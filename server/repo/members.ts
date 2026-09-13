/**
 * Membres du foyer. Toutes les requêtes sont scopées au `household_id` de la
 * session : rien ici ne peut lire le foyer d'à côté.
 */
import type { Db } from '../db.ts';

export interface Member {
  id: string;
  firstName: string;
  /** `YYYY-MM-DD`. L'âge se calcule, il ne se stocke pas (§10). */
  birthDate: string;
  sex: 'F' | 'M';
  portionCoef: number;
  diets: string[];
  color: string | null;
  active: boolean;
}

interface Row {
  id: string; first_name: string; birth_date: string; sex: 'F' | 'M';
  portion_coef: number; diets: string[]; color: string | null; active: boolean;
}

const toMember = (row: Row): Member => ({
  id: row.id,
  firstName: row.first_name,
  birthDate: row.birth_date,
  sex: row.sex,
  portionCoef: row.portion_coef,
  diets: row.diets,
  color: row.color,
  active: row.active,
});

const SELECT = `
  select id, first_name, birth_date, sex, portion_coef, diets, color, active
  from member`;

export async function listMembers(
  db: Db,
  householdId: string,
  { includeInactive = false } = {},
): Promise<Member[]> {
  const { rows } = await db.query<Row>(
    `${SELECT} where household_id = $1 ${includeInactive ? '' : 'and active'}
     order by birth_date asc, first_name asc`,
    [householdId],
  );
  return rows.map(toMember);
}

export async function findMembers(db: Db, householdId: string, ids: string[]): Promise<Member[]> {
  if (ids.length === 0) return [];
  const { rows } = await db.query<Row>(
    `${SELECT} where household_id = $1 and id = any($2::uuid[])`,
    [householdId, ids],
  );
  return rows.map(toMember);
}

export interface MemberInput {
  firstName: string;
  birthDate: string;
  sex: 'F' | 'M';
  portionCoef?: number;
  diets?: string[];
  color?: string | null;
}

export async function createMember(
  db: Db,
  householdId: string,
  input: MemberInput,
): Promise<Member> {
  const { rows } = await db.query<Row>(
    `insert into member (household_id, first_name, birth_date, sex, portion_coef, diets, color)
     values ($1, $2, $3::date, $4, coalesce($5::numeric, 1.00), coalesce($6::text[], '{}'), $7)
     returning id, first_name, birth_date, sex, portion_coef, diets, color, active`,
    [
      householdId, input.firstName, input.birthDate, input.sex,
      input.portionCoef ?? null, input.diets ?? null, input.color ?? null,
    ],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('membre non créé');
  return toMember(row);
}

export type MemberPatch = Partial<MemberInput> & { active?: boolean };

/**
 * Modifie un membre — y compris son `portion_coef`.
 *
 * R2 : **aucun repas passé n'est touché.** Les `share` ont été figés à
 * l'écriture de chaque repas ; un enfant qui grandit change ce qu'il mangera,
 * pas ce qu'il a mangé. Cette fonction n'écrit que dans `member`, et c'est
 * volontairement tout ce qu'elle sait faire.
 */
export async function updateMember(
  db: Db,
  householdId: string,
  id: string,
  patch: MemberPatch,
): Promise<Member | null> {
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

  if (sets.length === 0) {
    const [existing] = await findMembers(db, householdId, [id]);
    return existing ?? null;
  }

  const { rows } = await db.query<Row>(
    `update member set ${sets.join(', ')}
     where household_id = $1 and id = $2
     returning id, first_name, birth_date, sex, portion_coef, diets, color, active`,
    params,
  );
  const row = rows[0];
  return row === undefined ? null : toMember(row);
}
