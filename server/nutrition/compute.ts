/**
 * §11 — `calculerNutrition`. Exécuté **en applicatif** à chaque écriture ou
 * modification d'un repas, jamais en SQL : la résolution entre le snapshot
 * Jow et la somme des items est trop tordue à exprimer en SQL, et un calcul
 * dispersé dans des vues finirait par diverger du calcul de l'API.
 *
 * ── Tout est un encadrement ─────────────────────────────────────────────────
 *
 * Un nutriment n'est pas un nombre mais un intervalle `[min ; max]`, parce que
 * les sources ne disent pas toutes la même chose :
 *
 *   Ciqual publie `12,5`      → `[12,5 ; 12,5]`, exact
 *   Ciqual publie `< 0,5`     → `[0 ; 0,5]`, majorant publié par la source
 *   Ciqual publie `traces`    → inconnu : « très faible » sans seuil chiffré
 *   l'aliment n'est pas connu → inconnu
 *
 * Sommer des intervalles donne un intervalle. Un repas peut donc valoir
 * « entre 82,9 et 83,4 g de lipides », ou « au moins 31 g de protéines » quand
 * un aliment échappe au référentiel — ce qui est à la fois vrai et utile, là
 * où l'ancien « valeur inconnue » jetait tout ce qu'on savait.
 *
 * Deux règles gouvernent le reste du fichier :
 *
 * - **On n'invente jamais une borne.** `traces` reste sans majorant : l'ANSES
 *   écrit « très faible » et ne donne pas de seuil (I1).
 * - **Toute estimation porte un `confidence` affiché** (R6).
 */
import type { Confidence } from '../jow/types.ts';
import type { MealSource } from '../repo/meals.ts';
import { resolveUnit, type UnitConfidence, type UnitDefaults, type UnitSource } from './units.ts';

export type { Confidence };

/** Les cinq colonnes de `meal_nutrition` calculées par sommation. */
export const NUTRIENTS = ['kcal', 'proteinG', 'carbG', 'fatG', 'fiberG'] as const;
export type Nutrient = (typeof NUTRIENTS)[number];

/** Bornes basses, ou valeurs exactes. `null` = rien de connu. */
export type Macros = Record<Nutrient, number | null>;

export const EMPTY_MACROS: Macros = {
  kcal: null, proteinG: null, carbG: null, fatG: null, fiberG: null,
};

