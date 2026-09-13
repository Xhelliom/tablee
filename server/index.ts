/**
 * Point d'entrée du serveur.
 *
 *   DATABASE_URL=postgres://… npm start
 *
 * L'app est auto-hébergée derrière Caddy, qui porte le HTTPS — obligatoire
 * pour le share target Android (§4). Le serveur n'écoute donc qu'en HTTP, sur
 * le réseau de la maison.
 */
import { purgeExpiredSessions } from './auth/session.ts';
import { buildApp } from './app.ts';
import { closePool, getPool } from './db.ts';

const port = Number(process.env['PORT'] ?? 3000);
const host = process.env['HOST'] ?? '0.0.0.0';

const pool = getPool();
const purged = await purgeExpiredSessions(pool);
if (purged > 0) console.log(`${purged} session(s) expirée(s) purgée(s)`);

const app = buildApp({ pool });
await app.listen({ port, host });
console.log(`Tablée écoute sur http://${host}:${port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (async () => {
      await app.close();
      await closePool();
      process.exit(0);
    })();
  });
}
