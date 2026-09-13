import { fetchRecipeById, type FetchOptions } from './fetch.ts';
import { fallback, parseRecipeHtml } from './parse.ts';
import { parseShareText, redactShareText } from './share.ts';
import type { ParsedRecipe } from './types.ts';

export type { ParsedIngredient, ParsedNutrition, ParsedRecipe, ShareInput, Confidence } from './types.ts';
export { parseShareText, redactShareText, redactUrl, slugify } from './share.ts';
export { extractNextData, parseRecipeHtml, parseRecipeNode, toGrams } from './parse.ts';
export { fetchRecipeById, fetchRecipeByUrl } from './fetch.ts';

/**
 * Chaîne complète : texte partagé depuis Jow → recette exploitable.
 *
 * Ne rejette jamais. Une panne réseau, une page disparue ou un markup changé
 * donnent une recette `confidence: 'basse'` portant le titre deviné : l'écran
 * de confirmation bascule alors en saisie manuelle plutôt que de perdre le
 * repas que l'utilisateur était en train d'enregistrer.
 */
export async function resolveShare(
  text: string,
  options: FetchOptions = {},
): Promise<ParsedRecipe> {
  const share = parseShareText(text);
  const ctx = {
    title: share.title,
    jowRecipeId: share.jowRecipeId,
    url: share.url,
  };

  if (share.jowRecipeId === null) {
    return fallback(ctx, ['aucun identifiant de recette Jow dans le texte partagé']);
  }

  try {
    const page = await fetchRecipeById(share.jowRecipeId, options);
    return parseRecipeHtml(page.html, { ...ctx, url: page.url });
  } catch (error) {
    // Le message d'erreur peut contenir l'URL appelée : elle est déjà expurgée
    // (I6), mais on repasse par `redactShareText` par principe — aucun secret
    // ne doit pouvoir remonter jusqu'à un log via un message d'exception.
    const reason = redactShareText(error instanceof Error ? error.message : String(error));
    return fallback(ctx, [`recette Jow non résolue : ${reason}`]);
  }
}