/** Un aliment de `food`, réduit à ce dont le calcul a besoin. */
export interface FoodValues extends UnitSource {
  name: string;
  /** `null` = non classé, jamais « pas végétal » (§10). */
  plantBased: boolean | null;
  /** Bornes basses pour 100 g. */
  per100g: Macros;
  /** Bornes hautes pour 100 g. `null` = non bornée. */
  per100gMax?: Macros | undefined;
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

/**
 * Snapshot Jow figé à la capture — valeurs **par portion**, exactes. Jow ne
 * publie pas de majorants : une valeur est là, ou elle ne l'est pas.
 */
export interface RecipeSnapshot {
  perServing: Macros;
  confidence: Confidence;
}

export interface MealInput {
  /**
   * Parts **mangées à ce repas** — le snapshot Jow est par portion, il se
   * multiplie, et le total est ensuite réparti entre les convives présents
   * (§11). Ce n'est donc pas ce qui est sorti de la casserole : un plat pour 4
   * mangé à moitié vaut 2 ici, et le reste est un second repas le lendemain
   * (§6bis). L'écran disait « parts préparées », ce qui invitait à compter des
   * portions que personne n'avait mangées — corrigé le 14/09/2026.
   */
  servings: number;
  /**
   * Parts laissées dans le plat (§6bis, 15/09/2026). Les items décrivent ce
   * qui a été **servi** — la pizza entière — et seule la part mangée compte :
   * `servings / (servings + remainingServings)`. Absent ou `null` : tout a été
   * mangé, et les repas d'avant ne bougent pas.
   */
  remainingServings?: number | null;
  source: MealSource;
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
  /**
   * Confiance de la conversion d'unité quand les grammes sont une estimation
   * (pièce, cuillère, litre). `null` quand ils sont mesurés : donnés en
   * grammes, ou convertis depuis une masse.
   */
  conversion: UnitConfidence | null;
}

export interface MealNutrition extends Macros {
  /** Bornes hautes du total. `null` = non bornée. */
  max: Macros;
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

/**
 * Ce qu'une source permet d'affirmer, au mieux (R6). Un `Record` : une source
 * ajoutée ne compile pas tant qu'on n'a pas décidé du sien.
 */
const PLAFOND: Record<MealSource, Confidence> = {
  jow: 'haute', texte: 'haute', template: 'haute', manuel: 'haute',
  // Une photo ne donne ni quantité ni composition : quoi qu'on en tire, c'est
  // une estimation (§5 de la spec).
  photo: 'basse',
  // Une composition proposée par un LLM, même rattachée et relue, reste une
  // estimation : les grammes viennent du modèle (migration 012).
  ia: 'moyenne',
};

const LABELS: Record<Nutrient, string> = {
  kcal: 'énergie',
  proteinG: 'protéines',
  carbG: 'glucides',
  fatG: 'lipides',
  fiberG: 'fibres',
};

export function calculerNutrition(meal: MealInput, defaults: UnitDefaults): MealNutrition {
  const warnings: string[] = [];
  const servings = Number.isFinite(meal.servings) && meal.servings > 0 ? meal.servings : 1;
  if (servings !== meal.servings) {
    warnings.push('nombre de parts invalide, 1 part retenue');
  }
  const items = meal.items.map((item) => resolve(item, defaults, warnings));
  // Les items sont ce qui a été servi ; ce qui reste dans le plat n'a été mangé
  // par personne. Le snapshot Jow n'en a pas besoin : `servings` y est déjà la
  // part mangée. `items`, lui, repart tel quel — c'est la composition.
  // Avec recette, les items sont des ajouts mangés tels quels : pas de réduction.
  const eaten = meal.recipe === null ? eatenFraction(servings, meal.remainingServings) : 1;
  const eatenItems = items.map((item) => ({
    ...item,
    quantityG: item.quantityG === null ? null : item.quantityG * eaten,
  }));
  // Les ingrédients Jow passent par la même résolution : sans elle, une cuillère
  // de sauce ne comptait jamais dans la part végétale. Leurs manques se disent
  // déjà sur l'écran de la recette (`recipeGaps`) — pas une seconde fois ici.
  const recipeItems = (meal.recipeIngredients ?? []).map((item) => resolve(item, defaults, []));

  let macros: Macros;
  let maxima: Macros;
  let confidence: Confidence;

  const snapshot = meal.recipe;
  if (snapshot !== null && NUTRIENTS.some((n) => snapshot.perServing[n] !== null)) {
    // Le snapshot Jow l'emporte : il est publié par portion et vérifié, là où
    // la somme des ingrédients dépend d'unités que `unit_default` ne sait pas
    // encore convertir. Un nutriment absent du snapshot reste absent — on ne
    // va pas le chercher ailleurs, les deux bases ne sont pas comparables.
    macros = scale(snapshot.perServing, servings);
    maxima = { ...macros };
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
    const summed = sum(eatenItems, warnings);
    macros = summed.min;
    maxima = summed.max;
    confidence = summed.confidence;
    if (snapshot !== null) {
      warnings.push('la recette ne publie aucune valeur nutritionnelle');
    }
  }

  confidence = worst(confidence, PLAFOND[meal.source]);

  const plant = plantRatio(recipeItems, eatenItems, servings, warnings);

  return { ...macros, max: maxima, ...plant, confidence, warnings, items };
}

/**
 * Part de ce qui a été servi qui a été mangée (§6bis). Un reste non déclaré
 * vaut 0 : tout a été mangé. Les grammes suivent la même part — la journée les
 * somme pour sa part végétale, et un reste compté y pèserait.
 */
export function eatenFraction(servings: number, remaining: number | null | undefined): number {
  return servings / (servings + Math.max(remaining ?? 0, 0));
}

function resolve(item: NutritionItem, defaults: UnitDefaults, warnings: string[]): ResolvedItem {
  if (item.quantityG !== null) return { ...item, unresolved: null, conversion: null };

  const resolution = resolveUnit(item.quantity, item.unit, item.food, defaults);
  if (resolution.resolved) {
    // Une masse est une mesure ; le reste est une estimation, qui doit se voir (R6).
    const conversion = resolution.via === 'masse' ? null : resolution.confidence;
    return { ...item, quantityG: resolution.grams, unresolved: null, conversion };
  }
  warnings.push(`« ${item.label} » : ${resolution.reason}`);
  return { ...item, quantityG: null, unresolved: resolution.reason, conversion: null };
}

/**
 * Somme les items, nutriment par nutriment, en intervalles.
 *
 * Un aliment dont la teneur est totalement inconnue ne casse plus le total :
 * il **déborne le haut** sans effacer le bas. Le repas ressort « au moins
 * 31 g », ce qui est vrai, vérifiable, et plus utile que « on ne sait pas ».
 *
 * Un nutriment sur lequel **aucun** aliment n'a rien à dire ressort `[null ;
 * null]` : un plancher à 0 serait techniquement exact et parfaitement
 * trompeur à l'écran.
 */
function sum(
  items: ResolvedItem[],
  warnings: string[],
): { min: Macros; max: Macros; confidence: Confidence } {
  const min: Macros = { ...EMPTY_MACROS };
  const max: Macros = { ...EMPTY_MACROS };
  const floors: Record<Nutrient, number> = { kcal: 0, proteinG: 0, carbG: 0, fatG: 0, fiberG: 0 };
  const ceilings: Record<Nutrient, number> = { kcal: 0, proteinG: 0, carbG: 0, fatG: 0, fiberG: 0 };
  /** Nombre d'aliments ayant apporté au moins une borne, par nutriment. */
  const informed: Record<Nutrient, number> = { kcal: 0, proteinG: 0, carbG: 0, fatG: 0, fiberG: 0 };
  const unbounded: Record<Nutrient, string[]> = {
    kcal: [], proteinG: [], carbG: [], fatG: [], fiberG: [],
  };

  let confidence: Confidence = 'haute';
  let counted = 0;

  /**
   * Un item qu'on ne sait pas évaluer — aliment non rattaché, ou quantité non
   * convertible — ne contribue à aucun plancher, mais il **retire tous les
   * plafonds** : il y a bien quelque chose dans l'assiette, et ce quelque
   * chose peut contenir n'importe quoi. Sans cela, un plat de cantine ferait
   * passer un total pour exact alors qu'il ignore la moitié du repas.
   */
  const debound = (label: string): void => {
    for (const nutrient of NUTRIENTS) unbounded[nutrient].push(label);
  };

  for (const item of items) {
    if (item.food === null) {
      warnings.push(`« ${item.label} » : aliment non rattaché au référentiel, non compté`);
      confidence = 'basse';
      debound(item.label);
      continue;
    }
    if (item.quantityG === null) {
      // Le warning a déjà été posé par `resolve`.
      confidence = 'basse';
      debound(item.food.name);
      continue;
    }

    if (item.conversion !== null) confidence = worst(confidence, item.conversion);
    counted += 1;
    const ratio = item.quantityG / 100;
    for (const nutrient of NUTRIENTS) {
      const low = item.food.per100g[nutrient];
      // Même distinction qu'au niveau du repas : pas de table de bornes du
      // tout = valeurs exactes ; table présente avec un `null` = non borné.
      const high = item.food.per100gMax === undefined ? low : item.food.per100gMax[nutrient];

      if (low === null && high === null) {
        unbounded[nutrient].push(item.food.name);
        continue;
      }
      informed[nutrient] += 1;
      floors[nutrient] += (low ?? 0) * ratio;
      if (high === null) unbounded[nutrient].push(item.food.name);
      else ceilings[nutrient] += high * ratio;
    }
  }

  if (counted === 0) {
    // Aucun item exploitable : le repas n'a pas de valeurs, il n'en a pas zéro.
    return { min: { ...EMPTY_MACROS }, max: { ...EMPTY_MACROS }, confidence: 'basse' };
  }

  for (const nutrient of NUTRIENTS) {
    if (informed[nutrient] === 0) continue;   // reste [null ; null]

    min[nutrient] = round(floors[nutrient]);
    if (unbounded[nutrient].length === 0) {
      max[nutrient] = round(ceilings[nutrient]);
      continue;
    }
    warnings.push(
      `${LABELS[nutrient]} : valeur inconnue pour ${unbounded[nutrient].join(', ')} — ` +
        'le total est un minimum',
    );
  }

  return { min, max, confidence };
}

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
  recipeItems: ResolvedItem[],
  items: ResolvedItem[],
  servings: number,
  warnings: string[],
): Pick<MealNutrition, 'plantRatio' | 'gramsTotal' | 'gramsPlant' | 'gramsClassified'> {
  // Les ingrédients Jow sont donnés **par convive** : c'est le seul endroit où
  // `servings` les met à l'échelle (§3 du contrat Jow).
  const fromRecipe = recipeItems.map((ingredient) => ({
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
  if (all.some((item) => item.quantityG !== null && item.conversion === 'basse')) {
    warnings.push('part végétale calculée en partie sur des quantités approximatives (cuillères, litres)');
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
  const out: Macros = { ...EMPTY_MACROS };
  for (const nutrient of NUTRIENTS) {
    const value = macros[nutrient];
    out[nutrient] = value === null ? null : round(value * factor);
  }
  return out;
}

function round(n: number | null): number | null {
  return n === null ? null : Math.round(n * 100) / 100;
}
