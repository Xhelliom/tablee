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
import { buildMailer, MailConfigError, type SendMail } from './auth/mail.ts';
import { closePool, getPool } from './db.ts';
import { assertIsolation, IsolationError } from './db/guard.ts';
import { buildDrawDish } from './llm/image.ts';
import { buildLlm } from './llm/index.ts';

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

/**
 * L'envoi de mail, facultatif : `TABLEE_MAIL=resend|smtp`, voir
 * `server/auth/mail.ts`. Une configuration à moitié remplie refuse de démarrer,
 * pour la même raison que le secret — mieux vaut pas de mail qu'un mail qu'on
 * croit parti.
 */
let mail: SendMail | null;
try {
  mail = buildMailer(process.env);
} catch (error) {
  if (error instanceof MailConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

/**
 * La connexion Google, facultative : `GOOGLE_CLIENT_ID` et
 * `GOOGLE_CLIENT_SECRET`, les deux ou aucun. Le client OAuth se crée dans la
 * console Google Cloud, avec pour URI de redirection autorisée
 * `<TABLEE_BASE_URL>/api/auth/callback/google`. À moitié rempli, refus de
 * démarrer : un bouton Google qui échoue à chaque tap est pire que pas de bouton.
 */
const googleClientId = process.env['GOOGLE_CLIENT_ID'] ?? '';
const googleClientSecret = process.env['GOOGLE_CLIENT_SECRET'] ?? '';
if ((googleClientId === '') !== (googleClientSecret === '')) {
  console.error('GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET vont ensemble : les deux, ou aucun.');
  process.exit(1);
}
const google = googleClientId === '' ? null : { clientId: googleClientId, clientSecret: googleClientSecret };

/**
 * L'IA (V3), facultative : `ANTHROPIC_API_KEY`, voir `server/llm/`. Sans elle,
 * la saisie reste aliment par aliment et l'onglet « Conseils » n'apparaît pas.
 */
const llm = buildLlm(process.env);

/**
 * L'image d'un plat saisi avec l'IA, facultative : `GEMINI_API_KEY`, voir
 * `server/llm/image.ts`. Sans elle, la carte garde son bol dessiné.
 */
const drawDish = buildDrawDish(process.env);

const pool = getPool();

// Avant toute chose : l'étanchéité entre foyers est-elle réellement en place ?
// Un superutilisateur Postgres contourne la RLS **en silence**, et servir dans
// cet état promettrait aux familles invitées quelque chose de faux (§16).
try {
  await assertIsolation(pool);
} catch (error) {
  if (error instanceof IsolationError) {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }
  throw error;
}

const auth = buildAuth({ pool, baseURL, secret, secureCookies, mail, google });

const app = buildApp({ pool, auth, baseURL, llm, drawDish });
await app.listen({ port, host });
console.log(
  `Tablée écoute sur http://${host}:${port} (origine publique : ${baseURL}, `
    + `mail : ${mail === null ? 'aucun' : process.env['TABLEE_MAIL']}, `
    + `google : ${google === null ? 'non' : 'oui'}, IA : ${llm === null ? 'non' : 'oui'}, `
    + `images : ${drawDish === null ? 'non' : 'oui'})`,
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (async () => {
      await app.close();
      await closePool();
      process.exit(0);
    })();
  });
}
