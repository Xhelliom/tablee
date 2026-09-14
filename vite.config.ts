import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Le front vit dans `web/` et se compile dans `web/dist/`, que le serveur
 * Fastify sert en statique (voir `server/app.ts`).
 *
 * En développement, `npm run dev:web` proxie `/api` et `/share` vers le
 * serveur : le share target Android a besoin d'une vraie URL, pas d'un
 * fragment de hash.
 */
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
    proxy: { '/api/': 'http://localhost:3000' },
  },
});
