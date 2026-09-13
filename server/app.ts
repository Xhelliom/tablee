/**
 * Assemblage du serveur : Fastify, session de foyer, routes du §12, et le
 * front servi en statique.
 *
 * Toutes les routes `/api/*` sont authentifiées par cookie et **scopées au
 * `household_id` de la session**. Aucune requête de ce dépôt ne prend un
 * `household_id` depuis le client : c'est la session qui le donne, toujours.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { COOKIE_NAME, findSession, type Session } from './auth/session.ts';
import { ApiError } from './http/errors.ts';
import { authRoutes } from './routes/auth.ts';
import { dashboardRoutes } from './routes/dashboard.ts';
import { foodRoutes } from './routes/foods.ts';
import { mealRoutes } from './routes/meals.ts';
import { memberRoutes } from './routes/members.ts';
import { recipeRoutes } from './routes/recipes.ts';
import { templateRoutes } from './routes/templates.ts';

export interface AppContext {
  pool: pg.Pool;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Session résolue par le hook, ou `null` si le cookie est absent ou mort. */
    session: Session | null;
    /** Le foyer de la session. Lève 401 s'il n'y en a pas. */
    householdId(): string;
  }
}

/** Routes accessibles sans session. Tout le reste en exige une. */
const PUBLIC_API = new Set(['/api/auth/login', '/api/auth/logout', '/api/auth/session']);

export function buildApp(ctx: AppContext, options: { webDir?: string } = {}): FastifyInstance {
  const app = Fastify({
    logger: false,
    // Un partage Jow arrive en GET avec un texte long dans la query.
    maxParamLength: 500,
  });

  app.decorateRequest('session', null);
  app.decorateRequest('householdId', function (this: { session: Session | null }): string {
    if (this.session === null) throw ApiError.unauthorized();
    return this.session.householdId;
  });

  app.register(cookie);

  app.addHook('onRequest', async (request) => {
    request.session = await findSession(ctx.pool, request.cookies[COOKIE_NAME]);
    const url = request.url.split('?')[0] ?? '';
    if (url.startsWith('/api/') && !PUBLIC_API.has(url) && request.session === null) {
      throw ApiError.unauthorized();
    }
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
  memberRoutes(app, ctx);
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

  app.register(fastifyStatic, { root, index: false });

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({
        error: { code: 'introuvable', message: 'route inconnue' },
      });
    }
    return reply.sendFile('index.html');
  });
}
