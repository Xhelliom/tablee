/**
 * §11 — `calculerNutrition`. Exécuté **en applicatif** à chaque écriture ou
 * modification d'un repas, jamais en SQL : la résolution entre le snapshot
 * Jow et la somme des items est trop tordue à exprimer en SQL, et un calcul
 * dispersé dans des vues finirait par diverger du calcul de l'API.
 *
 * Deux règles gouvernent tout ce fichier :
 *
 * - **Une valeur inconnue est `null`, jamais `0`.** Un nutriment que l'on ne
 *   sait pas sommer ressort `null`, avec un warning qui nomme l'aliment
 *   fautif. Additionner en traitant les trous comme des zéros produirait un
 *   total plausible et sous-estimé, c'est-à-dire un chiffre faux affiché sans
 *   avertissement (I1).
 * - **Toute estimation porte un `confidence` affiché** (R6).
 */
import type { Confidence } from '../jow/types.ts';
import { resolveUnit, type UnitDefaults, type UnitSource } from './units.ts';

export type { Confidence };

/** Les cinq colonnes de `meal_nutrition` calculées par sommation. */
export const NUTRIENTS = ['kcal', 'proteinG', 'carbG', 'fatG', 'fiberG'] as const;
export type Nutrient = (typeof NUTRIENTS)[number];

export type Macros = Record<Nutrient, number | null>;

/** Un aliment de `food`, réduit à ce dont le calcul a besoin. */
export interface FoodValues extends UnitSource {
  name: string;
  /** `null` = non classé, jamais « pas végétal » (§10). */
  plantBased: boolean | null;
  per100g: Macros;
}

export interface NutritionItem {
  label: string;
  /** `null` tant que l'aliment n'est pas rattaché au référentiel. */
  food: FoodValues | null;
  quantity: number | null;
  unit: string | null;
  /** Grammes déjà résolus et stockés. `null` → à résoudre ici. */
  quantityG: number | null;
}

/** Snapshot Jow figé à la capture — valeurs **par portion**. */
export interface RecipeSnapshot {
  perServing: Macros;
  confidence: Confidence;
}

export interface MealInput {
  /** Parts préparées. Le snapshot Jow est par portion : il se multiplie. */
  servings: number;
  source: 'jow' | 'texte' | 'photo' | 'template' | 'manuel';
  recipe: RecipeSnapshot | null;
  /** Items hors-Jow, ou ajustements. */
  items: NutritionItem[];
  /**
   * Ingrédients de la recette, **par convive**. Ils ne servent qu'à la part
   * végétale : la nutrition d'un repas Jow vient du snapshot, pas de la somme
   * des ingrédients (§3 de `docs/jow-contract.md`).
   */
  recipeIngredients?: NutritionItem[];
}

export interface ResolvedItem extends NutritionItem {
  /** Grammes résolus par §6, ou `null` si l'unité reste à préciser. */
  quantityG: number | null;
  /** Message à afficher quand la résolution a échoué. */
  unresolved: string | null;
}

export interface MealNutrition extends Macros {
  /** 0-100, ou `null` si aucun gramme du repas n'est classé. */
  plantRatio: number | null;
  /** Grammes dont la quantité est connue — dénominateur du §8. */
  gramsTotal: number | null;
  /** Grammes issus d'aliments `plant_based = true`. */
  gramsPlant: number | null;
  /** Grammes dont l'origine est connue, végétale **ou** animale. */
  gramsClassified: number | null;
  confidence: Confidence;
  /** Destinés à être affichés, pas seulement loggués (§6 du contrat Jow). */
  warnings: string[];
  /** Items enrichis de leur `quantity_g`, à réécrire en base. */
  items: ResolvedItem[];
}

const RANK: Record<Confidence, number> = { haute: 3, moyenne: 2, basse: 1 };
const worst = (a: Confidence, b: Confidence): Confidence => (RANK[a] <= RANK[b] ? a : b);

