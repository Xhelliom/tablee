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
import { withHousehold } from '../db.ts';
import { claimEatersForUser } from '../repo/eaters.ts';
import { createHouseholdForOrganization, findHouseholdByOrganization } from '../repo/households.ts';
import { composeMail, type Mail, type SendMail } from './mail.ts';

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

/** Le lien que suit un invité : rendu au parent, et mis dans le mail s'il en part un. */
export const invitationUrl = (baseURL: string, id: string): string =>
  new URL(`/invitation/${encodeURIComponent(id)}`, baseURL).toString();

/**
 * Part en arrière-plan, et ne lève jamais.
 *
 * better-auth **attend** ces crochets, faute de file d'arrière-plan : un envoi
 * lent ralentirait la réponse — et dirait, par sa durée, si un compte existe —
 * et un envoi raté la ferait échouer. L'invitation serait pourtant créée, mais
 * le parent verrait une erreur au lieu du lien à copier.
 *
 * Le journal dit l'objet et l'erreur, jamais le corps : il porte un jeton.
 */
function expédier(send: SendMail, mail: Mail): Promise<void> {
  send(mail).catch((error: unknown) => {
    console.error(`mail non envoyé (« ${mail.subject} ») : ${error instanceof Error ? error.message : String(error)}`);
  });
  return Promise.resolve();
}

/**
 * Rattache à son compte l'assiette que le foyer lui réservait.
 *
 * C'est la moitié serveur de « je saisis ma femme aujourd'hui, elle s'inscrit
 * dans trois semaines » : le parent a posé `claim_email` en créant la fiche, et
 * l'arrivée du compte dans le foyer — par invitation acceptée ou par ajout
 * direct — passe ici.
 *
 * ── Deux détails qui ne se devinent pas ─────────────────────────────────────
 *
 * `eater` est sous RLS depuis la 008 : une écriture depuis le pool nu ne
 * toucherait **aucune ligne**, en silence. D'où `withHousehold`, qui pose
 * `app.household_id` sur sa connexion — le crochet tourne hors du cycle de
 * requête de Fastify, il n'a donc pas de `request.db` sous la main.
 *
 * Et l'échec ne remonte pas. Un rattachement raté laisse une fiche non
 * rattachée, que le parent corrige d'un tap (« C'est elle ») ; une exception
 * levée ici ferait **échouer l'acceptation de l'invitation**, et la personne ne
 * pourrait pas entrer du tout. Le second coûte bien plus cher que le premier.
 */
async function rattacherAssiette(
  pool: pg.Pool,
  organizationId: string,
  user: { id: string; email: string },
): Promise<void> {
  try {
    const foyer = await findHouseholdByOrganization(pool, organizationId);
    if (foyer === null) return;
    await withHousehold(pool, foyer.id, (client) =>
      claimEatersForUser(client, foyer.id, user.id, user.email.toLowerCase()),
    );
  } catch {
    // Volontairement muet : voir l'en-tête. La fiche reste rattachable à la
    // main, et l'invitation, elle, aboutit.
  }
}

export interface AuthOptions {
  pool: pg.Pool;
  baseURL: string;
  secret: string;
  /** `false` en développement sur http://localhost, jamais en production. */
  secureCookies: boolean;
  /**
   * L'envoi de mail, ou `null` quand l'instance n'en envoie pas (`mail.ts`).
   *
   * Il allume trois choses d'un coup, parce qu'aucune ne tient sans les
   * autres : un mot de passe oublié réinitialisé par mail ne vaut que si
   * l'adresse a été confirmée, et la confirmation n'a de sens que si un mail
   * peut partir (dette n° 7).
   */
  mail: SendMail | null;
  /**
   * Le client OAuth Google, ou `null` quand l'hébergeur ne l'a pas branché
   * (`GOOGLE_CLIENT_ID`, voir `server/index.ts`).
   */
  google: { clientId: string; clientSecret: string } | null;
}

export type Auth = ReturnType<typeof buildAuth>;

