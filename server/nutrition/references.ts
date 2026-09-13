/**
 * §9 — lecture de `nutrient_reference`.
 *
 * ⚠️ **La table est livrée vide, et le reste tant que les repères de l'ANSES
 * et du PNNS n'y ont pas été saisis avec leur `source`.** Ce module lit ; il
 * ne complète rien. Un âge non couvert par la source ne donne pas une barre à
 * zéro ni une barre estimée : il donne l'état « repère indisponible », qui est
 * un état **nominal** de l'interface, pas une panne.
 *
 * I1 s'applique ici en priorité : ces repères servent de base à des conseils
 * destinés à des enfants. Une valeur plausible et fausse y est pire qu'une
 * valeur absente.
 */
import type { Nutrient } from './compute.ts';

/** Colonnes de `nutrient_reference.nutrient`, telles que la spec les nomme. */
export const REFERENCE_KEYS = {
  proteinG: 'protein_g',
  carbG: 'carb_g',
  fatG: 'fat_g',
  fiberG: 'fiber_g',
  kcal: 'kcal',
} as const satisfies Record<Nutrient, string>;

/** Vocabulaire de l'ANSES. `IR_MIN`/`IR_MAX` bornent un intervalle. */
export type ReferenceKind = 'AS' | 'RNP' | 'RN' | 'IR_MIN' | 'IR_MAX';

/**
 * Ce à quoi la valeur se rapporte.
 *
 * `absolu`  une quantité par jour, comparable à ce qui a été mangé.
 * `pct_aet` un pourcentage de l'apport énergétique total de la journée. Les
 *           protéines, lipides et glucides sont publiés ainsi par l'ANSES, et
 *           **ne sont pas des grammes** : les traiter comme tels donnerait des
 *           pourcentages absurdes (« 30 g sur un repère de 10 »).
 */
export type ReferenceBasis = 'absolu' | 'pct_aet';

export interface NutrientReference {
  nutrient: string;
  value: number;
  unit: string;
  kind: ReferenceKind;
  basis: ReferenceBasis;
  /**
   * `true` quand la valeur est calculée à partir d'autres lignes sourcées
   * plutôt que recopiée d'un tableau — le cas des cibles en grammes déduites
   * d'un intervalle en % de l'AET. `source` porte alors la chaîne complète.
   * L'interface le montre : une arithmétique vérifiable n'est pas une mesure.
   */
  derived: boolean;
  /** Obligatoire (I1). Une ligne sans source n'a rien à faire dans la table. */
  source: string;
}

export type ReferenceTable = NutrientReference & { sex: 'F' | 'M' | 'ALL'; ageMin: number; ageMax: number };

function candidates(
  table: ReferenceTable[],
  sex: 'F' | 'M',
  age: number,
  nutrient: Nutrient,
): ReferenceTable[] {
  const key = REFERENCE_KEYS[nutrient];
  const matches = table.filter(
    (row) =>
      row.nutrient === key &&
      age >= row.ageMin &&
      age <= row.ageMax &&
      (row.sex === sex || row.sex === 'ALL'),
  );
  // Une ligne propre au sexe l'emporte sur une ligne `ALL` : les repères de
  // l'ANSES sont sexués à partir de l'adolescence, et retomber sur la ligne
  // générique alors qu'une ligne précise existe donnerait un pourcentage
  // calculé sur le mauvais repère.
  const sexed = matches.filter((row) => row.sex === sex);
  return sexed.length > 0 ? sexed : matches;
}

/**
 * Cherche le repère **en valeur absolue** d'un nutriment, pour un sexe et un
 * âge donnés. C'est celui auquel une consommation en grammes se compare.
 *
 * Les lignes `pct_aet` sont écartées **exprès** : un intervalle de référence
 * en pourcentage de l'apport énergétique n'est pas un repère en grammes, et
 * les confondre ferait afficher « 30 g sur un repère de 10 », soit 300 % de
 * quelque chose qui n'existe pas.
 *
 * À défaut : `null`. Jamais d'interpolation entre deux tranches, jamais de
 * reprise de la tranche voisine — ce serait inventer un repère (I1).
 */
export function findReference(
  table: ReferenceTable[],
  sex: 'F' | 'M',
  age: number,
  nutrient: Nutrient,
): NutrientReference | null {
  const matches = candidates(table, sex, age, nutrient).filter(
    (row) => row.basis === 'absolu' && row.kind !== 'IR_MAX',
  );
  // Entre deux natures, la plus engageante d'abord : une RNP couvre le besoin,
  // un AS n'est qu'un apport observé jugé satisfaisant, une borne basse
  // d'intervalle n'est qu'un plancher. `IR_MAX` est exclu d'emblée : un
  // plafond n'est pas une cible, et le prendre pour tel ferait viser le
  // maximum.
  const order: ReferenceKind[] = ['RNP', 'RN', 'AS', 'IR_MIN'];
  const row = [...matches].sort(
    (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind),
  )[0];
  return row === undefined ? null : strip(row);
}

/**
 * Le plafond : ce qu'il vaut mieux ne pas dépasser, quand la source en publie
 * un. Les lipides d'un adulte ont un intervalle 35-40 % de l'AET, dont la
 * borne haute devient une quantité comme une autre.
 *
 * Les fibres n'en ont pas : leur repère est un apport satisfaisant, pas un
 * intervalle. Rien à dépasser.
 */
export function findCeiling(
  table: ReferenceTable[],
  sex: 'F' | 'M',
  age: number,
  nutrient: Nutrient,
): NutrientReference | null {
  const row = candidates(table, sex, age, nutrient).find(
    (candidate) => candidate.basis === 'absolu' && candidate.kind === 'IR_MAX',
  );
  return row === undefined ? null : strip(row);
}

function strip(row: ReferenceTable): NutrientReference {
  return {
    nutrient: row.nutrient, value: row.value, unit: row.unit,
    kind: row.kind, basis: row.basis, derived: row.derived, source: row.source,
  };
}

/**
 * L'intervalle de référence en pourcentage de l'apport énergétique total,
 * quand la source en publie un (protéines, lipides, glucides).
 *
 * ⚠️ **Chargé, sourcé, mais pas encore affiché.** S'en servir demanderait de
 * comparer la part énergétique d'un macronutriment à cet intervalle, ce qui
 * change ce que raconte la barre — le §8 la définit comme « % du repère du
 * jour ». Le choix touche à ce que des enfants lisent sur leur alimentation :
 * il se prend avec le foyer, pas ici.
 */
export function findEnergyShareRange(
  table: ReferenceTable[],
  sex: 'F' | 'M',
  age: number,
  nutrient: Nutrient,
): { min: number | null; max: number | null; source: string } | null {
  const matches = candidates(table, sex, age, nutrient).filter((row) => row.basis === 'pct_aet');
  const min = matches.find((row) => row.kind === 'IR_MIN');
  const max = matches.find((row) => row.kind === 'IR_MAX');
  if (min === undefined && max === undefined) return null;
  return {
    min: min?.value ?? null,
    max: max?.value ?? null,
    source: (min ?? max)?.source ?? '',
  };
}
