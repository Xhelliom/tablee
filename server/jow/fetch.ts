/**
 * Accès réseau aux pages **publiques** de Jow.
 *
 * I7 : uniquement les pages publiques, jamais l'API interne non documentée de
 * l'application. Tout ce qui est lu ici est ce qu'un navigateur reçoit en
 * ouvrant l'URL.
 */

const BASE = 'https://jow.fr';

/** UA de navigateur : Jow sert du HTML allégé aux clients non identifiés. */
const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

export interface FetchedPage {
  html: string;
  /** URL finale après redirections — porte le slug canonique. */
  url: string;
}

export interface FetchOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Récupère une page recette à partir de l'ObjectId du lien de partage.
 *
 * `/{locale}/recipes/<ObjectId>` répond 302 vers l'URL canonique à suffixe.
 * C'est ce qui rend inutile la résolution par le titre décrite au §3 de la
 * spec — voir `docs/jow-contract.md`.
 */
export async function fetchRecipeById(
  recipeId: string,
  options: FetchOptions = {},
): Promise<FetchedPage> {
  if (!/^[a-f0-9]{24}$/i.test(recipeId)) {
    throw new Error('identifiant de recette Jow invalide');
  }
  return fetchPage(`${BASE}/fr/recipes/${recipeId.toLowerCase()}`, options);
}

/** Récupère une page recette depuis une URL web déjà connue (slug en cache). */
export async function fetchRecipeByUrl(
  url: string,
  options: FetchOptions = {},
): Promise<FetchedPage> {
  const parsed = new URL(url);
  if (!/(^|\.)jow\.(fr|com)$/i.test(parsed.hostname)) {
    throw new Error('URL hors du domaine Jow');
  }
  return fetchPage(parsed.toString(), options);
}

async function fetchPage(url: string, options: FetchOptions): Promise<FetchedPage> {
  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': USER_AGENT,
      'accept-language': 'fr-FR,fr;q=0.9',
      accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
  });

  if (!response.ok) {
    throw new Error(`Jow a répondu ${response.status} sur ${url}`);
  }
  return { html: await response.text(), url: response.url || url };
}
