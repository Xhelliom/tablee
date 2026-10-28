/**
 * Les journées marquées complètes (028) : « tout ce que ce convive a mangé ce
 * jour-là est saisi ». Une information sur la saisie, jamais un compte affiché.
 */
import type { HouseholdDb } from '../db.ts';

/** `false` si le convive n'est pas de ce foyer. Marquer deux fois ne change rien. */
export async function markDayComplete(
  db: HouseholdDb, householdId: string, eaterId: string, day: string,
): Promise<boolean> {
  // Par l'eater, et pas par la clé étrangère seule : elle accepterait celui du voisin (dette n° 8).
  const { rows } = await db.query(
    `with e as (select id from eater where household_id = $1 and id = $2),
     ins as (insert into day_complete (household_id, eater_id, day)
             select $1, id, $3 from e on conflict do nothing)
     select 1 from e`, [householdId, eaterId, day]);
  return rows.length === 1;
}

export async function unmarkDayComplete(
  db: HouseholdDb, householdId: string, eaterId: string, day: string,
): Promise<void> {
  await db.query('delete from day_complete where household_id = $1 and eater_id = $2 and day = $3',
    [householdId, eaterId, day]);
}

/** Les journées complètes de `from` à `to` inclus, en clés `"AAAA-MM-JJ eaterId"`. */
export async function completeDays(
  db: HouseholdDb, householdId: string, from: string, to: string,
): Promise<Set<string>> {
  const { rows } = await db.query<{ key: string }>(
    `select to_char(day, 'YYYY-MM-DD') || ' ' || eater_id as key from day_complete
     where household_id = $1 and day between $2 and $3`, [householdId, from, to]);
  return new Set(rows.map((row) => row.key));
}
