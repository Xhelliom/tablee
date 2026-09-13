/**
 * Calcul nutritionnel (§11 de la spec) — **en applicatif, jamais en SQL**.
 *
 * Trois algorithmes, trois responsabilités :
 *
 *   `calculerShares`     qui a mangé quelle part — figé à l'écriture (R2)
 *   `calculerNutrition`  ce que pèse un repas — null plutôt que zéro (I1)
 *   `bilanJournalier`    ce que ça donne pour une personne, en % du repère (R3)
 *
 * Les deux tables qui alimentent ces calculs et qui sont livrées **vides** —
 * `unit_default` (§6) et `nutrient_reference` (§9) — ont chacune un état
 * « la donnée manque » traité comme un cas nominal, pas comme une erreur.
 */
export { calculerShares, type ComputedShare, type SharePerson } from './shares.ts';
export {
  calculerNutrition,
  NUTRIENTS,
  type Confidence,
  type FoodValues,
  type Macros,
  type MealInput,
  type MealNutrition,
  type Nutrient,
  type NutritionItem,
  type RecipeSnapshot,
  type ResolvedItem,
} from './compute.ts';
export {
  bilanJournalier,
  type BalanceInput,
  type BarState,
  type DailyBalance,
  type DailyMeal,
  type NutrientBar,
  type PlantBar,
} from './daily.ts';
export {
  findReference,
  REFERENCE_KEYS,
  type NutrientReference,
  type ReferenceTable,
} from './references.ts';
export {
  normalizeUnit,
  parseQuantity,
  resolveUnit,
  type UnitDefaults,
  type UnitResolution,
} from './units.ts';
export { ageAt, ageBracket, isMinor } from './age.ts';
