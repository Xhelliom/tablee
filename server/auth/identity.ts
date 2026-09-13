/**
 * Qui parle, et pour quel foyer.
 *
 * Résout, à chaque requête : le compte, le foyer actif, et le rôle du compte
 * dans ce foyer. C'est le seul endroit d'où sort un `household_id` — aucune
 * route du §12 n'en accepte un venu du client, et c'est ce qui rend
 * l'étanchéité vérifiable en un seul point plutôt qu'en trente.
 *
 * ── Deux vérifications, pas une ─────────────────────────────────────────────
 *
 * `session.activeOrganizationId` dit quel foyer le client regarde. On ne s'en
 * contente pas : l'appartenance est **revérifiée en base** à chaque requête,
 * par la jointure sur `"member"`. better-auth valide déjà l'appartenance quand
 * il pose ce champ, mais une colonne qui porte un identifiant de foyer et qui
 * n'est pas recoupée est exactement le genre de raccourci qui finit par laisser
 * passer quelque chose. Le coût est une jointure ; le gain est qu'un foyer
 * actif frauduleux ne donne rien.
 */
import type pg from 'pg';
import type { Auth } from './auth.ts';
import { isRole, type Role } from './auth.ts';

export interface Identity {
  userId: string;
  email: string;
  name: string;
  /** Le foyer actif, résolu depuis l'organisation de la session. */
  householdId: string;
  organizationId: string;
  householdName: string;
  timezone: string;
  role: Role;
}

/**
 * L'état d'authentification d'une requête.
 *
 * `connecté sans foyer` est un état normal, pas une erreur : un compte qui
 * vient d'être créé n'a pas encore de foyer, et un compte invité dans deux
 * foyers doit en choisir un. L'app montre alors l'écran de choix, et non
 * l'écran de connexion — les confondre renverrait l'utilisateur au login alors
 * qu'il est parfaitement connecté.
 */
export type AuthState =
  | { kind: 'anonyme' }
  | { kind: 'sans_foyer'; userId: string; email: string; name: string }
  | { kind: 'actif'; identity: Identity };

interface MembershipRow {
  household_id: string;
  household_name: string;
  timezone: string;
  organization_id: string;
  role: string;
}

/**
 * Le foyer actif d'un compte.
 *
 * Quand la session ne désigne aucune organisation et que le compte n'en a
 * qu'une, on prend celle-là : forcer un aller-retour « choisis ton foyer » à
 * quelqu'un qui n'en a qu'un ajoute un tap au chemin critique du partage, pour
 * rien. À partir de deux, c'est à l'utilisateur de trancher.
 */
async function resolveMembership(
  pool: pg.Pool,
  userId: string,
  activeOrganizationId: string | null,
): Promise<MembershipRow | null> {
  if (activeOrganizationId !== null) {
    const { rows } = await pool.query<MembershipRow>(
      `select h.id as household_id, h.name as household_name, h.timezone,
              h.organization_id, m."role"
       from "member" m
       join household h on h.organization_id = m."organizationId"
       where m."userId" = $1 and m."organizationId" = $2`,
      [userId, activeOrganizationId],
    );
    return rows[0] ?? null;
  }

  const { rows } = await pool.query<MembershipRow>(
    `select h.id as household_id, h.name as household_name, h.timezone,
            h.organization_id, m."role"
     from "member" m
     join household h on h.organization_id = m."organizationId"
     where m."userId" = $1
     limit 2`,
    [userId],
  );
  return rows.length === 1 ? (rows[0] ?? null) : null;
}

/**
 * Lit l'état d'authentification d'une requête entrante.
 *
 * `headers` est passé tel quel à better-auth, qui y lit son cookie — la
 * validation du jeton, son expiration et sa révocation sont son affaire, pas
 * la nôtre.
 */
export async function readAuthState(
  auth: Auth,
  pool: pg.Pool,
  headers: Headers,
): Promise<AuthState> {
  const session = await auth.api.getSession({ headers }).catch(() => null);
  if (session === null || session.user === undefined) return { kind: 'anonyme' };

  const { user } = session;
  const active = session.session.activeOrganizationId ?? null;
  const membership = await resolveMembership(pool, user.id, active);

  if (membership === null) {
    return { kind: 'sans_foyer', userId: user.id, email: user.email, name: user.name };
  }

  // Un rôle inconnu n'est pas une permission par défaut. Si `"member".role`
  // porte autre chose que nos deux rôles — montée de version, écriture
  // manuelle — on retombe sur le rôle le moins capable plutôt que de laisser
  // passer.
  const role: Role = isRole(membership.role) ? membership.role : 'adulte';

  return {
    kind: 'actif',
    identity: {
      userId: user.id,
      email: user.email,
      name: user.name,
      householdId: membership.household_id,
      organizationId: membership.organization_id,
      householdName: membership.household_name,
      timezone: membership.timezone,
      role,
    },
  };
}
