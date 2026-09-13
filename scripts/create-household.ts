/**
 * Crée le compte du foyer (§7). Il n'y a pas d'inscription dans l'app : un
 * seul compte, créé une fois par la personne qui héberge.
 *
 *   npm run household -- --login=maison --name="Chez nous"
 *
 * Le mot de passe est demandé sur l'entrée standard et n'apparaît ni dans la
 * ligne de commande, ni dans l'historique du shell, ni dans les logs.
 * Rejouer la commande avec le même login met à jour le mot de passe.
 */
import { createInterface } from 'node:readline/promises';
import { hashPassword } from '../server/auth/password.ts';
import { closePool, getPool } from '../server/db.ts';

const args = process.argv.slice(2);
const arg = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const login = arg('login');
const name = arg('name') ?? 'Foyer';
const timezone = arg('timezone') ?? 'Europe/Paris';

if (login === undefined || login.length === 0) {
  console.error('usage : npm run household -- --login=<identifiant> [--name="Chez nous"] [--timezone=Europe/Paris]');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question('Mot de passe du foyer (8 caractères minimum) : ');
const again = await rl.question('Confirmation : ');
rl.close();

if (password !== again) {
  console.error('les deux saisies diffèrent');
  process.exit(1);
}

const hash = await hashPassword(password);
const pool = getPool();
try {
  const { rows } = await pool.query<{ id: string }>(
    `insert into household (name, login, password_hash, timezone)
     values ($1, $2, $3, $4)
     on conflict (login) do update set
       name = excluded.name,
       password_hash = excluded.password_hash,
       timezone = excluded.timezone
     returning id`,
    [name, login, hash, timezone],
  );
  console.log(`foyer « ${name} » prêt (${rows[0]?.id}), connexion : ${login}`);
} finally {
  await closePool();
}
