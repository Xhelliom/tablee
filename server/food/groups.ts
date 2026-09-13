/**
 * Mapping des sous-groupes Ciqual vers `food.category` et `food.plant_based`.
 *
 * Le §5 de la spec demande de renseigner ces deux colonnes « par mapping de
 * groupe Ciqual ». Le mapping est fait ici au niveau **sous-groupe** (0201,
 * 0403, …) plutôt que groupe (02, 04) : « matières grasses » mélange le beurre
 * et l'huile de tournesol, « produits laitiers » contient les spécialités au
 * soja. Un mapping au groupe se tromperait sur ces lignes.
 *
 * ⚠️ Ce fichier contient des **décisions de classification**, pas des valeurs
 * nutritionnelles. Il est écrit pour être relu et corrigé ligne à ligne. La
 * règle suivie :
 *
 * - `true`  — origine végétale non ambiguë pour **tout** le sous-groupe.
 * - `false` — origine animale non ambiguë pour tout le sous-groupe.
 * - `null`  — sous-groupe mixte (plats composés, viennoiseries aux œufs,
 *             chocolats au lait, margarines mi-végétales). `null` signifie
 *             « non classé », jamais « pas végétal » (§10 de la spec).
 *
 * Conséquence assumée, à connaître avant de lire une part végétale : le §11
 * met les grammes non classés au **dénominateur** du calcul. Un repas composé
 * surtout de plats préparés Ciqual sortira donc avec une part végétale
 * sous-estimée, pas absente.
 */

export type PlantBased = boolean | null;

interface Subgroup {
  category: string | null;
  plant: PlantBased;
  /** Pourquoi `null`, quand ce n'est pas évident. */
  why?: string;
}

/**
 * Vocabulaire de `food.category` — volontairement court. Le §14 de la spec
 * interroge `food.category = 'poisson'` : les catégories servent à poser des
 * questions simples sur l'historique, pas à reproduire la taxonomie Ciqual,
 * qui reste disponible via `external_id`.
 */
export const CATEGORIES = [
  'plat_compose', 'soupe', 'sandwich', 'legume', 'tubercule', 'legumineuse',
  'fruit', 'oleagineux', 'cereale', 'pain', 'biscuit_aperitif', 'viande',
  'charcuterie', 'poisson', 'fruit_de_mer', 'oeuf', 'substitut_vegetal',
  'lait', 'produit_laitier', 'fromage', 'creme', 'eau', 'boisson',
  'boisson_alcoolisee', 'sucre', 'chocolat', 'confiserie', 'confiture',
  'viennoiserie', 'biscuit', 'cereale_petit_dej', 'barre_cerealiere',
  'patisserie', 'glace', 'sorbet', 'beurre', 'huile_vegetale', 'margarine',
  'huile_animale', 'matiere_grasse', 'sauce', 'condiment', 'aide_culinaire',
  'sel', 'epice', 'herbe', 'algue', 'alimentation_particuliere', 'infantile',
] as const;

