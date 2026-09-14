/**
 * Assemblage du serveur : Fastify, session de foyer, routes du §12, et le
 * front servi en statique.
 *
 * Toutes les routes `/api/*` sont authentifiées par cookie et **scopées au
 * `household_id` de la session**. Aucune requête de ce dépôt ne prend un
 * `household_id` depuis le client : c'est la session qui le donne, toujours.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { acquireForHousehold, type HouseholdDb, type ScopedClient } from './db.ts';
import type { Auth } from './auth/auth.ts';
import { readAuthState, type AuthState, type Identity } from './auth/identity.ts';
import { redactRequestUrl } from './jow/share.ts';
import { ApiError } from './http/errors.ts';
import { SECURITY_HEADERS } from './http/headers.ts';
import { authRoutes } from './routes/auth.ts';
import { dashboardRoutes } from './routes/dashboard.ts';
import { foodRoutes } from './routes/foods.ts';
import { householdRoutes } from './routes/household.ts';
import { mealRoutes } from './routes/meals.ts';
import { eaterRoutes } from './routes/eaters.ts';
import { recipeRoutes } from './routes/recipes.ts';
import { templateRoutes } from './routes/templates.ts';

export interface AppContext {
  pool: pg.Pool;
  auth: Auth;
  /** Origine publique du service. Sert à better-auth et aux liens d'invitation. */
  baseURL: string;
}

/**
 * Limitation de débit sur `/api/*` — généreuse, mais présente.
 *
 * ── Pourquoi ─────────────────────────────────────────────────────────────
 *
 * L'inscription est publique par choix (§16) : l'app est sur Internet, et
 * n'importe qui peut créer un compte. better-auth limite ses propres routes ;
 * le reste du §12 ne l'était pas du tout. Sans plafond, une boucle suffit à
 * saturer le pool Postgres d'une machine domestique — pas besoin de
 * malveillance, un script de synchronisation mal écrit fait pareil.
 *
 * ── Le chiffre ───────────────────────────────────────────────────────────
 *
 * 300 requêtes par minute et par compte. Un foyer n'est pas un robot : une
 * journée chargée dans l'app, c'est quelques dizaines de requêtes par minute,
 * et un partage Jow en fait trois. Le plafond ne se voit donc jamais à l'usage
 * — il ne mord que sur une boucle.
 *
 * ── Ce qui n'y est pas soumis ────────────────────────────────────────────
 *
 * `/share` n'est pas une route d'API : c'est une **page**, le chemin critique
 * du produit, servie par la coquille du front. La limitation ne porte que sur
 * `/api/`, donc ni la page, ni les fichiers statiques, ni le manifeste.
 *
 * ── Ce que le proxy change, et ce qu'on n'a pas fait ─────────────────────
 *
 * `request.ip` est l'adresse de **Caddy** en production, pas celle du client :
 * Fastify ne lit `x-forwarded-for` que si on le lui dit (`trustProxy`), et on
 * ne le lui dit pas — un en-tête que l'on croit sur parole se falsifie, et le
 * plafond se contournerait alors d'une ligne. Conséquence assumée : les
 * requêtes **anonymes** partagent un seul compteur. Pour un foyer c'est large ;
 * pour une instance scannée depuis Internet, ça peut faire attendre une minute
 * devant l'écran de connexion. Les requêtes authentifiées, elles, sont comptées
 * par compte et ne sont pas concernées.
 */
export interface RateLimitOptions {
  max: number;
  /** Fenêtre glissante, en millisecondes. */
  timeWindow: number;
}

export const RATE_LIMIT: RateLimitOptions = { max: 300, timeWindow: 60_000 };

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Ce que le hook a pu établir : anonyme, connecté sans foyer, ou actif.
     * Toujours renseigné une fois `onRequest` passé.
     */
    auth: AuthState;
    /** Le compte et son foyer actif. Lève 401 s'il n'y en a pas. */
    identity(): Identity;
    /** Le foyer actif. Lève 401 s'il n'y en a pas. */
    householdId(): string;
    /**
     * Le client Postgres de cette requête, sur lequel `app.household_id` est
     * posé — donc celui que la RLS de la migration 008 filtre. **Toute** lecture
     * ou écriture du domaine passe par lui ; `ctx.pool` ne porte aucun foyer et
     * ne doit plus servir qu'à ce qui précède le foyer — la session, la liste
     * des foyers d'un compte.
     *
     * Le type le dit maintenant, et le compilateur le fait respecter : les
     * fonctions de `server/repo/` exigent un `HouseholdDb`, que seul
     * `acquireForHousehold` produit. Un `ctx.pool` à leur place ne compile pas.
     */
    db: HouseholdDb;
    /** Interne : la libération du client, appelée par le hook onResponse. */
    scoped: ScopedClient | null;
  }
}

