/**
 * La limitation de débit — ce qu'elle plafonne, et ce qu'elle laisse passer.
 *
 * Le point qui compte autant que le plafond lui-même : **`/share` n'y est pas
 * soumis**. C'est le chemin critique du produit — la feuille de partage
 * d'Android ouvre cette page, et un 429 à cet endroit se traduirait par « ça
 * n'a pas marché » sans autre explication, sur le geste même qui fait vivre
 * l'app.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { buildTestAuth, TEST_BASE_URL } from './test-support/auth.ts';
import { closeTestPool, SKIP_MESSAGE, testDatabaseUrl, testPool } from './test-support/db.ts';

const enabled = testDatabaseUrl() !== null;

describe('limitation de débit', { skip: enabled ? false : SKIP_MESSAGE }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;

  before(async () => {
    pool = await testPool();
    app = buildApp(
      { pool, auth: buildTestAuth(pool), baseURL: TEST_BASE_URL },
      // Un plafond de test : trois requêtes. Celui de production est à 300 par
      // minute (`RATE_LIMIT`), et une suite de tests l'atteindrait d'elle-même
      // sans rien prouver de plus.
      { webDir: '/dev/null/absent', rateLimit: { max: 3, timeWindow: 60_000 } },
    );
    await app.ready();
  });

  after(async () => {
    await app.close();
    await closeTestPool();
  });

  const get = (url: string): Promise<{ status: number; body: string }> =>
    app.inject({ method: 'GET', url }).then((r) => ({ status: r.statusCode, body: r.body }));

  it('plafonne l’API, et le dit au format d’erreur du §12', async () => {
    for (let i = 0; i < 3; i += 1) {
      const { status } = await get('/api/me');
      assert.equal(status, 200, `la requête ${i + 1} doit passer`);
    }

    const bloqué = await get('/api/me');
    assert.equal(bloqué.status, 429);

    const corps = JSON.parse(bloqué.body) as { error: { code: string; message: string } };
    assert.equal(corps.error.code, 'trop_de_requetes');
    assert.match(corps.error.message, /réessayer dans \d+ s/);
  });

  /**
   * Une page, pas une API. Si ce test tombe, le partage depuis Jow tombe avec
   * lui — et c'est le geste qui fait vivre le produit.
   */
  it('ne plafonne pas /share, même bien au-delà du seuil', async () => {
    for (let i = 0; i < 12; i += 1) {
      const { status } = await get('/share?title=Galette&text=https%3A%2F%2Fjow.fr%2Frecipes%2Fx');
      assert.notEqual(status, 429, `/share ne doit jamais être limité (requête ${i + 1})`);
    }
  });

  it('ne plafonne ni la coquille ni les fichiers du front', async () => {
    for (let i = 0; i < 12; i += 1) {
      assert.notEqual((await get('/')).status, 429);
      assert.notEqual((await get('/manifest.webmanifest')).status, 429);
    }
  });
});
