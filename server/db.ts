/**
 * Accès Postgres — un pool unique, partagé par l'API et les scripts.
 *
 * Le calcul nutritionnel ne passe pas par ici : il se fait en applicatif
 * (§11 de la spec). Ce module ne sert qu'à lire et écrire des lignes.
 */
import pg from 'pg';

/**
 * `numeric` arrive par défaut sous forme de chaîne (pg refuse de perdre de la
 * précision en le coulant dans un double). Tous nos `numeric` sont des grammes
 * et des coefficients à 2-3 décimales : le flottant est exact à cette échelle,
 * et une chaîne dans un calcul de nutrition serait une source de bugs
 * silencieux (`"1.5" * 2` vaut 3, mais `"1.5" + 2` vaut "1.52").
 */
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));
/** `date` (sans heure) reste une chaîne `YYYY-MM-DD` : pas de dérive de fuseau. */
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export type Db = pg.Pool | pg.PoolClient;

let pool: pg.Pool | null = null;

export function databaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.length === 0) {
    throw new Error('DATABASE_URL manquant');
  }
  return url;
}

export function getPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: databaseUrl(), max: 10 });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool !== null) {
    const p = pool;
    pool = null;
    await p.end();
  }
}

/** Exécute `fn` dans une transaction, et la déroule à la moindre erreur. */
export async function transaction<T>(
  db: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
