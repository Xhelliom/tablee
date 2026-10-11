/**
 * Abonnement aux rappels : un appareil, une ligne. Rien ici ne parle de
 * l'envoi — voir `server/push.ts`.
 */
import type { FastifyInstance } from 'fastify';
import { ApiError } from '../http/errors.ts';
import { body, str } from '../http/validate.ts';
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
    // Un appareil change de compte : l'endpoint est repris, pas dupliqué.
    await request.db.query(
      `insert into push_subscription (household_id, user_id, endpoint, p256dh, auth)
       values ($1, $2, $3, $4, $5)
       on conflict (endpoint) do update
         set household_id = $1, user_id = $2, p256dh = $4, auth = $5`,
      [request.householdId(), request.identity().userId, endpoint(input['endpoint']),
        str(keys['p256dh'], 'keys.p256dh', { max: 200 }), str(keys['auth'], 'keys.auth', { max: 100 })],
    );
    reply.code(201);
    return { ok: true };
  });

  app.post('/api/push/unsubscribe', async (request) => {
    await request.db.query(
      'delete from push_subscription where household_id = $1 and endpoint = $2',
      [request.householdId(), endpoint(body(request.body)['endpoint'])]);
    return { ok: true };
  });
}
