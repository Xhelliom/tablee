/**
 * ETL Ciqual (§5 de la spec) : l'export XML de l'ANSES → table `food`.
 *
 *   npm run seed:food                    # lit data/ciqual/
 *   npm run seed:food -- --dir=/ailleurs
 *   npm run seed:food -- --dry-run       # parse et rapporte, n'écrit rien
 *
 * L'export ne se télécharge pas depuis ce script : c'est un geste d'opérateur,
 * fait une fois, sur une source qui change une fois tous les quelques années.
 * Le script dit quoi télécharger et où le poser quand il ne trouve rien.
 *
 * Idempotent : `on conflict (source, external_id) do update`. Rejouer le seed
 * sur une base déjà peuplée met à jour les valeurs, ne duplique rien, et ne
 * touche pas aux `food` saisis à la main (`source='manuel'`) ni à ceux issus
 * de Jow.
 *
 * **Ce script n'écrit aucune valeur qu'il n'a pas lue.** Une teneur absente,
 * à l'état de traces ou sous le seuil de quantification est écrite `NULL`,
 * jamais `0` (I1). Le rapport final compte ces trous, colonne par colonne :
 * ils doivent se voir.
 */
import { createReadStream } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  CIQUAL_NUTRIENTS,
  decodeCiqual,
  parseCompoChunk,
  parseFoods,
  type CiqualFood,
  type NutrientColumn,
  type TeneurKind,
} from '../server/food/ciqual.ts';
import { classify, isKnownSubgroup } from '../server/food/groups.ts';
import { closePool, getPool } from '../server/db.ts';

const SOURCE_URL =
  'https://ciqual.anses.fr/cms/sites/default/files/inline-files/XML_2020_07_07.zip';

const DEFAULT_DIR = fileURLToPath(new URL('../data/ciqual/', import.meta.url));
const CHUNK = 200;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dir = args.find((a) => a.startsWith('--dir='))?.slice('--dir='.length) ?? DEFAULT_DIR;

interface FoodRow {
  externalId: string;
  name: string;
  category: string | null;
  plantBased: boolean | null;
  /** Borne basse par colonne — ce qui est garanti atteint. */
  values: Partial<Record<NutrientColumn, number | null>>;
  /** Borne haute par colonne. Absente = non bornée. */
  maxima: Partial<Record<NutrientColumn, number | null>>;
}

/**
 * Trouve `alim_<date>.xml` / `compo_<date>.xml` sans dépendre de la date de
 * l'export. Le préfixe est suivi d'un chiffre : sans cela, `alim_` attraperait
 * aussi `alim_grp_<date>.xml`, qui décrit les groupes et non les aliments.
 */
async function locate(prefix: string): Promise<string> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    throw new Error(
      `dossier introuvable : ${dir}\n` +
        `  Télécharger ${SOURCE_URL}\n` +
        `  puis le décompresser dans ce dossier (il est couvert par .gitignore).`,
    );
  }
  const pattern = new RegExp(`^${prefix}\\d[\\w ]*\\.xml$`);
  const found = entries.filter((f) => pattern.test(f)).sort();
  const file = found.at(-1);
  if (file === undefined) {
    throw new Error(
      `aucun fichier ${prefix}*.xml dans ${dir}\n` +
        `  Télécharger ${SOURCE_URL} et le décompresser ici.\n` +
        `  Attendu : alim_<date>.xml et compo_<date>.xml.`,
    );
  }
  return path.join(dir, file);
}

/**
 * Lit `compo_*.xml` en flux. 57 Mo tiendraient en mémoire, mais le fichier
 * grossit à chaque édition de la table et rien n'oblige à le charger entier :
 * on découpe sur `</COMPO>`, qui ne peut pas apparaître ailleurs.
 */
async function readCompo(
  file: string,
  onRow: (row: ReturnType<typeof parseCompoChunk>[number]) => void,
): Promise<void> {
  const decoder = new TextDecoder('windows-1252');
  let buffer = '';
  for await (const chunk of createReadStream(file)) {
    buffer += decoder.decode(chunk as Uint8Array, { stream: true });
    const cut = buffer.lastIndexOf('</COMPO>');
    if (cut === -1) continue;
    for (const row of parseCompoChunk(buffer.slice(0, cut + 8))) onRow(row);
    buffer = buffer.slice(cut + 8);
  }
  buffer += decoder.decode();
  for (const row of parseCompoChunk(buffer)) onRow(row);
}

async function main(): Promise<void> {
  const alimFile = await locate('alim_');
  const compoFile = await locate('compo_');

  const foods: CiqualFood[] = parseFoods(decodeCiqual(await readFile(alimFile)));
  if (foods.length === 0) {
    throw new Error(`${alimFile} ne contient aucun aliment exploitable`);
  }

  const rows = new Map<string, FoodRow>();
  const unknownSubgroups = new Set<string>();
  for (const food of foods) {
    const { category, plantBased } = classify(food.subgroupCode, food.name);
    if (!isKnownSubgroup(food.subgroupCode)) unknownSubgroups.add(food.subgroupCode);
    rows.set(food.code, {
      externalId: food.code,
      name: food.name,
      category,
      plantBased,
      values: {},
      maxima: {},
    });
  }

  // Pourquoi chaque trou est un trou : rapporté à la fin, pas seulement compté.
  const holes: Record<NutrientColumn, Record<TeneurKind, number>> = blankHoles();
  await readCompo(compoFile, (row) => {
    const food = rows.get(row.foodCode);
    if (food === undefined) return;
    food.values[row.column] = row.teneur.value;
    food.maxima[row.column] = row.teneur.max;
    const perColumn = holes[row.column];
    perColumn[row.teneur.kind] += 1;
  });

  report(rows, holes, unknownSubgroups);

  if (dryRun) {
    console.log('\n--dry-run : rien n’a été écrit.');
    return;
  }

  const pool = getPool();
  try {
    const list = [...rows.values()];
    let written = 0;
    for (let i = 0; i < list.length; i += CHUNK) {
      written += await upsert(pool, list.slice(i, i + CHUNK));
    }
    console.log(`\n${written} aliment(s) écrit(s) dans food (source='ciqual').`);
  } finally {
    await closePool();
  }
}

