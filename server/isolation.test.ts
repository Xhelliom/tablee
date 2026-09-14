/**
 * L'étanchéité entre foyers — le test qui donne son sens au §16.
 *
 * Deux foyers sur la même instance, et rien ne passe de l'un à l'autre. C'est
 * la promesse faite aux familles invitées, et elle ne vaut que ce que valent
 * ces assertions : « on a fait attention partout » n'est pas une garantie,
 * c'est une intention.
 *
 * Trois couches sont vérifiées séparément, parce qu'elles peuvent tomber
 * indépendamment :
 *
 *   1. **L'API** — une route ne rend rien sur l'identifiant du voisin.
 *   2. **La base** — une requête qui a *oublié* son `where household_id` ne
 *      rend rien non plus. C'est la RLS de la 008, et c'est ce qui rattrape le
 *      bug qu'on n'a pas encore écrit.
 *   3. **Le garde-fou** — la RLS est effective, et pas seulement déclarée.
 *      Un superutilisateur Postgres la contourne en silence ; sans cette
 *      vérification, les deux couches au-dessus passeraient au vert dans une
 *      base où rien ne filtre. C'est arrivé.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import type { Auth } from './auth/auth.ts';
import { withHousehold } from './db.ts';
import { diagnoseIsolation } from './db/guard.ts';
import {
  buildTestAuth, inviteAndAccept, signUp, signUpWithHousehold,
  TEST_BASE_URL, type TestAccount, type TestHousehold,
} from './test-support/auth.ts';
import { closeTestPool, resetDatabase, SKIP_MESSAGE, testDatabaseUrl, testPool } from './test-support/db.ts';

const enabled = testDatabaseUrl() !== null;

describe('étanchéité entre foyers (§16)', { skip: enabled ? false : SKIP_MESSAGE }, () => {
  let pool: pg.Pool;
  let auth: Auth;
  let app: FastifyInstance;
  let nous: TestHousehold;
  let voisins: TestHousehold;

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
  });

  /** Un convive et un repas chez les voisins, écrits dans **leur** contexte. */
  const repasChezLesVoisins = async (): Promise<{ eaterId: string; mealId: string }> => {
    const { body } = await call('POST', '/api/eaters', voisins.cookie, {
      firstName: 'Enfant des voisins', birthDate: '2017-04-02', sex: 'F', portionCoef: 0.5,
    });
    const eaterId = body.eater.id as string;
    const repas = await call('POST', '/api/meals', voisins.cookie, {
      eaten_at: '2026-09-13T19:30:00+02:00', slot: 'diner', source: 'manuel',
      participants: [{ eaterId }],
    });
    return { eaterId, mealId: repas.body.meal.id as string };
  };

  // ── 1. L'API ──────────────────────────────────────────────────────────────

  describe('par l’API', () => {
    it('ne montre pas les convives du voisin', async () => {
      await repasChezLesVoisins();
      const { body } = await call('GET', '/api/eaters', nous.cookie);
      assert.deepEqual(body.eaters, [], 'le foyer d’à côté n’existe pas, de notre point de vue');
    });

    it('ne montre pas les repas du voisin, même par identifiant direct', async () => {
      const { mealId } = await repasChezLesVoisins();

      const liste = await call('GET', '/api/meals?from=2026-09-13&to=2026-09-13', nous.cookie);
      assert.deepEqual(liste.body.meals, []);

      // Connaître l'identifiant ne doit rien donner de plus que de l'ignorer.
      const direct = await call('GET', `/api/meals/${mealId}`, nous.cookie);
      assert.equal(direct.status, 404, 'un repas d’un autre foyer est introuvable, pas interdit');
    });

    it('ne laisse pas supprimer le repas du voisin', async () => {
      const { mealId } = await repasChezLesVoisins();
      const { status } = await call('DELETE', `/api/meals/${mealId}`, nous.cookie);
      assert.equal(status, 404);

      // Et il est toujours là, chez eux.
      const chezEux = await call('GET', `/api/meals/${mealId}`, voisins.cookie);
      assert.equal(chezEux.status, 200);
    });

    it('ne laisse pas inscrire un convive du voisin à notre repas', async () => {
      const { eaterId } = await repasChezLesVoisins();
      const { status } = await call('POST', '/api/meals', nous.cookie, {
        eaten_at: '2026-09-13T12:30:00+02:00', slot: 'dejeuner', source: 'manuel',
        participants: [{ eaterId }],
      });
      assert.notEqual(status, 201, 'un convive d’un autre foyer n’est pas un convive');
      assert.ok(status === 400 || status === 404, `statut inattendu : ${status}`);
    });

    it('ne montre pas le tableau de bord du voisin', async () => {
      await repasChezLesVoisins();
      const { body } = await call('GET', '/api/dashboard?date=2026-09-13', nous.cookie);
      assert.deepEqual(body.dashboard, []);
    });
  });

  // ── 2. La base ────────────────────────────────────────────────────────────

  describe('par la base, quand le code a oublié son where', () => {
    it('ne rend aucune ligne d’un autre foyer sur un select sans filtre', async () => {
      await repasChezLesVoisins();

      // Exactement la requête qu'un helper interne finirait par écrire.
      const vus = await withHousehold(pool, nous.householdId, async (client) => {
        const { rows } = await client.query<{ n: string }>('select count(*) as n from meal');
        return Number(rows[0]?.n ?? -1);
      });
      assert.equal(vus, 0, 'la base filtre, même sans where');

      const chezEux = await withHousehold(pool, voisins.householdId, async (client) => {
        const { rows } = await client.query<{ n: string }>('select count(*) as n from meal');
        return Number(rows[0]?.n ?? -1);
      });
      assert.equal(chezEux, 1, 'et elle ne cache pas leurs propres lignes aux voisins');
    });

    it('refuse d’écrire une ligne au nom d’un autre foyer', async () => {
      await assert.rejects(
        withHousehold(pool, nous.householdId, (client) =>
          client.query(
            `insert into meal (household_id, eaten_at, slot, source)
             values ($1, now(), 'diner', 'manuel')`,
            [voisins.householdId],
          )),
        /row-level security|violates/i,
        'écrire chez le voisin doit lever, pas réussir en silence',
      );
    });

    it('ne rend rien du tout à une connexion sans foyer posé', async () => {
      await repasChezLesVoisins();
      const { rows } = await pool.query<{ n: string }>('select count(*) as n from meal');
      assert.equal(
        Number(rows[0]?.n), 0,
        'une connexion qui n’a pas déclaré son foyer ne voit rien — le défaut va dans le sens fermé',
      );
    });

    it('partage les recettes Jow, mais pas les recettes manuelles', async () => {
      // Une recette Jow appartient à tout le monde : c'est de la donnée
      // publique, et la re-télécharger par foyer n'a aucun intérêt.
      await pool.query(
        `insert into recipe (source, jow_recipe_id, title, base_servings)
         values ('jow', '650b16ade7cc8d0013ce4a6e', 'Galette végé', 2)`,
      );
      // Une recette manuelle porte un titre libre — souvent un prénom.
      await withHousehold(pool, voisins.householdId, (client) =>
        client.query(
          `insert into recipe (source, title, base_servings, household_id) values ('manuel', $1, 2, $2)`,
          ['Blanquette de mamie Jeanne', voisins.householdId],
        ));

      const titres = await withHousehold(pool, nous.householdId, async (client) => {
        const { rows } = await client.query<{ title: string }>('select title from recipe');
        return rows.map((r) => r.title);
      });
      assert.deepEqual(titres, ['Galette végé']);
    });
  });

  // ── 3. Le garde-fou ───────────────────────────────────────────────────────

  describe('le garde-fou', () => {
    /**
     * Sans ce test, tout ce fichier peut passer au vert dans une base où la
     * RLS ne filtre rien : il suffit que le rôle soit superutilisateur. Les
     * policies sont alors bien là, `\\d` les affiche, et elles sont ignorées —
     * en silence. C'est exactement ce qui s'est produit en écrivant la 008.
     */
    it('confirme que la RLS est effective, et pas seulement déclarée', async () => {
      const { superuser, sansPolicy } = await diagnoseIsolation(pool);
      assert.equal(
        superuser, false,
        'le rôle de test est superutilisateur : il contourne la RLS, et les tests ci-dessus ne prouvent rien',
      );
      assert.deepEqual(sansPolicy, [], 'toutes les tables scopées doivent être en RLS forcée');
    });
  });

  // ── La gestion du foyer ───────────────────────────────────────────────────

  describe('gérer le foyer', () => {
    it('laisse un parent renommer le foyer et changer son fuseau', async () => {
      const { status, body } = await call('PATCH', '/api/household', nous.cookie, {
        name: 'La maison', timezone: 'Indian/Reunion',
      });
      assert.equal(status, 200);
      assert.equal(body.household.name, 'La maison');
      assert.equal(body.household.timezone, 'Indian/Reunion');
    });

    /**
     * Le fuseau n'est pas un réglage d'affichage : il décide où s'arrête une
     * journée, dans le SQL. Une valeur fantaisiste acceptée fausserait tous les
     * bilans en silence.
     */
    it('refuse un fuseau qui n’existe pas', async () => {
      const { status, body } = await call('PATCH', '/api/household', nous.cookie, {
        timezone: 'Europe/Nulle-Part',
      });
      assert.equal(status, 400);
      assert.equal(body.error.code, 'fuseau_inconnu');

      // Et le foyer n'a pas bougé.
      const après = await call('GET', '/api/household', nous.cookie);
      assert.equal(après.body.household.timezone, 'Europe/Paris');
    });

    it('n’autorise pas un adulte à changer le foyer', async () => {
      const nounou = await signUp(auth, 'nounou-foyer@exemple.test');
      await inviteAndAccept(auth, nous, nounou, 'adulte');

      const { status, body } = await call('PATCH', '/api/household', nounou.cookie, {
        name: 'Chez moi maintenant',
      });
      assert.equal(status, 403);
      assert.equal(body.error.code, 'droits_insuffisants');
    });

    /**
     * Les rôles de `server/auth/auth.ts` disent `eater: []` pour un `adulte` :
     * une nounou saisit les repas, elle ne compose pas la famille. better-auth
     * ne garde que ses propres routes — celles du §12 sont à nous, et cette
     * vérification-là n'existait pas.
     */
    it('n’autorise pas un adulte à composer la famille', async () => {
      const nounou = await signUp(auth, 'nounou-convives@exemple.test');
      await inviteAndAccept(auth, nous, nounou, 'adulte');

      const ajout = await call('POST', '/api/eaters', nounou.cookie, {
        firstName: 'Invité surprise', birthDate: '2015-05-05', sex: 'M', portionCoef: 0.75,
      });
      assert.equal(ajout.status, 403);
      assert.equal(ajout.body.error.code, 'droits_insuffisants');

      // Et le coefficient de portion d'un convive existant ne bouge pas non
      // plus : c'est lui qui décide de la part de chacun dans un repas.
      const créé = await call('POST', '/api/eaters', nous.cookie, {
        firstName: 'Enfant', birthDate: '2016-06-06', sex: 'F', portionCoef: 0.5,
      });
      const modif = await call(
        'PATCH', `/api/eaters/${créé.body.eater.id}`, nounou.cookie, { portionCoef: 2 },
      );
      assert.equal(modif.status, 403);

      const après = await call('GET', '/api/eaters', nous.cookie);
      assert.equal(après.body.eaters[0].portionCoef, 0.5);
    });

    it('laisse malgré tout un adulte lire les convives — il en a besoin', async () => {
      const nounou = await signUp(auth, 'nounou-lecture@exemple.test');
      await inviteAndAccept(auth, nous, nounou, 'adulte');
      await call('POST', '/api/eaters', nous.cookie, {
        firstName: 'Enfant', birthDate: '2016-06-06', sex: 'F', portionCoef: 0.5,
      });

      const { status, body } = await call('GET', '/api/eaters', nounou.cookie);
      assert.equal(status, 200);
      assert.equal(body.eaters.length, 1, 'les allergènes et les régimes lui servent');
    });

    it('ne laisse pas modifier le foyer du voisin', async () => {
      await call('PATCH', '/api/household', voisins.cookie, { name: 'Renommé par eux' });
      // Chacun n'a touché qu'au sien : la route ne prend aucun identifiant du
      // client, c'est la session qui le donne.
      const chezNous = await call('GET', '/api/household', nous.cookie);
      assert.equal(chezNous.body.household.name, 'Chez nous');
    });

    /**
     * Le §16 en fait une exigence produit : pouvoir retirer ses données d'une
     * machine qui n'est pas la sienne. Encore faut-il que la cascade traverse
     * la RLS — ce n'était pas acquis.
     */
    it('supprime le foyer et tout ce qu’il contient', async () => {
      const { eaterId, mealId } = await repasChezLesVoisins();
      assert.ok(eaterId !== undefined && mealId !== undefined);

      const avant = await pool.query<{ n: number }>(
        'select count(*)::int as n from meal_participant',
      );
      assert.equal(avant.rows[0]?.n, 1, 'table sans RLS : le compte est réel');

      const suppression = await app.inject({
        method: 'POST', url: '/api/auth/organization/delete',
        headers: { cookie: voisins.cookie, origin: TEST_BASE_URL },
        payload: { organizationId: voisins.organizationId },
      });
      assert.equal(suppression.statusCode, 200);

      // Les tables filles n'ont pas de RLS : leur compte est le vrai. Elles
      // ne contenaient que les données des voisins, donc elles sont vides.
      for (const table of ['meal_participant', 'meal_item']) {
        const { rows } = await pool.query<{ n: number }>(
          `select count(*)::int as n from ${table}`,
        );
        assert.equal(rows[0]?.n, 0, `${table} devrait être vide après suppression`);
      }

      // Et il reste exactement un foyer : le nôtre, intact. Une suppression qui
      // emporterait le voisin serait le pire des bugs possibles ici.
      const { rows: restants } = await pool.query<{ n: number; name: string }>(
        'select count(*)::int as n, min(name) as name from household',
      );
      assert.equal(restants[0]?.n, 1);
      assert.equal(restants[0]?.name, 'Chez nous');

      const nôtre = await call('GET', '/api/household', nous.cookie);
      assert.equal(nôtre.status, 200);
    });
  });

  // ── Les comptes, eux aussi, restent chez eux ──────────────────────────────

  describe('les comptes', () => {
    it('ne rattache pas un compte à un foyer sans invitation', async () => {
      const inconnu: TestAccount = await signUp(auth, 'inconnu@exemple.test');
      const { body } = await app.inject({
        method: 'GET', url: '/api/me', headers: { cookie: inconnu.cookie },
      }).then((r) => ({ body: r.json() }));
      assert.equal(body.state, 'sans_foyer');
      assert.deepEqual(body.households, []);
    });

    it('donne accès une fois l’invitation acceptée, avec le rôle prévu', async () => {
      const nounou = await signUp(auth, 'nounou@exemple.test');
      await inviteAndAccept(auth, nous, nounou, 'adulte');

      const { body } = await app.inject({
        method: 'GET', url: '/api/me', headers: { cookie: nounou.cookie },
      }).then((r) => ({ body: r.json() }));

      assert.equal(body.state, 'actif');
      assert.equal(body.household.id, nous.householdId);
      assert.equal(body.role, 'adulte');
    });

    /**
     * Le rôle `adulte`, c'est la nounou ou le grand-parent : il saisit les
     * repas et lit tout — les allergènes en particulier, dont il a besoin —
     * mais ne touche pas aux accès.
     */
    it('n’autorise pas un adulte à inviter', async () => {
      const nounou = await signUp(auth, 'nounou2@exemple.test');
      await inviteAndAccept(auth, nous, nounou, 'adulte');

      const invitation = await app.inject({
        method: 'POST',
        url: '/api/auth/organization/invite-member',
        headers: { cookie: nounou.cookie, origin: TEST_BASE_URL },
        payload: { email: 'tiers@exemple.test', role: 'adulte', organizationId: nous.organizationId },
      });
      assert.notEqual(invitation.statusCode, 200, 'seul un parent invite');
    });

    it('laisse un adulte saisir un repas', async () => {
      const nounou = await signUp(auth, 'nounou3@exemple.test');
      await inviteAndAccept(auth, nous, nounou, 'adulte');

      const enfant = await call('POST', '/api/eaters', nous.cookie, {
        firstName: 'Enfant', birthDate: '2018-03-03', sex: 'M', portionCoef: 0.5,
      });
      const { status } = await call('POST', '/api/meals', nounou.cookie, {
        eaten_at: '2026-09-13T16:00:00+02:00', slot: 'gouter', source: 'manuel',
        participants: [{ eaterId: enfant.body.eater.id }],
      });
      assert.equal(status, 201, 'c’est tout l’intérêt de son compte');
    });
  });
});
