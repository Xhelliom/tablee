/**
 * Recettes Jow persistées, et leurs ingrédients.
 *
 * Les valeurs viennent du snapshot publié par Jow et n'en bougent plus : c'est
 * un instantané, pas une vue. Une recette modifiée chez Jow après qu'un repas
 * l'a utilisée ne doit pas réécrire ce repas.
 */
import type { HouseholdDb } from '../db.ts';
import type { ParsedRecipe } from '../jow/types.ts';
import type { NutritionItem, RecipeSnapshot } from '../nutrition/compute.ts';
import type { Confidence } from '../jow/types.ts';

export interface RecipeIngredient {
  id: string;
  label: string;
  foodId: string | null;
  jowFoodId: string | null;
  quantity: number | null;
  unit: string | null;
  /** Grammes **par convive**, ou `null` si l'unité n'a pas de source (§6). */
  quantityG: number | null;
  optional: boolean;
  position: number;
}

export interface Recipe {
  id: string;
  source: 'jow' | 'manuel';
  title: string;
  url: string | null;
  imageUrl: string | null;
  jowRecipeId: string | null;
  jowSlug: string | null;
  baseServings: number;
  snapshot: RecipeSnapshot;
  nutriScore: string | null;
  greenScore: string | null;
  confidence: Confidence;
  ingredients: RecipeIngredient[];
}

/**
 * Une recette du foyer, telle que la liste la montre — sans ses ingrédients,
 * qui ne servent qu'à l'écran de détail.
 *
 * `lastEatenAt` est ce qui rend la liste utile : ce qui n'a jamais été mangé
 * est ce qu'on cherche, et ce qui l'a été hier est ce qu'on ne veut pas
 * reproposer. Les deux se distinguent ici, pas dans l'écran.
 */
export interface RecipeSummary {
  id: string;
  title: string;
  imageUrl: string | null;
  baseServings: number;
  nutriScore: string | null;
  confidence: Confidence;
  /** `null` = importée, jamais enregistrée comme repas. */
  lastEatenAt: string | null;
  timesEaten: number;
}

/**
 * Marque une recette comme connue du foyer courant (011).
 *
 * ⚠️ Sans cet appel, une recette Jow lue mais jamais mangée n'est rattachée à
 * **aucun** foyer : elle est globale par construction (007). Elle
 * n'apparaîtrait donc dans la liste de personne — et lister les recettes
 * globales à la place montrerait à chaque foyer ce que ses voisins ont lu.
 *
 * Idempotent : on repasse ici à chaque lecture du même partage.
 */
export async function markRecipeKnown(
  db: HouseholdDb, householdId: string, recipeId: string,
): Promise<void> {
  await db.query(
    `insert into household_recipe (household_id, recipe_id)
     values ($1, $2) on conflict do nothing`,
    [householdId, recipeId],
  );
}

/**
 * Les recettes que **ce foyer** connaît, la moins récemment mangée d'abord.
 *
 * Elles sont déjà toutes en base : `saveJowRecipe` écrit la recette à la
 * lecture du partage, avant que le repas soit enregistré. Une recette lue puis
 * abandonnée reste donc là — c'est exactement le stock que cette liste rend
 * visible, et il n'y avait jusqu'ici aucun écran pour le voir.
 *
 * Le passage par `household_recipe` n'est pas une précaution de style : une
 * recette Jow est globale, et lire `recipe` directement rendrait aussi celles
 * des autres foyers (§16).
 *
 * Les restes (`leftover_of`) comptent comme un repas de plus : ils disent que
 * le plat a bien été mangé, ce jour-là, par ces convives.
 */
export async function listRecipes(db: HouseholdDb, limit = 100): Promise<RecipeSummary[]> {
  const { rows } = await db.query<{
    id: string; title: string; image_url: string | null; base_servings: number;
    nutri_score: string | null; confidence: Confidence;
    last_eaten_at: Date | null; times_eaten: string;
  }>(
    `select r.id, r.title, r.image_url, r.base_servings, r.nutri_score, r.confidence,
            max(m.eaten_at) as last_eaten_at,
            count(m.id)     as times_eaten
     from household_recipe hr
     join recipe r on r.id = hr.recipe_id
     -- Les repas sont déjà filtrés au foyer courant par la RLS : le compte est
     -- celui de cette table, pas celui de l'instance.
     left join meal m on m.recipe_id = r.id
     group by r.id, hr.first_seen_at
     -- nulls first : jamais mangée passe devant, c'est ce qu'on cherche.
     order by max(m.eaten_at) asc nulls first, hr.first_seen_at desc
     limit $1`,
    [limit],
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    imageUrl: row.image_url,
    baseServings: row.base_servings,
    nutriScore: row.nutri_score,
    confidence: row.confidence,
    lastEatenAt: row.last_eaten_at === null ? null : row.last_eaten_at.toISOString(),
    timesEaten: Number(row.times_eaten),
  }));
}

