/**
 * Nomme un super-admin de la plateforme (020), depuis le serveur lui-même.
 *
 *   npm run superadmin -- contact@exemple.fr
 *   npm run superadmin -- contact@exemple.fr autre@exemple.fr
 *   npm run superadmin -- --retirer contact@exemple.fr
 *
 * Dans le container, sans npm :
 *   node --import tsx scripts/make-superadmin.ts contact@exemple.fr
 *
 * ── Pourquoi ce script existe, en plus de la première connexion ─────────────
 *
 * Le premier compte connecté devient super-admin tout seul (`server/repo/
 * admin.ts`, `ensureFirstSuperAdmin`). Mais sur une instance qui a déjà
 * plusieurs comptes au moment où la 020 s'applique, c'est la première requête
 * — de n'importe qui — qui gagne. Ce script lève l'ambiguïté : l'hébergeur
 * désigne explicitement qui administre la plateforme, sans passer par
 * l'interface ni deviner un identifiant interne — une adresse suffit.
 *
 * Idempotent : rejouer avec la même adresse ne duplique rien.
 */
import pg from 'pg';
import { closePool, getPool } from '../server/db.ts';

const retirer = process.argv.includes('--retirer');
const adresses = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));

if (adresses.length === 0) {
  console.error(
    'Usage : npm run superadmin -- <adresse…> [--retirer]\n'
    + 'Exemple : npm run superadmin -- contact@exemple.fr',
  );
  process.exit(1);
}

const pool: pg.Pool = getPool();

try {
  // La 020 n'est peut-être pas encore appliquée : le dire plutôt que de
  // sortir une erreur Postgres brute.
  const table = await pool.query<{ t: string | null }>(
    "select to_regclass('platform_admin') as t",
  ).catch(() => ({ rows: [{ t: null }] as { t: string | null }[] }));
  if (table.rows[0]?.t === null) {
    console.error('Table platform_admin absente : appliquer d’abord `npm run migrate` (020).');
    process.exit(1);
  }

  let échecs = 0;
  for (const adresse of adresses) {
    const normalisée = adresse.trim().toLowerCase();
    const { rows } = await pool.query<{ id: string; email: string }>(
      'select "id", "email" from "user" where lower("email") = $1',
      [normalisée],
    );
    const compte = rows[0];
    if (compte === undefined) {
      console.error(`× ${adresse} : aucun compte avec cette adresse`);
      échecs += 1;
      continue;
    }
    if (retirer) {
      await pool.query('delete from platform_admin where user_id = $1', [compte.id]);
      console.log(`− ${compte.email} n’est plus super-admin`);
    } else {
      await pool.query(
        'insert into platform_admin (user_id) values ($1) on conflict do nothing',
        [compte.id],
      );
      console.log(`✓ ${compte.email} est super-admin`);
    }
  }
  if (échecs > 0) process.exit(1);
} finally {
  await closePool();
}
