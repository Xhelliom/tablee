/**
 * Plats à venir (023) : voir, ajouter depuis une recette connue, retirer.
 * Pas de modification : un plat est là ou il n'y est plus.
 */
import type { FastifyInstance } from 'fastify';
import { ApiError } from '../http/errors.ts';
import { transaction } from '../db.ts';
import { body, isoDateTime, slot, uuid } from '../http/validate.ts';
import { listEaters } from '../repo/eaters.ts';
import { createMeal } from '../repo/meals.ts';
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

  /**
   * Un tap : le plat devient un repas pour tous les convives actifs du foyer,
   * et sort du stock. Même chemin que le partage Jow (`createMeal`) : les parts
   * sont calculées et figées à l'écriture. Annuler, c'est supprimer le repas et
   * remettre la recette au stock — deux gestes qui existent déjà.
   */
  app.post<{ Params: { id: string } }>('/api/upcoming-dishes/:id/eat', async (request, reply) => {
    const input = body(request.body);
    const householdId = request.householdId();
    const id = uuid(request.params.id, 'id');
    const eatenAt = isoDateTime(input['eatenAt'], 'eatenAt');
    const slotValue = slot(input['slot']);

    const mealId = await transaction(request.db, async (client) => {
      const dish = (await listUpcomingDishes(client, householdId)).find((d) => d.id === id);
      if (dish === undefined) throw ApiError.notFound('plat introuvable');
      const eaters = await listEaters(client, householdId);
      const created = await createMeal(client, householdId, {
        eatenAt, slot: slotValue, source: 'jow', recipeId: dish.recipe.id,
        // Une part par convive, jamais sous 1 : comme l'écran de partage.
        servings: Math.max(eaters.length, 1),
        participants: eaters.map((e) => ({ eaterId: e.id, present: true })),
        createdBy: request.identity().userId,
      });
      await removeUpcomingDish(client, householdId, id);
      return created;
    });
    reply.code(201);
    return { mealId };
  });
}
