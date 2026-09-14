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

/**
 * ── Deux types d'accès, et un seul sert au domaine ──────────────────────────
 *
 * La migration 008 filtre les tables du domaine sur `app.household_id`, posé
 * par `acquireForHousehold` sur **un** client. Une requête partie du pool n'en
 * porte aucun : elle ne lève pas, elle ne rend rien — et « rien » ressemble à
 * « le foyer est vide » jusqu'à ce que quelqu'un ouvre les journaux.
 *
 * Tant que le type disait `pg.Pool | pg.PoolClient`, cette erreur **se
 * compilait**. Elle ne se compile plus : `HouseholdDb` porte une marque que
 * seul ce module pose, à l'endroit exact où le foyer est écrit sur le client.
 * Passer `ctx.pool` à `getMeal` est désormais une erreur de type, pas une
 * relecture attentive.
 *
 * Les lectures d'avant-foyer restent légitimes — résoudre une session suppose
 * bien de lire `"member"` et `household` sans savoir encore de quel foyer il
 * s'agit. Elles prennent `UnscopedDb`, qui est nommé pour se voir en revue :
 * une fonction du domaine qui l'accepterait se repère à l'œil.
 */

declare const foyerPosé: unique symbol;

/**
 * Un client Postgres **marqué au foyer courant**, et le seul type que les
 * fonctions de `server/repo/` acceptent pour toucher une table scopée.
 *
 * La marque est un type fantôme : elle n'existe qu'à la compilation, ne coûte
 * rien à l'exécution, et n'est posée que par `acquireForHousehold`. Un
 * `as unknown as HouseholdDb` la contrefait, comme toute marque en TypeScript
 * — mais il faut alors l'écrire, et ça se lit en revue.
 */
export type HouseholdDb = pg.PoolClient & { readonly [foyerPosé]: true };

/**
 * Un accès Postgres qui ne porte **aucun** foyer : le pool, ou un client nu.
 *
 * Réservé à ce qui se passe avant qu'un foyer soit connu — la résolution de
 * session (`server/auth/identity.ts`), la création du foyer d'une organisation
 * qui vient de naître, la liste des foyers d'un compte — et aux tables hors
 * RLS que tout le monde lit : `food`, `nutrient_reference`, `unit_default`.
 *
 * Un `HouseholdDb` y est accepté : un client marqué reste un client, et lire
 * le référentiel public depuis une requête scopée est normal. L'inverse, non.
 */
export type UnscopedDb = pg.Pool | pg.PoolClient;

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
 * La transaction se tient sur **le client de l'appelant** — celui que
 * `acquireForHousehold` a marqué au foyer. En prendre un autre dans le pool
 * écrirait hors du foyer courant, sans que rien ne le signale ; c'est
 * désormais impossible à écrire, puisque le pool n'est plus un `HouseholdDb`.
 *
 * Le client n'est ni rendu ni fermé ici : il appartient à l'appelant, et la
 * requête HTTP le rend dans son hook `onResponse`.
 */
export async function transaction<T>(
  db: HouseholdDb,
  fn: (client: HouseholdDb) => Promise<T>,
): Promise<T> {
  await db.query('begin');
  try {
    const result = await fn(db);
    await db.query('commit');
    return result;
  } catch (error) {
    // `catch` et non `await` nu : un `rollback` qui échoue — connexion coupée,
    // transaction déjà avortée — remplacerait sinon l'erreur d'origine par une
    // erreur de nettoyage, et c'est la première qui dit ce qui s'est passé.
    await db.query('rollback').catch(() => undefined);
    throw error;
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
  client: HouseholdDb;
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
    // La marque est posée **ici**, et nulle part ailleurs : c'est la seule
    // ligne du dépôt où un client devient un `HouseholdDb`, et elle suit
    // immédiatement le `set_config` qui lui donne son foyer.
    client: client as HouseholdDb,
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
  fn: (client: HouseholdDb) => Promise<T>,
): Promise<T> {
  const scoped = await acquireForHousehold(pool, householdId);
  try {
    return await fn(scoped.client);
  } finally {
    await scoped.release();
  }
}
