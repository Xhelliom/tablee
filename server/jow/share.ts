import type { ShareInput } from './types.ts';

/**
 * Paramètres d'un lien de partage Jow qui sont des **secrets de compte**.
 * I6 : ne jamais les logger ni les persister, nulle part, sous aucune forme.
 * Tout ce qui sort de ce module en est déjà expurgé.
 */
const SECRET_PARAMS = ['key', 'userid', 'token', 'access_token'];

const OBJECT_ID = /\b([a-f0-9]{24})\b/i;
const URL_IN_TEXT = /https?:\/\/[^\s<>"')\]]+/gi;

/**
 * Retire les paramètres secrets d'une URL. Retourne l'URL telle quelle si elle
 * n'est pas parsable — on ne casse pas sur une entrée inattendue, mais on ne
 * prétend pas non plus l'avoir nettoyée : d'où `redactUrl` toujours appelée en
 * amont de toute persistance, et jamais l'inverse.
 */
export function redactUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Pas une URL absolue : on retire quand même les paires clé=valeur sensibles.
    return raw.replace(
      new RegExp(`([?&])(${SECRET_PARAMS.join('|')})=[^&\\s]*`, 'gi'),
      '$1',
    );
  }
  for (const key of [...url.searchParams.keys()]) {
    if (SECRET_PARAMS.includes(key.toLowerCase())) url.searchParams.delete(key);
  }
  return url.toString();
}

/**
 * Version expurgée d'un texte de partage. **C'est la seule forme qui peut être
 * loggée ou stockée** (I6). Le texte brut ne doit jamais atteindre un fichier
 * de log, `meal.raw_input`, ni un message d'erreur.
 */
export function redactShareText(text: string): string {
  return text.replace(URL_IN_TEXT, (u) => redactUrl(u));
}

/**
 * Version expurgée d'une URL de **requête entrante**, destinée au journal.
 *
 * I6, cas particulier et facile à manquer : le share target est un GET (§4),
 * donc le texte partagé par Jow arrive **dans la query string**, percent-encodé.
 * `key=SECRET` y apparaît sous la forme `%26key%3DSECRET` à l'intérieur du
 * paramètre `text` : ni `redactUrl` ni `redactShareText` ne le voient, parce
 * qu'ils travaillent sur le texte déjà décodé. Un journal de requêtes écrirait
 * alors le jeton de compte sur le disque, en clair.
 *
 * On décode donc chaque paramètre avant de l'expurger, puis on ré-encode.
 */
export function redactRequestUrl(url: string): string {
  const cut = url.indexOf('?');
  if (cut === -1) return redactUrl(url);

  const path = url.slice(0, cut);
  const params = new URLSearchParams(url.slice(cut + 1));
  const clean = new URLSearchParams();
  for (const [key, value] of params) {
    if (SECRET_PARAMS.includes(key.toLowerCase())) continue;
    clean.set(key, redactShareText(value));
  }
  const query = clean.toString();
  return query.length === 0 ? path : `${path}?${query}`;
}

/**
 * Extrait du texte de partage ce qui est exploitable, sans aucun accès réseau.
 *
 * Tolérant par construction : un texte inattendu ne lève pas, il ressort avec
 * des champs à `null` et c'est l'appelant qui bascule en saisie manuelle.
 */
export function parseShareText(text: string): ShareInput {
  const redacted = redactShareText(text ?? '');

  const urls = redacted.match(URL_IN_TEXT) ?? [];
  const jowUrl = urls.find((u) => /(^|\.)jow\.(fr|com)/i.test(u)) ?? urls[0] ?? null;

  // L'ObjectId peut être dans un paramètre `recipeId` ou nu dans le texte.
  const fromParam = redacted.match(/recipeId=([a-f0-9]{24})/i)?.[1];
  const jowRecipeId = (fromParam ?? redacted.match(OBJECT_ID)?.[1] ?? null)?.toLowerCase() ?? null;

  return { jowRecipeId, title: guessTitle(redacted), url: jowUrl };
}

/**
 * Devine le titre : première ligne qui ne soit ni une URL, ni une amorce de
 * phrase (« Découvre cette recette : »). Sert uniquement de repli quand la
 * résolution par ObjectId échoue — on n'en fait jamais une source de valeurs.
 */
function guessTitle(text: string): string | null {
  const lines = text
    .split(/[\r\n]+/)
    .map((l) => l.replace(URL_IN_TEXT, '').trim())
    .filter((l) => l.length > 0 && !l.endsWith(':'));
  return lines[0] ?? null;
}

/**
 * Slug Jow à partir d'un titre : minuscules, accents retirés, `&` → `et`,
 * ponctuation retirée, espaces → `-`.
 *
 * ⚠️ Ne suffit **pas** à construire une URL web : celle-ci porte un suffixe
 * aléatoire (`…-8vch9drbhyhc03wu0epa`) absent du titre. Conservé parce que le
 * slug nu est utile pour comparer deux titres, pas pour fetcher.
 */
export function slugify(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' et ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
