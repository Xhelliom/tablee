/**
 * V3 — l'image d'un plat saisi avec l'IA (15/09/2026, à la demande du
 * propriétaire) : la carte d'un repas découpé n'avait ni recette ni photo.
 *
 * ── Chez Google, parce que Claude ne dessine pas ────────────────────────────
 *
 * Gemini 3.1 Flash Lite Image (« Nano Banana 2 Lite ») : le moins cher des
 * modèles d'image dont Google publie le prix, 0,0336 $ l'image 1K au
 * 15/09/2026, contre 0,039 $ pour Nano Banana (2.5 Flash Image). Il se change
 * par `TABLEE_IMAGE_MODEL`, comme celui du texte. Un `fetch` suffit : pas de
 * SDK pour un seul appel.
 *
 * ── Ce qui part ─────────────────────────────────────────────────────────────
 *
 * Ce que le découpage envoie déjà chez Anthropic, rien de plus : les aliments
 * et la description tapée, passés par `anonymize` — le type l'exige (I3, R5).
 * La consigne interdit toute personne dans l'image.
 *
 * ── Ce qu'elle refuse d'être ────────────────────────────────────────────────
 *
 * Une illustration, comme la photo d'une recette Jow. Elle ne dit rien de ce
 * qu'il y avait dans l'assiette, et rien n'en est tiré.
 */
import { createHash } from 'node:crypto';
import type { Anonymized } from './index.ts';

export interface DishImage {
  mimeType: string;
  bytes: Buffer;
}

/** L'image du plat, ou `null` si le modèle n'en a rendu aucune. */
export type DrawDish = (prompt: Anonymized) => Promise<DishImage | null>;

/** Ce que `dish_image.mime_type` accepte : rien qu'un navigateur exécuterait. */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function buildDrawDish(env: NodeJS.ProcessEnv): DrawDish | null {
  const apiKey = env['GEMINI_API_KEY'] ?? '';
  if (apiKey === '') return null;
  const model = env['TABLEE_IMAGE_MODEL'] || 'gemini-3.1-flash-lite-image';

  return async (prompt) => {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        // La clé dans un en-tête, pas dans l'URL : une URL finit dans un journal.
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          // 4:3 : entre la carte héros, large, et la vignette carrée.
          generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '4:3' } },
        }),
        // Personne n'attend devant l'écran : l'app a déjà rendu la main.
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!response.ok) throw new Error(`le modèle d’image a répondu ${response.status}`);
    return readImage(await response.json());
  };
}

/** La première image de la réponse. Un type que `dish_image` refuse n'en est pas une. */
export function readImage(response: unknown): DishImage | null {
  const candidates = (response as { candidates?: unknown } | null)?.candidates;
  const parts = Array.isArray(candidates)
    ? (candidates[0] as { content?: { parts?: unknown } } | undefined)?.content?.parts
    : undefined;
  for (const part of Array.isArray(parts) ? parts : []) {
    const inline = (part as { inlineData?: { mimeType?: unknown; data?: unknown } } | null)?.inlineData;
    if (typeof inline?.mimeType !== 'string' || typeof inline.data !== 'string') continue;
    if (!IMAGE_TYPES.has(inline.mimeType) || inline.data === '') continue;
    return { mimeType: inline.mimeType, bytes: Buffer.from(inline.data, 'base64') };
  }
  return null;
}

/**
 * L'étiquette d'une image : ses ingrédients, sans ordre ni doublon. L'aliment
 * Ciqual quand il est rattaché — « 2 œufs » et « 3 œufs » sont le même œuf —,
 * le libellé sinon. La description n'y entre pas : les mêmes ingrédients
 * reprennent l'image déjà payée.
 *
 * C'est la signature d'un repas habituel (`suggestTemplates`, en SQL) : un
 * « même plat » qui changerait de définition ici doit en changer là-bas.
 */
// ponytail: égalité stricte des ensembles ; rapprocher des ensembles voisins (Jaccard) le jour où les images se répètent trop peu.
export function dishTag(items: { foodId: string | null; label: string }[]): string {
  const keys = [...new Set(items.map((item) => item.foodId ?? item.label.toLowerCase()))].sort();
  return createHash('sha256').update(keys.join('\n')).digest('hex');
}

export function dishPrompt(ingredients: string[], description: string | null): string {
  return [
    'Photographie culinaire d’un repas fait maison, servi sur une table familiale, lumière naturelle douce, vue de trois quarts.',
    'Aucune personne, aucune main, aucun texte, aucun logo.',
    ...(description === null ? [] : [`Le repas : ${description.replace(/\s+/g, ' ')}`]),
    `Ingrédients : ${ingredients.map((name) => name.replace(/\s+/g, ' ')).join(', ')}.`,
  ].join('\n');
}
