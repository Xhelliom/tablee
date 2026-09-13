/**
 * Harnais de test sur une vraie base Postgres.
 *
 * Les tests d'intégration tournent contre `TEST_DATABASE_URL`, jamais contre
 * `DATABASE_URL` : ce fichier tronque des tables, et se tromper de base
 * coûterait l'historique du foyer. Sans `TEST_DATABASE_URL`, les suites qui en
 * dépendent sont **sautées avec un message**, pas silencieusement vertes.
 *
 *   createdb tablee_test
 *   TEST_DATABASE_URL=postgres://…/tablee_test npm test
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS = fileURLToPath(new URL('../../db/migrations/', import.meta.url));

pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export function testDatabaseUrl(): string | null {
  const url = process.env['TEST_DATABASE_URL'];
  return url === undefined || url.length === 0 ? null : url;
}

/** Message unique, pour que le saut se voie dans la sortie de `npm test`. */
export const SKIP_MESSAGE =
  'TEST_DATABASE_URL absent : tests d’intégration sautés (createdb tablee_test, puis TEST_DATABASE_URL=postgres://…/tablee_test npm test)';

let pool: pg.Pool | null = null;

/** Pool de test, migrations appliquées une fois pour toutes. */
export async function testPool(): Promise<pg.Pool> {
  if (pool !== null) return pool;
  const url = testDatabaseUrl();
  if (url === null) throw new Error(SKIP_MESSAGE);

  pool = new pg.Pool({ connectionString: url, max: 5 });
  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
  const applied = await appliedMigrations(pool);
  for (const file of files) {
    if (applied.has(file)) continue;
    await pool.query(await readFile(MIGRATIONS + file, 'utf8'));
    await pool.query(
      "insert into schema_migration (filename, checksum) values ($1, 'test')",
      [file],
    );
  }
  return pool;
}

async function appliedMigrations(db: pg.Pool): Promise<Set<string>> {
  await db.query(`
    create table if not exists schema_migration (
      filename text primary key, checksum text not null,
      applied_at timestamptz not null default now()
    )`);
  const { rows } = await db.query<{ filename: string }>('select filename from schema_migration');
  return new Set(rows.map((r) => r.filename));
}

/**
 * Remet la base à zéro entre deux suites. `food` est préservée : elle est
 * peuplée par les tests qui en ont besoin, et la vider ne coûte rien de plus
 * que de la remplir — mais la garder simple évite les dépendances entre
 * suites.
 */
export async function resetDatabase(db: pg.Pool): Promise<void> {
  await db.query(`
    truncate household, member, food, recipe, meal, meal_template,
             nutrient_reference, unit_default, seasonal_produce, session
    restart identity cascade`);
}

export async function closeTestPool(): Promise<void> {
  if (pool !== null) {
    const p = pool;
    pool = null;
    await p.end();
  }
}