export function buildAuth(options: AuthOptions) {
  const { mail } = options;

  return betterAuth({
    database: options.pool,
    secret: options.secret,
    baseURL: options.baseURL,
    basePath: '/api/auth',

    /**
     * La connexion Google : un tap, là où une adresse et douze caractères
     * mettent de la friction sur le chemin critique.
     *
     * Une adresse déjà inscrite par mot de passe n'y est reliée que si elle
     * est **confirmée** — `requireLocalEmailVerified`, le défaut de
     * better-auth, laissé tel quel exprès. Sans lui, inscrire l'adresse de
     * quelqu'un avant lui suffirait à garder un mot de passe sur le compte
     * qu'il ouvrira ensuite par Google. Sans `TABLEE_MAIL`, aucune adresse
     * n'est confirmée : la personne entre avec son mot de passe, puis lie
     * Google depuis son profil — connectée, cette fois.
     */
    ...(options.google === null ? {} : {
      socialProviders: {
        google: {
          ...options.google,
          // `user.name` est un prénom partout ailleurs : l'inscription le
          // demande ainsi, l'invitation le cite. Google rend le nom complet.
          mapProfileToUser: (profile) => ({ name: profile.given_name ?? profile.name }),
        },
      },
    }),

    account: {
      // Tablée n'appelle aucune API Google, mais better-auth garde les jetons
      // dans `account` : chiffrés, un dump de la base ne les rend pas utilisables.
      encryptOAuthTokens: true,
      // Lier Google depuis son profil exige d'être connecté : la session
      // prouve le compte, Google prouve le sien. Les deux adresses n'ont pas à
      // coïncider — on s'inscrit souvent avec une autre que sa Gmail, et c'est
      // justement ce cas qu'il faut rendre rapide. La liaison **implicite**, à
      // la connexion, reste limitée à la même adresse, confirmée.
      accountLinking: { allowDifferentEmails: true },
    },

    emailAndPassword: {
      enabled: true,
      // L'inscription est **ouverte**, et c'est voulu : des amis doivent
      // pouvoir créer leur foyer sans passer par l'hébergeur. C'est aussi ce
      // qui expose la boîte, d'où la limitation de débit plus bas.
      //
      // ⚠️ La vérification d'adresse mail est désactivée faute de serveur SMTP
      // (dette n° 7). Tant qu'elle l'est, une adresse n'est pas une preuve.
      //
      // ⚠️ Nuancé le 14/09/2026 : elle est obligatoire dès que l'instance
      // envoie des mails. Sans `TABLEE_MAIL`, la phrase au-dessus reste vraie.
      requireEmailVerification: mail !== null,
      minPasswordLength: 12,
      // Qui a oublié son mot de passe a peut-être aussi perdu un téléphone :
      // les sessions ouvertes tombent avec l'ancien.
      revokeSessionsOnPasswordReset: true,
      ...(mail === null ? {} : {
        sendResetPassword: ({ user, url }) => expédier(mail, composeMail({
          to: user.email,
          subject: 'Choisir un nouveau mot de passe Tablée',
          title: 'Nouveau mot de passe',
          paragraphs: ['Une demande de nouveau mot de passe a été faite pour ce compte Tablée.'],
          action: { label: 'Choisir un nouveau mot de passe', url },
          footer: 'Le lien vaut une heure. Si vous n’avez rien demandé, ignorez ce message : votre mot de passe ne change pas.',
        })),
      }),
    },

    ...(mail === null ? {} : {
      emailVerification: {
        sendOnSignUp: true,
        // Un compte créé avant que l'instance envoie des mails n'a jamais
        // confirmé son adresse : sa prochaine connexion lui renvoie un lien,
        // plutôt qu'un refus sans issue.
        sendOnSignIn: true,
        autoSignInAfterVerification: true,
        sendVerificationEmail: ({ user, url }) => expédier(mail, composeMail({
          to: user.email,
          subject: 'Confirmer votre adresse sur Tablée',
          title: 'Confirmer votre adresse',
          paragraphs: ['Il reste une étape avant d’entrer dans Tablée : confirmer que cette adresse est bien la vôtre.'],
          action: { label: 'Confirmer mon adresse', url },
          footer: 'Si vous n’avez pas créé de compte sur Tablée, ignorez ce message.',
        })),
      },
    }),

    /**
     * 30 jours, et non les 7 par défaut de better-auth.
     *
     * C'est la seule décision du §7 qui survit à son renversement, et sa raison
     * tient toujours : une PWA familiale qui redemande le mot de passe toutes
     * les semaines met de la friction sur le chemin critique — et la friction
     * de saisie est le vrai risque du projet. `updateAge` repousse l'échéance
     * à chaque usage, donc quelqu'un qui ouvre l'app régulièrement ne se
     * reconnecte jamais.
     */
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
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

          // Quelqu'un entre dans un foyer : si une assiette l'attendait, elle
          // devient la sienne. Les deux chemins d'entrée sont couverts —
          // l'invitation acceptée, qui est le cas courant, et l'ajout direct
          // d'un membre, qui ne passe pas par une invitation.
          afterAcceptInvitation: async ({ organization: org, user }) => {
            await rattacherAssiette(options.pool, org.id, user);
          },
          afterAddMember: async ({ organization: org, user }) => {
            await rattacherAssiette(options.pool, org.id, user);
          },
        },

        // Pas de `sendInvitationEmail` : sans SMTP, l'invitation est un lien
        // que l'inviteur copie et transmet comme il veut. C'est un choix, pas
        // un manque — installer un relais mail pour deux invitations par
        // décennie coûte plus cher que ça ne rapporte. L'identifiant de
        // l'invitation est rendu à l'appelant, qui construit le lien.
        //
        // ⚠️ Nuancé le 14/09/2026 : une instance qui envoie déjà des mails pour
        // les mots de passe oubliés envoie aussi l'invitation — le relais est
        // là, le coût est payé. Le lien reste rendu à l'appelant dans tous les
        // cas : un mail peut finir en indésirables.
        ...(mail === null ? {} : {
          sendInvitationEmail: ({ id, email, organization: org, inviter }) => expédier(mail, composeMail({
            to: email,
            subject: `Invitation au foyer « ${org.name} » sur Tablée`,
            title: `Rejoindre le foyer « ${org.name} »`,
            paragraphs: [
              `${inviter.user.name} vous invite à suivre les repas du foyer « ${org.name} » sur Tablée.`,
              'En acceptant, vous pourrez enregistrer les repas et voir les bilans de chacun.',
            ],
            action: { label: 'Rejoindre le foyer', url: invitationUrl(options.baseURL, id) },
            footer: 'Le lien vaut sept jours. Si vous n’attendiez pas cette invitation, ignorez ce message.',
          })),
        }),
        invitationExpiresIn: 60 * 60 * 24 * 7,
      }),
    ],
  });
}