/**
 * Routes accessibles sans foyer actif.
 *
 * `/api/auth/*` est servi par better-auth et se garde lui-même. `/api/me` doit
 * répondre à un anonyme — c'est précisément ce qu'il sert à savoir. Tout le
 * reste exige un compte **et** un foyer.
 */
const isPublicApi = (path: string): boolean =>
  path === '/api/me' || path.startsWith('/api/auth/');

/** Les en-têtes Fastify sous la forme que better-auth sait lire. */
function toWebHeaders(raw: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v);
  }
  return headers;
}

export function buildApp(
  ctx: AppContext,
  options: { webDir?: string; rateLimit?: RateLimitOptions } = {},
): FastifyInstance {
  const app = Fastify({
    // Silencieux par défaut : l'app tourne chez l'utilisateur, un log par
    // requête ne sert à personne. `TABLEE_LOG=1` le rallume pour diagnostiquer.
    logger:
      process.env['TABLEE_LOG'] === '1'
        ? {
            serializers: {
              /**
               * I6 — le share target arrive en GET, et le texte partagé par
               * Jow atterrit donc **dans l'URL**, percent-encodé, jetons `key`
               * et `userId` compris. Le journal de requêtes les écrirait tels
               * quels sur le disque : ils sont expurgés avant d'y entrer.
               */
              req: (request: { method: string; url: string }) => ({
                method: request.method,
                url: redactRequestUrl(request.url),
              }),
            },
          }
        : false,
    // Un partage Jow arrive en GET avec un texte long dans la query.
    routerOptions: { maxParamLength: 500 },
  });

  // `null` et non l'état anonyme : Fastify refuse un décorateur objet, qui
  // serait partagé par référence entre toutes les requêtes. Le hook ci-dessous
  // affecte une valeur propre à chacune, avant toute route.
  app.decorateRequest<AuthState | null>('auth', null);
  app.decorateRequest<HouseholdDb | null>('db', null);
  app.decorateRequest<ScopedClient | null>('scoped', null);
  app.decorateRequest('identity', function (this: { auth: AuthState | null }): Identity {
    if (this.auth === null || this.auth.kind !== 'actif') throw ApiError.unauthorized();
    return this.auth.identity;
  });
  app.decorateRequest('householdId', function (this: { auth: AuthState | null }): string {
    if (this.auth === null || this.auth.kind !== 'actif') throw ApiError.unauthorized();
    return this.auth.identity.householdId;
  });

  /**
   * Les en-têtes de sécurité, sur toute réponse — page, fichier, API, erreur,
   * 404. Posés en `onSend` justement pour que les chemins d'erreur, qui sont
   * ceux qu'on oublie, ne soient pas l'exception. Voir `http/headers.ts` pour
   * ce que chacun empêche.
   */
  app.addHook('onSend', (_request, reply, payload, done) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) reply.header(name, value);
    done(null, payload);
  });

  app.register(cookie);


  /**
   * L'état d'authentification est résolu une fois par requête, et seulement
   * pour `/api/*` : les pages et les fichiers statiques n'ont rien à y gagner,
   * et le partage Android ouvre `/share` en navigation — le faire passer par
   * une lecture de session retarderait le chemin critique pour rien.
   */
  app.addHook('onRequest', async (request) => {
    request.auth = { kind: 'anonyme' };

    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/')) return;

    // better-auth se garde lui-même ; le résoudre ici en plus ferait une
    // lecture de session inutile sur chaque connexion.
    if (path.startsWith('/api/auth/')) return;

    request.auth = await readAuthState(ctx.auth, ctx.pool, toWebHeaders(request.headers));

    if (!isPublicApi(path) && request.auth.kind !== 'actif') {
      throw ApiError.unauthorized();
    }

    // Un foyer actif : la requête reçoit son propre client, marqué à ce foyer.
    // Les policies de la 008 s'appuient dessus, et une requête qui aurait
    // oublié son `where household_id = …` ne ramènera donc rien plutôt que le
    // foyer d'à côté.
    if (request.auth.kind === 'actif') {
      const scoped = await acquireForHousehold(ctx.pool, request.auth.identity.householdId);
      request.scoped = scoped;
      request.db = scoped.client;
    }
  });

  // Rendre le client quoi qu'il arrive — réponse normale, erreur, 404.
  // `onResponse` passe dans tous ces cas ; ne pas le faire viderait le pool en
  // quelques dizaines de requêtes.
  app.addHook('onResponse', async (request) => {
    const scoped = request.scoped;
    if (scoped === null) return;
    request.scoped = null;
    await scoped.release();
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.status).send(error.toBody());
    }
    // Un message d'erreur interne peut contenir une requête SQL ou un chemin :
    // il ne sort pas. Le détail reste dans les logs du serveur, qui est chez
    // l'utilisateur.
    request.log.error(error);
    return reply.code(500).send({
      error: { code: 'erreur_interne', message: 'le serveur n’a pas pu traiter la demande' },
    });
  });

  /**
   * Les routes de l'API vivent dans leur propre contexte, et le plafond de
   * débit est chargé **avant** elles.
   *
   * L'ordre n'est pas un détail : `@fastify/rate-limit` s'accroche aux routes
   * par un hook `onRoute`, qui ne voit que celles déclarées après lui. Chargé
   * après, le plugin est présent, ne lève rien, n'ajoute aucun en-tête — et ne
   * plafonne rien. Ce contexte est ce qui rend l'ordre explicite plutôt que
   * dépendant de l'endroit où on ajoute la prochaine route.
   *
   * Ce qui est **dehors** l'est volontairement : la coquille, les fichiers du
   * front, et `/share` — une page, pas une API, et le chemin critique du
   * produit.
   */
  app.register(async (api) => {
    await api.register(rateLimit, {
      max: options.rateLimit?.max ?? RATE_LIMIT.max,
      timeWindow: options.rateLimit?.timeWindow ?? RATE_LIMIT.timeWindow,
      /**
       * La clé de comptage : le compte quand il y en a un, l'adresse IP sinon.
       *
       * Compter par IP seulement punirait le foyer entier pour un appareil —
       * ils sortent tous par la même adresse. Compter par compte seulement
       * laisserait l'anonyme sans plafond, ce qui est exactement le cas à
       * couvrir : l'inscription est publique (§16).
       */
      keyGenerator: (request) =>
        request.auth.kind === 'actif' ? request.auth.identity.userId : request.ip,
      /**
       * Le plugin **lève** ce que cette fonction rend, et c'est le
       * gestionnaire d'erreurs de l'app qui le met en forme. En rendant une
       * `ApiError`, le 429 sort au format du §12 — `{ error: { code, message } }`
       * — comme les 400 et les 404 : le front n'a qu'une seule forme d'erreur
       * à lire. Un objet nu ressortirait en 500, ce qui dirait au client « le
       * serveur est en panne » là où il faut lire « ralentis ».
       *
       * Les en-têtes `retry-after` et `x-ratelimit-*` sont déjà posés par le
       * plugin au moment où ceci est appelé.
       */
      errorResponseBuilder: (_request, context) =>
        new ApiError(
          429,
          'trop_de_requetes',
          `trop de demandes — réessayer dans ${Math.ceil(context.ttl / 1000)} s`,
        ),
    });

    authRoutes(api, ctx);
    eaterRoutes(api, ctx);
    householdRoutes(api, ctx);
    recipeRoutes(api, ctx);
    foodRoutes(api, ctx);
    mealRoutes(api, ctx);
    templateRoutes(api, ctx);
    dashboardRoutes(api, ctx);
  });

  registerWeb(app, options.webDir);
  return app;
}

