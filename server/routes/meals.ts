/**
 * §12 — repas.
 */
import type { FastifyInstance } from 'fastify';
import { transaction } from '../db.ts';
import { ApiError } from '../http/errors.ts';
import {
  body, int, isoDateTime, mealItems, num, optionalStr, optionalUuid,
  participants, slot, source, uuid,
} from '../http/validate.ts';
import {
  createMeal, deleteMeal, getMeal, listMeals, recentWithRecipe, updateMeal,
} from '../repo/meals.ts';
import { createTemplateFromMeal } from '../repo/templates.ts';
import { householdTimezone } from '../repo/dashboard.ts';
import { nextDay, startOfDay, todayIn } from '../http/tz.ts';
import type { AppContext } from '../app.ts';

export function mealRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/meals', async (request, reply) => {
    const input = body(request.body);
    const householdId = request.householdId();

    const id = await transaction(ctx.pool, (client) =>
      createMeal(client, householdId, {
        eatenAt: isoDateTime(input['eaten_at'] ?? input['eatenAt'], 'eaten_at'),
        slot: slot(input['slot']),
        source: source(input['source']),
        recipeId: optionalUuid(input['recipe_id'] ?? input['recipeId'], 'recipe_id'),
        servings:
          input['servings'] === undefined ? 1 : num(input['servings'], 'servings', { min: 0.01, max: 99 }),
        leftoverOf: optionalUuid(input['leftover_of'] ?? input['leftoverOf'], 'leftover_of'),
        guestCount:
          input['guest_count'] === undefined && input['guestCount'] === undefined
            ? 0
            : int(input['guest_count'] ?? input['guestCount'], 'guest_count', { min: 0, max: 50 }),
        items: input['items'] === undefined ? [] : mealItems(input['items']),
        participants: participants(input['participants'] ?? []),
        note: optionalStr(input['note'], 'note', { max: 1000 }),
        // I6 : expurgé une seconde fois par `createMeal`, avant l'insertion.
        rawInput: optionalStr(input['raw_input'] ?? input['rawInput'], 'raw_input', { max: 4000 }),
        createdBy: optionalUuid(input['created_by'] ?? input['createdBy'], 'created_by'),
      }),
    );

    reply.code(201);
    return { meal: await getMeal(ctx.pool, householdId, id) };
  });

  app.get<{ Querystring: { from?: string; to?: string } }>('/api/meals', async (request) => {
    const householdId = request.householdId();
    const timezone = await householdTimezone(ctx.pool, householdId);
    const { from, to } = range(request.query.from, request.query.to, timezone);
    return { meals: await listMeals(ctx.pool, householdId, from, to) };
  });

  /** Les repas des 3 derniers jours portant une recette — bouton « Restes de… ». */
  app.get<{ Querystring: { days?: string } }>('/api/meals/leftovers', async (request) => {
    const days = Math.min(Number(request.query.days ?? 3) || 3, 14);
    return { meals: await recentWithRecipe(ctx.pool, request.householdId(), days) };
  });

  app.get<{ Params: { id: string } }>('/api/meals/:id', async (request) => {
    const meal = await getMeal(ctx.pool, request.householdId(), uuid(request.params.id, 'id'));
    if (meal === null) throw ApiError.notFound('repas introuvable');
    return { meal };
  });

  /**
   * Modifier un repas passé.
   *
   * Recalcule la nutrition, **pas les parts** — sauf si la modification porte
   * précisément sur qui était à table ou sur le nombre d'invités, auquel cas
   * les parts précédentes ne décrivent plus rien.
   */
  app.patch<{ Params: { id: string } }>('/api/meals/:id', async (request) => {
    const id = uuid(request.params.id, 'id');
    const householdId = request.householdId();
    const input = body(request.body);

    const found = await transaction(ctx.pool, (client) =>
      updateMeal(client, householdId, id, {
        ...(input['eaten_at'] !== undefined || input['eatenAt'] !== undefined
          ? { eatenAt: isoDateTime(input['eaten_at'] ?? input['eatenAt'], 'eaten_at') }
          : {}),
        ...(input['slot'] !== undefined && { slot: slot(input['slot']) }),
        ...(input['servings'] !== undefined && {
          servings: num(input['servings'], 'servings', { min: 0.01, max: 99 }),
        }),
        ...(input['guest_count'] !== undefined || input['guestCount'] !== undefined
          ? { guestCount: int(input['guest_count'] ?? input['guestCount'], 'guest_count', { min: 0, max: 50 }) }
          : {}),
        ...(input['note'] !== undefined && { note: optionalStr(input['note'], 'note', { max: 1000 }) }),
        ...(input['recipe_id'] !== undefined || input['recipeId'] !== undefined
          ? { recipeId: optionalUuid(input['recipe_id'] ?? input['recipeId'], 'recipe_id') }
          : {}),
        ...(input['items'] !== undefined && { items: mealItems(input['items']) }),
        ...(input['participants'] !== undefined && { participants: participants(input['participants']) }),
      }),
    );

    if (!found) throw ApiError.notFound('repas introuvable');
    return { meal: await getMeal(ctx.pool, householdId, id) };
  });

  app.delete<{ Params: { id: string } }>('/api/meals/:id', async (request) => {
    const deleted = await deleteMeal(ctx.pool, request.householdId(), uuid(request.params.id, 'id'));
    if (!deleted) throw ApiError.notFound('repas introuvable');
    return { ok: true };
  });

  /** Faire d'un repas une habitude : §12, `POST /api/templates`. */
  app.post('/api/templates', async (request, reply) => {
    const input = body(request.body);
    const template = await createTemplateFromMeal(
      ctx.pool,
      request.householdId(),
      uuid(input['mealId'] ?? input['meal_id'], 'mealId'),
      optionalStr(input['name'], 'name', { max: 120 }) ?? 'Repas habituel',
    );
    if (template === null) throw ApiError.notFound('repas introuvable');
    reply.code(201);
    return { template };
  });
}

/**
 * Fenêtre par défaut : la journée en cours, dans le fuseau du foyer. Les
 * bornes reçues sont des dates (`AAAA-MM-JJ`) ou des instants ISO.
 */
function range(from: string | undefined, to: string | undefined, timezone: string): {
  from: string; to: string;
} {
  const start = from ?? todayIn(timezone);
  const end = to ?? start;
  return {
    from: normalize(start, false, timezone),
    to: normalize(end, true, timezone),
  };
}

/** Une date nue devient une borne de journée locale ; un instant ISO passe tel quel. */
function normalize(value: string, exclusiveEnd: boolean, timezone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw ApiError.badRequest('intervalle de dates illisible');
    return parsed.toISOString();
  }
  const day = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) throw ApiError.badRequest('intervalle de dates illisible');
  return startOfDay(exclusiveEnd ? nextDay(value) : value, timezone);
}
