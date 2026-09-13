/**
 * Repas : écriture, relecture, recalcul.
 *
 * Deux invariants gouvernent ce fichier :
 *
 * - **R2 — `share` est figé à l'écriture.** Les parts sont calculées depuis
 *   les `portion_coef` du moment où le repas est enregistré, puis ne bougent
 *   plus. Modifier le coefficient d'un membre ne touche aucun repas : la
 *   requête n'existe nulle part.
 * - **I6 — aucun texte de partage brut n'entre en base.** `raw_input` passe
 *   systématiquement par `redactShareText`, qui retire `key`, `userId` et les
 *   jetons associés.
 */
import type pg from 'pg';
import type { Db } from '../db.ts';
import { redactShareText } from '../jow/share.ts';
import type { Confidence, MealNutrition, NutritionItem } from '../nutrition/compute.ts';
import { calculerNutrition } from '../nutrition/compute.ts';
import { ApiError } from '../http/errors.ts';
import { calculerShares } from '../nutrition/shares.ts';
import { loadFoodValues } from './foods.ts';
import { ingredientsAsItems, loadIngredients, loadRecipe } from './recipes.ts';
import { loadUnitDefaults } from './refs.ts';

export const SLOTS = ['petit_dej', 'dejeuner', 'gouter', 'diner', 'collation'] as const;
export type Slot = (typeof SLOTS)[number];

export const SOURCES = ['jow', 'texte', 'photo', 'template', 'manuel'] as const;
export type MealSource = (typeof SOURCES)[number];

export interface MealItemInput {
  foodId: string | null;
  label: string;
  quantity: number | null;
  unit: string | null;
  /** Déjà en grammes, si l'utilisateur les a saisis directement. */
  quantityG: number | null;
}

export interface CreateMealInput {
  eatenAt: string;
  slot: Slot;
  source: MealSource;
  recipeId?: string | null;
  servings?: number;
  leftoverOf?: string | null;
  guestCount?: number;
  items?: MealItemInput[];
  /** Le client envoie `present`, **jamais** `share` (§12). */
  participants: { eaterId: string; present: boolean }[];
  note?: string | null;
  rawInput?: string | null;
  createdBy?: string | null;
}

export interface MealItem extends MealItemInput {
  id: string;
  position: number;
  foodName: string | null;
  plantBased: boolean | null;
}

export interface MealParticipant {
  eaterId: string;
  firstName: string;
  share: number;
}

export interface Meal {
  id: string;
  eatenAt: string;
  slot: Slot;
  source: MealSource;
  servings: number;
  guestCount: number;
  leftoverOf: string | null;
  note: string | null;
  recipe: { id: string; title: string; imageUrl: string | null; nutriScore: string | null } | null;
  items: MealItem[];
  participants: MealParticipant[];
  nutrition: StoredNutrition | null;
  /**
   * Nombre de produits de saison de la recette, ce mois-ci (§8bis) — le badge
   * de la carte de repas. Vaut 0 tant que `seasonal_produce` n'est pas saisie,
   * et le badge ne s'affiche alors pas.
   */
  seasonalCount: number;
}

export interface StoredNutrition {
  /** Bornes basses : ce qui est garanti atteint. */
  kcal: number | null;
  proteinG: number | null;
  carbG: number | null;
  fatG: number | null;
  fiberG: number | null;
  /** Bornes hautes. `null` = non bornée (un aliment échappe au référentiel). */
  max: {
    kcal: number | null;
    proteinG: number | null;
    carbG: number | null;
    fatG: number | null;
    fiberG: number | null;
  };
  plantRatio: number | null;
  gramsTotal: number | null;
  gramsPlant: number | null;
  gramsClassified: number | null;
  confidence: Confidence;
}

// ── écriture ────────────────────────────────────────────────────────────────