const EMPTY: Macros = { kcal: null, proteinG: null, carbG: null, fatG: null, fiberG: null };

export function calculerNutrition(meal: MealInput, defaults: UnitDefaults): MealNutrition {
  const warnings: string[] = [];
  const servings = Number.isFinite(meal.servings) && meal.servings > 0 ? meal.servings : 1;
  if (servings !== meal.servings) {
    warnings.push('nombre de parts invalide, 1 part retenue');
  }

  const items = meal.items.map((item) => resolve(item, defaults, warnings));

  let macros: Macros;
  let confidence: Confidence;

  const snapshot = meal.recipe;
  if (snapshot !== null && NUTRIENTS.some((n) => snapshot.perServing[n] !== null)) {
    // Le snapshot Jow l'emporte : il est publié par portion et vérifié, là où
    // la somme des ingrédients dépend d'unités que `unit_default` ne sait pas
    // encore convertir. Un nutriment absent du snapshot reste absent — on ne
    // va pas le chercher ailleurs, les deux bases ne sont pas comparables.
    macros = scale(snapshot.perServing, servings);
    confidence = snapshot.confidence;
    const partial = NUTRIENTS.filter((n) => snapshot.perServing[n] === null);
    if (partial.length > 0) {
      warnings.push(`${partial.length} valeur(s) nutritionnelle(s) absente(s) de la recette`);
      confidence = worst(confidence, 'moyenne');
    }
    if (meal.items.length > 0) {
      warnings.push(
        'les valeurs viennent de la recette ; les items ajoutés ne sont pas comptés dans les totaux',
      );
    }
  } else {
    const summed = sum(items, warnings);
    macros = summed.macros;
    confidence = summed.confidence;
    if (snapshot !== null) {
      warnings.push('la recette ne publie aucune valeur nutritionnelle');
    }
  }

  // Une photo ne donne ni quantité ni composition : quoi qu'on en tire, c'est
  // une estimation (§5 de la spec).
  if (meal.source === 'photo') confidence = 'basse';

  const plant = plantRatio(meal, items, servings, warnings);

  return { ...macros, ...plant, confidence, warnings, items };
}

function resolve(item: NutritionItem, defaults: UnitDefaults, warnings: string[]): ResolvedItem {
  if (item.quantityG !== null) return { ...item, unresolved: null };

  const resolution = resolveUnit(item.quantity, item.unit, item.food, defaults);
  if (resolution.resolved) {
    return { ...item, quantityG: resolution.grams, unresolved: null };
  }
  warnings.push(`« ${item.label} » : ${resolution.reason}`);
  return { ...item, quantityG: null, unresolved: resolution.reason };
}

/**
 * Somme les items. Un nutriment dont **un seul** item contributeur ignore la
 * valeur ressort `null` pour tout le repas : le total partiel serait
 * sous-estimé sans que rien ne le dise, et c'est précisément la valeur
 * plausible et fausse qu'interdit I1. Le warning nomme l'aliment en cause,
 * pour que la correction soit possible.
 */
function sum(items: ResolvedItem[], warnings: string[]): { macros: Macros; confidence: Confidence } {
  const totals: Macros = { ...EMPTY };
  const unknown: Record<Nutrient, string[]> = {
    kcal: [], proteinG: [], carbG: [], fatG: [], fiberG: [],
  };
  let confidence: Confidence = 'haute';
  let counted = 0;

  for (const item of items) {
    if (item.food === null) {
      warnings.push(`« ${item.label} » : aliment non rattaché au référentiel, non compté`);
      confidence = 'basse';
      continue;
    }
    if (item.quantityG === null) {
      // Le warning a déjà été posé par `resolve`.
      confidence = 'basse';
      continue;
    }

    counted += 1;
    const ratio = item.quantityG / 100;
    for (const nutrient of NUTRIENTS) {
      const per100 = item.food.per100g[nutrient];
      if (per100 === null) {
        unknown[nutrient].push(item.food.name);
        continue;
      }
      totals[nutrient] = (totals[nutrient] ?? 0) + per100 * ratio;
    }
  }

  if (counted === 0) {
    // Aucun item exploitable : le repas n'a pas de valeurs, il n'en a pas zéro.
    return { macros: { ...EMPTY }, confidence: 'basse' };
  }

  for (const nutrient of NUTRIENTS) {
    const missing = unknown[nutrient];
    if (missing.length === 0) {
      totals[nutrient] = round(totals[nutrient]);
      continue;
    }
    totals[nutrient] = null;
    warnings.push(
      `${LABELS[nutrient]} : valeur inconnue pour ${missing.join(', ')} — total indisponible`,
    );
  }

  return { macros: totals, confidence };
}

