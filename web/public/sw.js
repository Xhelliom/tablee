/*
 * Service worker minimal.
 *
 * Pas de précache généré : le seul besoin réel est que l'app s'ouvre quand le
 * serveur de la maison ne répond pas (Wi-Fi capricieux, Proxmox qui redémarre),
 * et qu'elle soit installable — un share target Android n'existe qu'une fois
 * la PWA installée (§4).
 *
 * Deux stratégies, et rien de plus :
 *
 *   /assets/*   cache d'abord — les noms sont hachés par Vite, donc immuables
 *   navigation  réseau d'abord, coquille en repli
 *
 * Les appels `/api` ne sont jamais mis en cache : un bilan nutritionnel périmé
 * servi comme s'il était à jour serait pire qu'un écran d'erreur.
 */
const CACHE = 'tablee-v1';
const SHELL = [
  '/', '/index.html', '/manifest.webmanifest', '/icon.svg',
  // Les polices font partie de la coquille : sans elles l'app s'ouvre hors
  // ligne dans ses polices de repli, et perd l'écart typographique qui porte
  // son identité (§8ter).
  '/fonts/inter-latin.woff2', '/fonts/fraunces-latin.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Les polices sont immuables elles aussi : leur nom change quand leur
  // contenu change.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((hit) => hit ?? Response.error())),
    );
  }
});
