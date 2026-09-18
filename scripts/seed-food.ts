/**
 * ETL Ciqual (§5 de la spec) : l'export XML de l'ANSES → table `food`.
 *
 *   npm run seed:food                    # télécharge si besoin, puis importe
 *   npm run seed:food -- --dir=/ailleurs # un export déjà décompressé
 *   npm run seed:food -- --no-download   # échoue plutôt que de sortir
 *   npm run seed:food -- --force         # réimporte même si c'est déjà fait
 *   npm run seed:food -- --dry-run       # parse et rapporte, n'écrit rien
 *
 * ⚠️ Renversé le 14/09/2026 — le script se télécharge tout seul.
 *
 * Il disait jusqu'ici : « l'export ne se télécharge pas depuis ce script :
 * c'est un geste d'opérateur, fait une fois ». Le geste se faisait mal. Une
 * instance fraîchement déployée servait une recherche d'aliments vide, sans
 * que rien n'indique qu'il manquait une étape faite à la main dans un
 * conteneur. Le seed tourne donc maintenant à chaque déploiement
 * (`deploy/k8s/30-deployment.yaml`), et va chercher les fichiers lui-même.
 *
 * Ce que l'objection d'origine avait de juste est conservé : ce qui est
 * versionné, c'est l'empreinte (`db/seeds/ciqual-source.json`). Un fichier
 * qui ne lui correspond pas n'est pas importé — `food` ne peut donc pas
 * changer de contenu sans qu'un diff le dise. Voir `server/food/ciqual-source.ts`.
 *
 * Idempotent, et à deux étages : l'import lui-même est un `on conflict do
 * update`, et il ne part même pas quand `referential_import` dit que la
 * version épinglée est déjà en base. Rejouer ne duplique rien et ne touche pas
 * aux `food` saisis à la main (`source='manuel'`) ni à ceux issus de Jow.
 *
 * **Ce script n'écrit aucune valeur qu'il n'a pas lue.** Une teneur absente,
 * à l'état de traces ou sous le seuil de quantification est écrite `NULL`,
 * jamais `0` (I1). Le rapport final compte ces trous, colonne par colonne :
 * ils doivent se voir.
 */
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import pg from 'pg';
import {
  CIQUAL_NUTRIENTS,
  decodeCiqual,
  decoderFor,
  parseCompoChunk,
  parseFoods,
  type CiqualFood,
  type NutrientColumn,
  type TeneurKind,
} from '../server/food/ciqual.ts';
import {
  downloadCiqual, fingerprintExports, locateExports, readCiqualSource, retenirLocal,
} from '../server/food/ciqual-source.ts';
import {
  VERSION_LOCALE, isUpToDate, readImportState, recordImport, type ImportState,
} from '../server/food/import-state.ts';
import { classify, isKnownSubgroup } from '../server/food/groups.ts';
import { closePool, databaseUrl, getPool } from '../server/db.ts';

const DEFAULT_DIR = fileURLToPath(new URL('../data/ciqual/', import.meta.url));
const CHUNK = 200;

/**
 * Clé de verrou consultatif. Deux pods qui démarrent ensemble lanceraient deux
 * imports concurrents : le second attend, voit que le premier a fini, et
 * repart sans rien faire. Clé distincte de celle des migrations.
 *
 * Sur une **connexion dédiée**, comme dans `migrate.ts` : un verrou consultatif
 * appartient à la session qui l'a pris, et une requête envoyée au pool ne
 * revient pas forcément sur la même connexion. Il tombe à la fermeture, ce qui
 * est exactement le comportement voulu si le script meurt en route.
 */
const SEED_LOCK = 828_534;

