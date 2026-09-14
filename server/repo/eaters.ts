/**
 * Membres du foyer. Toutes les requêtes sont scopées au `household_id` de la
 * session : rien ici ne peut lire le foyer d'à côté.
 *
 * ── Une assiette peut avoir un compte, et n'en a pas forcément ──────────────
 *
 * Depuis la 009, `eater.user_id` dit *quel compte est cette personne*, quand
 * elle en a un. C'est un lien facultatif, pas la refusion que la 007 répare :
 * un enfant reste une assiette sans compte, une nounou un compte sans
 * assiette, et « qui a agi » (`meal.created_by`) continue de désigner un
 * `"user"`, jamais un convive.
 *
 * `claim_email` est l'état d'attente entre les deux : le parent saisit
 * l'assiette de sa femme aujourd'hui, elle s'inscrit dans trois semaines, et
 * le rattachement se fait tout seul à ce moment-là (`claimEatersForUser`).
 */
import type { Db } from '../db.ts';

export interface Eater {
  id: string;
  firstName: string;
  /** `YYYY-MM-DD`. L'âge se calcule, il ne se stocke pas (§10). */
  birthDate: string;
  sex: 'F' | 'M';
  portionCoef: number;
  diets: string[];
  color: string | null;
  active: boolean;
  /** Le compte de ce convive, s'il en a un. `null` est l'état normal. */
  userId: string | null;
  /** L'adresse à qui l'assiette est réservée, tant que personne ne l'a prise. */
  claimEmail: string | null;
  /** Majeurs uniquement (I5). Une mesure, jamais une cible. */
  weightKg: number | null;
  /** Quand ce poids a été saisi. Un poids sans date dérive. */
  weightRecordedAt: string | null;
  heightCm: number | null;
}

interface Row {
  id: string; first_name: string; birth_date: string; sex: 'F' | 'M';
  portion_coef: number; diets: string[]; color: string | null; active: boolean;
  user_id: string | null; claim_email: string | null;
  weight_kg: number | null; weight_recorded_at: Date | string | null;
  height_cm: number | null;
}

const toEater = (row: Row): Eater => ({
  id: row.id,
  firstName: row.first_name,
  birthDate: row.birth_date,
  sex: row.sex,
  portionCoef: row.portion_coef,
  diets: row.diets,
  color: row.color,
  active: row.active,
  userId: row.user_id,
  claimEmail: row.claim_email,
  weightKg: row.weight_kg,
  weightRecordedAt:
    row.weight_recorded_at === null
      ? null
      : new Date(row.weight_recorded_at).toISOString(),
  heightCm: row.height_cm,
});

const COLUMNS = `id, first_name, birth_date, sex, portion_coef, diets, color, active,
                 user_id, claim_email, weight_kg, weight_recorded_at, height_cm`;

const SELECT = `select ${COLUMNS} from eater`;

export async function listEaters(
  db: Db,
  householdId: string,
  { includeInactive = false } = {},
): Promise<Eater[]> {
  const { rows } = await db.query<Row>(
    `${SELECT} where household_id = $1 ${includeInactive ? '' : 'and active'}
     order by birth_date asc, first_name asc`,
    [householdId],
  );
  return rows.map(toEater);
}

export async function findMembers(db: Db, householdId: string, ids: string[]): Promise<Eater[]> {
  if (ids.length === 0) return [];
  const { rows } = await db.query<Row>(
    `${SELECT} where household_id = $1 and id = any($2::uuid[])`,
    [householdId, ids],
  );
  return rows.map(toEater);
}

/** L'assiette d'un compte dans ce foyer, s'il en a une. */
export async function findEaterOfUser(
  db: Db,
  householdId: string,
  userId: string,
): Promise<Eater | null> {
  const { rows } = await db.query<Row>(
    `${SELECT} where household_id = $1 and user_id = $2`,
    [householdId, userId],
  );
  const row = rows[0];
  return row === undefined ? null : toEater(row);
}

export interface MemberInput {
  firstName: string;
  birthDate: string;
  sex: 'F' | 'M';
  portionCoef?: number;
  diets?: string[];
  color?: string | null;
  /** Le compte de ce convive. Posé pour « c'est moi », jamais deviné. */
  userId?: string | null;
  /** L'adresse à qui l'assiette est réservée, en attendant l'inscription. */
  claimEmail?: string | null;
  weightKg?: number | null;
  heightCm?: number | null;
}

