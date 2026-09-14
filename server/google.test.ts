/**
 * La connexion Google, de bout en bout — sauf Google.
 *
 * Un seul échange sort vraiment : le code contre les jetons, auprès de
 * `oauth2.googleapis.com`. Il est remplacé par un `fetch` qui rend un
 * `id_token` fabriqué. Tout le reste passe par Fastify comme le ferait un
 * navigateur : le bouton demande l'URL de Google, Google ramène au callback, et
 * la session doit en sortir. Ce qui ne se teste pas ici — le client OAuth
 * déclaré chez Google, son URI de redirection — se vérifie une fois, sur
 * l'instance (`docs/mise-en-service.md`).
 *
 * Deux passages par `/sign-in/social`, pas plus : better-auth en laisse trois
 * par dix secondes, et un compteur ferait échouer la suite pour rien.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, type TestContext } from 'node:test';
import type pg from 'pg';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from './app.ts';
import type { Auth } from './auth/auth.ts';
import { buildTestAuth, signUp, TEST_BASE_URL } from './test-support/auth.ts';
import { closeTestPool, resetDatabase, SKIP_MESSAGE, testDatabaseUrl, testPool } from './test-support/db.ts';

const enabled = testDatabaseUrl() !== null;

describe('connexion Google', { skip: enabled ? false : SKIP_MESSAGE }, () => {
  let pool: pg.Pool;
  let auth: Auth;
  let app: FastifyInstance;
  let sansGoogle: FastifyInstance;

  before(async () => {
    pool = await testPool();
    auth = buildTestAuth(pool, null, { clientId: 'client-test', clientSecret: 'secret-test' });
    app = buildApp({ pool, auth, baseURL: TEST_BASE_URL }, { webDir: '/dev/null/absent' });
    sansGoogle = buildApp({ pool, auth: buildTestAuth(pool), baseURL: TEST_BASE_URL }, { webDir: '/dev/null/absent' });
    await Promise.all([app.ready(), sansGoogle.ready()]);
  });

  after(async () => {
    await Promise.all([app.close(), sansGoogle.close()]);
    await closeTestPool();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
  });

  const cookies = (response: LightMyRequestResponse): string[] =>
    [response.headers['set-cookie'] ?? []].flat().map((c) => c.split(';')[0] ?? '');

  const cookieDeSession = (response: LightMyRequestResponse): string | undefined =>
    cookies(response).find((c) => /session_token=./.test(c));

  /** Non signé : le callback le tient de Google en direct, il ne le vérifie pas. */
  const idToken = (claims: Record<string, unknown>): string => {
    const part = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${part({ alg: 'none' })}.${part(claims)}.`;
  };

  const CAMILLE = {
    iss: 'https://accounts.google.com',
    aud: 'client-test',
    sub: 'google-camille',
    email: 'camille@example.net',
    email_verified: true,
    name: 'Camille Martin',
    given_name: 'Camille',
  };

  /** Le bouton, puis le retour de Google avec ce compte-là. */
  const revenirDeGoogle = async (t: TestContext, retour: string): Promise<LightMyRequestResponse> => {
    const demande = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/social',
      headers: { origin: TEST_BASE_URL },
      payload: { provider: 'google', callbackURL: retour, errorCallbackURL: retour },
    });
    assert.equal(demande.statusCode, 200, demande.body);
    const versGoogle = new URL(demande.json<{ url: string }>().url);
    assert.equal(versGoogle.origin, 'https://accounts.google.com');
    assert.equal(versGoogle.searchParams.get('redirect_uri'), `${TEST_BASE_URL}/api/auth/callback/google`);
    const state = versGoogle.searchParams.get('state');
    assert.ok(state);

    const fetch = t.mock.method(globalThis, 'fetch', () => Promise.resolve(Response.json({
      access_token: 'jeton-google', token_type: 'Bearer', expires_in: 3600, id_token: idToken(CAMILLE),
    })));
    try {
      return await app.inject({
        method: 'GET',
        url: `/api/auth/callback/google?code=code-test&state=${encodeURIComponent(state)}`,
        headers: { cookie: cookies(demande).join('; ') },
      });
    } finally {
      fetch.mock.restore();
    }
  };

  it('l’écran de connexion ne propose Google que sur une instance qui l’a branché', async () => {
    assert.deepEqual((await app.inject({ method: 'GET', url: '/api/me' })).json(), { state: 'anonyme', google: true });
    assert.deepEqual((await sansGoogle.inject({ method: 'GET', url: '/api/me' })).json(), { state: 'anonyme', google: false });
  });

  it('un compte Google entre, et revient là où il était', async (t) => {
    const retour = await revenirDeGoogle(t, '/invitation/abc');
    assert.equal(retour.statusCode, 302);
    assert.equal(retour.headers.location, '/invitation/abc', 'une invitation ouverte avant le compte survit');
    const session = cookieDeSession(retour);
    assert.ok(session, 'et la personne est connectée');

    const me = (await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: session } }))
      .json<{ state: string; user: { email: string; name: string } }>();
    assert.equal(me.state, 'sans_foyer');
    assert.equal(me.user.email, CAMILLE.email);
    assert.equal(me.user.name, 'Camille', 'le prénom, comme à l’inscription');

    const { rows } = await pool.query<{ accessToken: string }>(
      `select "accessToken" from "account" where "providerId" = 'google'`,
    );
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0]?.accessToken, 'jeton-google', 'les jetons Google ne sont pas en clair');
  });

  it('une adresse inscrite par mot de passe et jamais confirmée n’est pas reliée à Google', async (t) => {
    await signUp(auth, CAMILLE.email);

    const retour = await revenirDeGoogle(t, '/');
    assert.equal(retour.statusCode, 302);
    const location = new URL(String(retour.headers.location), TEST_BASE_URL);
    assert.equal(location.pathname, '/');
    assert.equal(location.searchParams.get('error'), 'account_not_linked', 'l’écran de connexion sait quoi dire');
    assert.equal(cookieDeSession(retour), undefined);

    const { rows } = await pool.query(`select 1 from "account" where "providerId" = 'google'`);
    assert.equal(rows.length, 0);
  });
});