export async function findRecipeByJowId(db: HouseholdDb, jowRecipeId: string): Promise<Recipe | null> {
  const { rows } = await db.query<{ id: string }>(
    "select id from recipe where source = 'jow' and jow_recipe_id = $1",
    [jowRecipeId],
  );
  const id = rows[0]?.id;
  return id === undefined ? null : loadRecipe(db, id);
}

export async function loadRecipe(db: HouseholdDb, id: string): Promise<Recipe | null> {
  const { rows } = await db.query<{
    id: string; source: 'jow' | 'manuel'; title: string; url: string | null;
    image_url: string | null; jow_recipe_id: string | null; jow_slug: string | null;
    base_servings: number; kcal_serving: number | null; protein_serving: number | null;
    carb_serving: number | null; fat_serving: number | null; fiber_serving: number | null;
    nutri_score: string | null; green_score: string | null; confidence: Confidence;
  }>(
    `select id, source, title, url, image_url, jow_recipe_id, jow_slug, base_servings,
            kcal_serving, protein_serving, carb_serving, fat_serving, fiber_serving,
            nutri_score, green_score, confidence
     from recipe where id = $1`,
    [id],
  );
  const row = rows[0];
  if (row === undefined) return null;

  return {
    id: row.id,
    source: row.source,
    title: row.title,
    url: row.url,
    imageUrl: row.image_url,
    jowRecipeId: row.jow_recipe_id,
    jowSlug: row.jow_slug,
    baseServings: row.base_servings,
    snapshot: {
      perServing: {
        kcal: row.kcal_serving,
        proteinG: row.protein_serving,
        carbG: row.carb_serving,
        fatG: row.fat_serving,
        fiberG: row.fiber_serving,
      },
      confidence: row.confidence,
    },
    nutriScore: row.nutri_score,
    greenScore: row.green_score,
    confidence: row.confidence,
    ingredients: await loadIngredients(db, id),
  };
}

export async function loadIngredients(db: HouseholdDb, recipeId: string): Promise<RecipeIngredient[]> {
  const { rows } = await db.query<{
    id: string; label: string; food_id: string | null; jow_food_id: string | null;
    quantity: number | null; unit: string | null; quantity_g: number | null;
    optional: boolean; position: number;
  }>(
    `select id, label, food_id, jow_food_id, quantity, unit, quantity_g, optional, position
     from recipe_ingredient where recipe_id = $1 order by position`,
    [recipeId],
  );
  return rows.map((r) => ({
    id: r.id, label: r.label, foodId: r.food_id, jowFoodId: r.jow_food_id,
    quantity: r.quantity, unit: r.unit, quantityG: r.quantity_g,
    optional: r.optional, position: r.position,
  }));
}

/**
 * Persiste une recette parsée depuis Jow, ou la retrouve si elle est déjà là.
 *
 * Un re-partage de la même recette ne refetche rien (§4, point 2) : c'est le
 * `jow_recipe_id` du lien qui sert de clé, et il arrive avant tout accès
 * réseau.
 *
 * Rien de ce qui est écrit ici ne vient du texte de partage : ni `url`, ni
 * `raw`. `redactUrl` est appliquée par acquit de conscience sur l'URL finale,
 * qui ne devrait de toute façon jamais porter de `key` (I6).
 */