const LABELS: Record<Nutrient, string> = {
  kcal: 'énergie',
  proteinG: 'protéines',
  carbG: 'glucides',
  fatG: 'lipides',
  fiberG: 'fibres',
};

/**
 * §8 — part végétale.
 *
 * ```
 * végétal_% = Σ(quantity_g où plant_based) / Σ(quantity_g connus) × 100
 * ```
 *
 * Deux précisions que le pseudo-code laisse implicites :
 *
 * - Les grammes dont l'origine n'est **pas classée** restent au dénominateur,
 *   comme le veut le §11. Une part végétale peut donc être sous-estimée ;
 *   `gramsClassified` dit sur quelle fraction du repas elle est calculée, pour
 *   que l'écran puisse le montrer.
 * - Si **aucun** gramme n'est classé, le résultat est `null` et non `0` — le
 *   pseudo-code dit « jamais 0 par défaut ». C'est le cas courant d'un repas
 *   Jow : ses ingrédients ne sont pas encore rattachés à Ciqual, et afficher
 *   « 0 % végétal » sur un gratin de courgettes serait faux.
 */
function plantRatio(
  meal: MealInput,
  items: ResolvedItem[],
  servings: number,
  warnings: string[],
): Pick<MealNutrition, 'plantRatio' | 'gramsTotal' | 'gramsPlant' | 'gramsClassified'> {
  // Les ingrédients Jow sont donnés **par convive** : c'est le seul endroit où
  // `servings` les met à l'échelle (§3 du contrat Jow).
  const fromRecipe = (meal.recipeIngredients ?? []).map((ingredient) => ({
    ...ingredient,
    quantityG: ingredient.quantityG === null ? null : ingredient.quantityG * servings,
  }));
  const all = [...fromRecipe, ...items];

  let total = 0;
  let plant = 0;
  let classified = 0;
  for (const item of all) {
    if (item.quantityG === null) continue;
    total += item.quantityG;
    const origin = item.food?.plantBased;
    if (origin === true) {
      plant += item.quantityG;
      classified += item.quantityG;
    } else if (origin === false) {
      classified += item.quantityG;
    }
  }

  if (total === 0) {
    return { plantRatio: null, gramsTotal: null, gramsPlant: null, gramsClassified: null };
  }
  if (classified === 0) {
    warnings.push(
      'part végétale indisponible : aucun aliment du repas n’est rattaché au référentiel',
    );
    return {
      plantRatio: null,
      gramsTotal: round(total),
      gramsPlant: 0,
      gramsClassified: 0,
    };
  }
  if (classified < total) {
    const share = Math.round((classified / total) * 100);
    warnings.push(`part végétale calculée sur ${share} % du repas seulement`);
  }

  return {
    plantRatio: round((plant / total) * 100),
    gramsTotal: round(total),
    gramsPlant: round(plant),
    gramsClassified: round(classified),
  };
}

function scale(macros: Macros, factor: number): Macros {
  const out: Macros = { ...EMPTY };
  for (const nutrient of NUTRIENTS) {
    const value = macros[nutrient];
    out[nutrient] = value === null ? null : round(value * factor);
  }
  return out;
}

function round(n: number | null): number | null {
  return n === null ? null : Math.round(n * 100) / 100;
}
