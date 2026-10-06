/**
 * Tests d'intégration du super-admin (020), sur une vraie base.
 *
 * On y vérifie ce qui ferait mal en silence : que le premier connecté prenne
 * le siège, que les autres ne voient rien (`403`), que les listes se
 * cherchent et se paginent côté serveur, et qu'un lien verrouillé refuse la
 * voie du foyer tout en cédant à la voie admin.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { withHousehold } from './db.ts';
import type { Auth } from './auth/auth.ts';
import { buildTestAuth, signUpWithHousehold } from './test-support/auth.ts';
import type { TestHousehold } from './test-support/auth.ts';
import { closeTestPool, resetDatabase, SKIP_MESSAGE, testDatabaseUrl, testPool } from './test-support/db.ts';

const enabled = testDatabaseUrl() !== null;

describe('super-admin', { skip: enabled ? false : SKIP_MESSAGE }, () => {
  let pool: pg.Pool;
  let auth: Auth;
  let app: FastifyInstance;
  let premier: TestHousehold;
  let second: TestHousehold;

  const call = async (
    method: string, url: string, cookie: string, payload?: unknown,
  ): Promise<{ status: number; body: any }> => {
    const response = await app.inject({
      method: method as 'GET',
      url,
      ...(payload === undefined ? {} : { payload: payload as object }),
      headers: { cookie },
    });
    return { status: response.statusCode, body: response.json() };
  };

  before(async () => {
    pool = await testPool();
    auth = buildTestAuth(pool);
    app = buildApp({ pool, auth, baseURL: 'http://localhost' }, { webDir: '/dev/null/absent' });
    await app.ready();
  });

  after(async () => {
    await app.close();
    await closeTestPool();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
    premier = await signUpWithHousehold(auth, pool, 'premier@exemple.test');
    second = await signUpWithHousehold(auth, pool, 'second@exemple.test');
  });

  it('le premier connecté devient super-admin, pas le second', async () => {
    const moi = await call('GET', '/api/me', premier.cookie);
    assert.equal(moi.body.superadmin, true);
    const autre = await call('GET', '/api/me', second.cookie);
    assert.equal(autre.body.superadmin, false);
  });

  it('un non super-admin lit un 403 sur les listes', async () => {
    // Le premier prend le siège en touchant l'app avant l'autre : sans ça,
    // c'est le second qui gagnerait la course, et le test prouverait
    // l'inverse de ce qu'il veut dire.
    await call('GET', '/api/me', premier.cookie);
    for (const url of ['/api/admin/users', '/api/admin/households', '/api/admin/eater-links', '/api/admin/food-links', '/api/admin/unlinked-ingredients', '/api/admin/journal', '/api/admin/apercu']) {
      const { status } = await call('GET', url, second.cookie);
      assert.equal(status, 403, url);
    }
  });

  it('les comptes se cherchent et se paginent', async () => {
    const page1 = await call('GET', '/api/admin/users?limit=1&page=1', premier.cookie);
    assert.equal(page1.status, 200);
    assert.equal(page1.body.total, 2);
    assert.equal(page1.body.users.length, 1);

    const page2 = await call('GET', '/api/admin/users?limit=1&page=2', premier.cookie);
    assert.notEqual(page2.body.users[0].id, page1.body.users[0].id);

    const cherche = await call('GET', '/api/admin/users?q=prem', premier.cookie);
    assert.equal(cherche.body.total, 1);
    assert.match(cherche.body.users[0].email, /premier/);
  });

  it('un lien verrouillé refuse le foyer et cède à l’admin', async () => {
    const créé = await call('POST', '/api/eaters', premier.cookie, {
      firstName: 'Léa', birthDate: '2020-01-01', sex: 'F', claimEmail: 'femme@exemple.test',
    });
    assert.equal(créé.status, 201);
    const eaterId = créé.body.eater.id as string;

    const verrou = await call(
      'PATCH', `/api/admin/eater-links/${premier.householdId}/${eaterId}`,
      premier.cookie, { linkLocked: true },
    );
    assert.equal(verrou.status, 200);

    const refusé = await call('PUT', `/api/eaters/${eaterId}/compte`, premier.cookie, {
      email: 'autre@exemple.test',
    });
    assert.equal(refusé.status, 403);
    assert.equal(refusé.body.error.code, 'lien_verrouille');

    const réparé = await call(
      'PATCH', `/api/admin/eater-links/${premier.householdId}/${eaterId}`,
      premier.cookie, { email: 'autre@exemple.test' },
    );
    assert.equal(réparé.status, 200);
  });

  it('l’aperçu compte juste', async () => {
    const { status, body } = await call('GET', '/api/admin/apercu', premier.cookie);
    assert.equal(status, 200);
    assert.equal(body.apercu.comptes, 2);
    assert.equal(body.apercu.foyers, 2);
    assert.equal(body.apercu.superadmins, 1);
  });

  it('les ingrédients jamais rattachés se voient, puis se rattachent en masse', async () => {
    const food = await pool.query<{ id: string }>(
      "insert into food (source, name) values ('manuel', 'Carotte') returning id",
    );
    const foodId = food.rows[0]?.id as string;
    // `recipe` est sous RLS : on écrit depuis son foyer, comme une requête.
    const recetteId = await withHousehold(pool, premier.householdId, async (client) => {
      const recette = await client.query<{ id: string }>(
        'insert into recipe (source, title, household_id) values ($1, $2, $3) returning id',
        ['manuel', 'Soupe', premier.householdId],
      );
      const id = recette.rows[0]?.id as string;
      await client.query(
        `insert into recipe_ingredient (recipe_id, jow_food_id, label)
         values ($1, 'jow-carotte', 'Carotte Jow'), ($1, 'jow-carotte', 'Carotte Jow')`,
        [id],
      );
      return id;
    });
    assert.ok(recetteId);

    const vides = await call('GET', '/api/admin/unlinked-ingredients', premier.cookie);
    assert.equal(vides.status, 200);
    assert.equal(vides.body.total, 1);
    assert.equal(vides.body.unlinked[0].jowFoodId, 'jow-carotte');

    const rattaché = await call(
      'PATCH', '/api/admin/food-links/jow-carotte', premier.cookie, { foodId },
    );
    assert.equal(rattaché.status, 200);
    assert.equal(rattaché.body.propagated, 2);

    const plusVide = await call('GET', '/api/admin/unlinked-ingredients', premier.cookie);
    assert.equal(plusVide.body.total, 0);
    const pleines = await call('GET', '/api/admin/food-links?q=carotte', premier.cookie);
    assert.equal(pleines.body.total, 1);
  });

  it('l’impact se calcule sans rien écrire', async () => {
    const impactVide = await call('POST', '/api/admin/food-links/impact', premier.cookie, { ids: [] });
    assert.equal(impactVide.status, 400);

    const food = await pool.query<{ id: string }>(
      "insert into food (source, name) values ('manuel', 'Beurre') returning id",
    );
    const foodId = food.rows[0]?.id as string;
    await withHousehold(pool, premier.householdId, async (client) => {
      const recette = await client.query<{ id: string }>(
        'insert into recipe (source, title, household_id) values ($1, $2, $3) returning id',
        ['manuel', 'Gâteau', premier.householdId],
      );
      const id = recette.rows[0]?.id as string;
      await client.query(
        `insert into recipe_ingredient (recipe_id, jow_food_id, label)
         values ($1, 'jow-beurre', 'Beurre Jow'), ($1, 'jow-beurre', 'Beurre Jow')`,
        [id],
      );
    });

    const avant = await call('POST', '/api/admin/food-links/impact', premier.cookie, {
      ids: ['jow-beurre'],
    });
    assert.equal(avant.status, 200);
    assert.equal(avant.body.totaux.lignes, 2);
    assert.equal(avant.body.totaux.recettes, 1);
    // Calculé sans écrire : toujours pas de correspondance.
    const liens = await call('GET', '/api/admin/food-links?q=beurre', premier.cookie);
    assert.equal(liens.body.total, 0);

    const corrigé = await call('PATCH', '/api/admin/food-links/jow-beurre', premier.cookie, { foodId });
    assert.equal(corrigé.body.propagated, 2);
  });

  it('les gestes s’inscrivent au journal', async () => {
    const vide = await call('GET', '/api/admin/journal', premier.cookie);
    assert.equal(vide.body.total, 0);

    await call('POST', '/api/admin/superadmin', premier.cookie, {
      userId: second.userId, make: true,
    });
    const plein = await call('GET', '/api/admin/journal', premier.cookie);
    assert.equal(plein.body.total, 1);
    assert.equal(plein.body.journal[0].action, 'superadmin.nommer');
    assert.equal(plein.body.journal[0].target, second.userId);
    assert.equal(plein.body.journal[0].actorEmail, 'premier@exemple.test');

    const cherché = await call('GET', '/api/admin/journal?q=nommer', premier.cookie);
    assert.equal(cherché.body.total, 1);
    const àCôté = await call('GET', '/api/admin/journal?q=supprimer', premier.cookie);
    assert.equal(àCôté.body.total, 0);
  });
});
