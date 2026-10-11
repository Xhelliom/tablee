/**
 * Plats à venir (023) : voir, ajouter depuis une recette connue, retirer.
 * Pas de modification : un plat est là ou il n'y est plus.
 */
import type { FastifyInstance } from 'fastify';
import { ApiError } from '../http/errors.ts';
import { body, uuid } from '../http/validate.ts';
import { addUpcomingDish, listUpcomingDishes, removeUpcomingDish } from '../repo/upcoming.ts';
import type { AppContext } from '../app.ts';

export function upcomingRoutes(app: FastifyInstance, _ctx: AppContext): void {
  app.get('/api/upcoming-dishes', async (request) => ({
    dishes: await listUpcomingDishes(request.db, request.householdId()),
  }));

  app.post('/api/upcoming-dishes', async (request, reply) => {
    const recipeId = uuid(body(request.body)['recipeId'], 'recipeId');
    const dish = await addUpcomingDish(request.db, request.householdId(), recipeId);
    if (dish === null) throw ApiError.notFound('recette inconnue de ce foyer');
    reply.code(201);
    return { dish };
  });

  app.delete<{ Params: { id: string } }>('/api/upcoming-dishes/:id', async (request) => {
    const removed = await removeUpcomingDish(
      request.db, request.householdId(), uuid(request.params.id, 'id'));
    if (!removed) throw ApiError.notFound('plat introuvable');
    return { ok: true };
  });
}
