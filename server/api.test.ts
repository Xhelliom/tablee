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
import { hashPassword } from './auth/password.ts';
import { closeTestPool, resetDatabase, SKIP_MESSAGE, testDatabaseUrl, testPool } from './test-support/db.ts';

const enabled = testDatabaseUrl() !== null;

describe('API', { skip: enabled ? false : SKIP_MESSAGE }, () => {
  let pool: pg.Pool;
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
    app = buildApp({ pool }, { webDir: '/dev/null/absent' });
    await app.ready();
  });

  after(async () => {
    await app.close();
    await closeTestPool();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
    const { rows } = await pool.query<{ id: string }>(
      `insert into household (name, login, password_hash) values ('Foyer test', 'test', $1)
       returning id`,
      [await hashPassword('motdepasse')],
    );
    householdId = rows[0]!.id;

    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { login: 'test', password: 'motdepasse' },
    });
    cookie = login.headers['set-cookie'] as string;
  });

  // ── auth ──────────────────────────────────────────────────────────────────

  describe('session de foyer', () => {
    it('refuse un mot de passe faux sans dire lequel des deux est faux', async () => {
      const mauvaisMotDePasse = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { login: 'test', password: 'nonnonnon' },
      });
      const loginInconnu = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { login: 'inexistant', password: 'motdepasse' },
      });
      assert.equal(mauvaisMotDePasse.statusCode, 401);
      assert.equal(loginInconnu.statusCode, 401);
      assert.deepEqual(mauvaisMotDePasse.json(), loginInconnu.json());
    });

    it('pose un cookie httpOnly, SameSite=Lax', async () => {
      assert.match(cookie, /tablee_session=/);
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=Lax/i);
    });

    it('ferme l’API sans session', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/members' });
      assert.equal(response.statusCode, 401);
      assert.equal(response.json().error.code, 'non_authentifie');
    });

    it('invalide la session à la déconnexion', async () => {
      await call('POST', '/api/auth/logout');
      const { status } = await call('GET', '/api/members');
      assert.equal(status, 401);
    });
  });

  // ── membres ───────────────────────────────────────────────────────────────

  const addMember = async (
    firstName: string, birthDate: string, portionCoef = 1, sex: 'F' | 'M' = 'F',
  ): Promise<string> => {
    const { body } = await call('POST', '/api/members', { firstName, birthDate, sex, portionCoef });
    return body.member.id;
  };

  describe('membres', () => {
    it('crée un membre et calcule son âge sans le stocker', async () => {
      const { status, body } = await call('POST', '/api/members', {
        firstName: 'Camille', birthDate: '2016-03-01', sex: 'F', portionCoef: 0.75,
      });
      assert.equal(status, 201);
      assert.equal(body.member.portionCoef, 0.75);
      assert.equal(body.member.minor, true);
      assert.ok(body.member.age >= 9);
    });

    it('refuse un coefficient hors bornes', async () => {
      const { status } = await call('POST', '/api/members', {
        firstName: 'X', birthDate: '2000-01-01', sex: 'M', portionCoef: 5,
      });
      assert.equal(status, 400);
    });
  });

  // ── repas et parts ────────────────────────────────────────────────────────

  describe('repas', () => {
    it('calcule les parts côté serveur, et refuse celles du client', async () => {
      const papa = await addMember('Papa', '1985-01-01', 1, 'M');
      const enfant = await addMember('Enfant', '2016-01-01', 0.5);

      const refuse = await call('POST', '/api/meals', {
        eaten_at: '2026-09-13T19:30:00+02:00', slot: 'diner', source: 'manuel',
        participants: [{ member_id: papa, share: 0.9 }],
      });
      assert.equal(refuse.status, 400);

      const { body } = await call('POST', '/api/meals', {
        eaten_at: '2026-09-13T19:30:00+02:00', slot: 'diner', source: 'manuel',
        participants: [{ memberId: papa }, { memberId: enfant }],
      });
      const shares = Object.fromEntries(
        body.meal.participants.map((p: { memberId: string; share: number }) => [p.memberId, p.share]),
      );
      assert.equal(shares[papa], 0.667);
      assert.equal(shares[enfant], 0.333);
      assert.equal(shares[papa] + shares[enfant], 1);
    });

    // ── Test structurant n° 2 (§15) ─────────────────────────────────────────
    it('avec 2 invités, Σ des parts < 1 et les assiettes du foyer ne gonflent pas', async () => {
      const papa = await addMember('Papa', '1985-01-01', 1, 'M');
      const maman = await addMember('Maman', '1987-01-01', 1);

      const sans = await call('POST', '/api/meals', {
        eaten_at: '2026-09-12T19:30:00+02:00', slot: 'diner', source: 'manuel',
        participants: [{ memberId: papa }, { memberId: maman }],
      });
      const avec = await call('POST', '/api/meals', {
        eaten_at: '2026-09-13T19:30:00+02:00', slot: 'diner', source: 'manuel',
        guest_count: 2,
        participants: [{ memberId: papa }, { memberId: maman }],
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
      const papa = await addMember('Papa', '1985-01-01', 1, 'M');
      const enfant = await addMember('Enfant', '2016-01-01', 0.5);

      const { body: avant } = await call('POST', '/api/meals', {
        eaten_at: '2026-09-13T19:30:00+02:00', slot: 'diner', source: 'manuel',
        participants: [{ memberId: papa }, { memberId: enfant }],
      });
      const mealId = avant.meal.id;
      const partsAvant = avant.meal.participants.map((p: any) => [p.memberId, p.share]).sort();

      // L'enfant grandit : son coefficient passe de 0,5 à 1.
      const patch = await call('PATCH', `/api/members/${enfant}`, { portionCoef: 1 });
      assert.equal(patch.status, 200);
      assert.equal(patch.body.member.portionCoef, 1);

      const { body: apres } = await call('GET', `/api/meals/${mealId}`);
      const partsApres = apres.meal.participants.map((p: any) => [p.memberId, p.share]).sort();
      assert.deepEqual(partsApres, partsAvant, 'les parts d’un repas passé ont bougé');

      // Et le repas suivant, lui, prend bien le nouveau coefficient.
      const { body: suivant } = await call('POST', '/api/meals', {
        eaten_at: '2026-09-14T19:30:00+02:00', slot: 'diner', source: 'manuel',
        participants: [{ memberId: papa }, { memberId: enfant }],
      });
      for (const p of suivant.meal.participants) assert.equal(p.share, 0.5);
    });

    it('recalcule la nutrition à la modification, sans toucher aux parts', async () => {
      const papa = await addMember('Papa', '1985-01-01', 1, 'M');
      const enfant = await addMember('Enfant', '2016-01-01', 0.5);
      const riz = await insertFood(pool, 'Riz cuit', { kcal: 130, protein: 2.7, carb: 28, fat: 0.3, fiber: 0.4 }, true);

      const { body: creation } = await call('POST', '/api/meals', {
        eaten_at: '2026-09-13T12:30:00+02:00', slot: 'dejeuner', source: 'manuel',
        participants: [{ memberId: papa }, { memberId: enfant }],
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
      const papa = await addMember('Papa', '1985-01-01', 1, 'M');
      await call('POST', '/api/meals', {
        eaten_at: '2026-09-13T19:30:00+02:00', slot: 'diner', source: 'jow',
        participants: [{ memberId: papa }],
        raw_input:
          'Galette végé https://jow.fr/r?recipeId=650b16ade7cc8d0013ce4a6e&key=SECRET42&userId=abc123',
      });

      const { rows } = await pool.query<{ raw_input: string }>('select raw_input from meal');
      const stored = rows[0]?.raw_input ?? '';
      assert.doesNotMatch(stored, /SECRET42/);
      assert.doesNotMatch(stored, /abc123/);
      assert.doesNotMatch(stored, /key=/);
      assert.match(stored, /recipeId=650b16ade7cc8d0013ce4a6e/);
    });

    it('ne rend que les repas du foyer de la session', async () => {
      const papa = await addMember('Papa', '1985-01-01', 1, 'M');
      await call('POST', '/api/meals', {
        eaten_at: '2026-09-13T19:30:00+02:00', slot: 'diner', source: 'manuel',
        participants: [{ memberId: papa }],
      });

      const { rows } = await pool.query<{ id: string }>(
        `insert into household (name, login, password_hash) values ('Voisins', 'voisin', 'x')
         returning id`,
      );
      await pool.query(
        `insert into meal (household_id, eaten_at, slot, source)
         values ($1, '2026-09-13T19:30:00+02:00', 'diner', 'manuel')`,
        [rows[0]!.id],
      );

      const { body } = await call('GET', '/api/meals?from=2026-09-13&to=2026-09-13');
      assert.equal(body.meals.length, 1);
    });
  });


  // ── anti-friction : templates et restes (§6bis) ───────────────────────────

  describe('templates et restes', () => {
    it('rejoue un template avec les coefficients du jour, pas ceux d’hier', async () => {
      const papa = await addMember('Papa', '1985-01-01', 1, 'M');
      const enfant = await addMember('Enfant', '2016-01-01', 0.5);
      const pain = await insertFood(pool, 'Pain complet', { kcal: 250, protein: 9 }, true);

      const { body: origine } = await call('POST', '/api/meals', {
        eaten_at: '2026-09-13T07:30:00+02:00', slot: 'petit_dej', source: 'texte',
        participants: [{ memberId: papa }, { memberId: enfant }],
        items: [{ foodId: pain, label: 'Pain', quantity: 100, unit: 'g', quantityG: 100 }],
      });

      const { status, body: cree } = await call('POST', '/api/templates', {
        mealId: origine.meal.id, name: 'Petit-déj de la maison',
      });
      assert.equal(status, 201);
      assert.equal(cree.template.useCount, 0);

      // L'enfant grandit entre la création du template et son usage.
      await call('PATCH', `/api/members/${enfant}`, { portionCoef: 1 });

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
        inchange.meal.participants.map((p: any) => [p.memberId, p.share]),
      );
      assert.equal(parts[papa], 0.667);
      assert.equal(parts[enfant], 0.333);

      const { body: liste } = await call('GET', '/api/templates');
      assert.equal(liste.templates[0].useCount, 1);
    });

    it('ne propose en restes que les plats à recette des 3 derniers jours', async () => {
      const papa = await addMember('Papa', '1985-01-01', 1, 'M');
      const { rows } = await pool.query<{ id: string }>(
        `insert into recipe (source, jow_recipe_id, title, base_servings)
         values ('jow', '650b16ade7cc8d0013ce4a6e', 'Gratin de courgettes', 4) returning id`,
      );
      const recipeId = rows[0]!.id;

      // Un plat d'hier, avec recette : proposé.
      const hier = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { body: source } = await call('POST', '/api/meals', {
        eaten_at: hier, slot: 'diner', source: 'jow', recipe_id: recipeId, servings: 4,
        participants: [{ memberId: papa }],
      });
      // Un repas sans recette : jamais proposé, il n'y a rien à resservir.
      await call('POST', '/api/meals', {
        eaten_at: hier, slot: 'dejeuner', source: 'texte',
        participants: [{ memberId: papa }],
      });
      // Un plat d'il y a dix jours : hors fenêtre.
      await pool.query(
        `insert into meal (household_id, eaten_at, slot, source, recipe_id)
         values ($1, now() - interval '10 days', 'diner', 'jow', $2)`,
        [householdId, recipeId],
      );

      const { body } = await call('GET', '/api/meals/leftovers?days=3');
      assert.equal(body.meals.length, 1);
      assert.equal(body.meals[0].id, source.meal.id);

      // Le 2e service pointe la même recette et garde sa traçabilité, sans
      // contrainte sur la somme des parts (§6bis).
      const { body: restes } = await call('POST', '/api/meals', {
        eaten_at: new Date().toISOString(), slot: 'dejeuner', source: 'jow',
        recipe_id: recipeId, servings: 1.5, leftover_of: source.meal.id,
        participants: [{ memberId: papa }],
      });
      assert.ok(restes.meal !== undefined, JSON.stringify(restes));
      assert.equal(restes.meal.leftoverOf, source.meal.id);
      assert.equal(restes.meal.recipe.id, recipeId);

      // Et il ne se propose pas lui-même comme reste d'un reste.
      const { body: apres } = await call('GET', '/api/meals/leftovers?days=3');
      assert.equal(apres.meals.length, 1);
    });

    it('repère un repas qui revient trois fois, et se tait après le template', async () => {
      const papa = await addMember('Papa', '1985-01-01', 1, 'M');
      const pain = await insertFood(pool, 'Pain complet', { kcal: 250 }, true);

      for (const day of ['2026-09-11', '2026-09-12', '2026-09-13']) {
        await call('POST', '/api/meals', {
          eaten_at: `${day}T07:30:00+02:00`, slot: 'petit_dej', source: 'texte',
          participants: [{ memberId: papa }],
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
      const papa = await addMember('Papa', '1985-01-01', 1, 'M');
      const pain = await insertFood(pool, 'Pain', { kcal: 250 }, true);
      for (const day of ['2026-09-12', '2026-09-13']) {
        await call('POST', '/api/meals', {
          eaten_at: `${day}T07:30:00+02:00`, slot: 'petit_dej', source: 'texte',
          participants: [{ memberId: papa }],
          items: [{ foodId: pain, label: 'Pain', quantity: 80, unit: 'g', quantityG: 80 }],
        });
      }
      const { body } = await call('GET', '/api/templates/suggestions');
      assert.deepEqual(body.suggestions, []);
    });
  });

  // ── tables livrées vides ──────────────────────────────────────────────────

  describe('tables livrées vides (§17)', () => {
    it('affiche « repère indisponible » plutôt que 0 tant que nutrient_reference est vide', async () => {
      const enfant = await addMember('Enfant', '2016-01-01', 0.5);
      const riz = await insertFood(pool, 'Riz cuit', { kcal: 130, protein: 2.7, carb: 28, fat: 0.3, fiber: 0.4 }, true);
      await call('POST', '/api/meals', {
        eaten_at: '2026-09-13T12:30:00+02:00', slot: 'dejeuner', source: 'manuel',
        participants: [{ memberId: enfant }],
        items: [{ foodId: riz, label: 'Riz', quantity: 150, unit: 'g', quantityG: 150 }],
      });

      const { body } = await call('GET', '/api/dashboard?date=2026-09-13');
      assert.equal(body.referencesLoaded, false);
      const balance = body.dashboard.find((d: any) => d.member.id === enfant).balance;
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
      const papa = await addMember('Papa', '1985-01-01', 1, 'M');
      const salade = await insertFood(pool, 'Salade verte', { kcal: 15 }, true);
      const { body } = await call('POST', '/api/meals', {
        eaten_at: '2026-09-13T19:30:00+02:00', slot: 'diner', source: 'manuel',
        participants: [{ memberId: papa }],
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

async function insertFood(
  pool: pg.Pool,
  name: string,
  values: { kcal?: number; protein?: number; carb?: number; fat?: number; fiber?: number },
  plantBased: boolean | null,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into food (source, external_id, name, plant_based,
                       kcal_100g, protein_100g, carb_100g, fat_100g, fiber_100g)
     values ('manuel', $1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      name, name, plantBased,
      values.kcal ?? null, values.protein ?? null, values.carb ?? null,
      values.fat ?? null, values.fiber ?? null,
    ],
  );
  return rows[0]!.id;
}
