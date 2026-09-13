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
  findRecipeByJowId, loadRecipe, recipeGaps, saveJowRecipe, seasonalCount,
} from '../repo/recipes.ts';
import type { AppContext } from '../app.ts';

export function recipeRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/recipes/resolve', async (request) => {
    const input = body(request.body);
    const text = str(input['text'], 'text', { max: 4000 });
    const share = parseShareText(text);

    // §4, point 2 : une recette déjà connue est réutilisée, sans accès réseau.
    if (share.jowRecipeId !== null) {
      const known = await findRecipeByJowId(ctx.pool, share.jowRecipeId);
      if (known !== null) {
        return {
          recipe: known,
          seasonal: await seasonalCount(ctx.pool, known.id, new Date().getMonth() + 1),
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

    const recipe = await saveJowRecipe(ctx.pool, parsed);
    return {
      recipe,
      seasonal: await seasonalCount(ctx.pool, recipe.id, new Date().getMonth() + 1),
      fetched: true,
      warnings: parsed.warnings,
    };
  });

  /**
   * Une recette et ses ingrédients — l'écran de détail d'un repas s'en sert
   * pour proposer de rattacher chaque ingrédient au référentiel.
   */
  app.get<{ Params: { id: string } }>('/api/recipes/:id', async (request) => {
    const recipe = await loadRecipe(ctx.pool, uuid(request.params.id, 'id'));
    if (recipe === null) throw ApiError.notFound('recette introuvable');
    return {
      recipe,
      seasonal: await seasonalCount(ctx.pool, recipe.id, new Date().getMonth() + 1),
      warnings: recipeGaps(recipe),
    };
  });

  /**
   * Ce que l'on sait tirer d'un texte partagé **sans accès réseau**. Sert à
   * l'écran `/share` pour afficher quelque chose immédiatement pendant que la
   * résolution complète se fait.
   */
  app.post('/api/recipes/peek', async (request) => {
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
