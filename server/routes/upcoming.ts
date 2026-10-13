/**
 * Plats à venir (023) : voir, ajouter depuis une recette connue, retirer.
 * Pas de modification : un plat est là ou il n'y est plus.
 */
import type { FastifyInstance } from 'fastify';
import { ApiError } from '../http/errors.ts';
import { transaction } from '../db.ts';
import { body, isoDateTime, slot, str, uuid } from '../http/validate.ts';
import { resolveShare } from '../jow/index.ts';
import { fetchOrderRecipeIds, parseOrderLink } from '../jow/order.ts';
import { findRecipeByJowId, markRecipeKnown, saveJowRecipe } from '../repo/recipes.ts';
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

  /**
   * Une commande Jow entière : ses plats entrent au stock, un par ligne
   * (la même recette commandée deux fois en fait deux). Les recettes inconnues
   * sont lues sur leur page publique ; celles qui ne se résolvent pas sont
   * comptées dans `failed`, jamais inventées. `key` et `userId` du lien ne
   * sont ni stockés ni journalisés (I6, `jow/order.ts`).
   */
  app.post('/api/upcoming-dishes/from-order', async (request, reply) => {
    const link = parseOrderLink(str(body(request.body)['text'], 'text', { max: 4000 }));
    if (link === null) throw ApiError.badRequest('aucun lien de commande Jow reconnu');
    const ids = await fetchOrderRecipeIds(link).catch((e: Error) => {
      throw ApiError.badRequest(e.message);
    });
    const householdId = request.householdId();
    const dishes = [];
    let failed = 0;
    for (const id of ids.slice(0, 30)) {
      const recipe = (await findRecipeByJowId(request.db, id))
        ?? await resolveShare(id).then((p) => (p.jowRecipeId === null || p.confidence === 'basse' ? null : saveJowRecipe(request.db, p)));
      if (recipe === null) { failed += 1; continue; }
      await markRecipeKnown(request.db, householdId, recipe.id);
      const dish = await addUpcomingDish(request.db, householdId, recipe.id);
      if (dish !== null) dishes.push(dish);
    }
    reply.code(201);
    return { dishes, failed };
  });

  app.delete<{ Params: { id: string } }>('/api/upcoming-dishes/:id', async (request) => {
    const removed = await removeUpcomingDish(
      request.db, request.householdId(), uuid(request.params.id, 'id'));
    if (removed === null) throw ApiError.notFound('plat introuvable');
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
      // Retirer d'abord : deux taps rapprochés ne font qu'un repas, le second
      // attend le verrou de la ligne et repart en 404.
      const recipeId = await removeUpcomingDish(client, householdId, id);
      if (recipeId === null) throw ApiError.notFound('plat introuvable');
      const eaters = await listEaters(client, householdId);
      return createMeal(client, householdId, {
        eatenAt, slot: slotValue, source: 'jow', recipeId,
        // Une part par convive, jamais sous 1 : comme l'écran de partage.
        servings: Math.max(eaters.length, 1),
        participants: eaters.map((e) => ({ eaterId: e.id, present: true })),
        createdBy: request.identity().userId,
      });
    });
    reply.code(201);
    return { mealId };
  });
}
