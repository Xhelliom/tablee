/**
 * §11 — `bilanJournalier`.
 *
 * Ce que chaque personne a consommé dans la journée, exprimé en **pourcentage
 * du repère du jour** (R3) et jamais en grammes bruts : « 18 g de fibres » ne
 * dit rien à personne, « 62 % du repère » se lit d'un coup.
 *
 * Trois états possibles par barre, et il faut les trois :
 *
 *   `disponible`   la valeur est connue pour tous les repas de la journée
 *   `partiel`      un repas au moins n'a pas cette valeur → minorant, signalé
 *   `indisponible` rien de connu → pas de barre, pas de zéro
 *
 * et, orthogonalement, un repère peut manquer (§9) : la barre existe alors
 * sans pourcentage. On ne remplace jamais un repère absent par celui de la
 * tranche d'âge voisine.
 */
import { NUTRIENTS, type Macros, type Nutrient } from './compute.ts';
import { findReference, type NutrientReference, type ReferenceTable } from './references.ts';

export type BarState = 'disponible' | 'partiel' | 'indisponible';

export interface NutrientBar {
  nutrient: Nutrient;
  state: BarState;
  /** Quantité consommée, en grammes (kcal pour l'énergie). `null` si rien n'est connu. */
  consumed: number | null;
  /** Repas de la journée qui ne publient pas cette valeur. */
  missingMeals: number;
  /** `null` quand la tranche d'âge n'est couverte par aucune source (§9). */
  reference: NutrientReference | null;
  /** % du repère du jour. `null` dès que le repère ou la valeur manque. */
  percent: number | null;
}

/**
 * La barre « Végétal » n'a **pas** de repère chiffré (§8). Elle montre la
 * valeur du jour et la moyenne des sept derniers jours du foyer : une
 * tendance, pas un objectif (R7, I5).
 */
export interface PlantBar {
  state: BarState;
  /** Part végétale du jour, 0-100. */
  percent: number | null;
  /** Part des grammes du jour dont l'origine est connue, 0-100. */
  coverage: number | null;
  /** Moyenne du foyer sur 7 jours, fournie par l'appelant. `null` si inconnue. */
  householdAverage7d: number | null;
}

/** Un repas de la journée, vu depuis une personne. */
export interface DailyMeal extends Macros {
  /** Part figée à l'écriture (R2). */
  share: number;
  gramsTotal: number | null;
  gramsPlant: number | null;
  gramsClassified: number | null;
}

export interface DailyBalance {
  bars: NutrientBar[];
  plant: PlantBar;
  mealCount: number;
}

export interface BalanceInput {
  sex: 'F' | 'M';
  age: number;
  meals: DailyMeal[];
  references: ReferenceTable[];
  householdPlantAverage7d?: number | null;
}

export function bilanJournalier(input: BalanceInput): DailyBalance {
  const bars = NUTRIENTS.map((nutrient) => bar(nutrient, input));
  return {
    bars,
    plant: plantBar(input),
    mealCount: input.meals.length,
  };
}

function bar(nutrient: Nutrient, input: BalanceInput): NutrientBar {
  let consumed: number | null = null;
  let missingMeals = 0;

  for (const meal of input.meals) {
    const value = meal[nutrient];
    if (value === null) {
      missingMeals += 1;
      continue;
    }
    consumed = (consumed ?? 0) + value * meal.share;
  }

  const reference = findReference(input.references, input.sex, input.age, nutrient);
  const state: BarState =
    consumed === null ? 'indisponible' : missingMeals > 0 ? 'partiel' : 'disponible';

  // Pas de repère → pas de pourcentage. Pas de valeur → pas de pourcentage non
  // plus : un 0 % serait lu comme « n'a rien mangé », pas comme « on ne sait
  // pas ».
  const percent =
    reference === null || consumed === null
      ? null
      : Math.round((consumed / reference.value) * 1000) / 10;

  return {
    nutrient,
    state,
    consumed: consumed === null ? null : Math.round(consumed * 100) / 100,
    missingMeals,
    reference,
    percent,
  };
}

/**
 * Part végétale de la journée : rapport des grammes, pas moyenne des
 * pourcentages. Deux repas dont l'un pèse dix fois l'autre ne pèsent pas
 * pareil dans la journée, et faire la moyenne de leurs pourcentages donnerait
 * un chiffre que rien ne mesure.
 *
 * Les grammes sont pondérés par la `share` : c'est bien ce que la personne a
 * eu dans son assiette, pas ce qui était sur la table.
 */
function plantBar(input: BalanceInput): PlantBar {
  let total = 0;
  let plant = 0;
  let classified = 0;
  let known = 0;

  for (const meal of input.meals) {
    if (meal.gramsTotal === null) continue;
    known += 1;
    total += meal.gramsTotal * meal.share;
    plant += (meal.gramsPlant ?? 0) * meal.share;
    classified += (meal.gramsClassified ?? 0) * meal.share;
  }

  const average = input.householdPlantAverage7d ?? null;

  // Aucun gramme classé : « 0 % végétal » serait faux, pas prudent.
  if (total === 0 || classified === 0) {
    return {
      state: 'indisponible',
      percent: null,
      coverage: total === 0 ? null : 0,
      householdAverage7d: average,
    };
  }

  return {
    state: known < input.meals.length || classified < total ? 'partiel' : 'disponible',
    percent: Math.round((plant / total) * 1000) / 10,
    coverage: Math.round((classified / total) * 1000) / 10,
    householdAverage7d: average,
  };
}
