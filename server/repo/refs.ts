/**
 * Les trois tables de référence **livrées vides** (§17) : `unit_default`,
 * `nutrient_reference`, `seasonal_produce`.
 *
 * Ce module les lit. Il n'en écrit aucune ligne, et aucun script de ce dépôt
 * ne les remplit : chacune demande une collecte — une source d'équivalences
 * pour les unités, l'ANSES pour les repères, une saisie manuelle pour la
 * saisonnalité. Une valeur inventée à leur place serait pire que leur
 * absence (I1).
 *
 * Le code alentour est écrit pour fonctionner **avec ces tables vides** :
 * l'unité non convertible déclenche une question, le repère absent donne une
 * barre « indisponible », la bande de saison ne s'affiche pas. Ce sont des
 * états nominaux.
 */
import type { Db } from '../db.ts';
import type { ReferenceTable } from '../nutrition/references.ts';
import type { UnitDefaults } from '../nutrition/units.ts';
import { normalizeUnit } from '../nutrition/units.ts';

export async function loadUnitDefaults(db: Db): Promise<UnitDefaults> {
  const { rows } = await db.query<{ unit: string; grams: number; source: string }>(
    'select unit, grams, source from unit_default',
  );
  return new Map(rows.map((r) => [normalizeUnit(r.unit), { grams: r.grams, source: r.source }]));
}

export async function loadReferences(db: Db): Promise<ReferenceTable[]> {
  const { rows } = await db.query<{
    sex: 'F' | 'M' | 'ALL'; age_min: number; age_max: number;
    nutrient: string; value: number; unit: string; source: string;
  }>('select sex, age_min, age_max, nutrient, value, unit, source from nutrient_reference');
  return rows.map((r) => ({
    sex: r.sex, ageMin: r.age_min, ageMax: r.age_max,
    nutrient: r.nutrient, value: r.value, unit: r.unit, source: r.source,
  }));
}

export interface SeasonalProduce {
  id: string;
  name: string;
  kind: 'legume' | 'fruit';
  months: number[];
  foodId: string | null;
  /** Le produit a-t-il été mangé par le foyer ce mois-ci ? */
  eatenThisMonth: boolean;
  /** Dernier mois de la saison, quand elle se termine bientôt. */
  lastMonth: number;
}

/**
 * Produits de saison du mois, marqués de ce que le foyer a déjà mangé (§8bis).
 *
 * Le marquage passe par `seasonal_produce.food_id` : sans rattachement à un
 * aliment du référentiel, un produit ne peut pas être coché. C'est voulu —
 * rapprocher « Courgette » d'un libellé de repas par ressemblance de chaîne
 * produirait des coches fausses, et une coche fausse dans un jeu le ruine.
 */
export async function seasonalForMonth(
  db: Db,
  householdId: string,
  month: number,
): Promise<SeasonalProduce[]> {
  const { rows } = await db.query<{
    id: string; name: string; kind: 'legume' | 'fruit'; months: number[];
    food_id: string | null; eaten: boolean;
  }>(
    `select sp.id, sp.name, sp.kind, sp.months, sp.food_id,
            exists (
              select 1
              from meal_item mi
              join meal m on m.id = mi.meal_id
              where m.household_id = $1
                and mi.food_id = sp.food_id
                and date_trunc('month', m.eaten_at) = date_trunc('month', now())
            ) as eaten
     from seasonal_produce sp
     where $2 = any(sp.months)
     order by sp.kind, sp.name`,
    [householdId, month],
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    months: r.months,
    foodId: r.food_id,
    eatenThisMonth: r.eaten,
    lastMonth: lastMonthOfSeason(r.months, month),
  }));
}

/**
 * Dernier mois consécutif de la saison en cours. Sert la ligne d'urgence de
 * l'accueil (« le raisin part fin octobre »), qui transforme un catalogue en
 * fenêtre qui se ferme.
 *
 * Les saisons passent l'hiver (`[11,12,1,2]`) : on avance de mois en mois en
 * bouclant sur 12, plutôt que de prendre le maximum du tableau.
 */
export function lastMonthOfSeason(months: number[], current: number): number {
  const set = new Set(months);
  let month = current;
  for (let step = 0; step < 12; step += 1) {
    const next = (month % 12) + 1;
    if (!set.has(next)) break;
    month = next;
  }
  return month;
}
