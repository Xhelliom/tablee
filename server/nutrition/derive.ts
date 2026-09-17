/**
 * Traduction des intervalles de référence en cibles de la journée.
 *
 * ── Pourquoi une traduction est nécessaire ──────────────────────────────────
 *
 * L'ANSES publie les protéines, lipides et glucides en **pourcentage de
 * l'apport énergétique total**. C'est une information d'équilibre, et elle ne
 * répond pas à « qu'est-ce qu'il me manque ? » : une part énergétique est un
 * ratio, elle converge au fil de la journée au lieu de progresser. « 8 % de
 * protéines » à 10 h et à 20 h, c'est le même chiffre et deux situations sans
 * rapport.
 *
 * Pour qu'une barre se remplisse, il faut une cible en grammes :
 *
 *   cible_g = intervalle (% AET) × besoin énergétique (kcal) / facteur (kcal/g)
 *
 * ── Les trois termes, et leur source ────────────────────────────────────────
 *
 * 1. L'intervalle en % vient des avis ANSES (`nutrient_reference`, basis
 *    `pct_aet`).
 * 2. Le besoin énergétique vient d'`energy_reference` — EFSA 2017 pour les
 *    enfants, ANSES 2016 pour les adultes.
 * 3. Les facteurs de conversion sont ceux du **Règlement (UE) n° 1169/2011,
 *    Annexe XIV**, c'est-à-dire exactement la convention sous laquelle Ciqual
 *    publie son énergie (constituant 328, « Energie, Règlement UE N°
 *    1169/2011 »). Les deux bouts de la chaîne parlent donc la même langue.
 *
 * ── Ce que le résultat est, et n'est pas ────────────────────────────────────
 *
 * Le produit n'est publié nulle part tel quel : aucun tableau ne dit « 65 g de
 * protéines pour un homme adulte ». C'est un repère **dérivé**, marqué comme
 * tel en base (`nutrient_reference.derived`), avec la chaîne de calcul dans sa
 * `source`. On ne le confond jamais avec une valeur recopiée — c'est la
 * différence entre une arithmétique vérifiable et une valeur inventée (I1).
 *
 * Et c'est un repère de **population**, pour une activité physique moyenne.
 * Un adolescent très sportif en dépense davantage.
 */

import { MAJORITE } from './age.ts';

/**
 * Facteurs de conversion énergétique — Règlement (UE) n° 1169/2011, Annexe
 * XIV. Les fibres (2 kcal/g) n'y figurent pas parce que leur repère est déjà
 * publié en grammes : rien à dériver.
 */
export const KCAL_PER_GRAM = {
  protein_g: 4,
  carb_g: 4,
  fat_g: 9,
} as const;

export type DerivableNutrient = keyof typeof KCAL_PER_GRAM;

export const isDerivable = (nutrient: string): nutrient is DerivableNutrient =>
  nutrient in KCAL_PER_GRAM;

export interface AgeRange {
  ageMin: number;
  ageMax: number;
}

export interface PercentReference extends AgeRange {
  sex: 'F' | 'M' | 'ALL';
  nutrient: string;
  kind: string;
  /** Pourcentage de l'apport énergétique total. */
  value: number;
  source: string;
}

export interface EnergyReference extends AgeRange {
  sex: 'F' | 'M';
  kcal: number;
  source: string;
}

export interface DerivedReference extends AgeRange {
  sex: 'F' | 'M';
  nutrient: DerivableNutrient;
  kind: string;
  /** Grammes par jour. */
  value: number;
  source: string;
}

/**
 * Le besoin énergétique d'une tranche, prêt à entrer dans `nutrient_reference`
 * comme repère de la barre « Énergie ». Séparé de `DerivedReference` parce
 * qu'il n'est pas en grammes et qu'il ne se dérive de rien : il se recopie.
 */
export interface EnergyTarget extends AgeRange {
  sex: 'F' | 'M';
  nutrient: 'kcal';
  kind: 'BNM';
  /** Kilocalories par jour. */
  value: number;
  unit: 'kcal';
  source: string;
}

/** Âge maximal considéré. Au-delà, aucune source ne dit rien. */
const MAX_AGE = 120;

/**
 * Croise les intervalles en % et les besoins énergétiques, année par année.
 *
 * Les deux jeux de tranches d'âge **ne coïncident pas** : l'ANSES publie les
 * protéines par 4-5 / 6-9 / 10-13 / 14-17 ans et les besoins énergétiques par
 * 4-6 / 7-10 / 11-14 / 15-17 ans. Les harmoniser à la main reviendrait à
 * choisir laquelle des deux sources a tort. On descend donc à l'année, on
 * calcule là où les deux parlent, et on recolle les années identiques en
 * tranches — ce qui redonne les découpages réels du croisement, sans en
 * inventer aucun.
 *
 * Une année que l'une des deux sources ne couvre pas ne produit rien : la
 * barre affichera « repère indisponible ».
 */
