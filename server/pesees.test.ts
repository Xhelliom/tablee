/**
 * Les pesées datées (029) : majeurs seulement, une tendance et pas des
 * pesées, la courbe d'un autre fermée à un `adulte`, et rien vers le LLM.
 * Chacun des trois filets de la 009 est testé seul — les « harmoniser » en un
 * seul en ferait tomber deux sans qu'aucun test ne rougisse.
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { after, before, beforeEach, describe, it } from 'node:test';
import type pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import type { Auth } from './auth/auth.ts';
import { tendance } from './routes/weights.ts';
import {
  buildTestAuth, inviteAndAccept, signUp, signUpWithHousehold,
  TEST_BASE_URL, type TestHousehold,
} from './test-support/auth.ts';
import { closeTestPool, resetDatabase, SKIP_MESSAGE, testDatabaseUrl, testPool } from './test-support/db.ts';

const ilYA = (années: number): string => {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - années);
  return date.toISOString().slice(0, 10);
};
const MAJEUR = ilYA(38);
const MINEUR = ilYA(9);
const ilYAJours = (jours: number): string => new Date(Date.now() - jours * 86_400_000).toISOString().slice(0, 10);
const HIER = ilYAJours(1);

describe('tendance — moyenne exponentielle', () => {
  it('part de la première pesée et n’en suit une autre que d’un dixième par jour', () => {
    const points = tendance([
      { day: '2026-10-01', weightKg: 80 },
      { day: '2026-10-02', weightKg: 90 },
    ]);
    assert.deepEqual(points, [{ day: '2026-10-01', kg: 80 }, { day: '2026-10-02', kg: 81 }]);
  });

  it('pondère par l’écart en jours, pas par le rang', () => {
    const [, après10Jours] = tendance([
      { day: '2026-10-01', weightKg: 80 },
      { day: '2026-10-11', weightKg: 90 },
    ]);
    // 1 − 0,9¹⁰ ≈ 65 % de l'écart.
    assert.equal(après10Jours?.kg, 86.5);
  });
});

describe('le poids ne part jamais au LLM (I3)', () => {
  it('aucun fichier de server/llm/ ne lit les pesées', async () => {
    const dossier = new URL('./llm/', import.meta.url);
    for (const nom of await readdir(dossier)) {
      const source = await readFile(new URL(nom, dossier), 'utf8');
      assert.doesNotMatch(source, /weight_measure|repo\/weights|routes\/weights|weightKg|nutrition\/besoin|energy-need/, nom);
    }
  });
});

describe('pesées (029)', { skip: testDatabaseUrl() !== null ? false : SKIP_MESSAGE }, () => {
  let pool: pg.Pool;
  let auth: Auth;
  let app: FastifyInstance;
  let parent: TestHousehold;

  const call = async (
    method: string, url: string, cookie: string, payload?: unknown,
  ): Promise<{ status: number; body: any }> => {
    const response = await app.inject({
      method: method as 'GET', url, headers: { cookie },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
    return { status: response.statusCode, body: response.json() };
  };

  const fiche = async (birthDate: string, extra: object = {}): Promise<string> =>
    (await call('POST', '/api/eaters', parent.cookie, {
      firstName: 'Camille', birthDate, sex: 'F', ...extra,
    })).body.eater.id;

  /** Écrit en base sans passer par l'API — ce que ferait un script, ou une date corrigée plus tard. */
  const pesageDirect = async (eaterId: string): Promise<void> => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.household_id', $1, true)", [parent.householdId]);
      await client.query(
        'insert into weight_measure (household_id, eater_id, day, weight_kg) values ($1, $2, $3, 30)',
        [parent.householdId, eaterId, HIER]);
      await client.query('commit');
    } finally {
      client.release();
    }
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

  it('trace une tendance datée, sans cible, et remplace la pesée du même jour', async () => {
    const id = await fiche(MAJEUR);
    assert.equal((await call('PUT', `/api/eaters/${id}/weights/${HIER}`, parent.cookie, { weightKg: 70 })).status, 200);
    await call('PUT', `/api/eaters/${id}/weights/${HIER}`, parent.cookie, { weightKg: 71 });

    const { body } = await call('GET', `/api/eaters/${id}/weights`, parent.cookie);
    assert.deepEqual(body, { tendance: [{ day: HIER, kg: 71 }], pesees: [{ day: HIER, weightKg: 71 }] });

    await call('DELETE', `/api/eaters/${id}/weights/${HIER}`, parent.cookie);
    assert.deepEqual((await call('GET', `/api/eaters/${id}/weights`, parent.cookie)).body.tendance, []);
  });

  it('refuse une pesée datée dans le futur', async () => {
    const id = await fiche(MAJEUR);
    const demain = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    assert.equal((await call('PUT', `/api/eaters/${id}/weights/${demain}`, parent.cookie, { weightKg: 70 })).status, 400);
  });

  it('filet 1 — l’API refuse une pesée sur un mineur', async () => {
    const id = await fiche(MINEUR);
    const { status, body } = await call('PUT', `/api/eaters/${id}/weights/${HIER}`, parent.cookie, { weightKg: 30 });
    assert.equal(status, 422);
    assert.equal(body.error.code, 'poids_interdit_mineur');
  });

  it('filet 2 — la lecture masque une pesée restée en base sur un mineur', async () => {
    const id = await fiche(MINEUR);
    await pesageDirect(id);
    const { body } = await call('GET', `/api/eaters/${id}/weights`, parent.cookie);
    assert.deepEqual(body, { tendance: [], pesees: [] });
  });

  it('filet 3 — une date corrigée qui rend le profil mineur efface les pesées', async () => {
    const id = await fiche(MAJEUR);
    await call('PUT', `/api/eaters/${id}/weights/${HIER}`, parent.cookie, { weightKg: 60 });
    await call('PATCH', `/api/eaters/${id}`, parent.cookie, { birthDate: MINEUR });
    // Revenir majeur ne fait rien réapparaître : la ligne est partie, pas masquée.
    await call('PATCH', `/api/eaters/${id}`, parent.cookie, { birthDate: MAJEUR });
    assert.deepEqual((await call('GET', `/api/eaters/${id}/weights`, parent.cookie)).body.pesees, []);
  });

  it('un adulte ne voit, ni n’écrit, la courbe d’un autre — mais la sienne, oui', async () => {
    const autre = await fiche(MAJEUR);
    await call('PUT', `/api/eaters/${autre}/weights/${HIER}`, parent.cookie, { weightKg: 60 });
    const conjoint = await signUp(auth, 'maman@exemple.test', 'Maman');
    await inviteAndAccept(auth, parent, conjoint, 'adulte');

    assert.equal((await call('GET', `/api/eaters/${autre}/weights`, conjoint.cookie)).status, 403);
    assert.equal((await call('PUT', `/api/eaters/${autre}/weights/${HIER}`, conjoint.cookie, { weightKg: 1 })).status, 403);
    assert.equal((await call('DELETE', `/api/eaters/${autre}/weights/${HIER}`, conjoint.cookie)).status, 403);

    const { body } = await call('POST', '/api/eaters', conjoint.cookie, {
      firstName: 'Maman', birthDate: MAJEUR, sex: 'F', self: true,
    });
    assert.equal((await call('PUT', `/api/eaters/${body.eater.id}/weights/${HIER}`, conjoint.cookie, { weightKg: 62 })).status, 200);
    assert.equal((await call('GET', `/api/eaters/${body.eater.id}/weights`, conjoint.cookie)).body.tendance.length, 1);
  });

  it('ne lit pas les pesées du foyer d’à côté', async () => {
    const id = await fiche(MAJEUR);
    await call('PUT', `/api/eaters/${id}/weights/${HIER}`, parent.cookie, { weightKg: 60 });
    const voisin = await signUpWithHousehold(auth, pool, 'voisin@exemple.test');
    assert.equal((await call('GET', `/api/eaters/${id}/weights`, voisin.cookie)).status, 404);
    assert.equal((await call('PUT', `/api/eaters/${id}/weights/${HIER}`, voisin.cookie, { weightKg: 1 })).status, 404);
  });

  describe('besoin estimé', () => {
    const besoin = async (id: string, cookie = parent.cookie): Promise<{ status: number; body: any }> =>
      call('GET', `/api/eaters/${id}/energy-need`, cookie);

    it('se tait sans journée complète, et dit ce qui manque', async () => {
      const id = await fiche(MAJEUR);
      for (const jours of [1, 8, 15, 22]) {
        await call('PUT', `/api/eaters/${id}/weights/${ilYAJours(jours)}`, parent.cookie, { weightKg: 70 });
      }
      const { status, body } = await besoin(id);
      assert.equal(status, 200);
      assert.equal(body.kcal, null);
      assert.equal(body.confidence, null);
      assert.equal(body.weighings, 4);
      assert.equal(body.completeDays, 0);
      assert.deepEqual(body.seuils, { windowDays: 28, completeDays: 14, weighings: 4, spanDays: 14 });
    });

    it('filet 2 — sur un mineur, rien ne se calcule, pas même un compte', async () => {
      const id = await fiche(MINEUR);
      await pesageDirect(id);
      const { body } = await besoin(id);
      assert.equal(body.kcal, null);
      assert.equal(body.weighings, 0);
    });

    it('filet 3 — une date corrigée qui rend mineur n’en laisse rien', async () => {
      const id = await fiche(MAJEUR);
      await call('PUT', `/api/eaters/${id}/weights/${HIER}`, parent.cookie, { weightKg: 60 });
      await call('PATCH', `/api/eaters/${id}`, parent.cookie, { birthDate: MINEUR });
      await call('PATCH', `/api/eaters/${id}`, parent.cookie, { birthDate: MAJEUR });
      assert.equal((await besoin(id)).body.weighings, 0);
    });

    it('fermé à un adulte pour un autre, comme la courbe', async () => {
      const autre = await fiche(MAJEUR);
      const conjoint = await signUp(auth, 'maman@exemple.test', 'Maman');
      await inviteAndAccept(auth, parent, conjoint, 'adulte');
      assert.equal((await besoin(autre, conjoint.cookie)).status, 403);
    });
  });
});
