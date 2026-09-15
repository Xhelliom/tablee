/**
 * Les images de plats dessinées par le modèle (015), une par ensemble
 * d'ingrédients et par foyer. Pourquoi par foyer et en base : en-tête de la
 * migration.
 */
import type { HouseholdDb } from '../db.ts';
import type { DishImage } from '../llm/image.ts';

/** Où l'écran lit l'image : derrière la session, comme le reste de l'API. */
export const dishImageUrl = (id: string): string => `/api/images/${id}`;

export async function findDishImage(db: HouseholdDb, householdId: string, tag: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    'select id from dish_image where household_id = $1 and tag = $2',
    [householdId, tag],
  );
  return rows[0]?.id ?? null;
}

/**
 * Garde une image, et rend son identifiant. Deux repas aux mêmes ingrédients
 * dessinés en même temps : la première image gagne, la seconde est jetée.
 */
export async function saveDishImage(
  db: HouseholdDb, householdId: string, tag: string, image: DishImage,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into dish_image (household_id, tag, mime_type, bytes) values ($1, $2, $3, $4)
     on conflict (household_id, tag) do update set tag = excluded.tag
     returning id`,
    [householdId, tag, image.mimeType, image.bytes],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('image non enregistrée');
  return id;
}

export async function setMealImage(
  db: HouseholdDb, householdId: string, mealId: string, imageId: string,
): Promise<void> {
  await db.query('update meal set image_id = $3 where household_id = $1 and id = $2', [householdId, mealId, imageId]);
}

export async function loadDishImage(db: HouseholdDb, id: string): Promise<DishImage | null> {
  const { rows } = await db.query<{ mime_type: string; bytes: Buffer }>(
    'select mime_type, bytes from dish_image where id = $1',
    [id],
  );
  const row = rows[0];
  return row === undefined ? null : { mimeType: row.mime_type, bytes: row.bytes };
}