export async function createMeal(
  client: pg.PoolClient,
  householdId: string,
  input: CreateMealInput,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into meal (household_id, eaten_at, slot, source, recipe_id, servings,
                       leftover_of, guest_count, raw_input, note, created_by)
     -- Les casts ne sont pas décoratifs : sans eux Postgres déduit le type du
     -- littéral de coalesce, et « 2,5 parts » échoue en entier invalide.
     values ($1, $2::timestamptz, $3, $4, $5, coalesce($6::numeric, 1), $7,
             coalesce($8::int, 0), $9, $10, $11)
     returning id`,
    [
      householdId, input.eatenAt, input.slot, input.source, input.recipeId ?? null,
      input.servings ?? null, input.leftoverOf ?? null, input.guestCount ?? null,
      // I6 : le texte brut ne doit jamais atteindre `meal.raw_input`.
      input.rawInput === null || input.rawInput === undefined
        ? null
        : redactShareText(input.rawInput),
      input.note ?? null, input.createdBy ?? null,
    ],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('repas non créé');

  await writeItems(client, id, input.items ?? []);
  await writeShares(client, householdId, id, input.participants, input.guestCount ?? 0);
  await recomputeNutrition(client, id);
  return id;
}

async function writeItems(
  client: pg.PoolClient,
  mealId: string,
  items: MealItemInput[],
): Promise<void> {
  await client.query('delete from meal_item where meal_id = $1', [mealId]);
  for (const [position, item] of items.entries()) {
    await client.query(
      `insert into meal_item (meal_id, food_id, label, quantity, unit, quantity_g, position)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [mealId, item.foodId, item.label, item.quantity, item.unit, item.quantityG, position],
    );
  }
}

/**
 * Calcule et fige les parts (R2).
 *
 * Appelée à la création, et **uniquement** lors d'une modification qui change
 * qui était à table ou le nombre d'invités : dans ce cas les parts précédentes
 * ne décrivent plus le repas et il faut bien les réécrire. Ce n'est pas une
 * entorse à R2, qui interdit qu'un changement de `portion_coef` réécrive
 * l'historique — et ce chemin-là n'existe nulle part.
 */
async function writeShares(
  client: pg.PoolClient,
  householdId: string,
  mealId: string,
  participants: { eaterId: string; present: boolean }[],
  guestCount: number,
): Promise<void> {
  const presentIds = participants.filter((p) => p.present).map((p) => p.eaterId);
  await client.query('delete from meal_participant where meal_id = $1', [mealId]);
  if (presentIds.length === 0) return;

  const { rows } = await client.query<{ id: string; portion_coef: number }>(
    'select id, portion_coef from eater where household_id = $1 and id = any($2::uuid[])',
    [householdId, presentIds],
  );
  if (rows.length !== presentIds.length) {
    // 400 et non 500 : la requête est fautive, pas le serveur. Un identifiant
    // de convive venu d'un autre foyer arrive forcément d'un client qui l'a
    // fabriqué — le traiter comme une panne interne le journaliserait comme
    // telle et rendrait un message qui n'aide personne.
    throw ApiError.badRequest('un convive ne fait pas partie de ce foyer', 'convive_inconnu');
  }

  const shares = calculerShares(
    rows.map((r) => ({ eaterId: r.id, portionCoef: r.portion_coef })),
    guestCount,
  );
  for (const { eaterId, share } of shares) {
    await client.query(
      'insert into meal_participant (meal_id, eater_id, share) values ($1, $2, $3)',
      [mealId, eaterId, share],
    );
  }
}

export interface MealPatch {
  eatenAt?: string;
  slot?: Slot;
  servings?: number;
  guestCount?: number;
  note?: string | null;
  recipeId?: string | null;
  items?: MealItemInput[];
  participants?: { eaterId: string; present: boolean }[];
}

/**
 * Modifie un repas. **Recalcule la nutrition, jamais les shares** (§12) — sauf
 * si la modification porte précisément sur qui était à table.
 */
export async function updateMeal(
  client: pg.PoolClient,
  householdId: string,
  mealId: string,
  patch: MealPatch,
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [householdId, mealId];
  const set = (column: string, value: unknown): void => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  if (patch.eatenAt !== undefined) set('eaten_at', patch.eatenAt);
  if (patch.slot !== undefined) set('slot', patch.slot);
  if (patch.servings !== undefined) set('servings', patch.servings);
  if (patch.guestCount !== undefined) set('guest_count', patch.guestCount);
  if (patch.note !== undefined) set('note', patch.note);
  if (patch.recipeId !== undefined) set('recipe_id', patch.recipeId);

  if (sets.length > 0) {
    const { rowCount } = await client.query(
      `update meal set ${sets.join(', ')} where household_id = $1 and id = $2`,
      params,
    );
    if (rowCount === 0) return false;
  } else {
    const { rowCount } = await client.query(
      'select 1 from meal where household_id = $1 and id = $2',
      [householdId, mealId],
    );
    if (rowCount === 0) return false;
  }

  if (patch.items !== undefined) await writeItems(client, mealId, patch.items);

  // Les parts ne bougent que si l'on touche à qui était à table. Le nombre
  // d'invités entre au dénominateur : le corriger change bien les parts.
  if (patch.participants !== undefined || patch.guestCount !== undefined) {
    const participants =
      patch.participants ??
      (await currentParticipants(client, mealId)).map((eaterId) => ({ eaterId, present: true }));
    const guestCount = patch.guestCount ?? (await currentGuestCount(client, mealId));
    await writeShares(client, householdId, mealId, participants, guestCount);
  }

  await recomputeNutrition(client, mealId);
  return true;
}

