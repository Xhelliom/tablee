/**
 * §12 — recherche d'aliments, et rattachement d'un ingrédient au référentiel.
 */
import type { FastifyInstance } from 'fastify';
import { transaction } from '../db.ts';
import { body, optionalUuid, str, uuid } from '../http/validate.ts';
import { createManualFood, searchFoods } from '../repo/foods.ts';
import { linkIngredientToFood, listLinks } from '../repo/recipes.ts';
import { recomputeMealsUsingIngredient } from '../repo/meals.ts';
import type { AppContext } from '../app.ts';

export function foodRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get<{ Querystring: { q?: string; limit?: string } }>(
    '/api/foods/search',
    async (request) => {
      const query = request.query.q ?? '';
      const limit = Math.min(Number(request.query.limit ?? 20) || 20, 50);
      return { foods: await searchFoods(ctx.pool, query, limit) };
    },
  );

  app.post('/api/foods', async (request, reply) => {
    const input = body(request.body);
    const id = await createManualFood(ctx.pool, {
      name: str(input['name'], 'name', { max: 200 }),
      // Laissé à `null` si l'utilisateur ne le dit pas : « non classé »,
      // jamais « pas végétal » (§10).
      plantBased: typeof input['plantBased'] === 'boolean' ? input['plantBased'] : null,
    });
    reply.code(201);
    return { id };
  });

  /**
   * Rattache un ingrédient de recette Jow à un aliment du référentiel.
   *
   * C'est le seul chemin par lequel un repas Jow acquiert une part végétale :
   * Jow publie des libellés, pas des codes Ciqual, et rapprocher les deux par
   * ressemblance de chaîne produirait des rattachements faux. On demande.
   *
   * Le rattachement vaut pour **l'ingrédient Jow**, pas pour cette ligne de
   * recette : il se propage à toutes les recettes qui l'emploient, et la
   * nutrition des repas concernés est recalculée dans la foulée. Sans ce
   * recalcul, on rattacherait un ingrédient et rien ne bougerait à l'écran —
   * le geste paraîtrait inutile et personne ne le referait.
   */
  app.post<{ Params: { id: string } }>(
    '/api/recipes/ingredients/:id/food',
    async (request) => {
      const ingredientId = uuid(request.params.id, 'id');
      const input = body(request.body);
      const foodId = optionalUuid(input['foodId'], 'foodId');
      const confirmedBy = optionalUuid(input['confirmedBy'], 'confirmedBy');
      const householdId = request.householdId();

      return transaction(ctx.pool, async (client) => {
        const link = await linkIngredientToFood(client, ingredientId, foodId, confirmedBy);
        const recomputed =
          link.jowFoodId === null
            ? 0
            : await recomputeMealsUsingIngredient(client, householdId, link.jowFoodId);
        return { ok: true, ...link, recomputed };
      });
    },
  );

  /** Les correspondances Jow → référentiel déjà posées. */
  app.get('/api/recipes/links', async () => ({ links: await listLinks(ctx.pool) }));
}
