/**
 * V3 — les assistants (hors roadmap d'origine, 14/09/2026) : la conversation
 * des Conseils, et les recettes du bouton de l'accueil.
 *
 * Les deux routes rassemblent la même semaine — ce que l'assistant a le droit
 * d'en savoir —, en retirent les prénoms, et transmettent. Ce qu'il sait et ce
 * qu'il refuse : en-têtes de `server/llm/conseil.ts` et
 * `server/llm/recettes.ts`. Rien n'est écrit en base.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError } from '../http/errors.ts';
import { array, body, str } from '../http/validate.ts';
import { nextDay, shiftDay, startOfDay, todayIn } from '../http/tz.ts';
import { ageAt } from '../nutrition/age.ts';
import { bilanJournalier, type DailyMeal } from '../nutrition/daily.ts';
import { describeHousehold, type HouseholdFacts, type Turn } from '../llm/conseil.ts';
import { anonymize, LLM_RATE_LIMIT, namesToHide, requireLlm } from '../llm/index.ts';
import {
  describePriorities, describeRecipes, readIdeas, readProposals, recipeCandidates,
} from '../llm/recettes.ts';
import { householdPlantAverage, householdTimezone } from '../repo/dashboard.ts';
import { listEaters } from '../repo/eaters.ts';
import { listMeals } from '../repo/meals.ts';
import { listRecipes } from '../repo/recipes.ts';
import { loadReferences } from '../repo/refs.ts';
import type { AppContext } from '../app.ts';

/** Au-delà, une conversation coûte plus qu'elle n'apporte. L'écran s'y tient aussi. */
const MAX_TURNS = 12;

/**
 * La longueur d'une réponse que la route accepte en retour. La réponse rendue
 * y est coupée : l'écran renvoie la conversation entière, et une réponse plus
 * longue que ce que `turns` accepte ferait refuser toutes les questions
 * suivantes, sans issue.
 */
const MAX_REPLY = 6000;

export function assistantRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/assistant', { config: { rateLimit: LLM_RATE_LIMIT } }, async (request) => {
    const { advise } = requireLlm(ctx.llm);
    const conversation = turns(body(request.body)['messages']);

    const { facts, names } = await readWeek(request);
    // Tout est lu : le client retourne au pool avant l'attente du modèle.
    await request.releaseDb();

    const reply = await advise(
      anonymize(describeHousehold(facts), names),
      conversation.map((turn) => ({ ...turn, content: anonymize(turn.content, names) })),
    ).catch((cause: unknown) => {
      request.log.error(cause);
      throw new ApiError(502, 'ia_injoignable', 'l’assistant n’a pas répondu — réessayez dans un instant');
    });
    return { reply: reply.slice(0, MAX_REPLY) };
  });

  /**
   * « Demander à l'assistant des recettes », depuis l'accueil. La réponse rend
   * aussi le texte envoyé : l'écran le montre, pour que ce qui sort du foyer se
   * vérifie plutôt que se croie (R5).
   */
  app.post('/api/assistant/recipes', { config: { rateLimit: LLM_RATE_LIMIT } }, async (request) => {
    const { suggestRecipes } = requireLlm(ctx.llm);
    const [{ facts, names }, recipes] = await Promise.all([readWeek(request), listRecipes(request.db)]);
    await request.releaseDb();

    // Deux cas où l'appel ne produirait que des banalités : on le dit, et rien
    // ne part. Un foyer sans recette Jow, lui, passe : il n'aura que des idées,
    // et c'est là qu'elles servent le plus.
    if (facts.mealCount === 0) {
      throw new ApiError(409, 'semaine_vide', 'aucun repas enregistré ces sept derniers jours : l’assistant n’aurait rien sur quoi s’appuyer');
    }
    const priorities = describePriorities(facts.percents);
    if (priorities === null) {
      throw new ApiError(409, 'rien_a_viser', 'aucune moyenne à viser : il faut des repas les jours précédents, et des repères qui couvrent les convives');
    }

    const candidates = recipeCandidates(recipes);
    const sent = anonymize(
      [describeHousehold(facts), priorities, '', describeRecipes(candidates)].join('\n'),
      names,
    );
    const output = await suggestRecipes(sent).catch((cause: unknown) => {
      request.log.error(cause);
      throw new ApiError(502, 'ia_injoignable', 'l’assistant n’a pas répondu — réessayez dans un instant');
    });
    return { proposals: readProposals(output, candidates), ideas: readIdeas(output), facts: sent };
  });
}