const COLUMNS: NutrientColumn[] = Object.values(CIQUAL_NUTRIENTS);

async function upsert(pool: ReturnType<typeof getPool>, batch: FoodRow[]): Promise<number> {
  const params: unknown[] = [];
  const tuples = batch.map((row) => {
    const base = params.length;
    params.push(
      row.externalId,
      row.name,
      row.category,
      row.plantBased,
      ...COLUMNS.map((c) => row.values[c] ?? null),
      ...COLUMNS.map((c) => row.maxima[c] ?? null),
    );
    const holders = Array.from({ length: 4 + COLUMNS.length * 2 }, (_, k) => `$${base + k + 1}`);
    return `(${holders.join(',')})`;
  });

  // `do update` et non `do nothing` : rejouer le seed après une mise à jour de
  // la table Ciqual doit corriger les valeurs, sinon le seed n'est idempotent
  // qu'en apparence.
  const maxColumns = COLUMNS.map((c) => `${c}_max`);
  const sql = `
    insert into food (
      external_id, name, category, plant_based,
      ${COLUMNS.join(', ')}, ${maxColumns.join(', ')}, source
    )
    select v.external_id, v.name, v.category, v.plant_based::boolean,
           ${[...COLUMNS, ...maxColumns].map((c) => `v.${c}::numeric`).join(', ')}, 'ciqual'
    -- Une clause values sans types arrive en text : les casts ci-dessus sont
    -- nécessaires, et ils ne convertissent rien — un NULL reste un NULL.
    from (values ${tuples.join(',')}) as v (
      external_id, name, category, plant_based,
      ${COLUMNS.join(', ')}, ${maxColumns.join(', ')}
    )
    on conflict (source, external_id) do update set
      name         = excluded.name,
      category     = excluded.category,
      plant_based  = excluded.plant_based,
      ${[...COLUMNS, ...maxColumns].map((c) => `${c} = excluded.${c}`).join(',\n      ')},
      updated_at   = now()
  `;
  const result = await pool.query(sql, params);
  return result.rowCount ?? 0;
}

function blankHoles(): Record<NutrientColumn, Record<TeneurKind, number>> {
  const kinds = (): Record<TeneurKind, number> => ({
    valeur: 0, absente: 0, traces: 0, seuil: 0, illisible: 0,
  });
  return {
    kcal_100g: kinds(), protein_100g: kinds(), carb_100g: kinds(),
    fat_100g: kinds(), fiber_100g: kinds(),
  };
}

/**
 * Le rapport n'est pas de la décoration : « signaler explicitement tout
 * endroit où une donnée manquait et a été laissée vide » (CLAUDE.md). Sans
 * lui, 1 900 teneurs à l'état de traces ressemblent à un bug d'import.
 */
function report(
  rows: Map<string, FoodRow>,
  holes: Record<NutrientColumn, Record<TeneurKind, number>>,
  unknownSubgroups: Set<string>,
): void {
  const total = rows.size;
  console.log(`${total} aliments Ciqual lus.\n`);
  console.log(
    'Couverture par colonne. « Encadrée » = la source ne donne qu’un majorant\n' +
      '(« < 0,5 ») ; il est conservé. « Inconnue » reste NULL, jamais 0.',
  );
  for (const column of COLUMNS) {
    const h = holes[column];
    const missing = total - h.valeur;
    // `seuil` n'est plus un trou : la source publie un majorant, on le garde.
    const unknown = missing - h.seuil;
    console.log(
      `  ${column.padEnd(13)} ${String(h.valeur).padStart(5)} exactes, ` +
        `${String(h.seuil).padStart(4)} encadrées (« < X »), ` +
        `${String(unknown).padStart(4)} inconnues ` +
        `(non déterminée ${h.absente}, traces ${h.traces}` +
        (h.illisible > 0 ? `, illisible ${h.illisible}` : '') +
        ')',
    );
  }

  let plantTrue = 0, plantFalse = 0, plantNull = 0, noCategory = 0;
  for (const row of rows.values()) {
    if (row.plantBased === true) plantTrue += 1;
    else if (row.plantBased === false) plantFalse += 1;
    else plantNull += 1;
    if (row.category === null) noCategory += 1;
  }
  console.log(
    `\nplant_based : ${plantTrue} végétal, ${plantFalse} animal, ` +
      `${plantNull} non classé (NULL, pas false).`,
  );
  if (noCategory > 0) {
    console.log(`category : ${noCategory} aliment(s) sans catégorie.`);
  }
  if (unknownSubgroups.size > 0) {
    console.log(
      `⚠️  sous-groupe(s) Ciqual inconnu(s) de server/food/groups.ts : ` +
        `${[...unknownSubgroups].join(', ')} — à classer à la main.`,
    );
  }
}

await main();
