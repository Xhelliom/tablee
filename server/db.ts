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

/**
 * Exécute `fn` dans une transaction, et la déroule à la moindre erreur.
 *
 * Accepte un pool **ou** un client déjà acquis. Le second cas est celui des
 * routes : elles reçoivent le client marqué au foyer par `acquireForHousehold`,
 * et la transaction doit se tenir **sur ce client-là** — en prendre un autre
 * dans le pool écrirait hors du foyer courant, sans que rien ne le signale.
 * Un client prêté n'est ni rendu ni fermé ici : il appartient à l'appelant.
 */
export async function transaction<T>(
  db: Db,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const emprunté = 'release' in db;
  const client = emprunté ? (db as pg.PoolClient) : await (db as pg.Pool).connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    if (!emprunté) client.release();
  }
}

/**
 * Acquiert un client et y pose le foyer courant, pour la durée d'une requête.
 *
 * C'est le pendant applicatif de la migration 008 : les policies lisent
 * `app.household_id`, et c'est ici qu'il est écrit. Trois propriétés comptent,
 * et chacune répare une manière de se tromper :
 *
 * 1. **Le client est exclusif.** Tant que la requête le tient, personne
 *    d'autre ne l'utilise — un paramètre de session ne peut donc pas fuir d'une
 *    requête vers une autre.
 * 2. **Il est posé à chaque acquisition**, sans jamais lire l'état précédent.
 *    Un client recyclé ne peut pas hériter du foyer d'avant.
 * 3. **Il est effacé à la libération**, pour qu'un client rendu au pool ne
 *    reparte pas avec un foyer collé dessus si la suite oubliait d'en poser un.
 *
 * Volontairement **hors transaction** : `set_config(…, true)` serait annulé au
 * `commit`, et plusieurs fonctions du dépôt ouvrent déjà leur propre
 * transaction — les imbriquer ferait valider l'extérieur au premier `commit`
 * intérieur. Un paramètre de session traverse les transactions, lui.
 */
export interface ScopedClient {
  client: pg.PoolClient;
  /** À appeler quoi qu'il arrive. Efface le foyer, puis rend le client. */
  release(): Promise<void>;
}

/** La primitive. `withHousehold` en dessous couvre le cas courant. */
export async function acquireForHousehold(
  pool: pg.Pool,
  householdId: string,
): Promise<ScopedClient> {
  const client = await pool.connect();
  const set = (value: string): Promise<unknown> =>
    client.query('select set_config($1, $2, false)', ['app.household_id', value]);

  try {
    await set(householdId);
  } catch (error) {
    client.release();
    throw error;
  }

  return {
    client,
    release: async () => {
      // `catch` et non `await` nu : si l'effacement échoue, le client doit
      // quand même être rendu, et masquer l'erreur d'origine serait pire.
      await set('').catch(() => undefined);
      client.release();
    },
  };
}

export async function withHousehold<T>(
  pool: pg.Pool,
  householdId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const scoped = await acquireForHousehold(pool, householdId);
  try {
    return await fn(scoped.client);
  } finally {
    await scoped.release();
  }
}