export async function createEater(
  db: Db,
  householdId: string,
  input: MemberInput,
): Promise<Eater> {
  const { rows } = await db.query<Row>(
    `insert into eater (household_id, first_name, birth_date, sex, portion_coef,
                        diets, color, user_id, claim_email,
                        weight_kg, weight_recorded_at, height_cm)
     values ($1, $2, $3::date, $4, coalesce($5::numeric, 1.00),
             coalesce($6::text[], '{}'), $7, $8, lower($9),
             $10, case when $10::numeric is null then null else now() end, $11)
     returning ${COLUMNS}`,
    [
      householdId, input.firstName, input.birthDate, input.sex,
      input.portionCoef ?? null, input.diets ?? null, input.color ?? null,
      input.userId ?? null, input.claimEmail ?? null,
      input.weightKg ?? null, input.heightCm ?? null,
    ],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('membre non créé');
  return toEater(row);
}

export type MemberPatch = Partial<MemberInput> & { active?: boolean };

/**
 * Modifie un membre — y compris son `portion_coef`.
 *
 * R2 : **aucun repas passé n'est touché.** Les `share` ont été figés à
 * l'écriture de chaque repas ; un enfant qui grandit change ce qu'il mangera,
 * pas ce qu'il a mangé. Cette fonction n'écrit que dans `eater`, et c'est
 * volontairement tout ce qu'elle sait faire.
 */
export async function updateEater(
  db: Db,
  householdId: string,
  id: string,
  patch: MemberPatch,
): Promise<Eater | null> {
  const sets: string[] = [];
  const params: unknown[] = [householdId, id];
  const set = (column: string, value: unknown): void => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  if (patch.firstName !== undefined) set('first_name', patch.firstName);
  if (patch.birthDate !== undefined) set('birth_date', patch.birthDate);
  if (patch.sex !== undefined) set('sex', patch.sex);
  if (patch.portionCoef !== undefined) set('portion_coef', patch.portionCoef);
  if (patch.diets !== undefined) set('diets', patch.diets);
  if (patch.color !== undefined) set('color', patch.color);
  if (patch.active !== undefined) set('active', patch.active);
  if (patch.userId !== undefined) set('user_id', patch.userId);
  if (patch.claimEmail !== undefined) {
    params.push(patch.claimEmail);
    sets.push(`claim_email = lower($${params.length})`);
  }
  if (patch.heightCm !== undefined) set('height_cm', patch.heightCm);
  // La date de pesée suit le poids, et ne se saisit pas : un poids sans date
  // dérive en silence, et une date que le client choisirait ne dirait plus
  // quand la valeur a été écrite.
  if (patch.weightKg !== undefined) {
    params.push(patch.weightKg);
    sets.push(`weight_kg = $${params.length}`);
    sets.push(
      `weight_recorded_at = case when $${params.length}::numeric is null then null else now() end`,
    );
  }

  if (sets.length === 0) {
    const [existing] = await findMembers(db, householdId, [id]);
    return existing ?? null;
  }

  const { rows } = await db.query<Row>(
    `update eater set ${sets.join(', ')}
     where household_id = $1 and id = $2
     returning ${COLUMNS}`,
    params,
  );
  const row = rows[0];
  return row === undefined ? null : toEater(row);
}

/**
 * Rattache à `userId` l'assiette que ce foyer lui réservait, s'il y en a une.
 *
 * C'est le geste attendu de « je saisis ma femme aujourd'hui, elle s'inscrit
 * dans trois semaines » : le parent pose `claim_email` en créant l'assiette,
 * et l'acceptation de l'invitation passe ici.
 *
 * Trois précautions, toutes dans le `where` :
 *
 * - `user_id is null` — on ne vole pas une assiette déjà rattachée ;
 * - le `not exists` — un compte qui a déjà son assiette dans ce foyer n'en
 *   reçoit pas une seconde. Sans lui, un aller-retour « je quitte le foyer, on
 *   me réinvite » violerait `eater_un_compte_par_foyer` et ferait échouer
 *   l'acceptation de l'invitation, ce qui est bien pire que de ne pas
 *   rattacher ;
 * - l'unicité de `(household_id, lower(claim_email))`, posée par la 009,
 *   garantit qu'au plus une ligne correspond. Le rattachement n'a donc jamais
 *   à choisir.
 *
 * Idempotent : rejouer ne rattache rien de plus.
 */
export async function claimEatersForUser(
  db: Db,
  householdId: string,
  userId: string,
  email: string,
): Promise<Eater | null> {
  const { rows } = await db.query<Row>(
    `update eater
        set user_id = $2, claim_email = null
      where household_id = $1
        and user_id is null
        and claim_email = lower($3)
        and not exists (
          select 1 from eater autre
           where autre.household_id = $1 and autre.user_id = $2
        )
     returning ${COLUMNS}`,
    [householdId, userId, email],
  );
  const row = rows[0];
  return row === undefined ? null : toEater(row);
}
