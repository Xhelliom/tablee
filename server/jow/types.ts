/**
 * Types du contrat de parsing Jow (Tâche 0).
 * Le contrat lui-même — chemins exacts dans le payload — est documenté dans
 * `docs/jow-contract.md`. Ce fichier n'en est que la traduction TypeScript.
 */

export type Confidence = 'haute' | 'moyenne' | 'basse';

/**
 * Un ingrédient tel que Jow le publie : une quantité **par couvert**, dans une
 * unité qui n'est pas forcément métrique (`Poignée`, `Bouquet`, `Pièce`).
 *
 * `quantityG` n'est renseigné que si l'unité est métrique et convertible sans
 * hypothèse. Sinon il reste `null` : la conversion relève de `unit_default`,
 * qui exige une source (§6 de la spec, I1). On ne devine pas le poids d'une
 * poignée de salade.
 */
export interface ParsedIngredient {
  /** ObjectId de l'ingrédient chez Jow, ou null si absent du payload. */
  jowFoodId: string | null;
  /** Libellé Jow brut, jamais normalisé. */
  label: string;
  /** Quantité **par couvert**. */
  quantity: number | null;
  /** Libellé d'unité Jow brut (`Kilogramme`, `Poignée`, …). */
  unit: string | null;
  /** Quantité en grammes par couvert, ou null si non convertible sans source. */
  quantityG: number | null;
  optional: boolean;
  position: number;
}

/**
 * Valeurs nutritionnelles **par portion**, telles que publiées par Jow.
 * Un champ à `null` signifie « Jow ne l'a pas publié », jamais « zéro ».
 */
export interface ParsedNutrition {
  kcal: number | null;
  proteinG: number | null;
  carbG: number | null;
  fatG: number | null;
  fiberG: number | null;
}

export interface ParsedRecipe {
  title: string;
  /**
   * Nombre de parts **prévu par Jow** pour la recette (`recipe.base_servings`).
   * Ce n'est pas un facteur d'échelle appliqué au reste : `nutrition` est
   * toujours **par portion** et `ingredients[].quantity` toujours **par
   * convive**. La quantité totale d'un ingrédient vaut `quantity × servings`.
   *
   * Les pages sont générées statiquement et `?coversCount=` ne les change pas
   * (voir `docs/jow-contract.md`) : la mise à l'échelle est faite en aval.
   */
  servings: number;
  ingredients: ParsedIngredient[];
  nutrition: ParsedNutrition;
  jowRecipeId: string | null;
  jowSlug: string | null;
  url: string | null;
  imageUrl: string | null;
  nutriScore: string | null;
  greenScore: string | null;
  confidence: Confidence;
  /**
   * Ce qui manquait ou n'a pas pu être résolu. Destiné à être remonté à
   * l'utilisateur, pas seulement loggué : une donnée absente doit se voir.
   */
  warnings: string[];
}

/** Ce qu'on arrive à tirer du texte partagé, avant tout accès réseau. */
export interface ShareInput {
  /** ObjectId Mongo (24 hex) extrait du lien de partage, si présent. */
  jowRecipeId: string | null;
  /** Titre deviné depuis le texte, si présent. */
  title: string | null;
  /** URL Jow trouvée dans le texte, **déjà expurgée** de `key` / `userId`. */
  url: string | null;
}