async function currentParticipants(client: pg.PoolClient, mealId: string): Promise<string[]> {
  const { rows } = await client.query<{ eater_id: string }>(
    'select eater_id from meal_participant where meal_id = $1',
    [mealId],
  );
  return rows.map((r) => r.eater_id);
}

async function currentGuestCount(client: pg.PoolClient, mealId: string): Promise<number> {
  const { rows } = await client.query<{ guest_count: number }>(
    'select guest_count from meal where id = $1',
    [mealId],
  );
  return rows[0]?.guest_count ?? 0;
}

export async function deleteMeal(db: Db, householdId: string, mealId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    'delete from meal where household_id = $1 and id = $2',
    [householdId, mealId],
  );
  return (rowCount ?? 0) > 0;
}

// ── calcul (§11, en applicatif) ─────────────────────────────────────────────

/**
 * Recalcule `meal_nutrition` et les `quantity_g` résolus d'un repas.
 *
 * Rejouable à volonté : le résultat ne dépend que du repas, du référentiel et
 * de `unit_default`. C'est ce qui rend une modification sûre — on ne patche
 * pas un total, on le refait.
 */
export async function recomputeNutrition(
  client: pg.PoolClient,
  mealId: string,
): Promise<MealNutrition> {
  const { rows: mealRows } = await client.query<{
    servings: number; source: MealSource; recipe_id: string | null;
  }>('select servings, source, recipe_id from meal where id = $1', [mealId]);
  const meal = mealRows[0];
  if (meal === undefined) throw new Error('repas introuvable');

  const { rows: itemRows } = await client.query<{
    id: string; food_id: string | null; label: string;
    quantity: number | null; unit: string | null; quantity_g: number | null;
  }>(
    `select id, food_id, label, quantity, unit, quantity_g
     from meal_item where meal_id = $1 order by position`,
    [mealId],
  );

  const recipe = meal.recipe_id === null ? null : await loadRecipe(client, meal.recipe_id);
  const ingredients = recipe === null ? [] : recipe.ingredients;

  const foodIds = [
    ...itemRows.map((r) => r.food_id),
    ...ingredients.map((i) => i.foodId),
  ].filter((id): id is string => id !== null);
  const foods = await loadFoodValues(client, [...new Set(foodIds)]);
  const defaults = await loadUnitDefaults(client);

  const items: NutritionItem[] = itemRows.map((row) => ({
    label: row.label,
    food: row.food_id === null ? null : foods.get(row.food_id) ?? null,
    quantity: row.quantity,
    unit: row.unit,
    quantityG: row.quantity_g,
  }));

  const result = calculerNutrition(
    {
      servings: meal.servings,
      source: meal.source,
      recipe: recipe?.snapshot ?? null,
      items,
      recipeIngredients: ingredientsAsItems(ingredients, foods),
    },
    defaults,
  );

  // Les grammes résolus par §6 sont réécrits : la prochaine lecture n'a plus à
  // les redériver, et l'écran de détail peut montrer ce qui a été résolu.
  for (const [index, item] of result.items.entries()) {
    const row = itemRows[index];
    if (row === undefined || row.quantity_g === item.quantityG) continue;
    await client.query('update meal_item set quantity_g = $2 where id = $1', [
      row.id,
      item.quantityG,
    ]);
  }

  await client.query(
    `insert into meal_nutrition (meal_id, kcal, protein_g, carb_g, fat_g, fiber_g,
                                 kcal_max, protein_g_max, carb_g_max, fat_g_max, fiber_g_max,
                                 plant_ratio, grams_total, grams_plant, grams_classified,
                                 confidence, computed_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now())
     on conflict (meal_id) do update set
       kcal = excluded.kcal, protein_g = excluded.protein_g, carb_g = excluded.carb_g,
       fat_g = excluded.fat_g, fiber_g = excluded.fiber_g,
       kcal_max = excluded.kcal_max, protein_g_max = excluded.protein_g_max,
       carb_g_max = excluded.carb_g_max, fat_g_max = excluded.fat_g_max,
       fiber_g_max = excluded.fiber_g_max,
       plant_ratio = excluded.plant_ratio, grams_total = excluded.grams_total,
       grams_plant = excluded.grams_plant, grams_classified = excluded.grams_classified,
       confidence = excluded.confidence, computed_at = now()`,
    [
      mealId, result.kcal, result.proteinG, result.carbG, result.fatG, result.fiberG,
      result.max.kcal, result.max.proteinG, result.max.carbG, result.max.fatG, result.max.fiberG,
      result.plantRatio, result.gramsTotal, result.gramsPlant, result.gramsClassified,
      result.confidence,
    ],
  );

  return result;
}

