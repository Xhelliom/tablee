/**
 * Identité : comptes, foyers, invitations, rôles.
 *
 * Le §7 (« un compte par foyer ») a été renversé le 13/09/2026, et le §16
 * (« si l'app sort un jour du foyer ») tranché : plusieurs adultes avec leur
 * propre compte, plusieurs foyers étanches sur une instance.
 *
 * ── Pourquoi une bibliothèque ici, et pas ailleurs ──────────────────────────
 *
 * Les cent lignes maison du §7 faisaient très bien ce qu'on leur demandait.
 * Ce qu'elles ne faisaient pas, ce n'est pas le login :
 *
 *   - **l'invitation** — entropie du jeton, expiration, usage unique, et le cas
 *     tordu d'une invitation acceptée alors qu'on est connecté sous un autre
 *     compte. Court à écrire, facile à écrire mal ;
 *   - **la récupération de mot de passe** — inexistante, parce qu'avec un mot
 *     de passe partagé entre deux adultes qui ont la main sur la machine, SSH
 *     suffisait. Ça ne suffit plus pour la femme d'un ami.
 *
 * better-auth possède donc l'identité, et **rien d'autre**. Le calcul
 * nutritionnel, les convives, les repas restent au domaine. La frontière passe
 * exactement là : `"user"` est un compte, `eater` est une assiette, et les deux
 * ensembles ne coïncident pas (voir l'en-tête de `007_comptes_et_foyers.sql`).
 *
 * ── Le schéma est figé, pas généré ──────────────────────────────────────────
 *
 * Le DDL des sept tables de better-auth est recopié dans la migration 007.
 * Son générateur ne doit **jamais** tourner en écriture sur cette base : la
 * règle du dépôt est qu'une migration appliquée ne se modifie plus, et le
 * lanceur le vérifie par empreinte. Une montée de version de better-auth se
 * fait par une migration de plus.
 */
import { betterAuth } from 'better-auth';
import { createAccessControl } from 'better-auth/plugins/access';
import { organization } from 'better-auth/plugins/organization';
import type pg from 'pg';
import { createHouseholdForOrganization } from '../repo/households.ts';

/**
 * Ce qu'un rôle peut faire.
 *
 * Les quatre premiers énoncés sont ceux de better-auth, qui s'en sert pour
 * garder ses propres routes. Les deux derniers sont au domaine : ils décrivent
 * ce que le code de Tablée autorise, et c'est Tablée qui les vérifie.
 */
const statement = {
  organization: ['update', 'delete'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  ac: ['create', 'read', 'update', 'delete'],
  /** Les convives : qui est à table, avec quel coefficient de portion. */
  eater: ['create', 'update', 'delete'],
  /** Les repas eux-mêmes. */
  meal: ['create', 'update', 'delete'],
} as const;

export const ac = createAccessControl(statement);

/**
 * Deux rôles, et pas trois.
 *
 * Une hiérarchie « admin / sous-admin » entre deux conjoints ne protège rien,
 * et le jour où elle servirait, c'est qu'il se passe quelque chose que le
 * logiciel n'a pas à arbitrer. La granularité utile s'adosse à de vraies
 * personnes :
 *
 *   `parent`  les parents. Tout, y compris inviter, retirer un accès, changer
 *             un rôle, supprimer le foyer.
 *   `adulte`  une nounou, un grand-parent. Saisit les repas et lit tout — les
 *             allergènes en particulier, dont il a besoin — mais ne touche ni
 *             aux accès, ni à la composition du foyer.
 *
 * Un troisième rôle viendra le jour où un enfant aura un compte. Ce ne sera pas
 * « un parent en moins » : I5 interdit d'afficher un objectif chiffré de
 * calories ou de poids sur un profil mineur, et « maman voit mon assiette »
 * n'est plus le même produit qu'entre adultes qui se sont mis d'accord. Ça se
 * décidera à ce moment-là, pas maintenant, et pas par défaut.
 */
export const ROLES = {
  parent: ac.newRole({
    organization: ['update', 'delete'],
    member: ['create', 'update', 'delete'],
    invitation: ['create', 'cancel'],
    ac: ['create', 'read', 'update', 'delete'],
    eater: ['create', 'update', 'delete'],
    meal: ['create', 'update', 'delete'],
  }),
  adulte: ac.newRole({
    organization: [],
    member: [],
    invitation: [],
    ac: ['read'],
    eater: [],
    meal: ['create', 'update', 'delete'],
  }),
};

export type Role = keyof typeof ROLES;

export const isRole = (value: string): value is Role => value === 'parent' || value === 'adulte';

/** Le rôle de celui qui crée le foyer. C'est le sien, il en est parent. */
const CREATOR_ROLE = 'parent';

export interface AuthOptions {
  pool: pg.Pool;
  baseURL: string;
  secret: string;
  /** `false` en développement sur http://localhost, jamais en production. */
  secureCookies: boolean;
}

export type Auth = ReturnType<typeof buildAuth>;

export function buildAuth(options: AuthOptions) {
  return betterAuth({
    database: options.pool,
    secret: options.secret,
    baseURL: options.baseURL,
    basePath: '/api/auth',

    emailAndPassword: {
      enabled: true,
      // L'inscription est **ouverte**, et c'est voulu : des amis doivent
      // pouvoir créer leur foyer sans passer par l'hébergeur. C'est aussi ce
      // qui expose la boîte, d'où la limitation de débit plus bas.
      //
      // ⚠️ La vérification d'adresse mail est désactivée faute de serveur SMTP
      // (dette n° 7). Tant qu'elle l'est, une adresse n'est pas une preuve.
      requireEmailVerification: false,
      minPasswordLength: 12,
    },

    // Le partage Android ouvre l'app sur une navigation de haut niveau :
    // `SameSite=Lax` laisse passer le cookie, et `Strict` le bloquerait.
    advanced: {
      useSecureCookies: options.secureCookies,
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true },
    },

    rateLimit: {
      enabled: true,
      window: 60,
      max: 30,
    },

    plugins: [
      organization({
        ac,
        roles: ROLES,
        creatorRole: CREATOR_ROLE,

        // Une organisation better-auth n'est qu'une identité. Le foyer, avec
        // son fuseau — qui découpe les journées et les mois de saisonnalité —
        // est une table du domaine, créée ici pour qu'aucune organisation ne
        // puisse exister sans son foyer.
        organizationHooks: {
          afterCreateOrganization: async ({ organization: org }) => {
            await createHouseholdForOrganization(options.pool, org.id, org.name);
          },
        },

        // Pas de `sendInvitationEmail` : sans SMTP, l'invitation est un lien
        // que l'inviteur copie et transmet comme il veut. C'est un choix, pas
        // un manque — installer un relais mail pour deux invitations par
        // décennie coûte plus cher que ça ne rapporte. L'identifiant de
        // l'invitation est rendu à l'appelant, qui construit le lien.
        invitationExpiresIn: 60 * 60 * 24 * 7,
      }),
    ],
  });
}
