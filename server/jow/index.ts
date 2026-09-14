import {
  fetchRecipeById, fetchRecipeByUrl, type FetchedPage, type FetchOptions,
} from './fetch.ts';
import { fallback, parseRecipeHtml } from './parse.ts';
import { parseShareText, redactShareText } from './share.ts';
import type { ParsedRecipe } from './types.ts';

export type { ParsedIngredient, ParsedNutrition, ParsedRecipe, ShareInput, Confidence } from './types.ts';
export {
  parseShareText, redactRequestUrl, redactShareText, redactUrl, slugify,
} from './share.ts';
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

  // Deux entrées, et la seconde n'est pas un confort : la feuille de partage
  // d'Android donne un ObjectId, mais le lien **copié depuis le site** est
  // l'URL canonique à suffixe (`/recipes/<slug>-<suffixe>`), qui n'en porte
  // aucun. Sans ce second chemin, coller une adresse de recette parfaitement
  // valide retomberait en saisie manuelle. La page reste publique (I7), et
  // c'est `assertJow` de `fetch.ts` qui garde le domaine.
  const recipeId = share.jowRecipeId;
  const url = share.url;
  const fetchPage: (() => Promise<FetchedPage>) | null =
    recipeId !== null
      ? () => fetchRecipeById(recipeId, options)
      : url !== null && isRecipePage(url)
        ? () => fetchRecipeByUrl(url, options)
        : null;

  if (fetchPage === null) {
    return fallback(ctx, ['aucune recette Jow reconnue dans le texte partagé']);
  }

  try {
    const page = await fetchPage();
    return parseRecipeHtml(page.html, { ...ctx, url: page.url });
  } catch (error) {
    // Le message d'erreur peut contenir l'URL appelée : elle est déjà expurgée
    // (I6), mais on repasse par `redactShareText` par principe — aucun secret
    // ne doit pouvoir remonter jusqu'à un log via un message d'exception.
    const reason = redactShareText(error instanceof Error ? error.message : String(error));
    return fallback(ctx, [`recette Jow non résolue : ${reason}`]);
  }
}

/**
 * L'URL vise-t-elle une **page recette** de Jow ? L'accueil ou une page
 * marketing ne contiennent pas de `__NEXT_DATA__` exploitable : aller les
 * chercher ne produirait qu'un aller-retour réseau pour un repli. Le contrôle
 * de domaine est refait ici parce que cette fonction décide d'un départ ;
 * `assertJow` décide, elle, d'une arrivée, et les deux doivent tenir seules.
 */
function isRecipePage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /(^|\.)jow\.(fr|com)$/i.test(parsed.hostname) && /\/recipes\//i.test(parsed.pathname);
  } catch {
    return false;
  }
}
