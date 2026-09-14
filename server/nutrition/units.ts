/**
 * §6 — résolution d'unité : d'un « 1/10 botte » vers des grammes, ou vers une
 * question posée à l'utilisateur.
 *
 * L'ordre de résolution est celui de la spec :
 *
 *   1. unité de masse          → conversion directe
 *   2. `food.unit_weights`     → poids propre à cet aliment
 *   3. `unit_default`          → repli par forme, `confidence='basse'`
 *   4. sinon                   → **demander**, ne pas deviner (I1)
 *
 * ⚠️ **Écart assumé avec le point 1 du §6**, qui range `ml` parmi les unités
 * directement utilisables. Passer d'un volume à une masse demande une densité :
 * 35 ml d'huile ne pèsent pas 35 g. Les volumes sont donc traités comme les
 * autres unités non métriques — ils passent par `unit_weights` ou
 * `unit_default`, et à défaut déclenchent la question. C'est la même règle que
 * celle retenue pour `Litre` au §4 de `docs/jow-contract.md`, et elle découle
 * de I1, qui ne se négocie pas.
 */

export type UnitConfidence = 'haute' | 'moyenne' | 'basse';

export interface UnitSource {
  /** Conversions propres à l'aliment : `{"piece":110,"poignee":30}`. */
  unitWeights?: Record<string, number> | null;
  /** `food.category` : décide du repli par forme (`formOf`). */
  category?: string | null;
}

/**
 * Table `unit_default` : un repli par unité **et par forme**, avec la source
 * qui l'atteste. Clé `unité normalisée|forme` — voir `defaultKey`.
 */
export type UnitDefaults = Map<string, { grams: number; source: string }>;

export type UnitForm = 'tout' | 'poudre';

/**
 * La forme d'un aliment, pour le repli (migration 013). Seule la catégorie
 * `epice` est une poudre à coup sûr : la farine est rangée avec le riz
 * (`cereale`) et le cacao avec les boissons. Ceux-là ont leur ligne propre dans
 * `food-unit-weight.csv`, plutôt qu'une catégorie qui mentirait pour leurs
 * voisins.
 */
export const formOf = (category: string | null | undefined): UnitForm =>
  (category === 'epice' ? 'poudre' : 'tout');

export const defaultKey = (unit: string, form: UnitForm): string => `${normalizeUnit(unit)}|${form}`;

export type UnitResolution =
  | { resolved: true; grams: number; confidence: UnitConfidence; via: 'masse' | 'aliment' | 'defaut' }
  /**
   * Non résolue. `reason` est destinée à être **affichée** : l'écran de
   * saisie demande la quantité en grammes plutôt que de l'estimer.
   */
  | { resolved: false; reason: string };

/** Unités de masse : les seules convertibles sans aucune hypothèse. */
const MASS: Record<string, number> = {
  g: 1, gr: 1, gramme: 1, grammes: 1,
  kg: 1000, kilo: 1000, kilos: 1000, kilogramme: 1000, kilogrammes: 1000,
  mg: 0.001, milligramme: 0.001, milligrammes: 0.001,
};

/**
 * Normalise un libellé d'unité : minuscules, accents retirés, pluriel simple
 * conservé tel quel. `Cuillère à soupe`, `cuilleres a soupe` et `CAS` ne se
 * rejoignent pas ici — `unit_default` porte les libellés tels que Jow les
 * publie, et le §4 du contrat Jow en donne la liste exacte.
 */
export function normalizeUnit(unit: string): string {
  return unit
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Lit une quantité écrite à la main : `1/10`, `0,5`, `1 1/2`, `2`.
 *
 * Les fractions viennent des recettes (`1/10 botte`), la virgule décimale de
 * l'habitude française. Une saisie illisible ressort à `null` — jamais à 1
 * « par défaut », qui ferait entrer une quantité inventée dans un calcul.
 */
export function parseQuantity(raw: string | number | null | undefined): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const text = (raw ?? '').trim().replace(',', '.');
  if (text.length === 0) return null;

  const mixed = text.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (mixed) {
    const [whole, num, den] = [Number(mixed[1]), Number(mixed[2]), Number(mixed[3])];
    return den === 0 ? null : whole + num / den;
  }

  const fraction = text.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (fraction) {
    const [num, den] = [Number(fraction[1]), Number(fraction[2])];
    return den === 0 ? null : num / den;
  }

  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * Résout une quantité en grammes, ou explique pourquoi elle ne l'est pas.
 *
 * `defaults` est la table `unit_default`, **livrée vide** : chacune de ses
 * lignes exige une source (§17, point 2). Tant qu'elle l'est, toute unité non
 * métrique sort ici en `resolved: false`, et c'est le comportement attendu —
 * pas une panne.
 */
export function resolveUnit(
  quantity: number | null,
  unit: string | null,
  food: UnitSource | null,
  defaults: UnitDefaults,
): UnitResolution {
  if (quantity === null || !Number.isFinite(quantity)) {
    return { resolved: false, reason: 'quantité absente ou illisible' };
  }
  if (unit === null || unit.trim().length === 0) {
    return { resolved: false, reason: 'unité absente' };
  }

  const key = normalizeUnit(unit);

  const mass = MASS[key];
  if (mass !== undefined) {
    return { resolved: true, grams: round(quantity * mass), confidence: 'haute', via: 'masse' };
  }

  // Le poids porté par l'aliment lui-même l'emporte sur le repli générique :
  // une pièce de poulet et une pièce de radis n'ont rien en commun.
  //
  // ⚠️ Précisé le 14/09/2026 : `moyenne`, et non plus `haute`. Même propre à
  // l'aliment, une pièce ou une cuillère n'est pas une pesée — l'œuf de la
  // recette n'est pas celui qui a servi de mesure, et une valeur USDA décrit
  // un produit américain (R6). Seule une masse est une mesure.
  const own = food?.unitWeights?.[key];
  if (typeof own === 'number' && Number.isFinite(own)) {
    return { resolved: true, grams: round(quantity * own), confidence: 'moyenne', via: 'aliment' };
  }

  // Le repli dégradé : par forme d'abord — une cuillère d'épice n'est pas une
  // cuillère d'huile —, puis pour toutes les formes.
  //
  // ⚠️ Précisé le 14/09/2026 : `basse`, et non plus `moyenne` — dit
  // « approximatif » sur une recette, où personne ne peut le corriger.
  // C'est une médiane de mesures publiées sur d'autres aliments, pas une mesure
  // de celui-ci (R6). Une cuillère n'est pas un instrument : à quelques grammes
  // près, c'est ce qu'on sait dire.
  const form = formOf(food?.category);
  const fallback = (form === 'tout' ? undefined : defaults.get(`${key}|${form}`)) ?? defaults.get(`${key}|tout`);
  if (fallback !== undefined) {
    return { resolved: true, grams: round(quantity * fallback.grams), confidence: 'basse', via: 'defaut' };
  }

  return {
    resolved: false,
    reason: `« ${unit} » n’a pas d’équivalence en grammes connue — à préciser`,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