async function lockSeed(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  await client.query('select pg_advisory_lock($1)', [SEED_LOCK]);
  return client;
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const download = !args.includes('--no-download');
// `--dir` explicite ou dossier par défaut : la distinction décide si un export
// trouvé sur place l'emporte sur la source épinglée (`retenirLocal`).
const dirArg = args.find((a) => a.startsWith('--dir='))?.slice('--dir='.length);
const dir = dirArg ?? DEFAULT_DIR;

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

/** Sortie du cas nominal : rien à importer, on rend le verrou et on se tait. */
async function déjàFait(verrou: pg.Client | null, state: ImportState | null): Promise<void> {
  console.log(
    `Table Ciqual ${state?.version} déjà importée `
    + `(${state?.rowCount} aliments, le ${state?.importedAt.toISOString().slice(0, 10)}).\n`
    + 'Rien à faire. `--force` pour réimporter.',
  );
  await verrou?.end();
  await closePool();
}

/**
 * Lit `compo_*.xml` en flux. 66 Mio tiendraient en mémoire, mais le fichier
 * grossit à chaque édition de la table — il a pris 14 Mio entre 2020 et 2025 —
 * et rien n'oblige à le charger entier : on découpe sur `</COMPO>`, qui ne
 * peut pas apparaître ailleurs.
 *
 * L'encodage se lit sur le premier morceau, comme `decodeCiqual` le fait sur
 * le fichier entier : les deux tables n'ont pas le même, et le supposer
 * donnerait ici des nombres illisibles plutôt que des accents abîmés.
 */
async function readCompo(
  file: string,
  onRow: (row: ReturnType<typeof parseCompoChunk>[number]) => void,
): Promise<void> {
  let decoder: TextDecoder | null = null;
  let buffer = '';
  for await (const chunk of createReadStream(file)) {
    decoder ??= decoderFor(chunk as Uint8Array);
    buffer += decoder.decode(chunk as Uint8Array, { stream: true });
    const cut = buffer.lastIndexOf('</COMPO>');
    if (cut === -1) continue;
    for (const row of parseCompoChunk(buffer.slice(0, cut + 8))) onRow(row);
    buffer = buffer.slice(cut + 8);
  }
  // Un fichier vide n'a jamais donné de morceau, donc pas de décodeur : il n'y
  // a rien à vider, et l'appelant refusera l'export plus loin.
  if (decoder !== null) buffer += decoder.decode();
  for (const row of parseCompoChunk(buffer)) onRow(row);
}

async function main(): Promise<void> {
  const source = await readCiqualSource();
  const épinglé = { version: source.version, sha256: source.sha256, etl: source.etl };

  // ── Est-ce déjà fait ? ────────────────────────────────────────────────────
  //
  // La question se pose **avant** le réseau et avant le XML : ce script tourne
  // au démarrage de chaque pod, et la réponse est « oui » presque à chaque
  // fois. Ce cas-là doit coûter une requête, pas trente secondes.
  const verrou = dryRun ? null : await lockSeed();
  const pool = dryRun ? null : getPool();
  let state = null;
  if (pool !== null) {
    state = await readImportState(pool, 'ciqual');
    if (!force && isUpToDate(state, épinglé)) return déjàFait(verrou, state);
  }

  // Des fichiers déjà sur place l'emportent sur le téléchargement : `--dir`
  // sert précisément à apporter un export autrement, réseau coupé. Leur
  // empreinte n'est calculée que si l'export épinglé n'a pas déjà répondu —
  // sans quoi on relirait 70 Mo pour découvrir qu'il n'y a rien à faire.
  const trouvé = await locateExports(dir);
  const empreinte = trouvé === null ? null : await fingerprintExports(trouvé);
  const conforme = empreinte === source.sha256;
  const local = retenirLocal(empreinte, source.sha256, dirArg !== undefined) ? trouvé : null;

  // Un export posé à la main qui a l'empreinte du manifeste **est** l'export
  // épinglé : il s'enregistre sous sa vraie version plutôt que sous « local »,
  // et le raccourci d'en haut répondra seul au démarrage suivant au lieu de
  // relire 70 Mo pour redécouvrir les mêmes fichiers.
  const identité = local !== null && empreinte !== null && !conforme
    ? { version: VERSION_LOCALE, sha256: empreinte, etl: source.etl }
    : épinglé;
  if (pool !== null && !force && isUpToDate(state, identité)) return déjàFait(verrou, state);

  if (trouvé !== null && local === null) {
    console.warn(
      `Export ignoré : ${trouvé.alim} n’a pas l’empreinte du manifeste, `
      + `la table ${source.version} est téléchargée à sa place. `
      + `Pour imposer un export apporté à la main : --dir=${dir}`,
    );
  }

  const { alim: alimFile, compo: compoFile } = local ?? await downloadCiqual(dir, { download });
  console.log(
    local === null
      ? `Table Ciqual ${source.version} téléchargée et vérifiée (${source.sha256.slice(0, 12)}…).`
      : conforme
        ? `Export lu depuis ${dir} — empreinte conforme au manifeste (${source.sha256.slice(0, 12)}…).`
        : `Export lu depuis ${dir} — posé à la main, donc non vérifié à la source.`,
  );

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

  if (pool === null) {
    console.log('\n--dry-run : rien n’a été écrit.');
    return;
  }

  try {
    const list = [...rows.values()];
    let written = 0;
    for (let i = 0; i < list.length; i += CHUNK) {
      written += await upsert(pool, list.slice(i, i + CHUNK));
    }
    // L'état d'import s'écrit **après** les aliments : un import interrompu au
    // milieu doit se rejouer au démarrage suivant, pas se croire terminé.
    await recordImport(pool, { source: 'ciqual', ...identité, rowCount: written });
    console.log(`\n${written} aliment(s) écrit(s) dans food (source='ciqual').`);
    console.log(source.source);
  } finally {
    // Le verrou tombe avec sa connexion — y compris si l'import a échoué.
    await verrou?.end();
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
