/**
 * Lire les plats d'une commande Jow à partir de son lien de partage
 * (`recipes-selection/<sharingId>?key=…&userId=…`).
 *
 * ⚠️ Seule exception à I7, décidée par le propriétaire le 13/10/2026 : la page
 * de ce lien est une coquille vide (`docs/jow-contract.md` §10), les plats ne
 * se lisent que par `GET /share/link/details`. `key` et `userId` y sont ceux
 * d'un **partage public**, pas d'un compte : le propriétaire les tient pour des
 * clés publiques. I6 reste entier malgré cela — ils vivent le temps de l'appel,
 * en mémoire, et ne sont ni stockés, ni journalisés, ni repris dans une erreur.
 *
 * La forme de la réponse (`meals[].recipe.id`) vient de la lecture du bundle
 * public de la page, pas d'une réponse observée : on n'en retient que les
 * identifiants, et tout le reste passe par les pages recette publiques.
 */
import type { FetchOptions } from './fetch.ts';

const API = 'https://api.jow.fr/public/share/link/details';
const HEX24 = /^[a-f0-9]{24}$/i;

export interface OrderLink { sharingId: string; key: string; userId: string }

/** `null` si le texte ne contient pas un lien de commande complet. */
export function parseOrderLink(text: string): OrderLink | null {
  for (const raw of text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? []) {
    let url: URL;
    try { url = new URL(raw); } catch { continue; }
    if (!/(^|\.)jow\.(fr|com)$/i.test(url.hostname)) continue;
    const sharingId = url.pathname.match(/\/recipes-selection\/([^/?#]+)/i)?.[1];
    const key = url.searchParams.get('key');
    const userId = url.searchParams.get('userId');
    if (sharingId !== undefined && key !== null && userId !== null) {
      return { sharingId, key, userId };
    }
  }
  return null;
}

/** Les ObjectId des recettes de la commande, dans l'ordre, doublons conservés. */
export async function fetchOrderRecipeIds(
  link: OrderLink, options: FetchOptions = {},
): Promise<string[]> {
  const url = new URL(API);
  url.searchParams.set('key', link.key);
  url.searchParams.set('userId', link.userId);
  url.searchParams.set('sharingId', link.sharingId);
  // Les messages ne citent jamais l'URL : elle porte les paramètres.
  const response = await (options.fetchImpl ?? fetch)(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
  }).catch(() => { throw new Error('commande Jow injoignable'); });
  if (!response.ok) throw new Error(`commande Jow refusée (${response.status})`);

  const data = (await response.json().catch(() => null)) as
    { meals?: { recipe?: { id?: unknown } }[] } | null;
  return (data?.meals ?? [])
    .map((m) => m.recipe?.id)
    .filter((id): id is string => typeof id === 'string' && HEX24.test(id))
    .map((id) => id.toLowerCase());
}
