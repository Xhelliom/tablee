/**
 * Abonnement aux rappels : un appareil, une ligne. Rien ici ne parle de
 * l'envoi — voir `server/push.ts`.
 */
import type { FastifyInstance } from 'fastify';
import { ApiError } from '../http/errors.ts';
import { body, str } from '../http/validate.ts';
import { subscribe, unsubscribe } from '../repo/push.ts';
import type { AppContext } from '../app.ts';

/** Un service push est toujours en https ; le reste est une erreur ou un détournement. */
function endpoint(value: unknown): string {
  const url = str(value, 'endpoint', { max: 1000 });
  if (!url.startsWith('https://')) throw ApiError.badRequest('endpoint : une adresse https est attendue');
  return url;
}

export function pushRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/push/key', () => {
    if (ctx.push == null) throw ApiError.notFound('rappels non activés sur ce serveur');
    return { publicKey: ctx.push.publicKey };
  });

  app.post('/api/push/subscription', async (request, reply) => {
    if (ctx.push == null) throw ApiError.notFound('rappels non activés sur ce serveur');
    const input = body(request.body);
    const keys = body(input['keys']);
    // Un appareil qui change de compte ou de foyer est repris, pas dupliqué (025).
    await subscribe(request.db, request.householdId(), request.identity().userId, {
      endpoint: endpoint(input['endpoint']),
      p256dh: str(keys['p256dh'], 'keys.p256dh', { max: 200 }),
      auth: str(keys['auth'], 'keys.auth', { max: 100 }),
    });
    reply.code(201);
    return { ok: true };
  });

  app.post('/api/push/unsubscribe', async (request) => {
    await unsubscribe(request.db, request.householdId(), endpoint(body(request.body)['endpoint']));
    return { ok: true };
  });
}
