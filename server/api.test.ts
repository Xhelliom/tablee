/**
 * Tests d'intégration de l'API, sur une vraie base.
 *
 * On y vérifie ce qu'aucun test unitaire ne peut vérifier : que les parts
 * écrites en base survivent à un changement de coefficient, que la session
 * scope bien les lectures au foyer, et que les tables livrées vides donnent
 * les états attendus plutôt que des zéros.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { withHousehold } from './db.ts';
import type { Auth } from './auth/auth.ts';
import { buildTestAuth, signUp, signUpWithHousehold, TEST_BASE_URL } from './test-support/auth.ts';
import { closeTestPool, resetDatabase, SKIP_MESSAGE, testDatabaseUrl, testPool } from './test-support/db.ts';

const enabled = testDatabaseUrl() !== null;

describe('API', { skip: enabled ? false : SKIP_MESSAGE }, () => {
  let pool: pg.Pool;
  let auth: Auth;
  let app: FastifyInstance;
  let cookie: string;
  let householdId: string;

  const call = async (
    method: string,
    url: string,
    payload?: unknown,
    { auth = true } = {},
  ): Promise<{ status: number; body: any }> => {
    const response = await app.inject({
      method: method as 'GET',
      url,
      ...(payload === undefined ? {} : { payload: payload as object }),
      ...(auth && cookie !== undefined ? { headers: { cookie } } : {}),
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

  /**
   * Une requête SQL dans le foyer du test — l'équivalent de ce que fait le
   * serveur à chaque requête. Depuis la 008, un `pool.query` nu sur une table
   * du domaine ne voit ni n'écrit rien : c'est exactement la garantie qu'on
   * voulait, et le harnais doit s'y plier comme le reste.
   */
  const sql = async <T extends pg.QueryResultRow>(
    text: string, params: unknown[] = [], foyer = householdId,
  ): Promise<T[]> =>
    withHousehold(pool, foyer, async (client) => (await client.query<T>(text, params)).rows);

  beforeEach(async () => {
    await resetDatabase(pool);
    const foyer = await signUpWithHousehold(auth, pool, 'parent@exemple.test');
    householdId = foyer.householdId;
    cookie = foyer.cookie;
  });

  /**
   * « Qui a agi » vient de la session, pas du client.
   *
   * `meal.created_by` pointe vers un **compte** (migration 007). Le lire dans
   * le corps de la requête laissait attribuer un repas à n'importe qui — par
   * exemple à la nounou. Le champ n'est d'ailleurs pas exposé par l'API : il
   * se vérifie donc en base.
   */
  describe('qui a saisi', () => {
    it('attribue le repas au compte connecté, et ignore ce que le client prétend', async () => {
      const autre = '00000000-0000-4000-8000-000000000000';
      const { status, body } = await call('POST', '/api/meals', {
        eaten_at: '2026-09-13T19:30:00+02:00', slot: 'diner', source: 'manuel',
        created_by: autre,
        participants: [],
      });
      assert.equal(status, 201);

      const [row] = await sql<{ created_by: string | null }>(
        'select created_by from meal where id = $1', [body.meal.id],
      );
      assert.notEqual(row?.created_by, autre, 'le client ne choisit pas l’auteur');
      assert.equal(typeof row?.created_by, 'string', 'mais l’auteur est bien enregistré');
    });
  });

  // ── auth ──────────────────────────────────────────────────────────────────

  describe('session', () => {
    it('pose un cookie httpOnly, SameSite=Lax', async () => {
      // `SameSite=Lax` n'est pas un détail : le partage Android ouvre `/share`
      // par une navigation de haut niveau venue d'une autre application, et
      // `Strict` bloquerait le cookie — donc le chemin critique du produit.
      const response = await app.inject({
        method: 'POST', url: '/api/auth/sign-in/email',
        headers: { origin: TEST_BASE_URL },
        payload: { email: 'parent@exemple.test', password: 'motdepasse-de-test-long' },
      });
      assert.equal(response.statusCode, 200);
      const posé = String(response.headers['set-cookie']);
      assert.match(posé, /better-auth\.session_token=/);
      assert.match(posé, /HttpOnly/i);
      assert.match(posé, /SameSite=Lax/i);
    });

    it('refuse un mot de passe faux', async () => {
      const response = await app.inject({
        method: 'POST', url: '/api/auth/sign-in/email',
        headers: { origin: TEST_BASE_URL },
        payload: { email: 'parent@exemple.test', password: 'ce-n-est-pas-le-bon' },
      });
      assert.equal(response.statusCode, 401);
    });

    it('ferme l’API sans session', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/eaters' });
      assert.equal(response.statusCode, 401);
      assert.equal(response.json().error.code, 'non_authentifie');
    });

    it('invalide la session à la déconnexion', async () => {
      // `Origin` est exigé par la protection CSRF de better-auth sur toute
      // requête qui change l'état. Un navigateur en envoie un d'office ;
      // `app.inject` non, d'où sa présence ici et non dans le code client.
      const out = await app.inject({
        method: 'POST', url: '/api/auth/sign-out',
        headers: { cookie, origin: TEST_BASE_URL },
      });
      assert.equal(out.statusCode, 200);
      const { status } = await call('GET', '/api/eaters');
      assert.equal(status, 401);
    });

    /**
     * Trois états, et les confondre coûterait cher : un compte tout neuf est
     * **connecté** mais sans foyer. Le renvoyer vers l'écran de connexion
     * serait lui redemander un mot de passe qu'il vient de saisir.
     */
    it('distingue « pas connecté » de « connecté sans foyer »', async () => {
      const anonyme = await app.inject({ method: 'GET', url: '/api/me' });
      assert.equal(anonyme.json().state, 'anonyme');

      const seul = await signUp(auth, 'sans-foyer@exemple.test');
      const réponse = await app.inject({
        method: 'GET', url: '/api/me', headers: { cookie: seul.cookie },
      });
      assert.equal(réponse.statusCode, 200);
      assert.equal(réponse.json().state, 'sans_foyer');
      assert.deepEqual(réponse.json().households, []);

      // Et il n'a accès à rien tant qu'il n'a pas de foyer.
      const eaters = await app.inject({
        method: 'GET', url: '/api/eaters', headers: { cookie: seul.cookie },
      });
      assert.equal(eaters.statusCode, 401);
    });

    it('donne le foyer actif et le rôle', async () => {
      const { body } = await call('GET', '/api/me');
      assert.equal(body.state, 'actif');
      assert.equal(body.household.id, householdId);
      assert.equal(body.role, 'parent', 'celui qui crée le foyer en est parent');
    });
  });

  // ── membres ───────────────────────────────────────────────────────────────

  const addEater = async (
    firstName: string, birthDate: string, portionCoef = 1, sex: 'F' | 'M' = 'F',
  ): Promise<string> => {
    const { body } = await call('POST', '/api/eaters', { firstName, birthDate, sex, portionCoef });
    return body.eater.id;
  };

  describe('membres', () => {
    it('crée un membre et calcule son âge sans le stocker', async () => {
      const { status, body } = await call('POST', '/api/eaters', {
        firstName: 'Camille', birthDate: '2016-03-01', sex: 'F', portionCoef: 0.75,
      });
      assert.equal(status, 201);
      assert.equal(body.eater.portionCoef, 0.75);
      assert.equal(body.eater.minor, true);
      assert.ok(body.eater.age >= 9);
    });

    it('refuse un coefficient hors bornes', async () => {
      const { status } = await call('POST', '/api/eaters', {
        firstName: 'X', birthDate: '2000-01-01', sex: 'M', portionCoef: 5,
      });
      assert.equal(status, 400);
    });
  });

  // ── repas et parts ────────────────────────────────────────────────────────

  describe('repas', () => {
    it('calcule les parts côté serveur, et refuse celles du client', async () => {
      const adulte = await addEater('Adulte', '1985-01-01', 1, 'M');
      const enfant = await addEater('Enfant', '2016-01-01', 0.5);

      const refuse = await call('POST', '/api/meals', {
        eaten_at: '2026-09-13T19:30:00+02:00', slot: 'diner', source: 'manuel',
        participants: [{ eater_id: adulte, share: 0.9 }],
      });
      assert.equal(refuse.status, 400);

      const { body } = await call('POST', '/api/meals', {
        eaten_at: '2026-09-13T19:30:00+02:00', slot: 'diner', source: 'manuel',
        participants: [{ eaterId: adulte }, { eaterId: enfant }],
      });
      const shares = Object.fromEntries(
        body.meal.participants.map((p: { eaterId: string; share: number }) => [p.eaterId, p.share]),
      );
      assert.equal(shares[adulte], 0.667);
      assert.equal(shares[enfant], 0.333);
      assert.equal(shares[adulte] + shares[enfant], 1);
    });

    /**
     * « On n'a pas mangé ensemble le midi » : deux plats au même créneau, un
     * par personne. Chacun ne compte que pour qui l'a mangé — une part entière,
     * et rien dans le bilan de l'autre.
     */
    it('deux plats différents au même midi restent chacun à qui les a mangés', async () => {
      const moi = await addEater('Adulte', '1985-01-01', 1, 'M');
      const elle = await addEater('Adulte deux', '1987-01-01', 1);
      const enfant = await addEater('Enfant', '2016-01-01', 0.5);
      const riz = await insertFood(pool, 'Riz cuit', { kcal: 130, protein: 2.7, carb: 28, fat: 0.3, fiber: 0.4 }, true);
      const pates = await insertFood(pool, 'Pâtes cuites', { kcal: 150, protein: 5, carb: 30, fat: 1, fiber: 2 }, true);

      const plat = async (eaterId: string, foodId: string, label: string): Promise<any> =>
        (await call('POST', '/api/meals', {
          eaten_at: '2026-09-13T12:30:00+02:00', slot: 'dejeuner', source: 'manuel',
          participants: [{ eaterId }],
          items: [{ foodId, label, quantity: 100, unit: 'g', quantityG: 100 }],
        })).body.meal;
      const monPlat = await plat(moi, riz, 'Riz');
      const sonPlat = await plat(elle, pates, 'Pâtes');

      assert.deepEqual(monPlat.participants.map((p: any) => [p.eaterId, p.share]), [[moi, 1]]);
      assert.deepEqual(sonPlat.participants.map((p: any) => [p.eaterId, p.share]), [[elle, 1]]);

      const { body: jour } = await call('GET', '/api/meals?from=2026-09-13&to=2026-09-13');
      assert.equal(jour.meals.filter((m: any) => m.slot === 'dejeuner').length, 2);

      const { body: bilan } = await call('GET', '/api/dashboard?date=2026-09-13');
      const repas = Object.fromEntries(
        bilan.dashboard.map((e: any) => [e.eater.id, e.balance.mealCount]),
      );
      assert.deepEqual(repas, { [moi]: 1, [elle]: 1, [enfant]: 0 });
    });

    // ── Test structurant n° 2 (§15) ─────────────────────────────────────────
    it('avec 2 invités, Σ des parts < 1 et les assiettes du foyer ne gonflent pas', async () => {
      const adulte = await addEater('Adulte', '1985-01-01', 1, 'M');
      const adulte2 = await addEater('Adulte deux', '1987-01-01', 1);

      const sans = await call('POST', '/api/meals', {
        eaten_at: '2026-09-12T19:30:00+02:00', slot: 'diner', source: 'manuel',
        participants: [{ eaterId: adulte }, { eaterId: adulte2 }],
      });
      const avec = await call('POST', '/api/meals', {
        eaten_at: '2026-09-13T19:30:00+02:00', slot: 'diner', source: 'manuel',
        guest_count: 2,
        participants: [{ eaterId: adulte }, { eaterId: adulte2 }],
      });

      const total = (b: any): number =>
        Math.round(b.meal.participants.reduce((t: number, p: any) => t + p.share, 0) * 1000) / 1000;
      assert.equal(total(sans.body), 1);
      assert.equal(total(avec.body), 0.5);
      assert.ok(total(avec.body) < 1);
      for (const p of avec.body.meal.participants) assert.equal(p.share, 0.25);
    });

    // ── Test structurant n° 3 (§15) — R2 ────────────────────────────────────
    it('modifier un portion_coef ne change aucun repas passé', async () => {
      const adulte = await addEater('Adulte', '1985-01-01', 1, 'M');
      const enfant = await addEater('Enfant', '2016-01-01', 0.5);

      const { body: avant } = await call('POST', '/api/meals', {
        eaten_at: '2026-09-13T19:30:00+02:00', slot: 'diner', source: 'manuel',
        participants: [{ eaterId: adulte }, { eaterId: enfant }],
      });
      const mealId = avant.meal.id;
      const partsAvant = avant.meal.participants.map((p: any) => [p.eaterId, p.share]).sort();

      // L'enfant grandit : son coefficient passe de 0,5 à 1.
      const patch = await call('PATCH', `/api/eaters/${enfant}`, { portionCoef: 1 });
      assert.equal(patch.status, 200);
      assert.equal(patch.body.eater.portionCoef, 1);

      const { body: apres } = await call('GET', `/api/meals/${mealId}`);
      const partsApres = apres.meal.participants.map((p: any) => [p.eaterId, p.share]).sort();
      assert.deepEqual(partsApres, partsAvant, 'les parts d’un repas passé ont bougé');

      // Et le repas suivant, lui, prend bien le nouveau coefficient.
      const { body: suivant } = await call('POST', '/api/meals', {
        eaten_at: '2026-09-14T19:30:00+02:00', slot: 'diner', source: 'manuel',
        participants: [{ eaterId: adulte }, { eaterId: enfant }],
      });
      for (const p of suivant.meal.participants) assert.equal(p.share, 0.5);
    });

    it('recalcule la nutrition à la modification, sans toucher aux parts', async () => {
      const adulte = await addEater('Adulte', '1985-01-01', 1, 'M');
      const enfant = await addEater('Enfant', '2016-01-01', 0.5);
      const riz = await insertFood(pool, 'Riz cuit', { kcal: 130, protein: 2.7, carb: 28, fat: 0.3, fiber: 0.4 }, true);

      const { body: creation } = await call('POST', '/api/meals', {
        eaten_at: '2026-09-13T12:30:00+02:00', slot: 'dejeuner', source: 'manuel',
        participants: [{ eaterId: adulte }, { eaterId: enfant }],
        items: [{ foodId: riz, label: 'Riz', quantity: 100, unit: 'g', quantityG: 100 }],
      });
      assert.equal(creation.meal.nutrition.kcal, 130);
      const parts = creation.meal.participants.map((p: any) => p.share);

      const { body: modifie } = await call('PATCH', `/api/meals/${creation.meal.id}`, {
        items: [{ foodId: riz, label: 'Riz', quantity: 200, unit: 'g', quantityG: 200 }],
      });
      assert.equal(modifie.meal.nutrition.kcal, 260);
      assert.deepEqual(modifie.meal.participants.map((p: any) => p.share), parts);
    });

    it('n’écrit jamais le jeton d’un lien de partage dans raw_input (I6)', async () => {
      const adulte = await addEater('Adulte', '1985-01-01', 1, 'M');
      await call('POST', '/api/meals', {
        eaten_at: '2026-09-13T19:30:00+02:00', slot: 'diner', source: 'jow',
        participants: [{ eaterId: adulte }],
        raw_input:
          'Galette végé https://jow.fr/r?recipeId=650b16ade7cc8d0013ce4a6e&key=SECRET42&userId=abc123',
      });

      const rows = await sql<{ raw_input: string }>('select raw_input from meal');
      const stored = rows[0]?.raw_input ?? '';
      assert.doesNotMatch(stored, /SECRET42/);
      assert.doesNotMatch(stored, /abc123/);
      assert.doesNotMatch(stored, /key=/);
      assert.match(stored, /recipeId=650b16ade7cc8d0013ce4a6e/);
    });

    it('ne rend que les repas du foyer de la session', async () => {
      const adulte = await addEater('Adulte', '1985-01-01', 1, 'M');
      await call('POST', '/api/meals', {
        eaten_at: '2026-09-13T19:30:00+02:00', slot: 'diner', source: 'manuel',
        participants: [{ eaterId: adulte }],
      });

      const voisins = await signUpWithHousehold(auth, pool, 'voisin@exemple.test', 'Voisins');
      // Écrit **dans le foyer des voisins**, comme le ferait leur propre
      // session. La RLS interdit désormais d'écrire chez eux depuis ici.
      await sql(
        `insert into meal (household_id, eaten_at, slot, source)
         values ($1, '2026-09-13T19:30:00+02:00', 'diner', 'manuel')`,
        [voisins.householdId], voisins.householdId,
      );

      const { body } = await call('GET', '/api/meals?from=2026-09-13&to=2026-09-13');
      assert.equal(body.meals.length, 1);
    });
  });


  // ── anti-friction : templates et restes (§6bis) ───────────────────────────

  describe('templates et restes', () => {
    it('rejoue un template avec les coefficients du jour, pas ceux d’hier', async () => {
      const adulte = await addEater('Adulte', '1985-01-01', 1, 'M');
      const enfant = await addEater('Enfant', '2016-01-01', 0.5);
      const pain = await insertFood(pool, 'Pain complet', { kcal: 250, protein: 9 }, true);

      const { body: origine } = await call('POST', '/api/meals', {
        eaten_at: '2026-09-13T07:30:00+02:00', slot: 'petit_dej', source: 'texte',
        participants: [{ eaterId: adulte }, { eaterId: enfant }],
        items: [{ foodId: pain, label: 'Pain', quantity: 100, unit: 'g', quantityG: 100 }],
      });

      const { status, body: cree } = await call('POST', '/api/templates', {
        mealId: origine.meal.id, name: 'Petit-déj de la maison',
      });
      assert.equal(status, 201);
      assert.equal(cree.template.useCount, 0);

      // L'enfant grandit entre la création du template et son usage.
      await call('PATCH', `/api/eaters/${enfant}`, { portionCoef: 1 });

      const applique = await call('POST', `/api/templates/${cree.template.id}/apply`, {
        slot: 'petit_dej',
      });
      assert.equal(applique.status, 201);
      for (const p of applique.body.meal.participants) assert.equal(p.share, 0.5);
      assert.equal(applique.body.meal.nutrition.kcal, 250);
      assert.equal(applique.body.meal.source, 'template');

      // Le repas d'origine, lui, n'a pas bougé (R2).
      const { body: inchange } = await call('GET', `/api/meals/${origine.meal.id}`);
      const parts = Object.fromEntries(
        inchange.meal.participants.map((p: any) => [p.eaterId, p.share]),
      );
      assert.equal(parts[adulte], 0.667);
      assert.equal(parts[enfant], 0.333);

      const { body: liste } = await call('GET', '/api/templates');
      assert.equal(liste.templates[0].useCount, 1);
    });

    it('ne propose en restes que les plats entamés des 3 derniers jours', async () => {
      const adulte = await addEater('Adulte', '1985-01-01', 1, 'M');
      const { rows } = await pool.query<{ id: string }>(
        `insert into recipe (source, jow_recipe_id, title, base_servings)
         values ('jow', '650b16ade7cc8d0013ce4a6e', 'Gratin de courgettes', 4) returning id`,
      );
      const recipeId = rows[0]!.id;

      // Un plat d'hier dont il reste un quart : proposé.
      const hier = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { body: source } = await call('POST', '/api/meals', {
        eaten_at: hier, slot: 'diner', source: 'jow', recipe_id: recipeId,
        servings: 3, remaining_servings: 1,
        participants: [{ eaterId: adulte }],
      });
      assert.equal(source.meal.remainingServings, 1);
      // Le même plat, fini : rien à resservir.
      await call('POST', '/api/meals', {
        eaten_at: hier, slot: 'dejeuner', source: 'jow', recipe_id: recipeId,
        servings: 4, remaining_servings: 0,
        participants: [{ eaterId: adulte }],
      });
      // Un repas sans recette, fini : rien à resservir.
      await call('POST', '/api/meals', {
        eaten_at: hier, slot: 'dejeuner', source: 'texte',
        participants: [{ eaterId: adulte }],
      });
      // Une pizza maison dont il reste un quart : proposée, recette ou pas.
      const { body: pizza } = await call('POST', '/api/meals', {
        eaten_at: hier, slot: 'gouter', source: 'texte',
        servings: 0.75, remaining_servings: 0.25,
        items: [{ foodId: null, label: 'Pizza maison', quantity: 600, unit: 'g', quantityG: 600 }],
        participants: [{ eaterId: adulte }],
      });
      const ids = (b: { meals: { id: string }[] }): string[] => b.meals.map((m) => m.id).sort();
      // Un plat d'il y a dix jours : hors fenêtre.
      await sql(
        `insert into meal (household_id, eaten_at, slot, source, recipe_id, remaining_servings)
         values ($1, now() - interval '10 days', 'diner', 'jow', $2, 1)`,
        [householdId, recipeId],
      );

      const { body } = await call('GET', '/api/meals/leftovers?days=3');
      assert.deepEqual(ids(body), [source.meal.id, pizza.meal.id].sort());

      // Le 2e service pointe la même recette et garde sa traçabilité, sans
      // contrainte sur la somme des parts (§6bis). Il n'est pas fini non plus.
      const { body: restes } = await call('POST', '/api/meals', {
        eaten_at: new Date().toISOString(), slot: 'dejeuner', source: 'jow',
        recipe_id: recipeId, servings: 1.5, remaining_servings: 0.5, leftover_of: source.meal.id,
        participants: [{ eaterId: adulte }],
      });
      assert.ok(restes.meal !== undefined, JSON.stringify(restes));
      assert.equal(restes.meal.leftoverOf, source.meal.id);
      assert.equal(restes.meal.recipe.id, recipeId);

      // Le plat d'hier sort du frigo ; ce 2e service y entre à sa place.
      const { body: apres } = await call('GET', '/api/meals/leftovers?days=3');
      assert.deepEqual(ids(apres), [restes.meal.id, pizza.meal.id].sort());

      // « Il n'en reste rien », dit après coup : ce service quitte le frigo.
      await call('PATCH', `/api/meals/${restes.meal.id}`, { remainingServings: 0 });
      const { body: ensuite } = await call('GET', '/api/meals/leftovers?days=3');
      assert.deepEqual(ids(ensuite), [pizza.meal.id]);

      // Resservir la pizza sans envoyer de composition : le serveur reprend
      // celle du plat, réduite à ce qui restait.
      const { body: part } = await call('POST', '/api/meals', {
        eaten_at: new Date().toISOString(), slot: 'diner', source: 'texte',
        leftover_of: pizza.meal.id, servings: 1, participants: [{ eaterId: adulte }],
      });
      assert.equal(part.meal.items[0].quantityG, 150);   // 600 g × ¼
    });

    it('repère un repas qui revient trois fois, et se tait après le template', async () => {
      const adulte = await addEater('Adulte', '1985-01-01', 1, 'M');
      const pain = await insertFood(pool, 'Pain complet', { kcal: 250 }, true);

      for (const day of ['2026-09-11', '2026-09-12', '2026-09-13']) {
        await call('POST', '/api/meals', {
          eaten_at: `${day}T07:30:00+02:00`, slot: 'petit_dej', source: 'texte',
          participants: [{ eaterId: adulte }],
          items: [{ foodId: pain, label: 'Pain', quantity: 80, unit: 'g', quantityG: 80 }],
        });
      }

      const { body } = await call('GET', '/api/templates/suggestions');
      assert.equal(body.suggestions.length, 1);
      assert.equal(body.suggestions[0].occurrences, 3);
      assert.equal(body.suggestions[0].slot, 'petit_dej');

      // Une fois le template créé, la suggestion disparaît : on ne propose pas
      // de créer ce qui existe.
      await call('POST', '/api/templates', {
        mealId: body.suggestions[0].mealId, name: 'Petit-déj',
      });
      const { body: apres } = await call('GET', '/api/templates/suggestions');
      assert.deepEqual(apres.suggestions, []);
    });

    it('ne suggère rien pour deux occurrences', async () => {
      const adulte = await addEater('Adulte', '1985-01-01', 1, 'M');
      const pain = await insertFood(pool, 'Pain', { kcal: 250 }, true);
      for (const day of ['2026-09-12', '2026-09-13']) {
        await call('POST', '/api/meals', {
          eaten_at: `${day}T07:30:00+02:00`, slot: 'petit_dej', source: 'texte',
          participants: [{ eaterId: adulte }],
          items: [{ foodId: pain, label: 'Pain', quantity: 80, unit: 'g', quantityG: 80 }],
        });
      }
      const { body } = await call('GET', '/api/templates/suggestions');
      assert.deepEqual(body.suggestions, []);
    });
  });


  // ── encadrements (bornes publiées par Ciqual) ─────────────────────────────

  describe('bornes de quantification', () => {
    it('encadre un total plutôt que de le déclarer inconnu', async () => {
      const adulte = await addEater('Adulte', '1985-01-01', 1, 'M');
      // La banane : Ciqual publie « < 0,5 » pour les lipides — un majorant.
      const banane = await insertFood(
        pool, 'Banane, pulpe, crue',
        { kcal: 90.5, protein: 1.06, carb: 19.7, fiber: 2.7, fat: 0 },
        true, { fat: 0.5 },
      );
      const beurre = await insertFood(
        pool, 'Beurre', { kcal: 753, protein: 0.7, carb: 0.9, fiber: 0, fat: 82.9 }, false,
      );

      const { body } = await call('POST', '/api/meals', {
        eaten_at: '2026-09-13T07:30:00+02:00', slot: 'petit_dej', source: 'texte',
        participants: [{ eaterId: adulte }],
        items: [
          { foodId: banane, label: 'Banane', quantity: 100, unit: 'g', quantityG: 100 },
          { foodId: beurre, label: 'Beurre', quantity: 10, unit: 'g', quantityG: 10 },
        ],
      });

      // 8,29 g de beurre + entre 0 et 0,5 g de banane.
      assert.equal(body.meal.nutrition.fatG, 8.29, 'borne basse');
      assert.equal(body.meal.nutrition.max.fatG, 8.79, 'borne haute');
      // Et le majorant n'est jamais pris pour une mesure.
      assert.notEqual(body.meal.nutrition.fatG, 8.79);

      const { body: bilan } = await call('GET', '/api/dashboard?date=2026-09-13');
      const lipides = bilan.dashboard
        .find((d: any) => d.eater.id === adulte)
        .balance.bars.find((b: any) => b.nutrient === 'fatG');
      assert.equal(lipides.state, 'encadre');
      assert.equal(lipides.consumed, 8.29);
      assert.equal(lipides.consumedMax, 8.79);
    });

    it('garde ce qui est su quand un aliment échappe au référentiel', async () => {
      const adulte = await addEater('Adulte', '1985-01-01', 1, 'M');
      const riz = await insertFood(pool, 'Riz cuit', { kcal: 130, protein: 2.7 }, true);

      const { body } = await call('POST', '/api/meals', {
        eaten_at: '2026-09-13T12:30:00+02:00', slot: 'dejeuner', source: 'texte',
        participants: [{ eaterId: adulte }],
        items: [
          { foodId: riz, label: 'Riz', quantity: 100, unit: 'g', quantityG: 100 },
          { label: 'Plat de la cantine', quantity: 200, unit: 'g', quantityG: 200 },
        ],
      });

      // Le riz est compté, la cantine déborne le haut : « au moins 2,7 g ».
      assert.equal(body.meal.nutrition.proteinG, 2.7);
      assert.equal(body.meal.nutrition.max.proteinG, null);
      assert.equal(body.meal.nutrition.confidence, 'basse');

      const { body: bilan } = await call('GET', '/api/dashboard?date=2026-09-13');
      const proteines = bilan.dashboard
        .find((d: any) => d.eater.id === adulte)
        .balance.bars.find((b: any) => b.nutrient === 'proteinG');
      assert.equal(proteines.state, 'partiel');
      assert.equal(proteines.consumed, 2.7);
      assert.equal(proteines.consumedMax, null);
    });
  });


  // ── rattachement des ingrédients Jow ──────────────────────────────────────

  describe('mes recettes', () => {
    /**
     * Une recette Jow en base, **globale** : `household_id` est NULL pour une
     * recette Jow (007), et c'est `household_recipe` qui dit qui la connaît.
     */
    const recette = async (jowId: string, titre: string, foyer = householdId): Promise<string> => {
      // Upsert, comme `saveJowRecipe` : deux foyers qui lisent la même recette
      // Jow tombent sur **la même ligne**, c'est tout l'intérêt qu'elle soit
      // globale (007).
      const rows = await sql<{ id: string }>(
        `insert into recipe (source, jow_recipe_id, title, base_servings,
                             kcal_serving, protein_serving, carb_serving,
                             fat_serving, fiber_serving)
         values ('jow', $1, $2, 4, 320, 18, 16, 20, 12)
         on conflict (source, jow_recipe_id) do update set title = excluded.title
         returning id`,
        [jowId, titre], foyer,
      );
      const id = rows[0]!.id;
      await sql(
        `insert into household_recipe (household_id, recipe_id)
         values ($1, $2) on conflict do nothing`,
        [foyer, id], foyer,
      );
      return id;
    };

    it('liste ce que le foyer connaît, jamais mangé en tête', async () => {
      const mangée = await recette('650b16ade7cc8d0013ce4a6e', 'Galette végé');
      await recette('650b16ade7cc8d0013ce4a6f', 'Chili sin carne');

      await call('POST', '/api/meals', {
        eatenAt: new Date().toISOString(), slot: 'diner', source: 'jow',
        recipeId: mangée, servings: 2,
        participants: [{ eaterId: await addEater('Alex', '1988-04-12'), present: true }],
      });

      const { status, body } = await call('GET', '/api/recipes');
      assert.equal(status, 200);
      assert.deepEqual(body.recipes.map((r: any) => r.title), ['Chili sin carne', 'Galette végé']);

      const [chili, galette] = body.recipes;
      assert.equal(chili.lastEatenAt, null, 'jamais enregistrée comme repas');
      assert.equal(chili.timesEaten, 0);
      assert.equal(galette.timesEaten, 1);
      assert.ok(typeof galette.lastEatenAt === 'string');
    });

    /**
     * Le piège que cette suite existe pour attraper (§16).
     *
     * Une recette Jow est **globale** : la lire directement dans `recipe`
     * rendrait aussi celles que le foyer d'à côté a importées. Le titre d'une
     * recette est public ; le fait qu'une famille l'ait cherchée ne l'est pas.
     */
    it('ne montre pas les recettes lues par le foyer d’à côté', async () => {
      const voisins = await signUpWithHousehold(auth, pool, 'voisin@exemple.test');
      await recette('650b16ade7cc8d0013ce4a6e', 'Galette végé', voisins.householdId);

      const { body } = await call('GET', '/api/recipes');
      assert.deepEqual(body.recipes, [], 'rien de ce que les voisins ont lu');

      // Et la même recette, lue chez nous, devient nôtre sans être dupliquée.
      const partagée = await recette('650b16ade7cc8d0013ce4a6e', 'Galette végé');
      const { body: après } = await call('GET', '/api/recipes');
      assert.deepEqual(après.recipes.map((r: any) => r.id), [partagée]);
    });

    it('enregistre un repas depuis une recette déjà connue, sans texte d’origine', async () => {
      const id = await recette('650b16ade7cc8d0013ce4a6e', 'Galette végé');

      // Ce que fait l'écran « Mes recettes » : relire, puis enregistrer.
      const { status, body: lue } = await call('GET', `/api/recipes/${id}`);
      assert.equal(status, 200);
      assert.equal(lue.recipe.title, 'Galette végé');

      const { status: créé, body } = await call('POST', '/api/meals', {
        eatenAt: new Date().toISOString(), slot: 'dejeuner', source: 'jow',
        recipeId: id, servings: 2,
        participants: [{ eaterId: await addEater('Alex', '1988-04-12'), present: true }],
      });
      assert.equal(créé, 201);
      assert.equal(body.meal.recipe.id, id);
      // §6bis : 2 parts mangées sur 4 prévues. Rien n'oblige à finir le plat.
      assert.equal(body.meal.servings, 2);

      const rows = await sql<{ raw_input: string | null }>(
        'select raw_input from meal where id = $1', [body.meal.id],
      );
      assert.equal(rows[0]!.raw_input, null, 'aucun texte de partage à inventer');
    });
  });

  describe('jow_food_link', () => {
    /** Deux recettes Jow partageant le même ingrédient, comme dans la vraie vie. */
    const deuxRecettes = async (): Promise<{ a: string; b: string; ingredientA: string }> => {
      const recipes: string[] = [];
      for (const [jowId, titre] of [
        ['650b16ade7cc8d0013ce4a6e', 'Galette végé'],
        ['650b16ade7cc8d0013ce4a6f', 'Purée du soir'],
      ] as const) {
        const { rows } = await pool.query<{ id: string }>(
          `insert into recipe (source, jow_recipe_id, title, base_servings,
                               kcal_serving, protein_serving, carb_serving,
                               fat_serving, fiber_serving)
           values ('jow', $1, $2, 1, 320, 18, 16, 20, 12) returning id`,
          [jowId, titre],
        );
        const recipeId = rows[0]!.id;
        await pool.query(
          `insert into recipe_ingredient
             (recipe_id, jow_food_id, label, quantity, unit, quantity_g, position)
           values ($1, '63f4c8cc9b0e113c174f3eb0', 'Purée de carotte (surgelée)',
                   0.1, 'Kilogramme', 100, 0)`,
          [recipeId],
        );
        recipes.push(recipeId);
      }
      const { rows: ing } = await pool.query<{ id: string }>(
        'select id from recipe_ingredient where recipe_id = $1',
        [recipes[0]],
      );
      return { a: recipes[0]!, b: recipes[1]!, ingredientA: ing[0]!.id };
    };

    it('propage le rattachement à toutes les recettes qui emploient l’ingrédient', async () => {
      const { b, ingredientA } = await deuxRecettes();
      const carotte = await insertFood(pool, 'Carotte, cuite', { kcal: 33, fiber: 2.8 }, true);

      const { body } = await call(
        'POST', `/api/recipes/ingredients/${ingredientA}/food`, { foodId: carotte },
      );
      assert.equal(body.jowFoodId, '63f4c8cc9b0e113c174f3eb0');
      assert.equal(body.propagated, 2, 'les deux recettes doivent être câblées');

      // La seconde recette, jamais ouverte, est câblée elle aussi.
      const { body: autre } = await call('GET', `/api/recipes/${b}`);
      assert.equal(autre.recipe.ingredients[0].foodId, carotte);
    });

    it('câble d’avance une recette partagée après coup', async () => {
      const { ingredientA } = await deuxRecettes();
      const carotte = await insertFood(pool, 'Carotte, cuite', { kcal: 33 }, true);
      await call('POST', `/api/recipes/ingredients/${ingredientA}/food`, { foodId: carotte });

      // Une troisième recette arrive avec le même ingrédient.
      const { rows } = await pool.query<{ id: string }>(
        `insert into recipe (source, jow_recipe_id, title, base_servings)
         values ('jow', '650b16ade7cc8d0013ce4a70', 'Soupe', 1) returning id`,
      );
      await pool.query(
        `insert into recipe_ingredient
           (recipe_id, jow_food_id, label, quantity, unit, quantity_g, position)
         values ($1, '63f4c8cc9b0e113c174f3eb0', 'Purée de carotte (surgelée)',
                 0.2, 'Kilogramme', 200, 0)`,
        [rows[0]!.id],
      );
      const { applyKnownLinks } = await import('./repo/recipes.ts');
      // `applyKnownLinks` exige un client marqué au foyer, comme tout
      // `server/repo/` : le pool n'est plus un `Db` acceptable.
      const liés = await withHousehold(pool, householdId, (client) =>
        applyKnownLinks(client, rows[0]!.id));
      assert.equal(liés, 1);

      const { body } = await call('GET', `/api/recipes/${rows[0]!.id}`);
      assert.equal(body.recipe.ingredients[0].foodId, carotte);
    });

    it('recalcule la part végétale des repas concernés', async () => {
      const adulte = await addEater('Adulte', '1985-01-01', 1, 'M');
      const { a, ingredientA } = await deuxRecettes();
      const carotte = await insertFood(pool, 'Carotte, cuite', { kcal: 33 }, true);

      const { body: avant } = await call('POST', '/api/meals', {
        eaten_at: '2026-09-13T19:30:00+02:00', slot: 'diner', source: 'jow',
        recipe_id: a, servings: 2, participants: [{ eaterId: adulte }],
      });
      // Aucun ingrédient rattaché : pas de part végétale, et surtout pas 0 %.
      assert.equal(avant.meal.nutrition.plantRatio, null);

      const { body: lien } = await call(
        'POST', `/api/recipes/ingredients/${ingredientA}/food`, { foodId: carotte },
      );
      assert.equal(lien.recomputed, 1);

      const { body: apres } = await call('GET', `/api/meals/${avant.meal.id}`);
      assert.equal(apres.meal.nutrition.plantRatio, 100);
      // Les valeurs nutritionnelles, elles, viennent toujours du snapshot Jow.
      assert.equal(apres.meal.nutrition.proteinG, 36);
    });

    it('détacher oublie la correspondance au lieu de la réappliquer', async () => {
      const { b, ingredientA } = await deuxRecettes();
      const carotte = await insertFood(pool, 'Carotte, cuite', { kcal: 33 }, true);
      await call('POST', `/api/recipes/ingredients/${ingredientA}/food`, { foodId: carotte });

      await call('POST', `/api/recipes/ingredients/${ingredientA}/food`, { foodId: null });
      const { body } = await call('GET', `/api/recipes/${b}`);
      assert.equal(body.recipe.ingredients[0].foodId, null);

      const { body: liens } = await call('GET', '/api/recipes/links');
      assert.deepEqual(liens.links, []);
    });
  });


  // ── saisonnalité et fuseau du foyer ───────────────────────────────────────

  describe('mois de saisonnalité', () => {
    /** Un produit de saison rattaché à un aliment, pour pouvoir être coché. */
    const courgette = async (): Promise<string> => {
      const foodId = await insertFood(pool, 'Courgette, crue', { kcal: 15 }, true);
      await pool.query(
        `insert into seasonal_produce (name, kind, months, food_id)
         values ('Courgette', 'legume', '{6,7,8,9}', $1)`,
        [foodId],
      );
      return foodId;
    };

    it('rattache un repas de fin de mois au mois du foyer, pas à celui d’UTC', async () => {
      const adulte = await addEater('Adulte', '1985-01-01', 1, 'M');
      const foodId = await courgette();
      const { rows } = await pool.query<{ id: string }>(
        `insert into recipe (source, jow_recipe_id, title, base_servings)
         values ('jow', '650b16ade7cc8d0013ce4a6e', 'Gratin', 1) returning id`,
      );
      await pool.query(
        `insert into recipe_ingredient (recipe_id, food_id, label, quantity, unit, quantity_g, position)
         values ($1, $2, 'Courgette', 0.2, 'Kilogramme', 200, 0)`,
        [rows[0]!.id, foodId],
      );

      // 31 août, 23 h 30 heure de Paris — soit le 31 août 21 h 30 en UTC.
      // Les deux tombent en août, donc le badge doit compter la courgette.
      const { body: aout } = await call('POST', '/api/meals', {
        eaten_at: '2026-08-31T23:30:00+02:00', slot: 'diner', source: 'jow',
        recipe_id: rows[0]!.id, participants: [{ eaterId: adulte }],
      });
      assert.equal(aout.meal.seasonalCount, 1, 'août : la courgette est de saison');

      // 1er septembre, 0 h 30 heure de Paris — soit le 31 août 22 h 30 en UTC.
      // C'est septembre pour le foyer, et la courgette l'est encore.
      const { body: septembre } = await call('POST', '/api/meals', {
        eaten_at: '2026-09-01T00:30:00+02:00', slot: 'collation', source: 'jow',
        recipe_id: rows[0]!.id, participants: [{ eaterId: adulte }],
      });
      assert.equal(septembre.meal.seasonalCount, 1);

      // 1er octobre, 0 h 30 heure de Paris — le 30 septembre 22 h 30 en UTC.
      // Lu en UTC, la courgette serait encore de saison ; pour le foyer, non.
      const { body: octobre } = await call('POST', '/api/meals', {
        eaten_at: '2026-10-01T00:30:00+02:00', slot: 'collation', source: 'jow',
        recipe_id: rows[0]!.id, participants: [{ eaterId: adulte }],
      });
      assert.equal(
        octobre.meal.seasonalCount, 0,
        'le foyer est en octobre, même si UTC est encore en septembre',
      );
    });

    it('coche ce qui a été mangé le mois demandé, pas le mois courant', async () => {
      const adulte = await addEater('Adulte', '1985-01-01', 1, 'M');
      const foodId = await courgette();
      await call('POST', '/api/meals', {
        eaten_at: '2026-07-15T12:30:00+02:00', slot: 'dejeuner', source: 'texte',
        participants: [{ eaterId: adulte }],
        items: [{ foodId, label: 'Courgette', quantity: 200, unit: 'g', quantityG: 200 }],
      });

      const juillet = await call('GET', '/api/dashboard?date=2026-07-15');
      assert.equal(juillet.body.seasonal[0].eatenThisMonth, true);

      // Même produit, autre mois : rien n'a été mangé en août.
      const aout = await call('GET', '/api/dashboard?date=2026-08-15');
      assert.equal(aout.body.seasonal[0].eatenThisMonth, false);
    });
  });

  // ── tables livrées vides ──────────────────────────────────────────────────

  describe('tables livrées vides (§17)', () => {
    it('affiche « repère indisponible » plutôt que 0 tant que nutrient_reference est vide', async () => {
      const enfant = await addEater('Enfant', '2016-01-01', 0.5);
      const riz = await insertFood(pool, 'Riz cuit', { kcal: 130, protein: 2.7, carb: 28, fat: 0.3, fiber: 0.4 }, true);
      await call('POST', '/api/meals', {
        eaten_at: '2026-09-13T12:30:00+02:00', slot: 'dejeuner', source: 'manuel',
        participants: [{ eaterId: enfant }],
        items: [{ foodId: riz, label: 'Riz', quantity: 150, unit: 'g', quantityG: 150 }],
      });

      const { body } = await call('GET', '/api/dashboard?date=2026-09-13');
      assert.equal(body.referencesLoaded, false);
      const balance = body.dashboard.find((d: any) => d.eater.id === enfant).balance;
      for (const bar of balance.bars) {
        assert.equal(bar.reference, null, `${bar.nutrient} devrait être sans repère`);
        assert.equal(bar.percent, null, `${bar.nutrient} ne devrait pas avoir de pourcentage`);
      }
      // La consommation, elle, est connue : c'est le repère qui manque.
      const proteines = balance.bars.find((b: any) => b.nutrient === 'proteinG');
      assert.equal(proteines.state, 'disponible');
      assert.equal(proteines.consumed, 4.05);
    });

    it('demande l’unité plutôt que de la deviner tant que unit_default est vide', async () => {
      const adulte = await addEater('Adulte', '1985-01-01', 1, 'M');
      const salade = await insertFood(pool, 'Salade verte', { kcal: 15 }, true);
      const { body } = await call('POST', '/api/meals', {
        eaten_at: '2026-09-13T19:30:00+02:00', slot: 'diner', source: 'manuel',
        participants: [{ eaterId: adulte }],
        items: [{ foodId: salade, label: 'Salade', quantity: 1, unit: 'Poignée', quantityG: null }],
      });
      assert.equal(body.meal.items[0].quantityG, null);
      assert.equal(body.meal.nutrition.kcal, null);
      assert.equal(body.meal.nutrition.confidence, 'basse');
    });

    it('ne propose aucune bande de saison tant que seasonal_produce est vide', async () => {
      const { body } = await call('GET', '/api/dashboard?date=2026-09-13');
      assert.deepEqual(body.seasonal, []);
    });
  });
});

type Values = { kcal?: number; protein?: number; carb?: number; fat?: number; fiber?: number };

/**
 * `maxima` ne porte que les majorants qui diffèrent de la valeur — le cas
 * « < 0,5 » de Ciqual. Sans lui, les bornes hautes suivent les valeurs.
 */
async function insertFood(
  pool: pg.Pool,
  name: string,
  values: Values,
  plantBased: boolean | null,
  maxima: Values = {},
): Promise<string> {
  const bound = (key: keyof Values): number | null => maxima[key] ?? values[key] ?? null;
  const { rows } = await pool.query<{ id: string }>(
    `insert into food (source, external_id, name, plant_based,
                       kcal_100g, protein_100g, carb_100g, fat_100g, fiber_100g,
                       kcal_100g_max, protein_100g_max, carb_100g_max, fat_100g_max,
                       fiber_100g_max)
     values ('manuel', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
    [
      name, name, plantBased,
      values.kcal ?? null, values.protein ?? null, values.carb ?? null,
      values.fat ?? null, values.fiber ?? null,
      bound('kcal'), bound('protein'), bound('carb'), bound('fat'), bound('fiber'),
    ],
  );
  return rows[0]!.id;
}
