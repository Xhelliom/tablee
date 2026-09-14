/**
 * §12 — repas.
 */
import type { FastifyInstance } from 'fastify';
import { transaction } from '../db.ts';
import { ApiError } from '../http/errors.ts';
import {
  body, int, isoDateTime, mealItems, num, optionalStr, optionalUuid,
  participants, slot, source, str, uuid,
} from '../http/validate.ts';
import {
  applyChoices, CANDIDATES, describeCandidates, SplitRefused, type MatchedItem,
} from '../llm/decoupage.ts';
import { anonymize, LLM_RATE_LIMIT, namesToHide, requireLlm } from '../llm/index.ts';
import { listEaters } from '../repo/eaters.ts';
import { searchFoods } from '../repo/foods.ts';
import {
  createMeal, deleteMeal, getMeal, listMeals, recentWithRecipe, updateMeal,
} from '../repo/meals.ts';
import { createTemplateFromMeal } from '../repo/templates.ts';
import { householdTimezone } from '../repo/dashboard.ts';
import { nextDay, startOfDay, todayIn } from '../http/tz.ts';
import type { AppContext } from '../app.ts';

export function mealRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * V3, §5 voie 2 — un texte libre découpé en aliments, **à valider**.
   *
   * Rien n'est écrit : la route propose des lignes rapprochées de Ciqual, et
   * c'est l'écran de saisie qui enregistre, avec la source `ia`, ce que la
   * personne a gardé. Deux appels au modèle : le découpage, puis le choix de
   * l'aliment parmi les candidats de la recherche. Ce qui part chez Anthropic,
   * et pourquoi : en-tête de `server/llm/decoupage.ts`.
   */
  app.post('/api/meals/decoupage', { config: { rateLimit: LLM_RATE_LIMIT } }, async (request) => {
    const début = Date.now();
    const { splitMeal, chooseFoods } = requireLlm(ctx.llm);
    const identity = request.identity();
    const text = str(body(request.body)['text'], 'text', { max: 500 });

    const eaters = await listEaters(request.db, identity.householdId, { includeInactive: true });
    const noms = namesToHide(eaters, identity.name);
    const envoyé = anonymize(text, noms);
    // Plus rien à lire sous RLS : le client retourne au pool avant l'attente du
    // modèle. La recherche qui suit lit `food`, référentiel public, sur le pool.
    await request.releaseDb();

    const proposed = await splitMeal(envoyé).catch((cause: unknown) => {
      if (cause instanceof SplitRefused) {
        throw new ApiError(
          422, 'decoupage_impossible',
          'l’IA n’a pas su découper ce texte — ajoutez les aliments un par un',
        );
      }
      request.log.error(cause);
      throw new ApiError(502, 'ia_injoignable', 'l’IA n’a pas répondu — ajoutez les aliments un par un');
    });

    const items: MatchedItem[] = [];
    for (const item of proposed) {
      items.push({ label: item.label, grams: item.grams, foods: await searchFoods(ctx.pool, item.search, CANDIDATES) });
    }
    // Aucun candidat nulle part : rien à demander, rien à payer. Un candidat
    // unique, lui, se juge — « Truffe au chocolat » n'est pas une truffe.
    // Et passé 45 s, on n'attend plus : l'ingress coupe à 60 (défaut de nginx),
    // et le découpage déjà payé partirait avec le choix.
    const tard = Date.now() - début > 45_000;
    if (tard || !items.some((item) => item.foods.length > 0)) return { items: applyChoices(items, null) };

    // Seuls les libellés viennent du foyer. Les noms Ciqual, publics, ne passent
    // pas au filtre des prénoms : pour un compte nommé Blanc, « Riz blanc »
    // deviendrait « Riz quelqu’un ». Le second passage ne retire que les jetons
    // Jow, et pose la marque.
    const lignes = items.map((item) => ({ ...item, label: anonymize(item.label, noms) }));
    // Le choix ne fait que ranger. S'il échoue, la recherche garde son ordre, et
    // le découpage déjà payé n'est pas perdu.
    const choix = await chooseFoods(anonymize(describeCandidates(lignes), [])).catch((cause: unknown) => {
      request.log.error(cause);
      return null;
    });
    return { items: applyChoices(items, choix) };
  });

  app.post('/api/meals', async (request, reply) => {
    const input = body(request.body);
    const householdId = request.householdId();

    const id = await transaction(request.db, (client) =>
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
        // Qui a saisi le repas se lit dans la **session**, jamais dans le
        // corps de la requête. L'accepter du client laissait attribuer un
        // repas à n'importe quel compte — la nounou, le conjoint — et
        // `meal.created_by` est précisément ce qui dit « qui a agi » (007).
        createdBy: request.identity().userId,
      }),
    );

    reply.code(201);
    return { meal: await getMeal(request.db, householdId, id) };
  });

  app.get<{ Querystring: { from?: string; to?: string } }>('/api/meals', async (request) => {
    const householdId = request.householdId();
    const timezone = await householdTimezone(request.db, householdId);
    const { from, to } = range(request.query.from, request.query.to, timezone);
    return { meals: await listMeals(request.db, householdId, from, to) };
  });

  /** Les repas des 3 derniers jours portant une recette — bouton « Restes de… ». */
  app.get<{ Querystring: { days?: string } }>('/api/meals/leftovers', async (request) => {
    const days = Math.min(Number(request.query.days ?? 3) || 3, 14);
    return { meals: await recentWithRecipe(request.db, request.householdId(), days) };
  });

  app.get<{ Params: { id: string } }>('/api/meals/:id', async (request) => {
    const meal = await getMeal(request.db, request.householdId(), uuid(request.params.id, 'id'));
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

    const found = await transaction(request.db, (client) =>
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
    return { meal: await getMeal(request.db, householdId, id) };
  });

  app.delete<{ Params: { id: string } }>('/api/meals/:id', async (request) => {
    const deleted = await deleteMeal(request.db, request.householdId(), uuid(request.params.id, 'id'));
    if (!deleted) throw ApiError.notFound('repas introuvable');
    return { ok: true };
  });

  /** Faire d'un repas une habitude : §12, `POST /api/templates`. */
  app.post('/api/templates', async (request, reply) => {
    const input = body(request.body);
    const template = await createTemplateFromMeal(
      request.db,
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
