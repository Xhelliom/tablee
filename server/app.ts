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
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { acquireForHousehold, type HouseholdDb, type ScopedClient } from './db.ts';
import type { Auth } from './auth/auth.ts';
import { readAuthState, type AuthState, type Identity } from './auth/identity.ts';
import { redactRequestUrl } from './jow/share.ts';
import { ApiError } from './http/errors.ts';
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

export function buildApp(ctx: AppContext, options: { webDir?: string } = {}): FastifyInstance {
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

  authRoutes(app, ctx);
  eaterRoutes(app, ctx);
  householdRoutes(app, ctx);
  recipeRoutes(app, ctx);
  foodRoutes(app, ctx);
  mealRoutes(app, ctx);
  templateRoutes(app, ctx);
  dashboardRoutes(app, ctx);

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
