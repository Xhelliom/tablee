/**
 * Les pesées datées d'un majeur (029). Ce dépôt ne connaît pas l'âge : refuser
 * un mineur est le travail de la route, la base ne pouvant pas le dire.
 * Rien dans `server/llm/` ne doit importer ce fichier (I3).
 */
import type { HouseholdDb } from '../db.ts';

export interface WeightMeasure {
  /** `YYYY-MM-DD`. */
  day: string;
  weightKg: number;
}

export async function listWeights(
  db: HouseholdDb, householdId: string, eaterId: string,
): Promise<WeightMeasure[]> {
  const { rows } = await db.query<{ day: string; weight_kg: string }>(
    `select to_char(day, 'YYYY-MM-DD') as day, weight_kg from weight_measure
     where household_id = $1 and eater_id = $2 order by day`, [householdId, eaterId]);
  return rows.map((row) => ({ day: row.day, weightKg: Number(row.weight_kg) }));
}

/** `false` si le convive n'est pas de ce foyer. Le même jour, la pesée remplace la précédente. */
export async function recordWeight(
  db: HouseholdDb, householdId: string, eaterId: string, day: string, weightKg: number,
): Promise<boolean> {
  // Par l'eater, et pas par la clé étrangère seule : elle accepterait celui du voisin (dette n° 8).
  const { rows } = await db.query(
    `with e as (select id from eater where household_id = $1 and id = $2),
     ins as (insert into weight_measure (household_id, eater_id, day, weight_kg)
             select $1, id, $3, $4 from e
             on conflict (eater_id, day) do update set weight_kg = excluded.weight_kg)
     select 1 from e`, [householdId, eaterId, day, weightKg]);
  return rows.length === 1;
}

export async function deleteWeight(
  db: HouseholdDb, householdId: string, eaterId: string, day: string,
): Promise<void> {
  await db.query('delete from weight_measure where household_id = $1 and eater_id = $2 and day = $3',
    [householdId, eaterId, day]);
}

/** Toutes les pesées d'un convive : le filet d'une date corrigée qui le rend mineur. */
export async function deleteAllWeights(
  db: HouseholdDb, householdId: string, eaterId: string,
): Promise<void> {
  await db.query('delete from weight_measure where household_id = $1 and eater_id = $2',
    [householdId, eaterId]);
}
