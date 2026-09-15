/**
 * Référentiel `food` : recherche plein texte et lecture des valeurs.
 */
import type { UnscopedDb } from '../db.ts';
import type { FoodValues } from '../nutrition/compute.ts';

export interface FoodSummary {
  id: string;
  name: string;
  source: 'ciqual' | 'off' | 'jow' | 'manuel';
  category: string | null;
  plantBased: boolean | null;
  /**
   * Au moins une teneur des barres est connue. Pas l'énergie : l'ANSES ne la
   * publie pas pour des centaines d'aliments dont elle donne les macros, et
   * « valeur inconnue » les faisait écarter à tort (15/09/2026).
   */
  nutrientsKnown: boolean;
  /** Les unités que cet aliment sait convertir lui-même (§6, étape 2). */
  units: string[];
}

interface ValuesRow {
  id: string; name: string; plant_based: boolean | null; category: string | null;
  kcal_100g: number | null; protein_100g: number | null; carb_100g: number | null;
  fat_100g: number | null; fiber_100g: number | null;
  kcal_100g_max: number | null; protein_100g_max: number | null;
  carb_100g_max: number | null; fat_100g_max: number | null; fiber_100g_max: number | null;
  unit_weights: Record<string, number>;
}

const toValues = (row: ValuesRow): FoodValues => ({
  name: row.name,
  plantBased: row.plant_based,
  unitWeights: row.unit_weights,
  category: row.category,
  per100g: {
    kcal: row.kcal_100g,
    proteinG: row.protein_100g,
    carbG: row.carb_100g,
    fatG: row.fat_100g,
    fiberG: row.fiber_100g,
  },
  // Bornes hautes : égales à la valeur quand elle est exacte, au seuil quand
  // la source n'écrit qu'un « < X », nulles quand rien n'est borné.
  per100gMax: {
    kcal: row.kcal_100g_max,
    proteinG: row.protein_100g_max,
    carbG: row.carb_100g_max,
    fatG: row.fat_100g_max,
    fiberG: row.fiber_100g_max,
  },
});

export async function loadFoodValues(db: UnscopedDb, ids: string[]): Promise<Map<string, FoodValues>> {
  if (ids.length === 0) return new Map();
  const { rows } = await db.query<ValuesRow>(
    `select id, name, plant_based, category,
            kcal_100g, protein_100g, carb_100g, fat_100g, fiber_100g,
            kcal_100g_max, protein_100g_max, carb_100g_max, fat_100g_max, fiber_100g_max,
            unit_weights
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
/**
 * Le référentiel contient-il quelque chose ?
 *
 * Une recherche vide a deux causes très différentes — « ce mot ne donne rien »
 * et « la table Ciqual n'a jamais été importée » — et l'écran ne peut pas les
 * distinguer seul. Sans cette question, le second cas ressemble à un bug de
 * recherche, ce qu'il n'est pas.
 */
export async function hasFoodReferential(db: UnscopedDb): Promise<boolean> {
  const { rows } = await db.query('select 1 from food limit 1');
  return rows.length > 0;
}

export async function searchFoods(db: UnscopedDb, query: string, limit = 20): Promise<FoodSummary[]> {
  // Ciqual écrit « Oeuf », « Boeuf » : aucun nom du référentiel ne porte de
  // ligature (vérifié). Celle d'un libellé Jow ou d'une saisie ne trouvait rien.
  const trimmed = query.trim()
    .replace(/œ/g, 'oe').replace(/Œ/g, 'Oe').replace(/æ/g, 'ae').replace(/Æ/g, 'Ae');
  if (trimmed.length < 2) return [];

  // Tous les mots d'abord. À défaut, n'importe lequel, ceux qui en portent le
  // plus en tête : Jow dit « Sauce soja salée » et « Haricot vert (frais) »,
  // Ciqual « Sauce soja, préemballée » et « Haricot vert, cru » — exiger chaque
  // mot ne ramenait rien.
  const mots = words(trimmed);
  // Le dernier mot est un préfixe, pour que « cour » remonte « courgette »
  // pendant qu'on tape.
  const termes = mots.map((mot, i) => (i === mots.length - 1 ? `${mot}:*` : mot));
  const tous = await matchFoods(db, trimmed, termes.length === 0 ? null : termes.join(' & '), termes, limit);
  if (tous.length > 0 || mots.length < 2) return tous;
  // Élargie, et sans préfixe : « salée:* » y rapprocherait « salade », et une
  // sauce crudités passerait devant la sauce soja.
  return matchFoods(db, trimmed, mots.join(' | '), termes, limit);
}

/**
 * L'ordre : le plus de termes de la recherche d'abord — le dernier compté comme
 * un préfixe, sans quoi « cour » rangerait « courant » devant « courgette » —,
 * puis le nom le plus court. Pas `ts_rank`, qui préfère un mot répété : « Oeuf,
 * jaune (jaune d'oeuf), cru » passait devant « Oeuf, cru », alors que chez
 * Ciqual le nom le plus court est l'aliment de base.
 */
async function matchFoods(
  db: UnscopedDb,
  raw: string,
  tsquery: string | null,
  termes: string[],
  limit: number,
): Promise<FoodSummary[]> {
  const { rows } = await db.query<{
    id: string; name: string; source: FoodSummary['source']; category: string | null;
    plant_based: boolean | null; nutrients_known: boolean; unit_weights: Record<string, number>;
  }>(
    `with q as (
       select websearch_to_tsquery('french', $1) as exact,
              to_tsquery('french', $2) as prefix
     )
     select f.id, f.name, f.source, f.category, f.plant_based, f.unit_weights,
            coalesce(f.protein_100g, f.carb_100g, f.fat_100g, f.fiber_100g) is not null as nutrients_known
     from food f, q
     where to_tsvector('french', f.name) @@ coalesce(q.prefix, q.exact)
     order by (select count(*) from unnest($4::text[]) terme
                where to_tsvector('french', f.name) @@ to_tsquery('french', terme)) desc,
              length(f.name) asc
     limit $3`,
    [raw, tsquery, limit, termes],
  );

  return rows.map((r) => ({
    id: r.id, name: r.name, source: r.source, category: r.category,
    plantBased: r.plant_based, nutrientsKnown: r.nutrients_known,
    units: Object.keys(r.unit_weights ?? {}),
  }));
}

/**
 * Les mots d'une recherche. Les caractères de syntaxe tsquery sont retirés
 * plutôt qu'échappés : une recherche n'a pas à interpréter ce qu'on tape.
 */
const words = (raw: string): string[] =>
  raw.replace(/[&|!():*<>'"\\]/g, ' ').split(/\s+/).filter((w) => w.length > 0);
/** Crée un aliment saisi à la main. Aucune valeur n'est déduite (I1). */
export async function createManualFood(
  db: UnscopedDb,
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
