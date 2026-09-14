/**
 * L'envoi de mail (dette n° 7) : ce qu'il allume, et ce qu'il ne doit pas casser.
 *
 * La première suite tourne sans base : c'est la lecture de la configuration.
 * La seconde suit chaque lien reçu jusqu'au bout, à travers Fastify — un lien
 * qui part dans un mail et ne mène nulle part est exactement le bug qui ne se
 * voit qu'en production, dans la boîte de quelqu'un d'autre.
 *
 * Les gestes du client passent par `auth.api`, comme dans `test-support` : par
 * HTTP, le limiteur de better-auth (trois connexions par dix secondes) ferait
 * échouer la suite sur un compteur, pas sur un bug. Les liens reçus, eux,
 * passent par `inject` — c'est le chemin qu'emprunte vraiment un navigateur.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type pg from 'pg';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from './app.ts';
import type { Auth } from './auth/auth.ts';
import { buildMailer, MailConfigError, type Mail } from './auth/mail.ts';
import { buildTestAuth, TEST_BASE_URL } from './test-support/auth.ts';
import { closeTestPool, resetDatabase, SKIP_MESSAGE, testDatabaseUrl, testPool } from './test-support/db.ts';

describe('configuration du mail', () => {
  const FROM = 'Tablée <tablee@example.net>';

  it('n’envoie rien sans TABLEE_MAIL', () => {
    assert.equal(buildMailer({}), null);
  });

  it('refuse une configuration incomplète plutôt que de se taire', () => {
    assert.throws(() => buildMailer({ TABLEE_MAIL: 'resend', RESEND_API_KEY: 're_x' }), MailConfigError);
    assert.throws(() => buildMailer({ TABLEE_MAIL: 'resend', TABLEE_MAIL_FROM: FROM }), MailConfigError);
    assert.throws(() => buildMailer({ TABLEE_MAIL: 'smtp', TABLEE_MAIL_FROM: FROM }), MailConfigError);
    assert.throws(() => buildMailer({ TABLEE_MAIL: 'sendgrid', TABLEE_MAIL_FROM: FROM }), MailConfigError);
  });

  it('monte un transport SMTP depuis son URL', () => {
    const send = buildMailer({ TABLEE_MAIL: 'smtp', TABLEE_MAIL_FROM: FROM, SMTP_URL: 'smtp://localhost:2525' });
    assert.equal(typeof send, 'function');
  });

  it('parle à Resend comme il l’attend, et remonte ses refus', async (t) => {
    let statut = 200;
    const fetch = t.mock.method(globalThis, 'fetch', () =>
      Promise.resolve(new Response('{"message":"domaine non vérifié"}', { status: statut })));
    const send = buildMailer({ TABLEE_MAIL: 'resend', TABLEE_MAIL_FROM: FROM, RESEND_API_KEY: 're_clef' });
    assert.ok(send);

    await send({ to: 'mamie@example.net', subject: 'Objet', text: 'Corps' });
    const [url, init] = fetch.mock.calls[0]!.arguments as [string, RequestInit];
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal((init.headers as Record<string, string>)['authorization'], 'Bearer re_clef');
    assert.deepEqual(JSON.parse(init.body as string), {
      from: FROM, to: 'mamie@example.net', subject: 'Objet', text: 'Corps',
    });

    statut = 403;
    await assert.rejects(send({ to: 'mamie@example.net', subject: 'Objet', text: 'Corps' }), /403/);
  });
});

const enabled = testDatabaseUrl() !== null;

describe('ce que l’envoi de mail allume', { skip: enabled ? false : SKIP_MESSAGE }, () => {
  const MOT_DE_PASSE = 'motdepasse-de-test-long';
  let pool: pg.Pool;
  let auth: Auth;
  let app: FastifyInstance;
  let boîte: Mail[] = [];
  let enPanne = false;

  before(async () => {
    pool = await testPool();
    auth = buildTestAuth(pool, (mail) => {
      boîte.push(mail);
      return enPanne ? Promise.reject(new Error('relais injoignable')) : Promise.resolve();
    });
    app = buildApp({ pool, auth, baseURL: TEST_BASE_URL }, { webDir: '/dev/null/absent' });
    await app.ready();
  });

  after(async () => {
    await app.close();
    await closeTestPool();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
    boîte = [];
    enPanne = false;
  });

  const inscrire = (email: string, callbackURL?: string): Promise<Response> =>
    auth.api.signUpEmail({
      body: { email, password: MOT_DE_PASSE, name: 'Camille', ...(callbackURL === undefined ? {} : { callbackURL }) },
      asResponse: true,
    });

  const connecter = (email: string, password: string, callbackURL?: string): Promise<Response> =>
    auth.api.signInEmail({
      body: { email, password, ...(callbackURL === undefined ? {} : { callbackURL }) },
      asResponse: true,
    });

  /** Le lien du dernier mail reçu à cette adresse, réduit à son chemin pour `inject`. */
  const lienReçu = (to: string): string => {
    const mail = boîte.filter((m) => m.to === to).at(-1);
    assert.ok(mail, `aucun mail pour ${to}`);
    const url = /https?:\/\/\S+/.exec(mail.text)?.[0];
    assert.ok(url, 'un mail sans lien');
    const { pathname, search } = new URL(url);
    return pathname + search;
  };

  const cookieDeSession = (response: LightMyRequestResponse): string | undefined =>
    [response.headers['set-cookie'] ?? []].flat()
      .find((c) => c.includes('session_token='))?.split(';')[0];

  /** Inscription, puis le lien de confirmation suivi : un compte qui peut entrer. */
  const compteConfirmé = async (email: string): Promise<string> => {
    assert.equal((await inscrire(email)).status, 200);
    const cookie = cookieDeSession(await app.inject({ method: 'GET', url: lienReçu(email) }));
    assert.ok(cookie, 'le lien de confirmation connecte');
    return cookie;
  };

  const foyerDe = async (cookie: string): Promise<string> => {
    const headers = new Headers({ cookie });
    const org = await auth.api.createOrganization({ body: { name: 'Les Essais', slug: 'les-essais' }, headers });
    assert.ok(org);
    await auth.api.setActiveOrganization({ body: { organizationId: org.id }, headers });
    return org.id;
  };

  const inviterMamie = (cookie: string, organizationId: string) =>
    auth.api.createInvitation({
      body: { email: 'mamie@example.net', role: 'adulte', organizationId },
      headers: new Headers({ cookie }),
    });

  it('une inscription attend la confirmation de l’adresse, et y ramène', async () => {
    const email = 'nouveau@example.net';
    const inscription = await inscrire(email, '/invitation/abc');
    assert.equal(inscription.status, 200);
    const corps = (await inscription.json()) as { token: string | null };
    assert.equal(corps.token, null, 'pas de session avant confirmation');

    const refus = await connecter(email, MOT_DE_PASSE, '/invitation/abc');
    assert.equal(refus.status, 403);
    assert.equal(((await refus.json()) as { code?: string }).code, 'EMAIL_NOT_VERIFIED');
    assert.equal(boîte.filter((m) => m.to === email).length, 2, 'la connexion refusée renvoie un lien');

    const confirmation = await app.inject({ method: 'GET', url: lienReçu(email) });
    assert.equal(confirmation.statusCode, 302);
    assert.equal(confirmation.headers.location, '/invitation/abc', 'l’invitation ouverte avant le compte survit');
    assert.ok(cookieDeSession(confirmation), 'et la personne est connectée');

    assert.equal((await connecter(email, MOT_DE_PASSE)).status, 200);
  });

  it('un mot de passe oublié se change depuis le lien reçu, et l’ancien ne sert plus', async () => {
    const email = 'distrait@example.net';
    await compteConfirmé(email);

    await auth.api.requestPasswordReset({ body: { email: 'personne@example.net', redirectTo: '/reinitialiser' } });
    assert.equal(boîte.some((m) => m.to === 'personne@example.net'), false, 'rien ne part vers une adresse inconnue');

    await auth.api.requestPasswordReset({ body: { email, redirectTo: '/reinitialiser' } });
    const passage = await app.inject({ method: 'GET', url: lienReçu(email) });
    assert.equal(passage.statusCode, 302);
    const arrivée = new URL(String(passage.headers.location), TEST_BASE_URL);
    assert.equal(arrivée.pathname, '/reinitialiser', 'le lien mène à l’écran du front');
    const token = arrivée.searchParams.get('token');
    assert.ok(token);

    await auth.api.resetPassword({ body: { newPassword: 'un-tout-nouveau-mot', token } });
    assert.equal((await connecter(email, MOT_DE_PASSE)).status, 401);
    assert.equal((await connecter(email, 'un-tout-nouveau-mot')).status, 200);
  });

  it('une invitation part par mail, avec le lien même que celui rendu au parent', async () => {
    const cookie = await compteConfirmé('parent@example.net');
    const invitation = await inviterMamie(cookie, await foyerDe(cookie));
    assert.ok(invitation);

    const lien = await app.inject({ method: 'GET', url: `/api/invitations/${invitation.id}/lien`, headers: { cookie } });
    assert.deepEqual(lien.json(), { url: `${TEST_BASE_URL}/invitation/${invitation.id}`, mailed: true });
    assert.equal(lienReçu('mamie@example.net'), `/invitation/${invitation.id}`);
  });

  it('un envoi raté ne fait pas échouer l’invitation, et ne journalise pas le lien', async (t) => {
    const cookie = await compteConfirmé('parent@example.net');
    const organizationId = await foyerDe(cookie);
    const erreurs = t.mock.method(console, 'error', () => undefined);

    enPanne = true;
    assert.ok(await inviterMamie(cookie, organizationId), 'l’invitation existe, et son lien reste à copier');

    // Le rejet se journalise au tour suivant de la boucle d'événements.
    await new Promise((resolve) => setImmediate(resolve));
    const journal = erreurs.mock.calls.map((c) => String(c.arguments[0])).join('\n');
    assert.match(journal, /relais injoignable/);
    assert.doesNotMatch(journal, /\/invitation\//);
  });
});
