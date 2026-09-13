/**
 * Recettes Jow persistées, et leurs ingrédients.
 *
 * Les valeurs viennent du snapshot publié par Jow et n'en bougent plus : c'est
 * un instantané, pas une vue. Une recette modifiée chez Jow après qu'un repas
 * l'a utilisée ne doit pas réécrire ce repas.
 */
import type { Db } from '../db.ts';
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

export async function findRecipeByJowId(db: Db, jowRecipeId: string): Promise<Recipe | null> {
  const { rows } = await db.query<{ id: string }>(
    "select id from recipe where source = 'jow' and jow_recipe_id = $1",
    [jowRecipeId],
  );
  const id = rows[0]?.id;
  return id === undefined ? null : loadRecipe(db, id);
}

export async function loadRecipe(db: Db, id: string): Promise<Recipe | null> {
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

export async function loadIngredients(db: Db, recipeId: string): Promise<RecipeIngredient[]> {
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
export async function saveJowRecipe(db: Db, parsed: ParsedRecipe): Promise<Recipe> {
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

  const recipe = await loadRecipe(db, id);
  if (recipe === null) throw new Error('recette introuvable après enregistrement');
  return recipe;
}

/** Rattache un ingrédient de recette à un aliment du référentiel (§6, étape 2). */
export async function linkIngredientToFood(
  db: Db,
  ingredientId: string,
  foodId: string | null,
): Promise<void> {
  await db.query('update recipe_ingredient set food_id = $2 where id = $1', [ingredientId, foodId]);
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
 * Badge « N produits de saison » d'une carte de repas (§8bis).
 *
 * Le croisement passe par `recipe_ingredient.food_id` × `seasonal_produce`,
 * donc par des rattachements explicites. Tant que `seasonal_produce` est vide
 * — elle l'est, sa saisie relève du §17 — le compte vaut 0 et le badge ne
 * s'affiche pas. C'est l'état attendu, pas une panne.
 */
export async function seasonalCount(db: Db, recipeId: string, month: number): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `select count(distinct sp.id)::int as count
     from recipe_ingredient ri
     join seasonal_produce sp on sp.food_id = ri.food_id
     where ri.recipe_id = $1 and $2 = any(sp.months)`,
    [recipeId, month],
  );
  return rows[0]?.count ?? 0;
}