/**
 * Sert la PWA compilée, et renvoie `index.html` sur toutes les routes
 * d'application.
 *
 * `/share` en fait partie : c'est une **page**, pas une API (§12). Android
 * l'ouvre avec `?title=…&text=…&url=…` et c'est le front qui lit ces
 * paramètres — le serveur ne les voit jamais passer, donc ne peut pas les
 * logger, ce qui est exactement ce que demande I6.
 */
function registerWeb(app: FastifyInstance, webDir?: string): void {
  const root = webDir ?? fileURLToPath(new URL('../web/dist/', import.meta.url));
  if (!existsSync(root)) {
    app.get('/*', async (_request, reply) =>
      reply.code(503).type('text/plain; charset=utf-8').send(
        'Front non compilé. Lancer `npm run build:web`, ou `npm run dev:web` en développement.',
      ),
    );
    return;
  }

  // La coquille est lue une fois et servie telle quelle. `reply.sendFile` sait
  // le faire, mais passe par une négociation de chemin qui répond 403 sur « / » :
  // pour un fichier unique, lu une fois, ça ne vaut pas le détour.
  const shell = readFileSync(join(root, 'index.html'), 'utf8');

  // Servie explicitement : le plugin statique capte « / » avec son propre
  // joker et répondrait 403 sur un dossier avant d'atteindre le gestionnaire
  // de 404.
  app.get('/', async (_request, reply) => reply.type('text/html; charset=utf-8').send(shell));

  app.register(fastifyStatic, { root, index: false });

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({
        error: { code: 'introuvable', message: 'route inconnue' },
      });
    }
    return reply.type('text/html; charset=utf-8').send(shell);
  });
}
