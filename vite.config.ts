import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Le front vit dans `web/` et se compile dans `web/dist/`, que le serveur
 * Fastify sert en statique (voir `server/app.ts`).
 *
 * En développement, `npm run dev:web` proxie `/api` et `/share` vers le
 * serveur : le share target Android a besoin d'une vraie URL, pas d'un
 * fragment de hash.
 *
 * Le port 3000 est la valeur par défaut du serveur (`PORT` dans
 * `server/index.ts`), mais il est souvent pris par un autre projet. Dans ce
 * cas, démarrer le serveur ailleurs et dire au proxy où il est :
 *
 *   PORT=3005 TABLEE_BASE_URL=http://localhost:3005 npm run dev
 *   TABLEE_API=http://localhost:3005 npm run dev:web
 */
const api = process.env['TABLEE_API'] ?? 'http://localhost:3000';

/**
 * Donne au cache du service worker le nom du build (dette n° 4bis). Un nom
 * écrit à la main laissait un front redéployé sans nouveau worker, donc avec
 * une coquille hors ligne pointant vers des bundles disparus.
 *
 * L'empreinte porte sur tout `dist` sauf `sw.js` : chemins et contenus, triés,
 * pour que deux builds identiques donnent le même nom — et ne vident pas le
 * cache des téléphones pour rien.
 */
export function stampServiceWorker(dist: string): string {
  const sw = join(dist, 'sw.js');
  const source = readFileSync(sw, 'utf8');
  if (!source.includes('__BUILD__')) throw new Error('sw.js : marqueur __BUILD__ introuvable');
  const hash = createHash('sha256');
  const files = readdirSync(dist, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name))
    .filter((f) => f !== sw)
    .sort();
  for (const f of files) hash.update(relative(dist, f)).update('\0').update(readFileSync(f)).update('\0');
  const version = hash.digest('hex').slice(0, 12);
  writeFileSync(sw, source.replaceAll('__BUILD__', version));
  return version;
}

const swVersion: Plugin = {
  name: 'tablee-sw-version',
  apply: 'build',
  // `closeBundle` : après la copie de `public/`, donc `dist/sw.js` existe.
  closeBundle() { stampServiceWorker(join(import.meta.dirname, 'web', 'dist')); },
};

export default defineConfig({
  root: 'web',
  plugins: [react(), swVersion],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    // `/api/` avec la barre, et pas `/api` : Vite compare par préfixe, et
    // `/api` capterait aussi `/api.ts` — le client HTTP du front, servi alors
    // par Fastify sous forme de coquille HTML. Page blanche, sans autre signe
    // qu'un « Unexpected token '<' ».
    proxy: { '/api/': api },
  },
});
