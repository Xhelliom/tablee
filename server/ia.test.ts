/**
 * V3 — l'IA de bout en bout, avec de faux modèles : le découpage d'un repas,
 * l'assistant, et les recettes de l'accueil.
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
import { withHousehold } from './db.ts';
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
  let choisis: string[] = [];
  let conseillé: { facts: string; conversation: Turn[] } | null = null;
  /** Le faux assistant lâche après son premier morceau. */
  let enPanne = false;
  let recettes: string[] = [];
  /** Ce que le faux modèle d'image a reçu : exactement ce qui serait parti chez Google. */
  let dessinés: string[] = [];

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

  const oeuf = async (label: string): Promise<Record<string, unknown>> => {
    const { rows } = await pool.query<{ id: string }>(`select id from food where name = 'Oeuf, cru'`);
    return { foodId: rows[0]!.id, label, quantity: 110, unit: 'g', quantityG: 110 };
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
      chooseFoods: (lines: string): Promise<unknown> => {
        choisis.push(lines);
        return Promise.resolve({ choix: [{ ligne: 1, numero: 2 }, { ligne: 2, numero: 1 }] });
      },
      advise: (facts: string, conversation: Turn[], { onText }: { onText: (delta: string) => void }): Promise<string> => {
        conseillé = { facts, conversation };
        onText('Une soupe ');
        if (enPanne) return Promise.reject(new Error('le modèle a lâché en route'));
        onText('de légumes ?');
        return Promise.resolve('Une soupe de légumes ?');
      },
      suggestRecipes: (facts: string): Promise<unknown> => {
        recettes.push(facts);
        return Promise.resolve({
          propositions: [
            { numero: 1, raison: 'Des haricots rouges, pour les fibres.' },
            { numero: 9, raison: 'une recette inventée' },
          ],
          idees: [{ titre: 'Dahl de lentilles corail', raison: 'Des légumineuses, pour les fibres.' }],
        });
      },
    };
    const drawDish = (prompt: string): Promise<{ mimeType: string; bytes: Buffer }> => {
      dessinés.push(prompt);
      return Promise.resolve({ mimeType: 'image/png', bytes: Buffer.from('png') });
    };
    avecIA = buildApp({ pool, auth, baseURL: TEST_BASE_URL, llm, drawDish }, { webDir: '/dev/null/absent' });
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
    choisis = [];
    conseillé = null;
    enPanne = false;
    recettes = [];
    dessinés = [];
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
    assert.equal((await call(sansIA, 'POST', '/api/assistant/recipes')).status, 503);
    assert.equal((await call(sansIA, 'POST', `/api/meals/${crypto.randomUUID()}/image`)).status, 503);
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
      assert.equal(body.items[0].foodId, body.items[0].foods[0].id, 'un numéro hors liste laisse le premier de la recherche');
      assert.equal(body.items[1].foodId, null);
    });

    it('range en tête l’aliment que le modèle désigne par son numéro', async () => {
      await pool.query(
        `insert into food (source, external_id, name, plant_based) values ('manuel', 'oeuf-dur', 'Oeuf, dur, écalé', false)`,
      );
      const { body } = await call(avecIA, 'POST', '/api/meals/decoupage', { text: '2 œufs et une truffe' });
      assert.deepEqual(body.items[0].foods.map((food: any) => food.name), ['Oeuf, dur, écalé', 'Oeuf, cru']);
      assert.equal(body.items[0].foodId, body.items[0].foods[0].id, 'le choix est aussi la présélection');
      assert.deepEqual(body.items[1].foods, [], 'un numéro sans candidat ne fabrique rien');
      assert.equal(choisis.length, 1);
      assert.match(choisis[0]!, /Ligne 1 : 2 œufs\n1\. Oeuf, cru\n2\. Oeuf, dur, écalé/);
    });

    it('enregistre le repas comme une estimation, même entièrement rattaché (R6)', async () => {
      const { body: fiche } = await call(avecIA, 'POST', '/api/eaters', {
        firstName: 'Sam', birthDate: '1988-01-01', sex: 'M', self: true,
      });
      const { status, body } = await call(avecIA, 'POST', '/api/meals', {
        eatenAt: new Date().toISOString(), slot: 'petit_dej', source: 'ia',
        participants: [{ eaterId: fiche.eater.id, present: true }],
        items: [await oeuf('2 œufs')],
      });
      assert.equal(status, 201);
      assert.equal(body.meal.nutrition.confidence, 'moyenne');
    });
  });

  describe('l’image d’un plat décrit avec l’IA', () => {
    const repas = async (eaterId: string, fields: Record<string, unknown>): Promise<any> => {
      const { body } = await call(avecIA, 'POST', '/api/meals', {
        eatenAt: new Date().toISOString(), slot: 'diner', source: 'ia',
        participants: [{ eaterId, present: true }], ...fields,
      });
      return body.meal;
    };
    const truffe = (label: string): Record<string, unknown> => ({ foodId: null, label });

    it('dessine le plat une fois, sans prénom, et reprend l’image pour les mêmes ingrédients', async () => {
      const léa = await créerLéa();
      const items = [await oeuf('2 œufs'), truffe('truffe de Léa')];
      const premier = await repas(léa, { items, remainingServings: 1 });
      assert.equal(premier.imageUrl, null, 'rien avant qu’on la demande');

      const { status, body } = await call(avecIA, 'POST', `/api/meals/${premier.id}/image`, {
        description: 'Léa a mangé des œufs et une truffe',
      });
      assert.equal(status, 200);
      assert.match(body.imageUrl, /^\/api\/images\//);
      assert.equal(dessinés.length, 1);
      assert.match(dessinés[0]!, /Le repas : quelqu’un a mangé des œufs et une truffe/);
      assert.match(dessinés[0]!, /Ingrédients : Oeuf, cru, truffe de quelqu’un\./, 'le nom Ciqual plutôt que le libellé');
      assert.ok(!dessinés[0]!.includes('Léa'), dessinés[0]);

      assert.equal((await call(avecIA, 'GET', `/api/meals/${premier.id}`)).body.meal.imageUrl, body.imageUrl);
      const image = await avecIA.inject({ method: 'GET', url: body.imageUrl, headers: { cookie: foyer.cookie } });
      assert.equal(image.statusCode, 200);
      assert.equal(image.headers['content-type'], 'image/png');
      assert.equal(image.body, 'png');

      const second = await repas(léa, { items });
      const reprise = await call(avecIA, 'POST', `/api/meals/${second.id}/image`, {});
      assert.equal(reprise.body.imageUrl, body.imageUrl, 'mêmes ingrédients, même image');
      assert.equal(dessinés.length, 1, 'rien n’est redessiné');

      const restes = await repas(léa, { source: 'texte', leftoverOf: premier.id });
      assert.equal(restes.imageUrl, body.imageUrl, 'les restes gardent l’image du plat');
    });

    it('ne dessine pas un repas saisi à la main, ni ne montre l’image au foyer d’à côté (§16)', async () => {
      const léa = await créerLéa();
      const àLaMain = await repas(léa, { source: 'texte', items: [truffe('une truffe')] });
      assert.equal((await call(avecIA, 'POST', `/api/meals/${àLaMain.id}/image`, {})).status, 409);
      assert.deepEqual(dessinés, [], 'rien ne part');

      const décrit = await repas(léa, { items: [truffe('une truffe')] });
      const { body } = await call(avecIA, 'POST', `/api/meals/${décrit.id}/image`, {});
      const voisin = await signUpWithHousehold(auth, pool, 'voisin@exemple.test');
      const vue = await avecIA.inject({ method: 'GET', url: body.imageUrl, headers: { cookie: voisin.cookie } });
      assert.equal(vue.statusCode, 404);
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

    /** Une question, et les événements de la réponse dans l'ordre. */
    const poser = async (content: string): Promise<{ status: number; type: unknown; events: [string, unknown][] }> => {
      const response = await avecIA.inject({
        method: 'POST',
        url: '/api/assistant',
        headers: { cookie: foyer.cookie },
        payload: { messages: [{ role: 'user', content }] },
      });
      return {
        status: response.statusCode,
        type: response.headers['content-type'],
        events: response.payload.trim().split('\n\n').map((bloc): [string, unknown] => {
          const [event = '', data = ''] = bloc.split('\n');
          return [event.replace('event: ', ''), JSON.parse(data.replace('data: ', ''))];
        }),
      };
    };

    it('envoie la réponse par morceaux pendant la génération, puis celle qui fait foi', async () => {
      const { status, type, events } = await poser('Une idée ?');
      assert.equal(status, 200);
      assert.match(String(type), /^text\/event-stream/);
      assert.deepEqual(events, [
        ['texte', 'Une soupe '],
        ['texte', 'de légumes ?'],
        ['fin', { reply: 'Une soupe de légumes ?' }],
      ]);
    });

    it('dit qu’un flux a cassé en route, et répond encore à la question suivante', async () => {
      enPanne = true;
      assert.deepEqual((await poser('Une idée ?')).events, [
        ['texte', 'Une soupe '],
        ['erreur', { error: { code: 'ia_injoignable', message: 'l’assistant n’a pas répondu — réessayez dans un instant' } }],
      ]);
      enPanne = false;
      assert.deepEqual((await poser('Une idée ?')).events.at(-1), ['fin', { reply: 'Une soupe de légumes ?' }]);
    });

    it('résume le foyer en tranches d’âge, sans prénom ni date de naissance (I3)', async () => {
      const { status } = await poser('Léa aime les pâtes, une idée ?');
      assert.equal(status, 200);
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

  describe('l’assistant de recettes', () => {
    it('ne demande rien au modèle sur une semaine vide', async () => {
      const { status, body } = await call(avecIA, 'POST', '/api/assistant/recipes');
      assert.equal(status, 409);
      assert.equal(body.error.code, 'semaine_vide');
      assert.deepEqual(recettes, [], 'rien ne part');
    });

    it('choisit parmi les recettes du foyer, sans prénom ni date de naissance (I3)', async () => {
      const léa = await créerLéa();
      await pool.query(
        `insert into nutrient_reference (sex, age_min, age_max, nutrient, kind, basis,
                                         value, unit, derived, source)
         values ('ALL', 4, 120, 'fiber_g', 'AS', 'absolu', 20, 'g', false, 'repère de test')`,
      );
      const chili = await withHousehold(pool, foyer.householdId, async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `insert into recipe (source, jow_recipe_id, title, base_servings,
                               protein_serving, carb_serving, fat_serving, fiber_serving)
           values ('jow', '650b16ade7cc8d0013ce4a70', 'Chili sin carne', 4, 18, 40, 10, 10)
           returning id`,
        );
        await db.query(
          'insert into household_recipe (household_id, recipe_id) values ($1, $2)',
          [foyer.householdId, rows[0]!.id],
        );
        return rows[0]!.id;
      });
      // Hier : la journée en cours ne compte pas dans les moyennes.
      await call(avecIA, 'POST', '/api/meals', {
        eatenAt: new Date(Date.now() - 86_400_000).toISOString(), slot: 'diner', source: 'jow',
        recipeId: chili, servings: 1, participants: [{ eaterId: léa, present: true }],
      });

      const { status, body } = await call(avecIA, 'POST', '/api/assistant/recipes');
      assert.equal(status, 200);
      assert.deepEqual(
        body.proposals.map((p: any) => [p.recipe.title, p.reason]),
        [['Chili sin carne', 'Des haricots rouges, pour les fibres.']],
        'la recette inventée est jetée',
      );
      assert.deepEqual(body.ideas, [
        { title: 'Dahl de lentilles corail', reason: 'Des légumineuses, pour les fibres.' },
      ], 'une idée, elle, passe — sans aucune valeur');

      const [envoyé] = recettes;
      assert.ok(envoyé !== undefined);
      // 10 g de fibres sur un repère de 20 g.
      assert.match(envoyé, /- fibres : 50 % du repère du jour/);
      assert.match(envoyé, /Repères du moins atteint au plus atteint : fibres\./);
      assert.match(envoyé, /1\. Chili sin carne — /);
      assert.ok(!envoyé.includes('Léa'), envoyé);
      assert.ok(!envoyé.includes(NAISSANCE), envoyé);
      assert.equal(body.facts, envoyé, 'l’écran montre exactement ce qui est parti');
    });
  });
});