const SUBGROUPS: Record<string, Subgroup> = {
  // ── 01 entrées et plats composés ─────────────────────────────────────────
  // Tous mixtes par construction : une salade composée peut être au thon.
  '0101': { category: 'plat_compose', plant: null, why: 'salades composées : avec ou sans produit animal' },
  '0102': { category: 'soupe', plant: null, why: 'soupes : au légume, au poisson, à la crème' },
  '0103': { category: 'plat_compose', plant: null, why: 'plats composés : recettes mixtes' },
  '0104': { category: 'plat_compose', plant: null, why: 'pizzas et quiches : fromage, œufs' },
  '0105': { category: 'sandwich', plant: null, why: 'sandwichs : garniture variable' },
  '0106': { category: 'plat_compose', plant: null, why: 'feuilletés : beurre, garniture variable' },

  // ── 02 fruits, légumes, légumineuses et oléagineux ────────────────────────
  '0201': { category: 'legume', plant: true },
  '0202': { category: 'tubercule', plant: true },
  '0203': { category: 'legumineuse', plant: true },
  '0204': { category: 'fruit', plant: true },
  '0205': { category: 'oleagineux', plant: true },

  // ── 03 produits céréaliers ───────────────────────────────────────────────
  '0301': { category: 'cereale', plant: true },
  '0302': { category: 'pain', plant: true },
  '0303': { category: 'biscuit_aperitif', plant: null, why: 'biscuits apéritifs : souvent au fromage' },
  // 0305 n'est déclaré nulle part dans `alim_grp_2020_07_07.xml` — trou de
  // l'export, pas de notre lecture. Les 44 aliments qui le portent ont été
  // relus un par un : ce sont des farines, fécules, amidons et flocons, tous
  // du groupe 03 et tous d'origine végétale.
  '0305': { category: 'cereale', plant: true },

  // ── 04 viandes, œufs, poissons et assimilés ──────────────────────────────
  '0401': { category: 'viande', plant: false },
  '0402': { category: 'viande', plant: false },
  '0403': { category: 'charcuterie', plant: false },
  '0404': { category: 'viande', plant: false },
  '0405': { category: 'poisson', plant: false },
  '0406': { category: 'poisson', plant: false },
  '0407': { category: 'fruit_de_mer', plant: false },
  '0408': { category: 'fruit_de_mer', plant: false },
  '0409': { category: 'poisson', plant: false },
  '0410': { category: 'oeuf', plant: false },
  '0411': { category: 'substitut_vegetal', plant: true },

  // ── 05 produits laitiers et assimilés ────────────────────────────────────
  // « et assimilés » : le sous-groupe contient des spécialités végétales,
  // rattrapées par la règle de nom ci-dessous.
  '0501': { category: 'lait', plant: false },
  '0502': { category: 'produit_laitier', plant: false },
  '0503': { category: 'fromage', plant: false },
  '0504': { category: 'creme', plant: false },

  // ── 06 eaux et autres boissons ───────────────────────────────────────────
  '0601': { category: 'eau', plant: null, why: 'eau : ni végétale ni animale' },
  '0602': { category: 'boisson', plant: null, why: 'boissons : jus de fruit et boissons lactées mêlés' },
  '0603': { category: 'boisson_alcoolisee', plant: null, why: 'alcools : crèmes de liqueur incluses' },

  // ── 07 produits sucrés ───────────────────────────────────────────────────
  '0701': { category: 'sucre', plant: null, why: 'le miel est un produit animal, le sucre non' },
  '0702': { category: 'chocolat', plant: null, why: 'chocolat au lait' },
  '0703': { category: 'confiserie', plant: null, why: 'gélatine, blanc d’œuf, lait' },
  '0704': { category: 'confiture', plant: null, why: 'confitures de lait incluses' },
  '0705': { category: 'viennoiserie', plant: null, why: 'beurre et œufs' },
  '0706': { category: 'biscuit', plant: null, why: 'beurre et œufs' },
  '0707': { category: 'cereale_petit_dej', plant: null, why: 'certaines contiennent du lait en poudre' },
  '0708': { category: 'barre_cerealiere', plant: null, why: 'enrobages chocolatés au lait' },
  '0709': { category: 'patisserie', plant: null, why: 'beurre, œufs, crème' },

  // ── 08 glaces et sorbets ─────────────────────────────────────────────────
  '0801': { category: 'glace', plant: null, why: 'crèmes glacées : lait' },
  '0802': { category: 'sorbet', plant: null, why: 'sorbets : blanc d’œuf possible' },
  '0803': { category: 'glace', plant: null, why: 'desserts glacés : composition variable' },

  // ── 09 matières grasses ──────────────────────────────────────────────────
  '0901': { category: 'beurre', plant: false },
  '0902': { category: 'huile_vegetale', plant: true },
  '0903': { category: 'margarine', plant: null, why: 'margarines : mélanges végétal / laitier' },
  '0904': { category: 'huile_animale', plant: false },
  '0905': { category: 'matiere_grasse', plant: null, why: 'sous-groupe fourre-tout' },

  // ── 10 aides culinaires et ingrédients divers ────────────────────────────
  '1001': { category: 'sauce', plant: null, why: 'sauces : béarnaise et sauce soja dans le même lot' },
  '1002': { category: 'condiment', plant: null, why: 'condiments : anchois, œuf' },
  '1003': { category: 'aide_culinaire', plant: null, why: 'gélatine, levure, bouillons' },
  '1004': { category: 'sel', plant: null, why: 'sel : origine minérale' },
  '1005': { category: 'epice', plant: true },
  '1006': { category: 'herbe', plant: true },
  // Les algues ne sont pas des plantes au sens botanique. Elles le sont au
  // sens de la barre « Végétal », qui oppose origine végétale et animale.
  '1007': { category: 'algue', plant: true },
  '1008': { category: 'alimentation_particuliere', plant: null, why: 'régimes spécifiques : composition variable' },
  // Deux libellés portent ce code dans l'export 2020 (« ingrédients divers »
  // et « aides culinaires et ingrédients pour végétariens ») : mixte.
  '1009': { category: 'aide_culinaire', plant: null, why: 'code partagé par deux libellés dans l’export 2020' },

  // ── 00 sans sous-groupe ──────────────────────────────────────────────────
  // Deux « aliments moyens » (Dessert, Glace) que Ciqual ne rattache à rien.
  '0000': { category: null, plant: null, why: 'aliment moyen sans sous-groupe' },

  // ── 11 aliments infantiles ───────────────────────────────────────────────
  '1101': { category: 'infantile', plant: null, why: 'laits infantiles : lait de vache ou végétal' },
  '1102': { category: 'infantile', plant: null, why: 'petits pots : avec ou sans viande' },
  '1103': { category: 'infantile', plant: null, why: 'desserts infantiles : lactés ou aux fruits' },
  '1104': { category: 'infantile', plant: null, why: 'céréales infantiles : lait en poudre fréquent' },
};

