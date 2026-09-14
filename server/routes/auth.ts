/**
 * Montage de better-auth, et les quelques routes que Tablée ajoute par-dessus.
 *
 * better-auth sert tout `/api/auth/*` : inscription, connexion, déconnexion,
 * foyers, invitations, rôles. Les routes ci-dessous ne font que ce qu'il ne
 * fait pas — dire au front où il en est, et lui rendre le lien d'invitation à
 * transmettre.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.ts';
import { ApiError } from '../http/errors.ts';
import { listHouseholdsForUser } from '../repo/households.ts';

/**
 * Traduit une requête Fastify en `Request` du web, que better-auth attend.
 *
 * Le corps est réassemblé depuis `request.body` déjà analysé par Fastify plutôt
 * que lu brut : toutes les routes d'authentification parlent JSON, et ajouter
 * un analyseur de contenu global pour garder le corps brut changerait le
 * comportement de **toutes** les autres routes pour le confort d'une seule.
 */
function toWebRequest(request: {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}, baseURL: string): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v);
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const body = hasBody && request.body !== undefined ? JSON.stringify(request.body) : undefined;
  if (body !== undefined) headers.set('content-type', 'application/json');

  return new Request(new URL(request.url, baseURL), {
    method: request.method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

export function authRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Toutes les méthodes, tout le sous-arbre : c'est better-auth qui route
  // à l'intérieur.
  app.route({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    url: '/api/auth/*',
    handler: async (request, reply) => {
      const response = await ctx.auth.handler(toWebRequest(request, ctx.baseURL));

      reply.status(response.status);
      response.headers.forEach((value, key) => {
        // `set-cookie` peut apparaître plusieurs fois ; `append` les conserve
        // toutes, là où `header` écraserait les précédentes.
        if (key.toLowerCase() === 'set-cookie') reply.raw.appendHeader('set-cookie', value);
        else reply.header(key, value);
      });

      return reply.send(response.body === null ? null : Buffer.from(await response.arrayBuffer()));
    },
  });

  /**
   * Où en est le client.
   *
   * Trois états, et les confondre coûterait cher : `anonyme` amène l'écran de
   * connexion, `sans_foyer` l'écran « crée ou rejoins un foyer » — pas le
   * login, la personne est connectée —, `actif` l'app elle-même.
   */
  app.get('/api/me', async (request) => {
    const state = request.auth;
    if (state.kind === 'anonyme') return { state: 'anonyme' };

    const userId = state.kind === 'actif' ? state.identity.userId : state.userId;
    const households = await listHouseholdsForUser(ctx.pool, userId);

    if (state.kind === 'sans_foyer') {
      return {
        state: 'sans_foyer',
        user: { id: state.userId, email: state.email, name: state.name },
        households,
      };
    }

    const { identity } = state;
    return {
      state: 'actif',
      user: { id: identity.userId, email: identity.email, name: identity.name },
      household: {
        id: identity.householdId,
        name: identity.householdName,
        timezone: identity.timezone,
        organizationId: identity.organizationId,
      },
      role: identity.role,
      households,
    };
  });

  /**
   * Le lien d'invitation à transmettre.
   *
   * Il n'y a pas de serveur SMTP, et c'est un choix : installer un relais mail
   * pour deux invitations par décennie coûte plus cher que ça ne rapporte. La
   * création de l'invitation elle-même reste celle de better-auth
   * (`POST /api/auth/organization/invite-member`) — cette route ne fait que
   * rendre l'URL correspondante, pour que le front n'ait pas à la fabriquer et
   * que sa forme reste décidée au même endroit que la route qui la reçoit.
   */
  app.get('/api/invitations/:id/lien', (request) => {
    const state = request.auth;
    if (state.kind !== 'actif') throw ApiError.unauthorized();
    if (state.identity.role !== 'parent') {
      throw new ApiError(403, 'droits_insuffisants', 'seul un parent peut inviter');
    }
    const { id } = request.params as { id: string };
    return { url: new URL(`/invitation/${encodeURIComponent(id)}`, ctx.baseURL).toString() };
  });
}
