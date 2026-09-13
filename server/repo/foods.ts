/**
 * Référentiel `food` : recherche plein texte et lecture des valeurs.
 */
import type { Db } from '../db.ts';
import type { FoodValues } from '../nutrition/compute.ts';

export interface FoodSummary {
  id: string;
  name: string;
  source: 'ciqual' | 'off' | 'jow' | 'manuel';
  category: string | null;
  plantBased: boolean | null;
  kcal100g: number | null;
  /** Les unités que cet aliment sait convertir lui-même (§6, étape 2). */
  units: string[];
}

interface ValuesRow {
  id: string; name: string; plant_based: boolean | null;
  kcal_100g: number | null; protein_100g: number | null; carb_100g: number | null;
  fat_100g: number | null; fiber_100g: number | null;
  unit_weights: Record<string, number>;
}

const toValues = (row: ValuesRow): FoodValues => ({
  name: row.name,
  plantBased: row.plant_based,
  unitWeights: row.unit_weights,
  per100g: {
    kcal: row.kcal_100g,
    proteinG: row.protein_100g,
    carbG: row.carb_100g,
    fatG: row.fat_100g,
    fiberG: row.fiber_100g,
  },
});

export async function loadFoodValues(db: Db, ids: string[]): Promise<Map<string, FoodValues>> {
  if (ids.length === 0) return new Map();
  const { rows } = await db.query<ValuesRow>(
    `select id, name, plant_based, kcal_100g, protein_100g, carb_100g, fat_100g,
            fiber_100g, unit_weights
     from food where id = any($1::uuid[])`,
    [ids],
  );
  return new Map(rows.map((row) => [row.id, toValues(row)]));
}

/**
 * Recherche plein texte française sur `food.name` (§12).
 *
 * `websearch_to_tsquery` accepte ce que les gens tapent réellement (« pain
 * complet », guillemets, `-mot`) au lieu d'exiger une syntaxe. Le préfixe est
 * ajouté sur le dernier mot pour que « cour » remonte « courgette » — sans
 * quoi il faut taper le mot entier avant d'avoir le moindre résultat, et
 * personne ne le fait deux fois.
 */
export async function searchFoods(db: Db, query: string, limit = 20): Promise<FoodSummary[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const { rows } = await db.query<{
    id: string; name: string; source: FoodSummary['source']; category: string | null;
    plant_based: boolean | null; kcal_100g: number | null; unit_weights: Record<string, number>;
  }>(
    `with q as (
       select websearch_to_tsquery('french', $1) as exact,
              to_tsquery('french', $2) as prefix
     )
     select f.id, f.name, f.source, f.category, f.plant_based, f.kcal_100g, f.unit_weights
     from food f, q
     where to_tsvector('french', f.name) @@ coalesce(q.prefix, q.exact)
     order by ts_rank(to_tsvector('french', f.name), coalesce(q.prefix, q.exact)) desc,
              length(f.name) asc
     limit $3`,
    [trimmed, prefixQuery(trimmed), limit],
  );

  return rows.map((r) => ({
    id: r.id, name: r.name, source: r.source, category: r.category,
    plantBased: r.plant_based, kcal100g: r.kcal_100g,
    units: Object.keys(r.unit_weights ?? {}),
  }));
}

/**
 * « pain complet » → `pain & complet:*`. Les caractères de syntaxe tsquery
 * sont retirés plutôt qu'échappés : une recherche n'a pas à interpréter ce que
 * l'utilisateur tape.
 */
function prefixQuery(raw: string): string | null {
  const words = raw
    .replace(/[&|!():*<>'"\\]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length === 0) return null;
  return words.map((word, i) => (i === words.length - 1 ? `${word}:*` : word)).join(' & ');
}

/** Crée un aliment saisi à la main. Aucune valeur n'est déduite (I1). */
export async function createManualFood(
  db: Db,
  input: { name: string; plantBased?: boolean | null },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into food (source, external_id, name, plant_based)
     values ('manuel', null, $1, $2) returning id`,
    [input.name, input.plantBased ?? null],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('aliment non créé');
  return id;
}
