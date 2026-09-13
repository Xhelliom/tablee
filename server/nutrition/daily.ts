/**
 * §11 — `bilanJournalier`.
 *
 * Ce que chaque personne a consommé dans la journée, exprimé en **pourcentage
 * du repère du jour** (R3) et jamais en grammes bruts : « 18 g de fibres » ne
 * dit rien à personne, « 62 % du repère » se lit d'un coup.
 *
 * Quatre états par barre, et il faut les quatre — ils ne disent pas la même
 * chose et se ressembleraient tous à un chiffre unique :
 *
 *   `disponible`   valeur exacte
 *   `encadre`      la source ne donne qu'un intervalle (« < 0,5 g » chez
 *                  Ciqual) → « entre X et Y »
 *   `partiel`      un aliment ou un repas échappe au référentiel → « au
 *                  moins X », le total ne peut que monter
 *   `indisponible` rien de connu → pas de barre, surtout pas un zéro
 *
 * et, orthogonalement, un repère peut manquer (§9) : la barre existe alors
 * sans pourcentage. On ne remplace jamais un repère absent par celui de la
 * tranche d'âge voisine.
 */
import { NUTRIENTS, type Macros, type Nutrient } from './compute.ts';
import {
  findCeiling, findEnergyShareRange, findReference,
  type NutrientReference, type ReferenceTable,
} from './references.ts';

export type BarState = 'disponible' | 'encadre' | 'partiel' | 'indisponible';

/**
 * Où en est la journée par rapport au repère. C'est ce que la barre doit dire
 * d'un coup d'œil : ce qui manque, ce qui est atteint, ce qui est dépassé.
 */
export type Standing = 'sous' | 'dans' | 'au_dela';

export interface NutrientBar {
  nutrient: Nutrient;
  state: BarState;
  /** Borne basse consommée, en grammes (kcal pour l'énergie). */
  consumed: number | null;
  /** Borne haute. `null` quand rien ne la borne. */
  consumedMax: number | null;
  /** Repas de la journée qui ne publient pas cette valeur. */
  missingMeals: number;
  /**
   * La cible du jour, à atteindre. `null` quand la tranche d'âge n'est
   * couverte par aucune source (§9).
   */
  reference: NutrientReference | null;
  /**
   * Le plafond, quand la source publie un intervalle. `null` pour les fibres,
   * dont le repère est un apport satisfaisant : rien à dépasser.
   */
  referenceMax: NutrientReference | null;
  /** % du repère du jour, borne basse. `null` dès que le repère manque. */
  percent: number | null;
  /** % du repère du jour, borne haute. */
  percentMax: number | null;
  /** Grammes restants pour atteindre la cible. `0` une fois atteinte. */
  remaining: number | null;
  /** Grammes au-delà du plafond. `null` tant qu'il n'est pas dépassé. */
  excess: number | null;
  standing: Standing | null;
  /**
   * L'intervalle publié par l'ANSES, en pourcentage de l'apport énergétique,
   * quand la cible en grammes en découle. Sert à expliquer d'où vient le
   * repère — « 10 à 20 % de l'énergie de la journée » — sans citer de calories.
   */
  energyShare: { min: number | null; max: number | null } | null;
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
  /** Bornes hautes du repas. */
  max?: Macros | undefined;
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
  let floor = 0;
  let ceiling = 0;
  let informed = 0;
  let missingMeals = 0;
  let unbounded = false;

  for (const meal of input.meals) {
    const low = meal[nutrient];
    // `max` absent = repas écrit avant l'encadrement, donc exact. `max` présent
    // avec un nutriment à `null` = borne haute **volontairement** absente. Les
    // confondre ferait passer pour exact un total qui ne peut que monter.
    const high = meal.max === undefined ? low : meal.max[nutrient];

    if (low === null && high === null) {
      missingMeals += 1;
      // Le total ne peut que monter : on le dit plutôt que de tout jeter.
      unbounded = true;
      continue;
    }
    informed += 1;
    floor += (low ?? 0) * meal.share;
    if (high === null) unbounded = true;
    else ceiling += high * meal.share;
  }

  const consumed = informed === 0 ? null : round(floor);
  const consumedMax = informed === 0 || unbounded ? null : round(ceiling);

  const reference = findReference(input.references, input.sex, input.age, nutrient);
  const referenceMax = findCeiling(input.references, input.sex, input.age, nutrient);

  const state: BarState =
    consumed === null
      ? 'indisponible'
      : consumedMax === null
        ? 'partiel'
        : consumedMax > consumed
          ? 'encadre'
          : 'disponible';

  // Pas de repère → pas de pourcentage. Pas de valeur → pas de pourcentage non
  // plus : un 0 % serait lu comme « n'a rien mangé », pas comme « on ne sait
  // pas ».
  const percent = percentOf(consumed, reference);
  const percentMax = percentOf(consumedMax, reference);

  return {
    nutrient,
    state,
    consumed,
    consumedMax,
    missingMeals,
    reference,
    referenceMax,
    percent,
    percentMax,
    ...position(consumed, reference, referenceMax),
    energyShare: share(findEnergyShareRange(input.references, input.sex, input.age, nutrient)),
  };
}

function share(
  range: { min: number | null; max: number | null; source: string } | null,
): { min: number | null; max: number | null } | null {
  return range === null ? null : { min: range.min, max: range.max };
}

/**
 * Ce qui manque, ce qui est dépassé, et où on en est.
 *
 * Le manque se compte sur la **borne basse** de ce qui a été mangé : c'est un
 * minorant de la consommation, donc un majorant de ce qui reste — on ne
 * promet pas d'avoir fini alors qu'on n'en sait rien.
 *
 * Le dépassement, lui, ne se déclare que si la borne basse elle-même passe le
 * plafond. Annoncer « tu as dépassé » sur une incertitude serait un reproche
 * adressé à quelqu'un qui n'a peut-être rien dépassé du tout (R7).
 */
function position(
  consumed: number | null,
  reference: NutrientReference | null,
  referenceMax: NutrientReference | null,
): { remaining: number | null; excess: number | null; standing: Standing | null } {
  if (consumed === null || reference === null) {
    return { remaining: null, excess: null, standing: null };
  }

  const remaining = Math.max(0, round(reference.value - consumed));
  const over = referenceMax !== null && consumed > referenceMax.value;

  return {
    remaining,
    excess: over ? round(consumed - (referenceMax as NutrientReference).value) : null,
    standing: over ? 'au_dela' : remaining > 0 ? 'sous' : 'dans',
  };
}

function percentOf(value: number | null, reference: NutrientReference | null): number | null {
  if (value === null || reference === null || reference.value === 0) return null;
  return Math.round((value / reference.value) * 1000) / 10;
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

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
