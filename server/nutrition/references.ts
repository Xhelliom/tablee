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

export interface NutrientReference {
  nutrient: string;
  value: number;
  unit: string;
  /** Obligatoire (I1). Une ligne sans source n'a rien à faire dans la table. */
  source: string;
}

export type ReferenceTable = NutrientReference & { sex: 'F' | 'M' | 'ALL'; ageMin: number; ageMax: number };

/**
 * Cherche le repère d'un nutriment pour un sexe et un âge donnés.
 *
 * Une ligne propre au sexe l'emporte sur une ligne `ALL` : les repères de
 * l'ANSES sont sexués à partir de l'adolescence, et retomber sur la ligne
 * générique alors qu'une ligne précise existe donnerait un pourcentage calculé
 * sur le mauvais repère.
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
  const key = REFERENCE_KEYS[nutrient];
  const matches = table.filter(
    (row) =>
      row.nutrient === key &&
      age >= row.ageMin &&
      age <= row.ageMax &&
      (row.sex === sex || row.sex === 'ALL'),
  );
  if (matches.length === 0) return null;

  const exact = matches.find((row) => row.sex === sex);
  const row = exact ?? matches[0];
  if (row === undefined) return null;
  return { nutrient: row.nutrient, value: row.value, unit: row.unit, source: row.source };
}
