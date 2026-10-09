/**
 * Repères de fréquence sur une vraie base : ce que la jointure garantit et
 * qu'un test unitaire ne voit pas — l'ingrédient Jow non rattaché ne remonte
 * pas, et la route n'expose rien par convive.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { withHousehold } from './db.ts';
import type { Auth } from './auth/auth.ts';
import { buildTestAuth, signUpWithHousehold, TEST_BASE_URL } from './test-support/auth.ts';
import { closeTestPool, resetDatabase, SKIP_MESSAGE, testDatabaseUrl, testPool } from './test-support/db.ts';

const enabled = testDatabaseUrl() !== null;

describe('repères de fréquence', { skip: enabled ? false : SKIP_MESSAGE }, () => {
  let pool: pg.Pool;
  let auth: Auth;
  let app: FastifyInstance;
  let cookie: string;
  let householdId: string;

  const sql = async <T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> =>
    withHousehold(pool, householdId, async (c) => (await c.query<T>(text, params)).rows);

  const week = async (): Promise<any> => {
    const r = await app.inject({ method: 'GET', url: '/api/week?from=2026-10-05&days=7', headers: { cookie } });
    assert.equal(r.statusCode, 200);
    return r.json();
  };
  const status = (body: any, code: string): any => body.frequencies.find((f: any) => f.code === code);

  before(async () => {
    pool = await testPool();
    auth = buildTestAuth(pool);
    app = buildApp({ pool, auth, baseURL: TEST_BASE_URL }, { webDir: '/dev/null/absent' });
    await app.ready();
  });
  after(async () => { await app.close(); await closeTestPool(); });

  beforeEach(async () => {
    await resetDatabase(pool);
    const foyer = await signUpWithHousehold(auth, pool, 'parent@exemple.test');
    householdId = foyer.householdId;
    cookie = foyer.cookie;
    await pool.query(
      `insert into frequency_reference (code, label, kind, value, categories, name_pattern, source, citation)
       values ('legumes_secs', 'Légumes secs', 'min_times', 2, '{legumineuse}', null, 'test', 'test'),
              ('charcuterie', 'Charcuterie', 'max_grams', 150, '{charcuterie}', null, 'test', 'test')`,
    );
  });

  const food = async (name: string, category: string): Promise<string> =>
    (await pool.query<{ id: string }>(
      "insert into food (source, name, category) values ('manuel', $1, $2) returning id", [name, category],
    )).rows[0]!.id;

  const eater = async (birth: string): Promise<string> =>
    (await sql<{ id: string }>(
      `insert into eater (household_id, first_name, birth_date, sex) values ($1, 'Test', $2, 'F') returning id`,
      [householdId, birth],
    ))[0]!.id;

  /** Un repas manuel avec ses lignes ; `foodId` null = non rattaché. */
  const meal = async (
    day: string, eaterId: string, items: { foodId: string | null; g: number; label?: string }[],
  ): Promise<void> => {
    const [m] = await sql<{ id: string }>(
      `insert into meal (household_id, eaten_at, slot, source) values ($1, $2, 'diner', 'manuel') returning id`,
      [householdId, `${day}T18:00:00Z`],
    );
    await sql('insert into meal_participant (meal_id, eater_id, share) values ($1, $2, 1)', [m!.id, eaterId]);
    for (const [i, it] of items.entries()) {
      await sql(
        'insert into meal_item (meal_id, food_id, label, quantity_g, position) values ($1, $2, $3, $4, $5)',
        [m!.id, it.foodId, it.label ?? 'x', it.g, i],
      );
    }
  };

  it('compte les légumes secs en fois, sur la semaine', async () => {
    const lentille = await food('Lentille', 'legumineuse');
    const a = await eater('1985-01-01');
    await meal('2026-10-05', a, [{ foodId: lentille, g: 100 }]);
    await meal('2026-10-07', a, [{ foodId: lentille, g: 100 }]);
    await meal('2026-10-14', a, [{ foodId: lentille, g: 100 }]); // hors fenêtre
    const s = status(await week(), 'legumes_secs');
    assert.equal(s.current, 2);
    assert.equal(s.met, true);
  });

  it('un ingrédient non rattaché ne fait pas baisser un compte', async () => {
    const lentille = await food('Lentille', 'legumineuse');
    const a = await eater('1985-01-01');
    await meal('2026-10-05', a, [{ foodId: lentille, g: 100 }, { foodId: null, g: 50, label: 'Pois chiches' }]);
    await meal('2026-10-06', a, [{ foodId: null, g: 200, label: 'Haricots' }]);
    const s = status(await week(), 'legumes_secs');
    assert.equal(s.current, 1, 'le repas rattaché compte, le non rattaché ne retire rien');
  });

  it('un plafond est calculé sur les adultes et reste au niveau du foyer', async () => {
    const jambon = await food('Jambon', 'charcuterie');
    const a = await eater('1985-01-01');
    const enfant = await eater('2018-01-01');
    await meal('2026-10-05', a, [{ foodId: jambon, g: 200 }]);
    await meal('2026-10-06', enfant, [{ foodId: jambon, g: 900 }]);
    const body = await week();
    assert.equal(status(body, 'charcuterie').current, 200, 'les grammes de l’enfant sont exclus');
    assert.equal(status(body, 'charcuterie').met, false);
    // Rien par convive : ni la semaine, ni le bilan du jour ne portent ces clés.
    assert.ok(body.eaters.every((e: any) => !('frequencies' in e)));
    const day = await app.inject({ method: 'GET', url: '/api/dashboard?date=2026-10-06', headers: { cookie } });
    assert.ok(!JSON.stringify(day.json()).includes('charcuterie'));
  });

  it('sans repas saisi, le compte est inconnu et non nul', async () => {
    const s = status(await week(), 'legumes_secs');
    assert.equal(s.current, null);
  });
});