export function deriveTargets(
  percents: PercentReference[],
  energies: EnergyReference[],
): DerivedReference[] {
  const derived: DerivedReference[] = [];
  const keys = new Set(percents.map((p) => `${p.nutrient} ${p.kind}`));

  for (const key of keys) {
    const [nutrient, kind] = key.split(' ') as [string, string];
    if (!isDerivable(nutrient)) continue;

    for (const sex of ['F', 'M'] as const) {
      const perYear: (DerivedReference | null)[] = [];

      for (let age = 0; age <= MAX_AGE; age += 1) {
        const percent = pick(percents, sex, age, (p) => p.nutrient === nutrient && p.kind === kind);
        const energy = pick(energies, sex, age, () => true);
        if (percent === null || energy === null) {
          perYear[age] = null;
          continue;
        }
        perYear[age] = {
          sex,
          ageMin: age,
          ageMax: age,
          nutrient,
          kind,
          value: round((percent.value / 100) * energy.kcal / KCAL_PER_GRAM[nutrient]),
          source:
            `dérivé : ${percent.value} % AET [${percent.source}] × ` +
            `${energy.kcal} kcal [${energy.source}] ÷ ${KCAL_PER_GRAM[nutrient]} kcal/g ` +
            '[Règlement (UE) n° 1169/2011, Annexe XIV]',
        };
      }

      derived.push(...merge(perYear));
    }
  }

  return derived.sort(
    (a, b) =>
      a.nutrient.localeCompare(b.nutrient) ||
      a.kind.localeCompare(b.kind) ||
      a.sex.localeCompare(b.sex) ||
      a.ageMin - b.ageMin,
  );
}

/**
 * Le besoin énergétique, recopié en repère affichable — **majeurs seulement**.
 *
 * ⚠️ Renversement du §9, décidé par le propriétaire le 17/09/2026 : le besoin
 * énergétique ne sortait jamais à l'écran, il n'était qu'un terme de calcul
 * pour `deriveTargets`. Il devient la cinquième barre. Lire l'en-tête de la
 * migration 017 avant d'y toucher — les deux objections écartées y sont, et
 * ce qui ne l'est pas non plus.
 *
 * **I5 tient entièrement.** Aucune ligne n'est produite avant 18 ans : la
 * boucle commence à la majorité, et une tranche de la source qui l'enjamberait
 * serait coupée là plutôt que d'être écartée en entier. C'est le premier des
 * trois filets ; les deux autres sont dans `bilanJournalier` et dans l'écran.
 *
 * Rien n'est calculé ici, à la différence de `deriveTargets` : la valeur est
 * celle d'`energy_reference`, au kcal près, et sa `source` est celle de la
 * ligne d'origine. Elle porte quand même `derived` en base — non qu'elle soit
 * un produit arithmétique, mais parce qu'elle est **écrite par le seed** et
 * réécrite à chaque passage, comme ses voisines, et non saisie dans un CSV.
 */
export function energyTargets(energies: EnergyReference[]): EnergyTarget[] {
  const out: EnergyTarget[] = [];

  for (const sex of ['F', 'M'] as const) {
    const perYear: (EnergyTarget | null)[] = [];
    for (let age = MAJORITE; age <= MAX_AGE; age += 1) {
      const energy = pick(energies, sex, age, () => true);
      perYear[age] = energy === null ? null : {
        sex,
        ageMin: age,
        ageMax: age,
        nutrient: 'kcal',
        kind: 'BNM',
        value: energy.kcal,
        unit: 'kcal',
        source: energy.source,
      };
    }
    out.push(...merge(perYear));
  }

  return out.sort((a, b) => a.sex.localeCompare(b.sex) || a.ageMin - b.ageMin);
}

/**
 * La ligne qui couvre cet âge pour ce sexe. Une ligne propre au sexe l'emporte
 * sur une ligne `ALL` : les repères de l'ANSES se sexuent à l'adolescence, et
 * retomber sur la ligne générique alors qu'une ligne précise existe donnerait
 * une cible calculée sur le mauvais repère.
 */
function pick<T extends AgeRange & { sex: 'F' | 'M' | 'ALL' }>(
  rows: T[],
  sex: 'F' | 'M',
  age: number,
  extra: (row: T) => boolean,
): T | null {
  const matches = rows.filter(
    (row) =>
      age >= row.ageMin && age <= row.ageMax && (row.sex === sex || row.sex === 'ALL') && extra(row),
  );
  return matches.find((row) => row.sex === sex) ?? matches[0] ?? null;
}

/** Recolle les années consécutives de même valeur en une seule tranche. */
function merge<T extends AgeRange & { value: number; source: string }>(
  perYear: (T | null)[],
): T[] {
  const out: T[] = [];
  let current: T | null = null;

  for (let age = 0; age <= MAX_AGE; age += 1) {
    const row = perYear[age] ?? null;
    if (row === null) {
      current = null;
      continue;
    }
    if (current !== null && current.value === row.value && current.source === row.source) {
      current.ageMax = age;
      continue;
    }
    current = { ...row };
    out.push(current);
  }
  return out;
}

/** Au gramme près : afficher « 64,87 g » donnerait une fausse précision. */
function round(grams: number): number {
  return Math.round(grams);
}
