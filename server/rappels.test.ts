/**
 * Les rappels push : abonnement par appareil, envoi à l'heure du foyer, et ce
 * qui ne doit jamais partir (prénom, foyer sans stock, clé privée côté front).
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import type pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import type { Auth } from './auth/auth.ts';
import { withHousehold } from './db.ts';
import { buildPush, PushConfigError, reminderMessage, runReminders, type PushMessage } from './push.ts';
import { buildTestAuth, signUpWithHousehold, TEST_BASE_URL, type TestHousehold } from './test-support/auth.ts';
import { closeTestPool, resetDatabase, SKIP_MESSAGE, testDatabaseUrl, testPool } from './test-support/db.ts';

describe('rappels : configuration et texte', () => {
  it('sans clé, pas de push ; à moitié remplie, refus', () => {
    assert.equal(buildPush({}), null);
    assert.throws(() => buildPush({ TABLEE_VAPID_PUBLIC: 'x' }), PushConfigError);
  });

  it('le texte nomme des plats, jamais de valeur nutritionnelle', () => {
    const m = reminderMessage(['Galette végé', 'Curry', 'Pâtes', 'Soupe'], 5);
    assert.equal(m.title, 'Aujourd’hui, lequel ?');
    assert.equal(m.body, 'Galette végé, Curry, Pâtes et 2 autres');
    assert.equal(reminderMessage([], 2).body, '2 plats au programme.');
  });

  it('aucune clé privée ni son nom de variable dans le code du front', () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return f === 'dist' || f === 'node_modules' ? [] : statSync(p).isDirectory() ? walk(p) : [p];
    });
    for (const file of walk('web').filter((f) => /\.(tsx?|js|html)$/.test(f))) {
      assert.ok(!readFileSync(file, 'utf8').includes('VAPID_PRIVATE'), file);
    }
  });
});

const enabled = testDatabaseUrl() !== null;

describe('rappels : envoi', { skip: enabled ? false : SKIP_MESSAGE }, () => {
  let pool: pg.Pool;
  let auth: Auth;
  let app: FastifyInstance;
  let nous: TestHousehold;
  let voisins: TestHousehold;
  const sent: { endpoint: string; message: PushMessage }[] = [];
  const send = (s: { endpoint: string }, message: PushMessage): Promise<'ok' | 'gone'> => {
    if (s.endpoint.endsWith('/mort')) return Promise.resolve('gone');
    sent.push({ endpoint: s.endpoint, message });
    return Promise.resolve('ok');
  };
  const midi = new Date('2026-10-12T10:05:00Z'); // 12 h 05 à Paris (UTC+2)

  const call = async (method: string, url: string, cookie: string, payload?: unknown) => {
    const response = await app.inject({
      method: method as 'GET', url, headers: { cookie, origin: TEST_BASE_URL },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
    return { status: response.statusCode, body: response.json() };
  };
  /** Combien d'appareils le foyer a d'abonnés — la RLS cache la table au pool nu. */
  const abonnes = (foyer: TestHousehold) => withHousehold(pool, foyer.householdId, async (db) =>
    (await db.query('select 1 from push_subscription')).rows.length);
  const abonner = (foyer: TestHousehold, endpoint: string) => call('POST', '/api/push/subscription', foyer.cookie,
    { endpoint, keys: { p256dh: 'p', auth: 'a' } });
  const stocker = async (foyer: TestHousehold, title: string, source = 'jow') => {
    await withHousehold(pool, foyer.householdId, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into recipe (source, jow_recipe_id, title, base_servings, household_id)
         values ($1, $2, $3, 2, $4) returning id`,
        [source, source === 'jow' ? title.padEnd(24, 'a').slice(0, 24) : null, title,
          source === 'jow' ? null : foyer.householdId]);
      await db.query('insert into household_recipe (household_id, recipe_id) values ($1, $2)', [foyer.householdId, rows[0]!.id]);
      await db.query('insert into upcoming_dish (household_id, recipe_id) values ($1, $2)', [foyer.householdId, rows[0]!.id]);
    });
  };

  before(async () => {
    pool = await testPool();
    auth = buildTestAuth(pool);
    app = buildApp({ pool, auth, baseURL: TEST_BASE_URL,
      push: { publicKey: 'PUBLIQUE', send } }, { webDir: '/dev/null/absent' });
    await app.ready();
  });
  after(async () => { await app.close(); await closeTestPool(); });
  beforeEach(async () => {
    await resetDatabase(pool);
    sent.length = 0;
    nous = await signUpWithHousehold(auth, pool, 'nous@exemple.test', 'Chez nous');
    voisins = await signUpWithHousehold(auth, pool, 'voisins@exemple.test', 'Chez les voisins');
  });

  it('donne la clé publique, et seulement elle', async () => {
    const r = await call('GET', '/api/push/key', nous.cookie);
    assert.deepEqual(r.body, { publicKey: 'PUBLIQUE' });
  });

  it('abonne un appareil (idempotent), puis le désabonne', async () => {
    assert.equal((await abonner(nous, 'https://push.test/a')).status, 201);
    assert.equal((await abonner(nous, 'https://push.test/a')).status, 201);
    assert.equal(await abonnes(nous), 1);
    assert.equal((await call('POST', '/api/push/unsubscribe', nous.cookie, { endpoint: 'https://push.test/a' })).status, 200);
    assert.equal(await abonnes(nous), 0);
  });

  it('reprend un appareil abonné par un autre foyer, sans laisser l’ancien désabonner', async () => {
    assert.equal((await abonner(nous, 'https://push.test/a')).status, 201);
    assert.equal((await abonner(voisins, 'https://push.test/a')).status, 201);
    assert.equal(await abonnes(nous), 0);
    assert.equal(await abonnes(voisins), 1);
    // La porte de la 025 ne s'ouvre qu'en abonnant : désabonner reste borné au foyer.
    await call('POST', '/api/push/unsubscribe', nous.cookie, { endpoint: 'https://push.test/a' });
    assert.equal(await abonnes(voisins), 1);
  });

  it('refuse un endpoint qui n’est pas en https', async () => {
    assert.equal((await abonner(nous, 'http://push.test/a')).status, 400);
  });

  it('envoie à midi, heure du foyer, et un tap ouvre l’accueil', async () => {
    await abonner(nous, 'https://push.test/a');
    await stocker(nous, 'Galette végé');
    assert.equal(await runReminders(pool, send, midi), 1);
    assert.equal(sent[0]!.message.url, '/');
    assert.match(sent[0]!.message.body, /Galette végé/);
  });

  it('n’envoie pas hors des créneaux, ni deux fois le même', async () => {
    await abonner(nous, 'https://push.test/a');
    await stocker(nous, 'Galette végé');
    assert.equal(await runReminders(pool, send, new Date('2026-10-12T08:00:00Z')), 0);
    assert.equal(await runReminders(pool, send, midi), 1);
    assert.equal(await runReminders(pool, send, new Date('2026-10-12T10:20:00Z')), 0);
    assert.equal(await runReminders(pool, send, new Date('2026-10-12T17:00:00Z')), 1); // 19 h : le soir
  });

  it('un foyer sans stock ne reçoit rien', async () => {
    await abonner(nous, 'https://push.test/a');
    assert.equal(await runReminders(pool, send, midi), 0);
    assert.equal(sent.length, 0);
  });

  it('ne mélange pas les foyers', async () => {
    await abonner(nous, 'https://push.test/a');
    await stocker(voisins, 'Curry');
    assert.equal(await runReminders(pool, send, midi), 0);
  });

  it('ne met jamais le titre d’une recette saisie à la main dans le texte', async () => {
    await abonner(nous, 'https://push.test/a');
    await stocker(nous, 'Gâteau de Léa', 'manuel');
    await runReminders(pool, send, midi);
    assert.ok(!sent[0]!.message.body.includes('Léa'));
    assert.equal(sent[0]!.message.body, '1 plat au programme.');
  });

  it('supprime un appareil que le service push dit disparu', async () => {
    await abonner(nous, 'https://push.test/mort');
    await stocker(nous, 'Galette végé');
    await runReminders(pool, send, midi);
    assert.equal(await abonnes(nous), 0);
  });
});
