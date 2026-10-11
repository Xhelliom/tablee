/**
 * Le stock de plats à venir (023) : ce qui est commandé et pas encore mangé.
 *
 * Aucune date : on choisit le plat le jour même. Retirer un plat, c'est le
 * seul geste qui le fait sortir — mangé ou abandonné, le stock n'en sait rien.
 */
import type { HouseholdDb } from '../db.ts';

export interface UpcomingDish {
  id: string;
  addedAt: string;
  recipe: {
    id: string; title: string; imageUrl: string | null; baseServings: number; url: string | null;
  };
}

interface Row {
  id: string; added_at: Date; recipe_id: string; title: string;
  image_url: string | null; base_servings: number; url: string | null;
}

const SELECT = `select d.id, d.added_at, r.id as recipe_id, r.title, r.image_url,
                       r.base_servings, r.url
                from upcoming_dish d join recipe r on r.id = d.recipe_id`;

const toDish = (row: Row): UpcomingDish => ({
  id: row.id,
  addedAt: row.added_at.toISOString(),
  recipe: {
    id: row.recipe_id, title: row.title, imageUrl: row.image_url,
    baseServings: row.base_servings, url: row.url,
  },
});

/** Le plus ancien d'abord : c'est la commande qu'on a le plus gardée. */
export async function listUpcomingDishes(db: HouseholdDb, householdId: string): Promise<UpcomingDish[]> {
  const { rows } = await db.query<Row>(
    `${SELECT} where d.household_id = $1 order by d.added_at, d.id`, [householdId]);
  return rows.map(toDish);
}

/** `null` si le foyer ne connaît pas cette recette (`household_recipe`). */
export async function addUpcomingDish(
  db: HouseholdDb, householdId: string, recipeId: string,
): Promise<UpcomingDish | null> {
  const { rows } = await db.query<{ id: string }>(
    `insert into upcoming_dish (household_id, recipe_id)
     select $1, recipe_id from household_recipe where household_id = $1 and recipe_id = $2
     returning id`,
    [householdId, recipeId],
  );
  const id = rows[0]?.id;
  if (id === undefined) return null;
  const { rows: full } = await db.query<Row>(`${SELECT} where d.id = $1`, [id]);
  return full[0] === undefined ? null : toDish(full[0]);
}

/**
 * La recette du plat retiré, `null` s'il n'y était plus. Le `delete` verrouille
 * la ligne : de deux retraits simultanés, le second attend et ne trouve rien.
 */
export async function removeUpcomingDish(
  db: HouseholdDb, householdId: string, id: string,
): Promise<string | null> {
  const { rows } = await db.query<{ recipe_id: string }>(
    'delete from upcoming_dish where household_id = $1 and id = $2 returning recipe_id',
    [householdId, id]);
  return rows[0]?.recipe_id ?? null;
}
