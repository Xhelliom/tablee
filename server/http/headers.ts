/**
 * Les en-têtes de sécurité, posés sur **toutes** les réponses.
 *
 * ── Pourquoi dans l'app et pas dans Caddy ───────────────────────────────────
 *
 * La passation ne demande qu'une ligne de Caddyfile (`reverse_proxy`), et
 * l'ingress Kubernetes est encore un autre proxy. Un en-tête posé dans la
 * configuration du proxy est un en-tête qui dépend de l'installation : il
 * manquera sur la première machine où l'on aura déployé autrement. Posé ici,
 * il suit l'image partout, et se teste.
 *
 * ── Ce que chacun empêche, concrètement ─────────────────────────────────────
 *
 * `content-security-policy` — le vrai travail. Même sans faille XSS connue,
 * une politique stricte limite ce qu'une faille future pourrait faire : rien
 * ne s'exécute qui ne vienne de l'origine, rien ne s'exfiltre vers un tiers
 * (`connect-src 'self'`), et la page ne peut pas être encadrée.
 *
 * `referrer-policy: no-referrer` — I6, et c'est le point le moins évident du
 * fichier. Le share target arrive en GET : l'URL de la page `/share` **porte
 * le texte partagé**, donc les jetons `key` et `userId` du lien Jow. Cette
 * page affiche ensuite la photo du plat, servie par `static.jow.fr`. Sans
 * cette ligne, le navigateur enverrait l'URL de la page dans l'en-tête
 * `Referer` de la requête d'image — c'est-à-dire renverrait le jeton de compte
 * à Jow, dans ses journaux. Les navigateurs récents tronquent déjà à l'origine
 * pour une requête tierce ; « déjà, par défaut, sur les versions récentes »
 * n'est pas une garantie qu'on veut sur un jeton.
 *
 * `x-content-type-options: nosniff` — un fichier du référentiel ou une photo
 * ne doit jamais être deviné exécutable.
 *
 * `x-frame-options` et `frame-ancestors` — l'app ne s'encadre nulle part, donc
 * pas de clickjacking sur les boutons de suppression.
 *
 * `permissions-policy` — aucune des API listées n'est utilisée. Le jour où la
 * saisie par photo arrivera (§6), `camera=()` devra être ouvert ici, et ce
 * sera une décision visible plutôt qu'une permission acquise en silence.
 */

/**
 * Les images de recettes viennent de Jow — c'est le sujet du §8ter, et la
 * seule origine tierce que la page charge.
 */
const IMAGES_JOW = ['https://static.jow.fr', 'https://*.jow.fr'];

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // React pose les styles en attribut `style=…` sur presque chaque élément.
  // Les en sortir demanderait de réécrire tout le front en feuilles de style :
  // ce serait la bonne chose à faire, ce n'est pas cette passe-ci.
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: ${IMAGES_JOW.join(' ')}`,
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
});