/**
 * Recalcule les repas dont une recette emploie cet ingrédient Jow.
 *
 * Rattacher « Purée de carotte » ne change aucune valeur nutritionnelle — la
 * nutrition d'un repas Jow vient du snapshot — mais change la **part
 * végétale**, qui dépend de `food.plant_based`. Le recalcul est donc ce qui
 * rend le geste visible.
 *
 * Les parts (`meal_participant.share`) ne sont pas touchées : R2 tient, seul
 * `meal_nutrition` est réécrit.
 */
export async function recomputeMealsUsingIngredient(
  client: pg.PoolClient,
  householdId: string,
  jowFoodId: string,
): Promise<number> {
  const { rows } = await client.query<{ id: string }>(
    `select distinct m.id
     from meal m
     join recipe_ingredient ri on ri.recipe_id = m.recipe_id
     where m.household_id = $1 and ri.jow_food_id = $2`,
    [householdId, jowFoodId],
  );
  for (const row of rows) await recomputeNutrition(client, row.id);
  return rows.length;
}

// ── lecture ─────────────────────────────────────────────────────────────────

const MEAL_SELECT = `
  select m.id, m.eaten_at, m.slot, m.source, m.servings, m.guest_count,
         m.leftover_of, m.note,
         r.id as recipe_id, r.title as recipe_title, r.image_url, r.nutri_score,
         n.kcal, n.protein_g, n.carb_g, n.fat_g, n.fiber_g,
         n.kcal_max, n.protein_g_max, n.carb_g_max, n.fat_g_max, n.fiber_g_max,
         n.plant_ratio, n.grams_total, n.grams_plant, n.grams_classified, n.confidence
  from meal m
  left join recipe r on r.id = m.recipe_id
  left join meal_nutrition n on n.meal_id = m.id`;

interface MealRow {
  id: string; eaten_at: Date; slot: Slot; source: MealSource; servings: number;
  guest_count: number; leftover_of: string | null; note: string | null;
  recipe_id: string | null; recipe_title: string | null; image_url: string | null;
  nutri_score: string | null;
  kcal: number | null; protein_g: number | null; carb_g: number | null;
  fat_g: number | null; fiber_g: number | null;
  kcal_max: number | null; protein_g_max: number | null; carb_g_max: number | null;
  fat_g_max: number | null; fiber_g_max: number | null;
  plant_ratio: number | null;
  grams_total: number | null; grams_plant: number | null; grams_classified: number | null;
  confidence: Confidence | null;
}

export async function listMeals(
  db: Db,
  householdId: string,
  from: string,
  to: string,
): Promise<Meal[]> {
  const { rows } = await db.query<MealRow>(
    `${MEAL_SELECT} where m.household_id = $1 and m.eaten_at >= $2 and m.eaten_at < $3
     order by m.eaten_at desc`,
    [householdId, from, to],
  );
  return hydrate(db, rows);
}

export async function getMeal(db: Db, householdId: string, id: string): Promise<Meal | null> {
  const { rows } = await db.query<MealRow>(
    `${MEAL_SELECT} where m.household_id = $1 and m.id = $2`,
    [householdId, id],
  );
  const [meal] = await hydrate(db, rows);
  return meal ?? null;
}

/**
 * Repas des N derniers jours portant une recette — la liste du bouton
 * « Restes de… » (§6bis).
 *
 * Les repas déjà marqués comme restes d'un autre sont exclus : proposer
 * « restes des restes » allonge la liste sans rien apporter, et la liste est
 * ce qui doit rester courte pour que le bouton tienne sa promesse de deux taps.
 */
export async function recentWithRecipe(
  db: Db,
  householdId: string,
  days = 3,
  limit = 6,
): Promise<Meal[]> {
  const { rows } = await db.query<MealRow>(
    `${MEAL_SELECT}
     where m.household_id = $1
       and m.recipe_id is not null
       and m.leftover_of is null
       and m.eaten_at > now() - ($2 || ' days')::interval
     order by m.eaten_at desc
     limit $3`,
    [householdId, String(days), limit],
  );
  return hydrate(db, rows);
}

