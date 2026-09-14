/**
 * La connexion Google, de bout en bout — sauf Google.
 *
 * Un seul échange sort vraiment : le code contre les jetons, auprès de
 * `oauth2.googleapis.com`. Il est remplacé par un `fetch` qui rend un
 * `id_token` fabriqué. Tout le reste passe par Fastify comme le ferait un
 * navigateur : le bouton demande l'URL de Google, Google ramène au callback, et
 * la session — ou la liaison — doit en sortir. Ce qui ne se teste pas ici — le
 * client OAuth déclaré chez Google, son URI de redirection — se vérifie une
 * fois, sur l'instance (`docs/mise-en-service.md`).
 *
 * Trois passages par `/sign-in/social`, pas plus : better-auth en laisse trois
 * par dix secondes, et un compteur ferait échouer la suite pour rien.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, type TestContext } from 'node:test';
import type pg from 'pg';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from './app.ts';
import type { Auth } from './auth/auth.ts';
import { redactRequestUrl } from './jow/share.ts';
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

  /** Le bouton — connexion ou liaison —, puis le retour de Google avec ce compte-là. */
  const parGoogle = async (
    t: TestContext,
    route: '/api/auth/sign-in/social' | '/api/auth/link-social',
    retour: string,
    session?: string,
  ): Promise<LightMyRequestResponse> => {
    const demande = await app.inject({
      method: 'POST',
      url: route,
      headers: { origin: TEST_BASE_URL, ...(session === undefined ? {} : { cookie: session }) },
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
        headers: { cookie: [...(session === undefined ? [] : [session]), ...cookies(demande)].join('; ') },
      });
    } finally {
      fetch.mock.restore();
    }
  };

  it('Google n’est proposé que sur une instance qui l’a branché', async () => {
    assert.deepEqual((await app.inject({ method: 'GET', url: '/api/me' })).json(), { state: 'anonyme', google: true });
    assert.deepEqual((await sansGoogle.inject({ method: 'GET', url: '/api/me' })).json(), { state: 'anonyme', google: false });
  });

  it('un compte Google entre, et revient sur le partage Jow qui l’attendait, sans ses jetons', async (t) => {
    // Ce que l'écran de connexion confie à better-auth quand Android a ouvert
    // `/share` sur un téléphone sans session.
    const partage = '/share?text=' + encodeURIComponent(
      'Galette https://app.jow.com/EC0U?recipeId=650b16ade7cc8d0013ce4a6e&key=SECRET42&userId=abc',
    );
    const retour = redactRequestUrl(partage);
    assert.doesNotMatch(retour, /SECRET42/);

    const réponse = await parGoogle(t, '/api/auth/sign-in/social', retour);
    assert.equal(réponse.statusCode, 302);
    assert.equal(réponse.headers.location, retour, 'la recette partagée survit à l’aller-retour');
    const session = cookieDeSession(réponse);
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

  it('une adresse inscrite par mot de passe et jamais confirmée n’est pas reliée à Google d’elle-même', async (t) => {
    await signUp(auth, CAMILLE.email);

    const retour = await parGoogle(t, '/api/auth/sign-in/social', '/');
    assert.equal(retour.statusCode, 302);
    const location = new URL(String(retour.headers.location), TEST_BASE_URL);
    assert.equal(location.pathname, '/');
    assert.equal(location.searchParams.get('error'), 'account_not_linked', 'l’écran de connexion sait quoi dire');
    assert.equal(cookieDeSession(retour), undefined);

    const { rows } = await pool.query(`select 1 from "account" where "providerId" = 'google'`);
    assert.equal(rows.length, 0);
  });

  it('un compte connecté lie Google depuis les réglages, puis entre par Google', async (t) => {
    // Une autre adresse que celle du compte Google : le cas courant, et celui
    // que la liaison implicite refuse.
    const compte = await signUp(auth, 'camille@yahoo.fr');

    const liaison = await parGoogle(t, '/api/auth/link-social', '/foyer', compte.cookie);
    assert.equal(liaison.statusCode, 302);
    assert.equal(liaison.headers.location, '/foyer');

    const connexion = await parGoogle(t, '/api/auth/sign-in/social', '/');
    const session = cookieDeSession(connexion);
    assert.ok(session, 'Google fait entrer');
    const me = (await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: session } }))
      .json<{ user: { id: string; email: string } }>();
    assert.equal(me.user.id, compte.userId, 'dans le compte auquel il a été lié');
    assert.equal(me.user.email, 'camille@yahoo.fr', 'dont l’adresse ne change pas');
  });
});
