import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

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

export default defineConfig({
  root: 'web',
  plugins: [react()],
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