async function hydrate(db: Db, rows: MealRow[]): Promise<Meal[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const { rows: itemRows } = await db.query<{
    meal_id: string; id: string; food_id: string | null; label: string;
    quantity: number | null; unit: string | null; quantity_g: number | null;
    position: number; food_name: string | null; plant_based: boolean | null;
  }>(
    `select mi.meal_id, mi.id, mi.food_id, mi.label, mi.quantity, mi.unit, mi.quantity_g,
            mi.position, f.name as food_name, f.plant_based
     from meal_item mi
     left join food f on f.id = mi.food_id
     where mi.meal_id = any($1::uuid[])
     order by mi.position`,
    [ids],
  );

  // Croisement recipe_ingredient × seasonal_produce pour tous les repas d'un
  // coup : une requête par carte affichée serait un N+1 pour un badge.
  //
  // Le mois est lu **dans le fuseau du foyer**, joint depuis `household` plutôt
  // que passé en paramètre : un dîner du 31 août à 23 h heure de Paris compte
  // pour août, pas pour septembre. Le sortir de la requête reviendrait à
  // confier ce soin à chaque appelant, et l'un d'eux finirait par l'oublier.
  const { rows: seasonRows } = await db.query<{ meal_id: string; count: number }>(
    `select m.id as meal_id, count(distinct sp.id)::int as count
     from meal m
     join household h on h.id = m.household_id
     join recipe_ingredient ri on ri.recipe_id = m.recipe_id
     join seasonal_produce sp on sp.food_id = ri.food_id
     where m.id = any($1::uuid[])
       and extract(month from (m.eaten_at at time zone h.timezone)) = any(sp.months)
     group by m.id`,
    [ids],
  );
  const seasonal = new Map(seasonRows.map((r) => [r.meal_id, r.count]));

  const { rows: partRows } = await db.query<{
    meal_id: string; eater_id: string; first_name: string; share: number;
  }>(
    `select mp.meal_id, mp.eater_id, mb.first_name, mp.share
     from meal_participant mp
     join eater mb on mb.id = mp.eater_id
     where mp.meal_id = any($1::uuid[])
     order by mb.birth_date`,
    [ids],
  );

  const itemsByMeal = new Map<string, MealItem[]>();
  for (const row of itemRows) {
    const list = itemsByMeal.get(row.meal_id) ?? [];
    list.push({
      id: row.id, foodId: row.food_id, label: row.label, quantity: row.quantity,
      unit: row.unit, quantityG: row.quantity_g, position: row.position,
      foodName: row.food_name, plantBased: row.plant_based,
    });
    itemsByMeal.set(row.meal_id, list);
  }

  const partsByMeal = new Map<string, MealParticipant[]>();
  for (const row of partRows) {
    const list = partsByMeal.get(row.meal_id) ?? [];
    list.push({ eaterId: row.eater_id, firstName: row.first_name, share: row.share });
    partsByMeal.set(row.meal_id, list);
  }

  return rows.map((row) => ({
    id: row.id,
    eatenAt: row.eaten_at.toISOString(),
    slot: row.slot,
    source: row.source,
    servings: row.servings,
    guestCount: row.guest_count,
    leftoverOf: row.leftover_of,
    note: row.note,
    recipe:
      row.recipe_id === null
        ? null
        : {
            id: row.recipe_id,
            title: row.recipe_title ?? '',
            imageUrl: row.image_url,
            nutriScore: row.nutri_score,
          },
    items: itemsByMeal.get(row.id) ?? [],
    participants: partsByMeal.get(row.id) ?? [],
    seasonalCount: seasonal.get(row.id) ?? 0,
    nutrition:
      row.confidence === null
        ? null
        : {
            kcal: row.kcal, proteinG: row.protein_g, carbG: row.carb_g,
            fatG: row.fat_g, fiberG: row.fiber_g,
            max: {
              kcal: row.kcal_max, proteinG: row.protein_g_max, carbG: row.carb_g_max,
              fatG: row.fat_g_max, fiberG: row.fiber_g_max,
            },
            plantRatio: row.plant_ratio,
            gramsTotal: row.grams_total, gramsPlant: row.grams_plant,
            gramsClassified: row.grams_classified, confidence: row.confidence,
          },
  }));
}

/** Ingrédients d'une recette, pour pré-remplir l'écran de détail. */
export { loadIngredients };
