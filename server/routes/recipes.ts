/**
 * §4 / §12 — réception d'un partage Jow.
 *
 * `POST /api/recipes/resolve` prend le texte partagé et rend une recette
 * exploitable. Il ne rejette jamais : une panne réseau ou une page changée
 * donnent une recette `confidence: 'basse'` portant le titre deviné, et
 * l'écran bascule en saisie manuelle. Perdre le repas que l'utilisateur était
 * en train d'enregistrer serait le pire résultat possible.
 *
 * I6 : le texte de partage porte `key` et `userId`, qui sont des jetons de
 * compte. `parseShareText` les retire avant tout le reste, et **rien** de ce
 * qui entre ici n'est loggué ni stocké tel quel.
 */
import type { FastifyInstance } from 'fastify';
import { parseShareText, redactShareText } from '../jow/share.ts';
import { resolveShare } from '../jow/index.ts';
import { ApiError } from '../http/errors.ts';
import { body, str, uuid } from '../http/validate.ts';
import {
  findRecipeByJowId, listRecipes, loadRecipe, markRecipeKnown, recipeGaps,
  saveJowRecipe, seasonalCount,
} from '../repo/recipes.ts';
import { currentMonth } from '../repo/dashboard.ts';
import type { AppContext } from '../app.ts';

export function recipeRoutes(app: FastifyInstance, _ctx: AppContext): void {
  app.post('/api/recipes/resolve', async (request) => {
    const input = body(request.body);
    const text = str(input['text'], 'text', { max: 4000 });
    const share = parseShareText(text);

    // §4, point 2 : une recette déjà connue est réutilisée, sans accès réseau.
    if (share.jowRecipeId !== null) {
      const known = await findRecipeByJowId(request.db, share.jowRecipeId);
      if (known !== null) {
        // Connue de l'instance ne veut pas dire connue de ce foyer : une
        // recette Jow est globale (007), et c'est ce partage-ci qui la fait
        // entrer chez nous.
        await markRecipeKnown(request.db, request.householdId(), known.id);
        const { month } = await currentMonth(request.db, request.householdId());
        return {
          recipe: known,
          seasonal: await seasonalCount(request.db, known.id, month),
          fetched: false,
          // Reconstruits depuis la recette : un deuxième partage doit montrer
          // les mêmes trous que le premier.
          warnings: recipeGaps(known),
        };
      }
    }

    const parsed = await resolveShare(text);
    if (parsed.jowRecipeId === null) {
      // Rien à persister : pas d'identifiant, donc pas de clé de déduplication.
      // L'écran propose la saisie manuelle avec le titre deviné.
      return { recipe: null, parsed, seasonal: 0, fetched: true, warnings: parsed.warnings };
    }

    const recipe = await saveJowRecipe(request.db, parsed);
    await markRecipeKnown(request.db, request.householdId(), recipe.id);
    const { month } = await currentMonth(request.db, request.householdId());
    return {
      recipe,
      seasonal: await seasonalCount(request.db, recipe.id, month),
      fetched: true,
      warnings: parsed.warnings,
    };
  });

  /**
   * Les recettes déjà connues du foyer — le « qu'est-ce qu'on a, déjà ? ».
   *
   * Rien de nouveau n'est écrit ici : ces recettes sont en base depuis leur
   * lecture, y compris celles dont on n'a jamais enregistré le repas. C'est
   * une fenêtre sur un stock existant, pas une fonction de plus.
   */
  app.get<{ Querystring: { limit?: string } }>('/api/recipes', async (request) => {
    const limit = Math.min(Number(request.query.limit ?? 100) || 100, 200);
    return { recipes: await listRecipes(request.db, limit) };
  });

  /**
   * Une recette et ses ingrédients — l'écran de détail d'un repas s'en sert
   * pour proposer de rattacher chaque ingrédient au référentiel.
   */
  app.get<{ Params: { id: string } }>('/api/recipes/:id', async (request) => {
    const recipe = await loadRecipe(request.db, uuid(request.params.id, 'id'));
    if (recipe === null) throw ApiError.notFound('recette introuvable');
    const { month } = await currentMonth(request.db, request.householdId());
    return {
      recipe,
      seasonal: await seasonalCount(request.db, recipe.id, month),
      warnings: recipeGaps(recipe),
    };
  });

  /**
   * Ce que l'on sait tirer d'un texte partagé **sans accès réseau**. Sert à
   * l'écran `/share` pour afficher quelque chose immédiatement pendant que la
   * résolution complète se fait.
   */
  app.post('/api/recipes/peek', (request) => {
    const input = body(request.body);
    const text = str(input['text'], 'text', { max: 4000 });
    const share = parseShareText(text);
    return {
      share,
      // Ce texte-là est expurgé : c'est la seule forme qui peut ressortir.
      redacted: redactShareText(text),
    };
  });
}
