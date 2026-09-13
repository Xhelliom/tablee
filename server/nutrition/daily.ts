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
  /** Tous les grammes de la journée, y compris ceux des repas écartés. */
  let allGrams = 0;
  let counted = 0;

  for (const meal of input.meals) {
    if (meal.gramsTotal === null) continue;
    const grams = meal.gramsTotal * meal.share;
    allGrams += grams;

    // Un repas dont **aucun** gramme n'est classé n'a pas de part végétale du
    // tout (§11 : « jamais 0 par défaut »). Le compter au dénominateur
    // reviendrait à le traiter comme entièrement non végétal, c'est-à-dire à
    // réintroduire à l'échelle de la journée le zéro qu'on vient de refuser à
    // l'échelle du repas. C'est le cas courant d'un repas Jow dont les
    // ingrédients ne sont pas encore rattachés à Ciqual.
    if ((meal.gramsClassified ?? 0) === 0) continue;

    counted += 1;
    total += grams;
    plant += (meal.gramsPlant ?? 0) * meal.share;
    classified += (meal.gramsClassified ?? 0) * meal.share;
  }

  const average = input.householdPlantAverage7d ?? null;
  // Part des grammes de la journée dont l'origine est connue — y compris ceux
  // des repas écartés, sans quoi la couverture dirait 100 % d'un jour dont on
  // ignore l'essentiel.
  const coverage = allGrams === 0 ? null : Math.round((classified / allGrams) * 1000) / 10;

  if (total === 0) {
    return { state: 'indisponible', percent: null, coverage, householdAverage7d: average };
  }

  return {
    state: counted < input.meals.length || classified < total ? 'partiel' : 'disponible',
    percent: Math.round((plant / total) * 1000) / 10,
    coverage,
    householdAverage7d: average,
  };
}
