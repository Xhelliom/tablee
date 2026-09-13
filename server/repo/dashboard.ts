/**
 * Lecture agrégée pour l'accueil et la vue semaine.
 *
 * Les jours sont découpés dans le **fuseau du foyer** (`household.timezone`) :
 * un dîner à 22 h 30 heure de Paris appartient à la journée de Paris, pas à
 * celle d'UTC. Se tromper là-dessus déplace un repas sur deux dans l'année.
 */
import type { Db } from '../db.ts';
import { todayIn } from '../http/tz.ts';
import type { DailyMeal } from '../nutrition/daily.ts';

export async function householdTimezone(db: Db, householdId: string): Promise<string> {
  const { rows } = await db.query<{ timezone: string }>(
    'select timezone from household where id = $1',
    [householdId],
  );
  return rows[0]?.timezone ?? 'Europe/Paris';
}

/**
 * Le mois en cours **chez le foyer**. Les badges de saisonnalité s'y réfèrent :
 * calculés à l'heure du serveur, ils basculeraient jusqu'à deux heures trop
 * tôt le dernier jour d'un mois.
 */
export async function currentMonth(
  db: Db,
  householdId: string,
): Promise<{ year: number; month: number }> {
  const today = todayIn(await householdTimezone(db, householdId));
  return { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
}

export interface DayMealForMember extends DailyMeal {
  mealId: string;
  eaterId: string;
}

/**
 * Les repas d'une journée, vus depuis chaque membre, avec la part qui lui a
 * été attribuée à l'écriture (R2 — on relit `share`, on ne le recalcule pas).
 */
export async function mealsForDay(
  db: Db,
  householdId: string,
  date: string,
  timezone: string,
): Promise<DayMealForMember[]> {
  const { rows } = await db.query<{
    meal_id: string; eater_id: string; share: number;
    kcal: number | null; protein_g: number | null; carb_g: number | null;
    fat_g: number | null; fiber_g: number | null;
    kcal_max: number | null; protein_g_max: number | null; carb_g_max: number | null;
    fat_g_max: number | null; fiber_g_max: number | null;
    grams_total: number | null; grams_plant: number | null; grams_classified: number | null;
  }>(
    `select m.id as meal_id, mp.eater_id, mp.share,
            n.kcal, n.protein_g, n.carb_g, n.fat_g, n.fiber_g,
            n.kcal_max, n.protein_g_max, n.carb_g_max, n.fat_g_max, n.fiber_g_max,
            n.grams_total, n.grams_plant, n.grams_classified
     from meal m
     join meal_participant mp on mp.meal_id = m.id
     left join meal_nutrition n on n.meal_id = m.id
     where m.household_id = $1
       and (m.eaten_at at time zone $3)::date = $2::date
     order by m.eaten_at`,
    [householdId, date, timezone],
  );

  return rows.map((r) => ({
    mealId: r.meal_id,
    eaterId: r.eater_id,
    share: r.share,
    kcal: r.kcal, proteinG: r.protein_g, carbG: r.carb_g,
    fatG: r.fat_g, fiberG: r.fiber_g,
    max: {
      kcal: r.kcal_max, proteinG: r.protein_g_max, carbG: r.carb_g_max,
      fatG: r.fat_g_max, fiberG: r.fiber_g_max,
    },
    gramsTotal: r.grams_total, gramsPlant: r.grams_plant, gramsClassified: r.grams_classified,
  }));
}

/**
 * Part végétale moyenne du foyer sur les sept derniers jours (§8).
 *
 * Rapport des grammes, pas moyenne des `plant_ratio` : un repas de 100 g et un
 * repas de 1 kg ne pèsent pas pareil. `null` si rien n'est mesurable — jamais
 * 0, qui se lirait « le foyer n'a mangé aucun végétal ».
 */
export async function householdPlantAverage(
  db: Db,
  householdId: string,
  days = 7,
): Promise<number | null> {
  const { rows } = await db.query<{ plant: number | null; total: number | null }>(
    `select sum(n.grams_plant) as plant, sum(n.grams_total) as total
     from meal m
     join meal_nutrition n on n.meal_id = m.id
     where m.household_id = $1
       and m.eaten_at > now() - ($2 || ' days')::interval
       and n.grams_total is not null
       and coalesce(n.grams_classified, 0) > 0`,
    [householdId, String(days)],
  );
  const row = rows[0];
  if (row === undefined || row.total === null || row.total === 0 || row.plant === null) return null;
  return Math.round((row.plant / row.total) * 1000) / 10;
}

export interface WeekCell {
  date: string;
  eaterId: string;
  /** Nombre de repas de la journée pour cette personne. */
  meals: number;
  plantRatio: number | null;
}

/**
 * Grille de la vue semaine (V2) : 7 jours × membres.
 *
 * Un jour sans repas ne remonte pas de ligne — l'absence de ligne se lit
 * « rien de saisi », un 0 se lirait « rien mangé ».
 */
export async function weekGrid(
  db: Db,
  householdId: string,
  from: string,
  days: number,
  timezone: string,
): Promise<WeekCell[]> {
  const { rows } = await db.query<{
    date: string; eater_id: string; meals: number;
    plant: number | null; total: number | null; classified: number | null;
  }>(
    `select (m.eaten_at at time zone $4)::date::text as date,
            mp.eater_id,
            count(*)::int as meals,
            -- Même règle que bilanJournalier : un repas dont aucun gramme
            -- n'est classé est écarté du rapport, pas compté comme non
            -- végétal. Sinon la grille de la semaine et le bilan du jour
            -- donneraient deux chiffres différents pour la même journée.
            sum(n.grams_plant * mp.share)
              filter (where coalesce(n.grams_classified, 0) > 0) as plant,
            sum(n.grams_total * mp.share)
              filter (where coalesce(n.grams_classified, 0) > 0) as total,
            sum(n.grams_classified * mp.share) as classified
     from meal m
     join meal_participant mp on mp.meal_id = m.id
     left join meal_nutrition n on n.meal_id = m.id
     where m.household_id = $1
       and (m.eaten_at at time zone $4)::date >= $2::date
       and (m.eaten_at at time zone $4)::date < ($2::date + ($3 || ' days')::interval)
     group by 1, 2
     order by 1, 2`,
    [householdId, from, String(days), timezone],
  );

  return rows.map((r) => ({
    date: r.date,
    eaterId: r.eater_id,
    meals: r.meals,
    plantRatio:
      r.total === null || r.total === 0 || r.plant === null || (r.classified ?? 0) === 0
        ? null
        : Math.round((r.plant / r.total) * 1000) / 10,
  }));
}
