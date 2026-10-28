/**
 * « J'ai tout saisi » (028, dette n° 20) : une journée se marque et se
 * démarque par convive, la moyenne d'énergie sur 7 jours ne porte alors que
 * sur les journées complètes et dit sur combien, et rien ne passe d'un foyer
 * à l'autre.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import type { Auth } from './auth/auth.ts';
import { withHousehold } from './db.ts';
import { buildTestAuth, signUpWithHousehold, TEST_BASE_URL, type TestHousehold } from './test-support/auth.ts';
import { closeTestPool, resetDatabase, SKIP_MESSAGE, testDatabaseUrl, testPool } from './test-support/db.ts';

const enabled = testDatabaseUrl() !== null;

describe('journées complètes', { skip: enabled ? false : SKIP_MESSAGE }, () => {
  let pool: pg.Pool;
  let auth: Auth;
  let app: FastifyInstance;
  let nous: TestHousehold;
  let voisins: TestHousehold;
  let adulte: string;

  const call = async (
    method: string, url: string, cookie: string, payload?: unknown,
  ): Promise<{ status: number; body: any }> => {
    const response = await app.inject({
      method: method as 'GET',
      url,
      headers: { cookie, origin: TEST_BASE_URL },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
    return { status: response.statusCode, body: response.json() };
  };
  const marquer = (cookie: string, eaterId: string, day: string, method = 'PUT') =>
    call(method, `/api/eaters/${eaterId}/days/${day}/complete`, cookie, method === 'PUT' ? {} : undefined);
  const bilan = async (date: string) =>
    (await call('GET', `/api/dashboard?date=${date}`, nous.cookie)).body.dashboard[0];

  before(async () => {
    pool = await testPool();
    auth = buildTestAuth(pool);
    app = buildApp({ pool, auth, baseURL: TEST_BASE_URL }, { webDir: '/dev/null/absent' });
    await app.ready();
  });

  after(async () => {
    await app.close();
    await closeTestPool();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
    nous = await signUpWithHousehold(auth, pool, 'nous@exemple.test', 'Chez nous');
    voisins = await signUpWithHousehold(auth, pool, 'voisins@exemple.test', 'Chez les voisins');
    adulte = (await call('POST', '/api/eaters', nous.cookie, {
      firstName: 'Adulte', birthDate: '1985-01-01', sex: 'M',
    })).body.eater.id;
  });

  it('se marque et se démarque, par convive', async () => {
    assert.equal((await bilan('2026-10-20')).complete, false);
    assert.equal((await marquer(nous.cookie, adulte, '2026-10-20')).status, 200);
    // Deux fois : idempotent.
    assert.equal((await marquer(nous.cookie, adulte, '2026-10-20')).status, 200);
    assert.equal((await bilan('2026-10-20')).complete, true);
    assert.equal((await bilan('2026-10-19')).complete, false, 'un jour, pas la semaine');

    assert.equal((await marquer(nous.cookie, adulte, '2026-10-20', 'DELETE')).status, 200);
    assert.equal((await bilan('2026-10-20')).complete, false);
  });

  it('refuse une date qui n’existe pas', async () => {
    assert.equal((await marquer(nous.cookie, adulte, '2026-02-30')).status, 400);
  });

  it('restreint la moyenne d’énergie aux journées complètes, et dit sur combien', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `insert into food (source, external_id, name, plant_based, kcal_100g, protein_100g, carb_100g, fat_100g, fiber_100g)
       values ('manuel', 'test-1', 'Riz cuit', true, 100, 2, 28, 0.3, 0.4) returning id`);
    const foodId = rows[0]!.id;
    // Le 19, seul un goûter saisi (300 kcal) ; le 20, la journée entière (1500 kcal).
    for (const [eaten_at, grams] of [['2026-10-19T16:00:00+02:00', 300], ['2026-10-20T12:30:00+02:00', 1500]] as const) {
      const { status } = await call('POST', '/api/meals', nous.cookie, {
        eaten_at, slot: 'dejeuner', source: 'manuel', participants: [{ eaterId: adulte }],
        items: [{ foodId, label: 'Riz', quantity: grams, unit: 'g', quantityG: grams }],
      });
      assert.equal(status, 201);
    }

    const avant = (await bilan('2026-10-20')).balance.energyAverage7d;
    assert.deepEqual([avant.average, avant.days, avant.completeOnly], [900, 2, false]);

    await marquer(nous.cookie, adulte, '2026-10-20');
    const après = (await bilan('2026-10-20')).balance.energyAverage7d;
    assert.deepEqual([après.average, après.days, après.completeOnly], [1500, 1, true]);
  });

  describe('étanchéité', () => {
    it('ne laisse pas marquer le convive du voisin', async () => {
      const leur = (await call('POST', '/api/eaters', voisins.cookie, {
        firstName: 'Voisin', birthDate: '1980-01-01', sex: 'F',
      })).body.eater.id;
      assert.equal((await marquer(nous.cookie, leur, '2026-10-20')).status, 404);
      const n = await withHousehold(pool, voisins.householdId, async (client) =>
        (await client.query('select 1 from day_complete')).rowCount);
      assert.equal(n, 0, 'aucune ligne écrite chez eux');
    });

    it('ne rend ni n’écrit aucune ligne d’un autre foyer, même sans filtre', async () => {
      await marquer(nous.cookie, adulte, '2026-10-20');
      const vus = await withHousehold(pool, voisins.householdId, async (client) =>
        (await client.query('select 1 from day_complete')).rowCount);
      assert.equal(vus, 0, 'la base filtre, même sans where');

      await assert.rejects(
        withHousehold(pool, voisins.householdId, (client) =>
          client.query(`insert into day_complete (household_id, eater_id, day) values ($1, $2, '2026-10-21')`,
            [nous.householdId, adulte])),
        /row-level security|violates/i,
      );
    });
  });
});
