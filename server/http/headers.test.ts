/**
 * Les en-têtes de sécurité — sur toutes les réponses, y compris les ratées.
 *
 * Un en-tête posé sur le chemin heureux et absent des 401, des 404 et des
 * fichiers statiques ne protège que ce qui n'avait pas besoin de l'être.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';
import { SECURITY_HEADERS } from './headers.ts';
import { buildTestAuth, TEST_BASE_URL } from '../test-support/auth.ts';
import { closeTestPool, SKIP_MESSAGE, testDatabaseUrl, testPool } from '../test-support/db.ts';

const enabled = testDatabaseUrl() !== null;

describe('en-têtes de sécurité', { skip: enabled ? false : SKIP_MESSAGE }, () => {
  let pool: pg.Pool;
  let app: FastifyInstance;

  before(async () => {
    pool = await testPool();
    app = buildApp(
      { pool, auth: buildTestAuth(pool), baseURL: TEST_BASE_URL },
      { webDir: '/dev/null/absent' },
    );
    await app.ready();
  });

  after(async () => {
    await app.close();
    await closeTestPool();
  });

  const cas = [
    ['une page', '/share?text=bonjour'],
    ['une route publique', '/api/me'],
    ['une route fermée, donc un 401', '/api/eaters'],
    ['une route inconnue, donc un 404', '/api/rien-du-tout'],
  ] as const;

  for (const [quoi, url] of cas) {
    it(`sont posés sur ${quoi}`, async () => {
      const response = await app.inject({ method: 'GET', url });
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        assert.equal(response.headers[name], value, `${name} manque sur ${url}`);
      }
    });
  }

  /**
   * I6 : l'URL de `/share` porte le texte partagé, donc les jetons `key` et
   * `userId` du lien Jow. La page charge ensuite la photo du plat depuis
   * `static.jow.fr` — sans cet en-tête, le jeton partirait dans le `Referer`.
   */
  it('n’envoient aucun référent, pour que le jeton Jow ne parte pas avec l’image', () => {
    assert.equal(SECURITY_HEADERS['referrer-policy'], 'no-referrer');
  });

  it('laissent passer les photos de plats, et rien d’autre venu d’ailleurs', () => {
    const csp = SECURITY_HEADERS['content-security-policy'] ?? '';
    assert.match(csp, /img-src [^;]*https:\/\/static\.jow\.fr/, 'les photos Jow doivent s’afficher');
    assert.match(csp, /connect-src 'self'/, 'rien ne s’exfiltre vers un tiers');
    assert.match(csp, /script-src 'self'/, 'aucun script de tiers');
    assert.match(csp, /frame-ancestors 'none'/);
  });
});
