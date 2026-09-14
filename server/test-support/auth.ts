/**
 * Fabrique de comptes et de foyers pour les tests d'intégration.
 *
 * Passe par l'API réelle — `signUpEmail`, `createOrganization`,
 * `setActiveOrganization` — plutôt que d'insérer les lignes à la main. Un
 * harnais qui écrit directement en base teste un schéma, pas une
 * authentification : il laisserait passer exactement les bugs qu'on cherche,
 * comme un foyer créé sans son organisation ou un rôle jamais posé.
 */
import type pg from 'pg';
import { buildAuth, type Auth, type AuthOptions } from '../auth/auth.ts';
import type { SendMail } from '../auth/mail.ts';

export const TEST_BASE_URL = 'http://localhost';

/** Secret de test. Sans valeur, mais de la bonne longueur. */
const TEST_SECRET = 'test'.repeat(10);

/**
 * Sans `mail`, l'instance n'en envoie pas : pas de confirmation d'adresse, et
 * `signUp` rend un compte qui peut entrer tout de suite. `mail.test.ts` passe
 * une boîte qui garde ce qu'elle reçoit. Sans `google`, pas de bouton Google ;
 * `google.test.ts` passe un client factice.
 */
export function buildTestAuth(
  pool: pg.Pool,
  mail: SendMail | null = null,
  google: AuthOptions['google'] = null,
): Auth {
  return buildAuth({
    pool,
    baseURL: TEST_BASE_URL,
    secret: TEST_SECRET,
    // `Secure` empêcherait le cookie de revenir en test, qui parle http.
    secureCookies: false,
    mail,
    google,
  });
}

export interface TestAccount {
  userId: string;
  email: string;
  /** L'en-tête `cookie` à rejouer sur les requêtes suivantes. */
  cookie: string;
}

export interface TestHousehold extends TestAccount {
  householdId: string;
  organizationId: string;
}

/** Un compte, et rien d'autre : pas encore de foyer. */
export async function signUp(auth: Auth, email: string, name = 'Compte'): Promise<TestAccount> {
  const response = await auth.api.signUpEmail({
    body: { email, password: 'motdepasse-de-test-long', name },
    asResponse: true,
  });
  if (response.status !== 200) {
    throw new Error(`inscription refusée (${response.status}) : ${await response.text()}`);
  }
  const setCookie = response.headers.get('set-cookie') ?? '';
  const cookie = setCookie.split(';')[0] ?? '';
  const body = (await response.json()) as { user?: { id?: string } };
  const userId = body.user?.id;
  if (userId === undefined) throw new Error('inscription sans identifiant de compte');
  return { userId, email, cookie };
}

/** Un compte, son foyer, et le foyer rendu actif. */
export async function signUpWithHousehold(
  auth: Auth,
  pool: pg.Pool,
  email: string,
  householdName = 'Foyer test',
): Promise<TestHousehold> {
  const account = await signUp(auth, email);
  const headers = new Headers({ cookie: account.cookie });

  const org = await auth.api.createOrganization({
    body: { name: householdName, slug: email.split('@')[0] ?? email },
    headers,
  });
  if (org === null || org === undefined) throw new Error('foyer non créé');

  await auth.api.setActiveOrganization({ body: { organizationId: org.id }, headers });

  const { rows } = await pool.query<{ id: string }>(
    'select id from household where organization_id = $1',
    [org.id],
  );
  const householdId = rows[0]?.id;
  if (householdId === undefined) {
    throw new Error('organisation créée sans foyer — le hook afterCreateOrganization n’a pas tourné');
  }

  return { ...account, householdId, organizationId: org.id };
}

/** Invite `email` dans un foyer, et accepte l'invitation sous ce compte. */
export async function inviteAndAccept(
  auth: Auth,
  inviter: TestHousehold,
  invitee: TestAccount,
  role: 'parent' | 'adulte',
): Promise<void> {
  const invitation = await auth.api.createInvitation({
    body: { email: invitee.email, role, organizationId: inviter.organizationId },
    headers: new Headers({ cookie: inviter.cookie }),
  });
  if (invitation === null || invitation === undefined) throw new Error('invitation non créée');

  await auth.api.acceptInvitation({
    body: { invitationId: invitation.id },
    headers: new Headers({ cookie: invitee.cookie }),
  });
}