/**
 * Rattrape les lignes que le sous-groupe classe mal. Ciqual nomme ses
 * substituts sans ambiguïté (« Spécialité végétale type fromage, à la noix de
 * cajou ») : c'est le libellé de la source qui tranche, pas une supposition.
 *
 * Volontairement court. Une règle de nom qui grossit finit par deviner.
 */
const VEGETAL_BY_NAME = /^sp[ée]cialit[ée] v[ée]g[ée]tale|^boisson (au |v[ée]g[ée]tale)|^pr[ée]paration culinaire [àa] base de soja/i;
/** Mélanges explicitement mi-végétaux mi-animaux : aucune réponse juste. */
const MIXED_BY_NAME = /m[ée]lang[ée]e? \((v[ée]g[ée]tale et laiti[èe]re|laiti[èe]re et v[ée]g[ée]tale)\)/i;

export interface Classification {
  category: string | null;
  plantBased: PlantBased;
}

/**
 * Classe un aliment Ciqual depuis son sous-groupe et son libellé.
 *
 * Un sous-groupe inconnu ressort `{ category: null, plantBased: null }` : si
 * l'ANSES ajoute un sous-groupe, on préfère ne rien dire plutôt que le ranger
 * au hasard.
 */
export function classify(subgroupCode: string, name: string): Classification {
  const entry = SUBGROUPS[subgroupCode.trim()];
  if (entry === undefined) return { category: null, plantBased: null };
  if (entry.category === null) return { category: null, plantBased: entry.plant };

  if (MIXED_BY_NAME.test(name)) return { category: entry.category, plantBased: null };
  if (VEGETAL_BY_NAME.test(name)) return { category: entry.category, plantBased: true };
  return { category: entry.category, plantBased: entry.plant };
}

/**
 * Le sous-groupe est-il décrit ici ? Un `false` signifie que l'ANSES a publié
 * un sous-groupe que ce fichier ne connaît pas : le seed le signale pour qu'il
 * soit classé à la main, plutôt que rangé au hasard.
 */
export function isKnownSubgroup(subgroupCode: string): boolean {
  return subgroupCode.trim() in SUBGROUPS;
}

/** Sous-groupes connus — utilisé par les tests et le rapport de seed. */
export function knownSubgroups(): string[] {
  return Object.keys(SUBGROUPS);
}
