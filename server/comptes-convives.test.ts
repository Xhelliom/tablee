/**
 * Le lien entre une assiette et un compte (migration 009).
 *
 * Ce que ces tests protègent, c'est le geste qui a motivé la 009 : « je saisis
 * ma femme à la main aujourd'hui, elle s'inscrit dans trois semaines, et sa
 * fiche devient la sienne sans que personne n'y repense ». Le reste du fichier
 * vérifie que ce lien n'a pas refusionné ce que la 007 a séparé — les rôles
 * tiennent, I5 tient, et l'étanchéité entre foyers tient.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import type { Auth } from './auth/auth.ts';
import {
  buildTestAuth, inviteAndAccept, signUp, signUpWithHousehold,
  TEST_BASE_URL, type TestAccount, type TestHousehold,
} from './test-support/auth.ts';
import { closeTestPool, resetDatabase, SKIP_MESSAGE, testDatabaseUrl, testPool } from './test-support/db.ts';

const enabled = testDatabaseUrl() !== null;

/** Un majeur et un mineur, calculés pour ne pas périmer avec le temps. */
const ilYA = (années: number): string => {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - années);
  return date.toISOString().slice(0, 10);
};
const MAJEUR = ilYA(38);
const MINEUR = ilYA(9);

describe('assiettes et comptes (009)', { skip: enabled ? false : SKIP_MESSAGE }, () => {
  let pool: pg.Pool;
  let auth: Auth;
  let app: FastifyInstance;
  let parent: TestHousehold;

  const call = async (
    method: string, url: string, cookie: string, payload?: unknown,
  ): Promise<{ status: number; body: any }> => {
    const response = await app.inject({
      method: method as 'GET',
      url,
      headers: { cookie },
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
    parent = await signUpWithHousehold(auth, pool, 'papa@exemple.test');
  });

  const eaters = async (cookie: string): Promise<any[]> =>
    (await call('GET', '/api/eaters', cookie)).body.eaters;

  // ── L'assiette de celui qui s'inscrit ─────────────────────────────────────

  describe('sa propre assiette', () => {
    it('se crée avec « self » et se reconnaît ensuite', async () => {
      const { status, body } = await call('POST', '/api/eaters', parent.cookie, {
        firstName: 'Stéphane', birthDate: MAJEUR, sex: 'M', self: true,
      });
      assert.equal(status, 201);
      assert.equal(body.eater.isMe, true);
      assert.equal(body.eater.claimEmail, null);
      assert.ok(body.eater.userId !== null);
    });

    it('refuse une seconde assiette pour le même compte', async () => {
      await call('POST', '/api/eaters', parent.cookie, {
        firstName: 'Stéphane', birthDate: MAJEUR, sex: 'M', self: true,
      });
      const { status, body } = await call('POST', '/api/eaters', parent.cookie, {
        firstName: 'Encore moi', birthDate: MAJEUR, sex: 'M', self: true,
      });
      assert.equal(status, 409);
      assert.equal(body.error.code, 'compte_deja_convive');
    });

    it('refuse « self » et une réservation dans la même requête', async () => {
      const { status } = await call('POST', '/api/eaters', parent.cookie, {
        firstName: 'X', birthDate: MAJEUR, sex: 'F', self: true,
        claimEmail: 'quelquun@exemple.test',
      });
      assert.equal(status, 400);
    });
  });

  // ── Le geste qui a motivé la migration ────────────────────────────────────

  describe('une fiche saisie avant l’inscription', () => {
    it('devient la sienne quand elle accepte l’invitation', async () => {
      const { body: créée } = await call('POST', '/api/eaters', parent.cookie, {
        firstName: 'Marie', birthDate: MAJEUR, sex: 'F', portionCoef: 1,
        diets: ['vegetarien'], claimEmail: 'Marie@Exemple.test',
      });
      // L'adresse est normalisée : elle a été saisie avec des majuscules.
      assert.equal(créée.eater.claimEmail, 'marie@exemple.test');
      assert.equal(créée.eater.userId, null);

      const marie = await signUp(auth, 'marie@exemple.test', 'Marie');
      await inviteAndAccept(auth, parent, marie, 'adulte');

      const [fiche] = (await eaters(marie.cookie)).filter((e) => e.firstName === 'Marie');
      assert.equal(fiche.id, créée.eater.id, 'la fiche existante, pas une nouvelle');
      assert.equal(fiche.isMe, true);
      assert.equal(fiche.claimEmail, null, 'la réservation est consommée');
      // Ce que le mari avait saisi la suit : c'est tout l'intérêt.
      assert.deepEqual(fiche.diets, ['vegetarien']);
    });

    it('se rattache tout de suite si la personne est déjà dans le foyer', async () => {
      const mamie = await signUp(auth, 'mamie@exemple.test', 'Mamie');
      await inviteAndAccept(auth, parent, mamie, 'adulte');

      const { body } = await call('POST', '/api/eaters', parent.cookie, {
        firstName: 'Mamie', birthDate: MAJEUR, sex: 'F',
        claimEmail: 'mamie@exemple.test',
      });
      assert.equal(body.eater.claimEmail, null, 'rien à attendre, elle est là');
      assert.ok(body.eater.userId !== null);

      const [fiche] = (await eaters(mamie.cookie)).filter((e) => e.firstName === 'Mamie');
      assert.equal(fiche.isMe, true);
    });

    it('refuse deux fiches réservées à la même adresse', async () => {
      await call('POST', '/api/eaters', parent.cookie, {
        firstName: 'Marie', birthDate: MAJEUR, sex: 'F', claimEmail: 'marie@exemple.test',
      });
      const { status, body } = await call('POST', '/api/eaters', parent.cookie, {
        firstName: 'Marie bis', birthDate: MAJEUR, sex: 'F', claimEmail: 'marie@exemple.test',
      });
      assert.equal(status, 409);
      assert.equal(body.error.code, 'adresse_deja_reservee');
    });

    it('laisse la fiche non rattachée si elle s’inscrit sous une autre adresse', async () => {
      await call('POST', '/api/eaters', parent.cookie, {
        firstName: 'Marie', birthDate: MAJEUR, sex: 'F', claimEmail: 'marie@exemple.test',
      });
      const autre = await signUp(auth, 'marie.autre@exemple.test', 'Marie');
      await inviteAndAccept(auth, parent, autre, 'adulte');

      const [fiche] = (await eaters(parent.cookie)).filter((e) => e.firstName === 'Marie');
      assert.equal(fiche.userId, null);
      assert.equal(fiche.claimEmail, 'marie@exemple.test');

      // Et le parent rattrape d'un geste, sans avoir à ressaisir la fiche.
      const { status, body } = await call(
        'PUT', `/api/eaters/${fiche.id}/compte`, parent.cookie,
        { email: 'marie.autre@exemple.test' },
      );
      assert.equal(status, 200);
      assert.equal(body.lié, true);
      assert.equal(body.eater.claimEmail, null);
    });

    it('ne rattache rien dans le foyer d’à côté', async () => {
      const voisins = await signUpWithHousehold(auth, pool, 'voisin@exemple.test', 'Voisins');
      await call('POST', '/api/eaters', voisins.cookie, {
        firstName: 'Marie', birthDate: MAJEUR, sex: 'F', claimEmail: 'marie@exemple.test',
      });

      // Marie entre chez nous, pas chez les voisins.
      const marie = await signUp(auth, 'marie@exemple.test', 'Marie');
      await inviteAndAccept(auth, parent, marie, 'adulte');

      const [chezLesVoisins] = await eaters(voisins.cookie);
      assert.equal(chezLesVoisins.userId, null, 'la réservation du voisin est intacte');
      assert.equal(chezLesVoisins.claimEmail, 'marie@exemple.test');
      assert.equal((await eaters(marie.cookie)).length, 0, 'et rien n’a été créé chez nous');
    });

    it('détache sans supprimer la fiche', async () => {
      const { body: créée } = await call('POST', '/api/eaters', parent.cookie, {
        firstName: 'Stéphane', birthDate: MAJEUR, sex: 'M', self: true,
      });
      const { status, body } = await call(
        'DELETE', `/api/eaters/${créée.eater.id}/compte`, parent.cookie,
      );
      assert.equal(status, 200);
      assert.equal(body.eater.userId, null);
      assert.equal(body.eater.isMe, false);
      assert.equal((await eaters(parent.cookie)).length, 1, 'la fiche est toujours là');
    });
  });

  // ── Les rôles de la 007 s'appliquent enfin aux convives ───────────────────

  describe('rôles', () => {
    let nounou: TestAccount;
    let enfant: string;

    beforeEach(async () => {
      nounou = await signUp(auth, 'nounou@exemple.test', 'Nounou');
      await inviteAndAccept(auth, parent, nounou, 'adulte');
      const { body } = await call('POST', '/api/eaters', parent.cookie, {
        firstName: 'Léa', birthDate: MINEUR, sex: 'F', portionCoef: 0.5,
      });
      enfant = body.eater.id;
    });

    it('un adulte ne peut pas ajouter un convive', async () => {
      const { status } = await call('POST', '/api/eaters', nounou.cookie, {
        firstName: 'Intrus', birthDate: MAJEUR, sex: 'M',
      });
      assert.equal(status, 403);
    });

    it('un adulte ne peut pas modifier la fiche d’un enfant', async () => {
      const { status } = await call('PATCH', `/api/eaters/${enfant}`, nounou.cookie, {
        portionCoef: 1,
      });
      assert.equal(status, 403);
    });

    it('un adulte peut créer et modifier la sienne', async () => {
      const { status, body } = await call('POST', '/api/eaters', nounou.cookie, {
        firstName: 'Nounou', birthDate: MAJEUR, sex: 'F', self: true,
      });
      assert.equal(status, 201);

      const modifiée = await call('PATCH', `/api/eaters/${body.eater.id}`, nounou.cookie, {
        portionCoef: 0.75,
      });
      assert.equal(modifiée.status, 200);
      assert.equal(modifiée.body.eater.portionCoef, 0.75);
    });

    it('un adulte ne se retire pas lui-même de la table', async () => {
      const { body } = await call('POST', '/api/eaters', nounou.cookie, {
        firstName: 'Nounou', birthDate: MAJEUR, sex: 'F', self: true,
      });
      const { status } = await call('PATCH', `/api/eaters/${body.eater.id}`, nounou.cookie, {
        active: false,
      });
      assert.equal(status, 403);
    });

    it('un adulte ne rattache aucune fiche à personne', async () => {
      const { status } = await call('PUT', `/api/eaters/${enfant}/compte`, nounou.cookie, {
        self: true,
      });
      assert.equal(status, 403);
    });
  });

  // ── I5 ────────────────────────────────────────────────────────────────────

  describe('poids et taille — majeurs seulement (I5)', () => {
    it('les accepte sur un majeur, avec la date de pesée', async () => {
      const { status, body } = await call('POST', '/api/eaters', parent.cookie, {
        firstName: 'Stéphane', birthDate: MAJEUR, sex: 'M', self: true,
        weightKg: 78.5, heightCm: 181,
      });
      assert.equal(status, 201);
      assert.equal(body.eater.weightKg, 78.5);
      assert.equal(body.eater.heightCm, 181);
      assert.ok(body.eater.weightRecordedAt !== null, 'un poids sans date dérive');
    });

    it('les refuse sur un mineur', async () => {
      const { status, body } = await call('POST', '/api/eaters', parent.cookie, {
        firstName: 'Léa', birthDate: MINEUR, sex: 'F', weightKg: 28,
      });
      assert.equal(status, 422);
      assert.equal(body.error.code, 'poids_interdit_mineur');
    });

    it('les efface si une date corrigée rend le profil mineur', async () => {
      const { body: créée } = await call('POST', '/api/eaters', parent.cookie, {
        firstName: 'Camille', birthDate: MAJEUR, sex: 'F', weightKg: 60,
      });
      const { body } = await call('PATCH', `/api/eaters/${créée.eater.id}`, parent.cookie, {
        birthDate: MINEUR,
      });
      assert.equal(body.eater.minor, true);
      assert.equal(body.eater.weightKg, null);
      assert.equal(body.eater.weightRecordedAt, null);
    });

    it('ne montre pas le poids des autres à un adulte', async () => {
      await call('POST', '/api/eaters', parent.cookie, {
        firstName: 'Stéphane', birthDate: MAJEUR, sex: 'M', self: true, weightKg: 78.5,
      });
      const nounou = await signUp(auth, 'nounou@exemple.test', 'Nounou');
      await inviteAndAccept(auth, parent, nounou, 'adulte');

      const [vuParLaNounou] = await eaters(nounou.cookie);
      assert.equal(vuParLaNounou.firstName, 'Stéphane');
      assert.equal(vuParLaNounou.weightKg, null, 'une nounou a besoin des allergènes, pas du poids');

      const [vuParLuiMeme] = await eaters(parent.cookie);
      assert.equal(vuParLuiMeme.weightKg, 78.5);
    });

    it('ne renvoie jamais 0 pour un poids absent', async () => {
      const { body } = await call('POST', '/api/eaters', parent.cookie, {
        firstName: 'Sans poids', birthDate: MAJEUR, sex: 'F',
      });
      assert.equal(body.eater.weightKg, null);
      assert.equal(body.eater.heightCm, null);
    });
  });
});