export async function saveJowRecipe(db: HouseholdDb, parsed: ParsedRecipe): Promise<Recipe> {
  const { rows } = await db.query<{ id: string }>(
    `insert into recipe (
       source, jow_recipe_id, jow_slug, title, url, image_url, base_servings,
       kcal_serving, protein_serving, carb_serving, fat_serving, fiber_serving,
       nutri_score, green_score, raw, confidence, fetched_at
     ) values ('jow', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now())
     on conflict (source, jow_recipe_id) do update set
       jow_slug        = excluded.jow_slug,
       title           = excluded.title,
       url             = excluded.url,
       image_url       = excluded.image_url,
       base_servings   = excluded.base_servings,
       kcal_serving    = excluded.kcal_serving,
       protein_serving = excluded.protein_serving,
       carb_serving    = excluded.carb_serving,
       fat_serving     = excluded.fat_serving,
       fiber_serving   = excluded.fiber_serving,
       nutri_score     = excluded.nutri_score,
       green_score     = excluded.green_score,
       raw             = excluded.raw,
       confidence      = excluded.confidence,
       fetched_at      = now()
     returning id`,
    [
      parsed.jowRecipeId, parsed.jowSlug, parsed.title, parsed.url, parsed.imageUrl,
      parsed.servings,
      parsed.nutrition.kcal, parsed.nutrition.proteinG, parsed.nutrition.carbG,
      parsed.nutrition.fatG, parsed.nutrition.fiberG,
      parsed.nutriScore, parsed.greenScore,
      parsed.raw === null || parsed.raw === undefined ? null : JSON.stringify(parsed.raw),
      parsed.confidence,
    ],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('recette non enregistrée');

  // Les ingrédients sont réécrits en bloc : ils décrivent la recette telle que
  // Jow la publie aujourd'hui, et un rattachement manuel à `food` se refait.
  // Aucun repas n'en dépend — la nutrition d'un repas Jow vient du snapshot.
  await db.query('delete from recipe_ingredient where recipe_id = $1', [id]);
  for (const ingredient of parsed.ingredients) {
    await db.query(
      `insert into recipe_ingredient
         (recipe_id, jow_food_id, label, quantity, unit, quantity_g, optional, position)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id, ingredient.jowFoodId, ingredient.label, ingredient.quantity,
        ingredient.unit, ingredient.quantityG, ingredient.optional, ingredient.position,
      ],
    );
  }

  // Les ingrédients déjà rencontrés sont recâblés immédiatement : une recette
  // partagée aujourd'hui profite de tout ce qui a été rattaché avant elle.
  await applyKnownLinks(db, id);

  const recipe = await loadRecipe(db, id);
  if (recipe === null) throw new Error('recette introuvable après enregistrement');
  return recipe;
}

export interface LinkResult {
  /** Lignes de `recipe_ingredient` mises à jour, toutes recettes confondues. */
  propagated: number;
  /** L'ObjectId Jow, quand l'ingrédient en a un. */
  jowFoodId: string | null;
}

/**
 * Rattache un ingrédient de recette à un aliment du référentiel (§6, étape 2)
 * — **et à travers lui, l'ingrédient Jow lui-même**.
 *
 * L'ObjectId de Jow est stable : « Purée de carotte (surgelée) » porte le même
 * identifiant dans toutes les recettes. Le rattachement est donc mémorisé dans
 * `jow_food_link` et propagé à toutes les lignes qui partagent cet identifiant
 * — les recettes déjà en base comme celles qui arriveront. On ne le fait
 * qu'une fois dans sa vie, et c'est ce qui rend la part végétale des repas Jow
 * atteignable sans y passer ses soirées.
 *
 * Un ingrédient sans `jow_food_id` (recette manuelle, payload inattendu) ne
 * met à jour que sa propre ligne : rien à propager sans clé stable.
 */
export async function linkIngredientToFood(
  db: HouseholdDb,
  ingredientId: string,
  foodId: string | null,
  confirmedBy: string | null = null,
): Promise<LinkResult> {
  const { rows } = await db.query<{ jow_food_id: string | null; label: string }>(
    'select jow_food_id, label from recipe_ingredient where id = $1',
    [ingredientId],
  );
  const ingredient = rows[0];
  if (ingredient === undefined) return { propagated: 0, jowFoodId: null };

  const jowFoodId = ingredient.jow_food_id;
  if (jowFoodId === null) {
    const { rowCount } = await db.query(
      'update recipe_ingredient set food_id = $2 where id = $1',
      [ingredientId, foodId],
    );
    return { propagated: rowCount ?? 0, jowFoodId: null };
  }

  if (foodId === null) {
    // Détacher, c'est aussi oublier la correspondance : sinon la prochaine
    // recette la réappliquerait aussitôt.
    await db.query('delete from jow_food_link where jow_food_id = $1', [jowFoodId]);
  } else {
    await db.query(
      `insert into jow_food_link (jow_food_id, food_id, label, confirmed_by)
       values ($1, $2, $3, $4)
       on conflict (jow_food_id) do update set
         food_id = excluded.food_id,
         label = excluded.label,
         confirmed_by = excluded.confirmed_by,
         created_at = now()`,
      [jowFoodId, foodId, ingredient.label, confirmedBy],
    );
  }

  const { rowCount } = await db.query(
    'update recipe_ingredient set food_id = $2 where jow_food_id = $1',
    [jowFoodId, foodId],
  );
  return { propagated: rowCount ?? 0, jowFoodId };
}

/**
 * Applique les correspondances connues aux ingrédients d'une recette.
 *
 * Appelée juste après la capture : une recette fraîchement partagée arrive
 * déjà câblée pour tout ingrédient rencontré auparavant. C'est ce qui fait que
 * l'effort décroît au lieu de se répéter.
 */
export async function applyKnownLinks(db: HouseholdDb, recipeId: string): Promise<number> {
  const { rowCount } = await db.query(
    `update recipe_ingredient ri
     set food_id = l.food_id
     from jow_food_link l
     where ri.recipe_id = $1
       and ri.jow_food_id = l.jow_food_id
       and ri.food_id is distinct from l.food_id`,
    [recipeId],
  );
  return rowCount ?? 0;
}

export interface KnownLink {
  jowFoodId: string;
  foodId: string;
  label: string;
  foodName: string;
  plantBased: boolean | null;
}

/** Les correspondances déjà posées — pour les relire et les corriger. */
export async function listLinks(db: HouseholdDb): Promise<KnownLink[]> {
  const { rows } = await db.query<{
    jow_food_id: string; food_id: string; label: string;
    food_name: string; plant_based: boolean | null;
  }>(
    `select l.jow_food_id, l.food_id, l.label,
            f.name as food_name, f.plant_based
     from jow_food_link l
     join food f on f.id = l.food_id
     order by l.label`,
  );
  return rows.map((r) => ({
    jowFoodId: r.jow_food_id, foodId: r.food_id, label: r.label,
    foodName: r.food_name, plantBased: r.plant_based,
  }));
}

/** Les ingrédients, vus par le calcul nutritionnel — quantités **par convive**. */
export function ingredientsAsItems(
  ingredients: RecipeIngredient[],
  foods: Map<string, { name: string; plantBased: boolean | null }>,
): NutritionItem[] {
  return ingredients.map((ingredient) => {
    const food = ingredient.foodId === null ? undefined : foods.get(ingredient.foodId);
    return {
      label: ingredient.label,
      food:
        food === undefined
          ? null
          : {
              name: food.name,
              plantBased: food.plantBased,
              per100g: { kcal: null, proteinG: null, carbG: null, fatG: null, fiberG: null },
            },
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      quantityG: ingredient.quantityG,
    };
  });
}

/**
 * Ce qui manque dans une recette déjà enregistrée.
 *
 * Les warnings du parseur ne sont produits qu'au moment du fetch. Une recette
 * repartagée n'est pas refetchée (§4, point 2) : sans cette fonction, l'écran
 * de confirmation d'un deuxième partage n'afficherait plus rien, alors que les
 * mêmes ingrédients sont toujours non convertis. Une donnée manquante doit se
 * voir à chaque fois, pas seulement la première.
 */
export function recipeGaps(recipe: Recipe): string[] {
  const warnings: string[] = [];

  const missing = Object.entries(recipe.snapshot.perServing)
    .filter(([, value]) => value === null)
    .length;
  if (missing > 0) {
    warnings.push(`${missing} valeur(s) nutritionnelle(s) sur 5 absente(s) de la recette`);
  }

  for (const ingredient of recipe.ingredients) {
    if (ingredient.quantityG !== null) continue;
    if (ingredient.quantity === null || ingredient.unit === null) {
      warnings.push(`« ${ingredient.label} » : quantité non publiée par Jow`);
      continue;
    }
    warnings.push(
      `« ${ingredient.label} » : ${ingredient.quantity} ${ingredient.unit} ` +
        'non convertible en grammes sans source',
    );
  }
  return warnings;
}

/**
 * Badge « N produits de saison » d'une carte de repas (§8bis).
 *
 * Le croisement passe par `recipe_ingredient.food_id` × `seasonal_produce`,
 * donc par des rattachements explicites. Tant que `seasonal_produce` est vide
 * — elle l'est, sa saisie relève du §17 — le compte vaut 0 et le badge ne
 * s'affiche pas. C'est l'état attendu, pas une panne.
 */
export async function seasonalCount(db: HouseholdDb, recipeId: string, month: number): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `select count(distinct sp.id)::int as count
     from recipe_ingredient ri
     join seasonal_produce sp on sp.food_id = ri.food_id
     where ri.recipe_id = $1 and $2 = any(sp.months)`,
    [recipeId, month],
  );
  return rows[0]?.count ?? 0;
}
