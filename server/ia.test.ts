/**
 * V3 — l'IA de bout en bout, avec de faux modèles : le découpage d'un repas et
 * l'assistant.
 *
 * Aucun appel réseau : ce qui se vérifie ici est ce que Tablée fait **autour**
 * du modèle — ce qui part (sans prénom ni date de naissance, I3), ce qui
 * revient (rapproché de Ciqual, rien d'inventé), ce que devient un repas
 * découpé (une estimation, R6), et le refus poli d'une instance sans clé.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import type { Auth } from './auth/auth.ts';
import type { Turn } from './llm/conseil.ts';
import type { ProposedItem } from './llm/decoupage.ts';
import {
  buildTestAuth, signUpWithHousehold, TEST_BASE_URL, type TestHousehold,
} from './test-support/auth.ts';
import { closeTestPool, resetDatabase, SKIP_MESSAGE, testDatabaseUrl, testPool } from './test-support/db.ts';

const enabled = testDatabaseUrl() !== null;

/** Un enfant de 7 ans, calculé pour ne pas périmer avec le temps. */
const NAISSANCE = (() => {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - 7);
  date.setUTCDate(date.getUTCDate() - 10);
  return date.toISOString().slice(0, 10);
})();

describe('l’IA', { skip: enabled ? false : SKIP_MESSAGE }, () => {
  let pool: pg.Pool;
  let auth: Auth;
  let avecIA: FastifyInstance;
  let sansIA: FastifyInstance;
  let foyer: TestHousehold;
  /** Ce que les faux modèles ont reçu : exactement ce qui serait parti chez Anthropic. */
  let découpés: string[] = [];
  let conseillé: { facts: string; conversation: Turn[] } | null = null;

  const call = async (
    app: FastifyInstance, method: string, url: string, payload?: unknown,
  ): Promise<{ status: number; body: any }> => {
    const response = await app.inject({
      method: method as 'GET',
      url,
      headers: { cookie: foyer.cookie },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
    return { status: response.statusCode, body: response.json() };
  };

  const créerLéa = async (): Promise<string> => {
    const { body } = await call(avecIA, 'POST', '/api/eaters', {
      firstName: 'Léa', birthDate: NAISSANCE, sex: 'F', portionCoef: 0.5, diets: ['vegetarien'],
    });
    return body.eater.id;
  };

  before(async () => {
    pool = await testPool();
    auth = buildTestAuth(pool);
    const llm = {
      splitMeal: (text: string): Promise<ProposedItem[]> => {
        découpés.push(text);
        return Promise.resolve([
          { label: '2 œufs', search: 'oeuf', grams: 110 },
          { label: 'une truffe', search: 'truffe', grams: null },
        ]);
      },
      advise: (facts: string, conversation: Turn[]): Promise<string> => {
        conseillé = { facts, conversation };
        return Promise.resolve('Une soupe de légumes ?');
      },
    };
    avecIA = buildApp({ pool, auth, baseURL: TEST_BASE_URL, llm }, { webDir: '/dev/null/absent' });
    sansIA = buildApp({ pool, auth, baseURL: TEST_BASE_URL }, { webDir: '/dev/null/absent' });
    await avecIA.ready();
    await sansIA.ready();
  });

  after(async () => {
    await avecIA.close();
    await sansIA.close();
    await closeTestPool();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
    foyer = await signUpWithHousehold(auth, pool, 'papa@exemple.test');
    découpés = [];
    conseillé = null;
    await pool.query(
      `insert into food (source, external_id, name, plant_based,
                         kcal_100g, protein_100g, carb_100g, fat_100g, fiber_100g,
                         kcal_100g_max, protein_100g_max, carb_100g_max, fat_100g_max, fiber_100g_max)
       values ('manuel', 'oeuf', 'Oeuf, cru', false, 140, 12.5, 0.7, 9.8, 0, 140, 12.5, 0.7, 9.8, 0)`,
    );
  });

  it('dit que l’IA n’est pas là plutôt que de faire semblant', async () => {
    assert.equal((await call(avecIA, 'GET', '/api/me')).body.ia, true);
    assert.equal((await call(sansIA, 'GET', '/api/me')).body.ia, false);
    assert.equal((await call(sansIA, 'POST', '/api/meals/decoupage', { text: '2 œufs' })).status, 503);
    const question = { messages: [{ role: 'user', content: 'Une idée ?' }] };
    assert.equal((await call(sansIA, 'POST', '/api/assistant', question)).status, 503);
  });

  describe('le découpage d’un repas', () => {
    it('ne laisse pas partir les prénoms du foyer (I3)', async () => {
      await créerLéa();
      const { status } = await call(avecIA, 'POST', '/api/meals/decoupage', {
        text: 'Léa a mangé 2 œufs et une truffe',
      });
      assert.equal(status, 200);
      assert.deepEqual(découpés, ['quelqu’un a mangé 2 œufs et une truffe']);
    });

    it('rapproche chaque ligne de Ciqual, et n’invente rien quand il ne connaît pas', async () => {
      const { body } = await call(avecIA, 'POST', '/api/meals/decoupage', { text: '2 œufs et une truffe' });
      assert.equal(body.items[0].label, '2 œufs');
      assert.equal(body.items[0].grams, 110);
      assert.equal(body.items[0].foods[0].name, 'Oeuf, cru');
      assert.deepEqual(body.items[1].foods, []);
      assert.equal(body.items[1].grams, null);
    });

    it('enregistre le repas comme une estimation, même entièrement rattaché (R6)', async () => {
      const { body: fiche } = await call(avecIA, 'POST', '/api/eaters', {
        firstName: 'Sam', birthDate: '1988-01-01', sex: 'M', self: true,
      });
      const { rows } = await pool.query<{ id: string }>(`select id from food where name = 'Oeuf, cru'`);
      const { status, body } = await call(avecIA, 'POST', '/api/meals', {
        eatenAt: new Date().toISOString(), slot: 'petit_dej', source: 'ia',
        participants: [{ eaterId: fiche.eater.id, present: true }],
        items: [{ foodId: rows[0]!.id, label: '2 œufs', quantity: 110, unit: 'g', quantityG: 110 }],
      });
      assert.equal(status, 201);
      assert.equal(body.meal.nutrition.confidence, 'moyenne');
    });
  });

  describe('l’assistant', () => {
    beforeEach(async () => {
      await call(avecIA, 'POST', '/api/meals', {
        eatenAt: new Date(Date.now() - 86_400_000).toISOString(), slot: 'diner', source: 'texte',
        participants: [{ eaterId: await créerLéa(), present: true }],
        items: [{ foodId: null, label: 'gâteau de Léa' }],
      });
    });

    it('résume le foyer en tranches d’âge, sans prénom ni date de naissance (I3)', async () => {
      const { status, body } = await call(avecIA, 'POST', '/api/assistant', {
        messages: [{ role: 'user', content: 'Léa aime les pâtes, une idée ?' }],
      });
      assert.equal(status, 200);
      assert.equal(body.reply, 'Une soupe de légumes ?');
      assert.ok(conseillé !== null);
      const { facts, conversation } = conseillé;
      assert.match(facts, /1 enfant de 6-9 ans/);
      assert.match(facts, /1 végétarien/);
      assert.match(facts, /gâteau de quelqu’un/);
      assert.ok(!facts.includes('Léa'), facts);
      assert.ok(!facts.includes(NAISSANCE), facts);
      assert.deepEqual(conversation, [{ role: 'user', content: 'quelqu’un aime les pâtes, une idée ?' }]);
    });

    it('refuse une conversation qui ne finit pas par une question', async () => {
      const { status } = await call(avecIA, 'POST', '/api/assistant', {
        messages: [{ role: 'user', content: 'Bonjour' }, { role: 'assistant', content: 'Bonjour !' }],
      });
      assert.equal(status, 400);
      assert.equal(conseillé, null, 'rien ne part');
    });
  });
});
