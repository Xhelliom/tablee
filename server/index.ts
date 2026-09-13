/**
 * Point d'entrée du serveur.
 *
 *   DATABASE_URL=postgres://… TABLEE_SECRET=… TABLEE_BASE_URL=… npm start
 *
 * L'app est auto-hébergée derrière Caddy, qui porte le HTTPS — obligatoire
 * pour le share target Android (§4). Le serveur n'écoute donc qu'en HTTP, sur
 * le réseau de la maison.
 */
import { buildApp } from './app.ts';
import { buildAuth } from './auth/auth.ts';
import { closePool, getPool } from './db.ts';

const port = Number(process.env['PORT'] ?? 3000);
const host = process.env['HOST'] ?? '0.0.0.0';

/**
 * L'origine publique du service, telle que le navigateur la voit.
 *
 * better-auth s'en sert pour valider l'origine des requêtes et poser ses
 * cookies ; les liens d'invitation en sortent aussi. Derrière Caddy, c'est le
 * nom de domaine, pas `localhost` — d'où une variable plutôt qu'une déduction
 * à partir du port d'écoute, qui serait fausse en production.
 */
const baseURL = process.env['TABLEE_BASE_URL'] ?? `http://localhost:${port}`;

/**
 * Le secret qui signe les jetons de session.
 *
 * Pas de valeur par défaut : une clé codée en dur et partagée par toutes les
 * installations ne protège rien. Le serveur refuse de démarrer sans, plutôt
 * que de tourner en donnant l'illusion d'être gardé.
 */
const secret = process.env['TABLEE_SECRET'] ?? '';
if (secret.length < 32) {
  console.error(
    'TABLEE_SECRET manquant ou trop court (32 caractères au moins).\n' +
      "En générer un :  node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"",
  );
  process.exit(1);
}

/**
 * `TABLEE_INSECURE_COOKIE=1` retire l'attribut `Secure` du cookie, pour le
 * développement sur http://localhost et **nulle part ailleurs** : le share
 * target Android exige HTTPS de toute façon (§4).
 */
const secureCookies = process.env['TABLEE_INSECURE_COOKIE'] !== '1';

const pool = getPool();
const auth = buildAuth({ pool, baseURL, secret, secureCookies });

const app = buildApp({ pool, auth, baseURL });
await app.listen({ port, host });
console.log(`Tablée écoute sur http://${host}:${port} (origine publique : ${baseURL})`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (async () => {
      await app.close();
      await closePool();
      process.exit(0);
    })();
  });
}