/**
 * La semaine telle que les assistants la reçoivent : des moyennes du foyer et
 * jamais par personne (en-tête de `conseil.ts`), et les noms à retirer de tout
 * ce qui part. Le client Postgres n'est pas rendu ici : chaque route lit encore
 * ce qui lui est propre avant de le faire.
 */
async function readWeek(request: FastifyRequest): Promise<{ facts: HouseholdFacts; names: string[] }> {
  const identity = request.identity();
  const { householdId } = identity;
  const timezone = await householdTimezone(request.db, householdId);
  const today = todayIn(timezone);
  const [everyone, references, plant7d, plant28d, recent] = await Promise.all([
    listEaters(request.db, householdId, { includeInactive: true }),
    loadReferences(request.db),
    householdPlantAverage(request.db, householdId, 7),
    householdPlantAverage(request.db, householdId, 28),
    listMeals(
      request.db, householdId,
      startOfDay(shiftDay(today, -7), timezone), startOfDay(nextDay(today), timezone),
    ),
  ]);
  const eaters = everyone.filter((eater) => eater.active);

  // Les repas déjà chargés, rangés par jour local et par convive, sur les
  // sept jours **précédents** : la journée en cours, pas finie, tirerait
  // tout vers le bas. Un repas sans nutrition ne change aucun pourcentage.
  const journées = new Map<string, { day: string; eaterId: string; meals: DailyMeal[] }>();
  for (const meal of recent) {
    const day = todayIn(timezone, new Date(meal.eatenAt));
    if (day === today || meal.nutrition === null) continue;
    for (const { eaterId, share } of meal.participants) {
      const journée = journées.get(`${day} ${eaterId}`) ?? { day, eaterId, meals: [] };
      journée.meals.push({ ...meal.nutrition, share });
      journées.set(`${day} ${eaterId}`, journée);
    }
  }

  // Des moyennes du foyer, et rien par personne : voir l'en-tête de conseil.ts.
  const percents: HouseholdFacts['percents'] = { proteinG: [], carbG: [], fatG: [], fiberG: [] };
  for (const { day, eaterId, meals } of journées.values()) {
    const eater = eaters.find((candidate) => candidate.id === eaterId);
    if (eater === undefined) continue;
    const { bars } = bilanJournalier({
      sex: eater.sex,
      age: ageAt(eater.birthDate, new Date(`${day}T12:00:00Z`)),
      meals,
      references,
    });
    for (const bar of bars) {
      if (bar.nutrient !== 'kcal' && bar.percent !== null) percents[bar.nutrient].push(bar.percent);
    }
  }

  // Le libellé Ciqual d'abord : il ne contient jamais de prénom, là où ce
  // qu'on a tapé peut en contenir un (« gâteau de Léa »).
  const dishes = [...new Set(recent.flatMap((meal) =>
    meal.recipe !== null ? [meal.recipe.title] : meal.items.map((item) => item.foodName ?? item.label),
  ))].slice(0, 40).map((dish) => dish.slice(0, 80));

  return {
    facts: {
      ages: eaters.map((eater) => ageAt(eater.birthDate)),
      diets: eaters.flatMap((eater) => eater.diets),
      mealCount: recent.length,
      dishes,
      percents,
      plant7d,
      plant28d,
    },
    names: namesToHide(everyone, identity.name),
  };
}

/**
 * La conversation telle que l'écran la renvoie. Elle vient du client : la
 * forme est vérifiée, et chaque message repasse par `anonymize`, réponses de
 * l'assistant comprises.
 */
function turns(value: unknown): Turn[] {
  const list = array(value, 'messages');
  if (list.length === 0 || list.length > MAX_TURNS) {
    throw ApiError.badRequest(`la conversation compte entre 1 et ${MAX_TURNS} messages`);
  }
  const conversation = list.map((raw, i): Turn => {
    const turn = (raw ?? {}) as Record<string, unknown>;
    const role = turn['role'];
    if (role !== 'user' && role !== 'assistant') {
      throw ApiError.badRequest(`« messages[${i}].role » : « user » ou « assistant »`);
    }
    return {
      role,
      content: str(turn['content'], `messages[${i}].content`, { max: role === 'user' ? 1000 : MAX_REPLY }),
    };
  });
  if (conversation[0]?.role !== 'user' || conversation[conversation.length - 1]?.role !== 'user') {
    throw ApiError.badRequest('la conversation commence et finit par une question');
  }
  return conversation;
}
