/**
 * Le stock de plats à venir : ce qu'on a commandé et qu'on n'a pas encore
 * mangé. Pas de jour associé — on choisit le plat le jour même.
 *
 * Les deux choses qui comptent : un plat ne s'ajoute que depuis une recette
 * que le foyer connaît déjà, et le stock d'un foyer n'existe pas pour l'autre.
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

describe('plats à venir', { skip: enabled ? false : SKIP_MESSAGE }, () => {
  let pool: pg.Pool;
  let auth: Auth;
  let app: FastifyInstance;
  let nous: TestHousehold;
  let voisins: TestHousehold;
  let recetteId: string;

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
    // Une recette Jow est globale ; seul `household_recipe` dit qui la connaît.
    const { rows } = await pool.query<{ id: string }>(
      `insert into recipe (source, jow_recipe_id, title, base_servings)
       values ('jow', '650b16ade7cc8d0013ce4a6e', 'Galette végé', 2) returning id`,
    );
    recetteId = rows[0]!.id;
    for (const foyer of [nous, voisins]) {
      await withHousehold(pool, foyer.householdId, (client) =>
        client.query('insert into household_recipe (household_id, recipe_id) values ($1, $2)',
          [foyer.householdId, recetteId]));
    }
  });

  it('ajoute un plat depuis une recette connue, le liste, puis le retire', async () => {
    const ajout = await call('POST', '/api/upcoming-dishes', nous.cookie, { recipeId: recetteId });
    assert.equal(ajout.status, 201);
    const id = ajout.body.dish.id as string;

    const liste = await call('GET', '/api/upcoming-dishes', nous.cookie);
    assert.equal(liste.body.dishes.length, 1);
    assert.equal(liste.body.dishes[0].recipe.title, 'Galette végé');

    assert.equal((await call('DELETE', `/api/upcoming-dishes/${id}`, nous.cookie)).status, 200);
    assert.deepEqual((await call('GET', '/api/upcoming-dishes', nous.cookie)).body.dishes, []);
    assert.equal((await call('DELETE', `/api/upcoming-dishes/${id}`, nous.cookie)).status, 404);
  });

  it('accepte deux fois la même recette : une commande peut en contenir deux', async () => {
    await call('POST', '/api/upcoming-dishes', nous.cookie, { recipeId: recetteId });
    await call('POST', '/api/upcoming-dishes', nous.cookie, { recipeId: recetteId });
    assert.equal((await call('GET', '/api/upcoming-dishes', nous.cookie)).body.dishes.length, 2);
  });

  it('refuse une recette que le foyer ne connaît pas', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `insert into recipe (source, jow_recipe_id, title, base_servings)
       values ('jow', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'Inconnue', 2) returning id`,
    );
    const { status } = await call('POST', '/api/upcoming-dishes', nous.cookie, { recipeId: rows[0]!.id });
    assert.equal(status, 404);
  });

  describe('manger un plat du stock', () => {
    const manger = (cookie: string, id: string) =>
      call('POST', `/api/upcoming-dishes/${id}/eat`, cookie,
        { eatenAt: '2026-10-11T12:00:00Z', slot: 'dejeuner' });

    beforeEach(async () => {
      for (const [firstName, birthDate] of [['Léa', '2020-01-01'], ['Marc', '1985-03-02']]) {
        await call('POST', '/api/eaters', nous.cookie, { firstName, birthDate, sex: 'F' });
      }
    });

    it('crée le repas pour les convives actifs, fige les parts (Σ = 1) et retire le plat', async () => {
      const id = (await call('POST', '/api/upcoming-dishes', nous.cookie, { recipeId: recetteId })).body.dish.id;
      const { status, body } = await manger(nous.cookie, id);
      assert.equal(status, 201);

      const meal = (await call('GET', `/api/meals/${body.mealId}`, nous.cookie)).body.meal;
      assert.equal(meal.source, 'jow');
      assert.equal(meal.participants.length, 2);
      const somme = meal.participants.reduce((n: number, p: { share: number }) => n + Number(p.share), 0);
      assert.ok(Math.abs(somme - 1) < 1e-6, `Σ des parts = ${somme}`);
      assert.deepEqual((await call('GET', '/api/upcoming-dishes', nous.cookie)).body.dishes, []);
    });

    it('annuler = supprimer le repas et remettre la recette au stock', async () => {
      const id = (await call('POST', '/api/upcoming-dishes', nous.cookie, { recipeId: recetteId })).body.dish.id;
      const { body } = await manger(nous.cookie, id);
      assert.equal((await call('DELETE', `/api/meals/${body.mealId}`, nous.cookie)).status, 200);
      await call('POST', '/api/upcoming-dishes', nous.cookie, { recipeId: recetteId });
      assert.equal((await call('GET', '/api/upcoming-dishes', nous.cookie)).body.dishes.length, 1);
    });

    it('deux taps rapprochés : un seul repas, le second en 404', async () => {
      const id = (await call('POST', '/api/upcoming-dishes', nous.cookie, { recipeId: recetteId })).body.dish.id;
      const statuts = (await Promise.all([manger(nous.cookie, id), manger(nous.cookie, id)]))
        .map((r) => r.status).sort();
      assert.deepEqual(statuts, [201, 404]);
      const { rows } = await withHousehold(pool, nous.householdId, (db) =>
        db.query<{ n: number }>('select count(*)::int as n from meal'));
      assert.equal(rows[0]?.n, 1);
    });

    it('refuse un plat inconnu, ou celui d’un autre foyer, sans rien créer', async () => {
      const autre = (await call('POST', '/api/upcoming-dishes', voisins.cookie, { recipeId: recetteId })).body.dish.id;
      assert.equal((await manger(nous.cookie, autre)).status, 404);
      assert.equal((await call('GET', '/api/upcoming-dishes', voisins.cookie)).body.dishes.length, 1);
    });
  });

  describe('étanchéité', () => {
    it('le stock du voisin est invisible et intouchable par l’API', async () => {
      const { body } = await call('POST', '/api/upcoming-dishes', voisins.cookie, { recipeId: recetteId });
      assert.deepEqual((await call('GET', '/api/upcoming-dishes', nous.cookie)).body.dishes, []);
      assert.equal((await call('DELETE', `/api/upcoming-dishes/${body.dish.id}`, nous.cookie)).status, 404);
      assert.equal((await call('GET', '/api/upcoming-dishes', voisins.cookie)).body.dishes.length, 1);
    });

    it('la RLS cache la table même à une requête sans filtre', async () => {
      await call('POST', '/api/upcoming-dishes', voisins.cookie, { recipeId: recetteId });
      const n = await withHousehold(pool, nous.householdId, async (client) => {
        const { rows } = await client.query<{ n: string }>('select count(*) as n from upcoming_dish');
        return Number(rows[0]?.n);
      });
      assert.equal(n, 0);
    });
  });
});

describe('plats à venir — depuis une commande Jow', { skip: enabled ? false : SKIP_MESSAGE }, () => {
  it('ajoute les plats de la commande, compte ceux qui ne se lisent pas, ne garde aucun jeton', async (t) => {
    const pool = await testPool();
    const auth = buildTestAuth(pool);
    const app = buildApp({ pool, auth, baseURL: TEST_BASE_URL }, { webDir: '/dev/null/absent' });
    await app.ready();
    try {
      await resetDatabase(pool);
      const nous = await signUpWithHousehold(auth, pool, 'nous@exemple.test', 'Chez nous');
      const connue = '650b16ade7cc8d0013ce4a6e';
      const absente = 'f'.repeat(24);
      await pool.query(
        `insert into recipe (source, jow_recipe_id, title, base_servings)
         values ('jow', $1, 'Galette végé', 2)`, [connue]);
      const vues: string[] = [];
      t.mock.method(globalThis, 'fetch', (u: URL | string) => {
        vues.push(String(u));
        return Promise.resolve(String(u).includes('/share/link/details')
          ? Response.json({ meals: [{ recipe: { id: connue } }, { recipe: { id: connue } }, { recipe: { id: absente } }] })
          : new Response('', { status: 404 }));
      });

      const r = await app.inject({
        method: 'POST', url: '/api/upcoming-dishes/from-order',
        headers: { cookie: nous.cookie, origin: TEST_BASE_URL },
        payload: { text: 'https://jow.fr/cooking/recipes-selection/s1?key=SECRETKEY&userId=SECRETUSER' },
      });
      assert.equal(r.statusCode, 201, r.body);
      assert.equal(r.json().dishes.length, 2, 'même recette deux fois = deux lignes');
      assert.equal(r.json().failed, 1);
      assert.doesNotMatch(r.body, /SECRETKEY|SECRETUSER/);
      const liste = await app.inject({
        method: 'GET', url: '/api/upcoming-dishes',
        headers: { cookie: nous.cookie, origin: TEST_BASE_URL },
      });
      assert.equal(liste.json().dishes.length, 2);

      const sans = await app.inject({
        method: 'POST', url: '/api/upcoming-dishes/from-order',
        headers: { cookie: nous.cookie, origin: TEST_BASE_URL },
        payload: { text: 'pas un lien' },
      });
      assert.equal(sans.statusCode, 400);
    } finally {
      await app.close();
      await closeTestPool();
    }
  });
});
