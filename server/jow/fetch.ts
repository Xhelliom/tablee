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
  return fetchPage(assertJow(`${BASE}/fr/recipes/${recipeId.toLowerCase()}`), options);
}

/** Récupère une page recette depuis une URL web déjà connue (slug en cache). */
export async function fetchRecipeByUrl(
  url: string,
  options: FetchOptions = {},
): Promise<FetchedPage> {
  return fetchPage(assertJow(url), options);
}

/**
 * Vérifie qu'une URL vise bien Jow, en HTTPS, et la rend normalisée.
 *
 * Deux pièges que le seul `endsWith('jow.fr')` laisserait passer :
 * `https://jow.fr@exemple.test/` — dont l'hôte est `exemple.test`, `jow.fr`
 * n'y étant qu'un nom d'utilisateur — et `https://jow.fr.exemple.test/`.
 * Comparer `url.hostname` à une expression ancrée sur la fin traite les deux.
 */
function assertJow(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('URL invalide');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('seul HTTPS est suivi');
  }
  if (!/(^|\.)jow\.(fr|com)$/i.test(parsed.hostname)) {
    throw new Error('URL hors du domaine Jow');
  }
  return parsed.toString();
}

/** Au-delà, c'est une boucle ou un piège, pas une URL canonique. */
const MAX_REDIRECTIONS = 5;

/**
 * ── Les redirections sont suivies à la main, et c'est le point du module ────
 *
 * `redirect: 'follow'` laisserait `fetch` aller où la réponse lui dit d'aller,
 * hôte compris. Le serveur tourne **sur le réseau de la maison** : une page de
 * jow.fr qui répondrait `Location: http://192.168.1.1/…` ferait alors émettre
 * la requête depuis l'intérieur, vers la box, le NAS ou Postgres — c'est la
 * forme classique d'un SSRF, et le contrôle d'hôte à l'entrée n'y change rien
 * puisqu'il n'est fait qu'une fois.
 *
 * Chaque saut est donc revalidé par `assertJow`. Ça ne coûte rien : le contrat
 * Jow n'en prévoit qu'un seul, de l'ObjectId vers l'URL canonique à suffixe.
 */
async function fetchPage(url: string, options: FetchOptions): Promise<FetchedPage> {
  const doFetch = options.fetchImpl ?? fetch;
  let current = url;

  for (let saut = 0; saut <= MAX_REDIRECTIONS; saut += 1) {
    const response = await doFetch(current, {
      redirect: 'manual',
      headers: {
        'user-agent': USER_AGENT,
        'accept-language': 'fr-FR,fr;q=0.9',
        accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location === null || location.length === 0) {
        throw new Error(`Jow a répondu ${response.status} sans destination`);
      }
      // Relative ou absolue : résolue contre l'URL courante, puis revérifiée.
      current = assertJow(new URL(location, current).toString());
      continue;
    }

    if (!response.ok) {
      throw new Error(`Jow a répondu ${response.status} sur ${current}`);
    }
    return { html: await response.text(), url: response.url || current };
  }

  throw new Error('trop de redirections');
}
