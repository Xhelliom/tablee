/**
 * Charge les tables de référence depuis `db/seeds/*.csv` (§9, §6, §8bis).
 *
 *   npm run seed:refs
 *   npm run seed:refs -- --dry-run
 *
 * Idempotent : `on conflict do update`. Rejouer après avoir complété un
 * fichier met à jour les lignes et n'en duplique aucune.
 *
 * **Aucune valeur ne s'écrit sans sa `source`.** Le chargeur s'arrête sur la
 * première ligne qui en manque une, en donnant le fichier et le numéro de
 * ligne. Les lignes dont la valeur est vide sont ignorées et comptées : un
 * fichier à moitié rempli se charge à moitié, et le dit.
 *
 * Ce qui reste vide reste vide, et c'est un état nominal : l'app affiche
 * « repère indisponible », demande l'unité, et masque la bande de saison.
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import {
  months as parseMonths,
  optionalNumber,
  parseCsv,
  requireSource,
  requiredNumber,
  requiredText,
  SeedError,
} from '../server/food/seeds.ts';
import { closePool, getPool } from '../server/db.ts';

const DIR = fileURLToPath(new URL('../db/seeds/', import.meta.url));
const dryRun = process.argv.includes('--dry-run');

interface Report {
  file: string;
  written: number;
  skipped: number;
  reason: string;
}

const reports: Report[] = [];

async function read(file: string): Promise<ReturnType<typeof parseCsv>> {
  return parseCsv(await readFile(DIR + file, 'utf8'));
}

// ── nutrient_reference (§9) ─────────────────────────────────────────────────

const NUTRIENTS = new Set(['protein_g', 'carb_g', 'fat_g', 'fiber_g', 'kcal']);
const KINDS = new Set(['AS', 'RNP', 'RN', 'IR_MIN', 'IR_MAX']);
const BASES = new Set(['absolu', 'pct_aet']);

async function loadReferences(db: pg.Pool): Promise<void> {
  const file = 'nutrient-reference.csv';
  const { rows } = await read(file);
  let written = 0;
  let skipped = 0;

  for (const row of rows) {
    const value = optionalNumber(file, row, 'value');
    if (value === null) { skipped += 1; continue; }

    const source = requireSource(file, row);
    const nutrient = requiredText(file, row, 'nutrient');
    if (!NUTRIENTS.has(nutrient)) {
      throw new SeedError(file, row.line, `nutriment inconnu : ${nutrient}`);
    }
    const kind = (row.values['kind'] ?? 'RNP').trim() || 'RNP';
    if (!KINDS.has(kind)) throw new SeedError(file, row.line, `kind inconnu : ${kind}`);
    const basis = (row.values['basis'] ?? 'absolu').trim() || 'absolu';
    if (!BASES.has(basis)) throw new SeedError(file, row.line, `basis inconnu : ${basis}`);

    const sex = requiredText(file, row, 'sex').toUpperCase();
    if (!['F', 'M', 'ALL'].includes(sex)) {
      throw new SeedError(file, row.line, `sexe inconnu : ${sex}`);
    }
    const ageMin = requiredNumber(file, row, 'age_min');
    const ageMax = requiredNumber(file, row, 'age_max');
    if (ageMax < ageMin) throw new SeedError(file, row.line, 'age_max inférieur à age_min');

    if (!dryRun) {
      await db.query(
        `insert into nutrient_reference (sex, age_min, age_max, nutrient, kind, basis, value, unit, source)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (sex, age_min, age_max, nutrient, kind) do update set
           basis = excluded.basis, value = excluded.value,
           unit = excluded.unit, source = excluded.source`,
        [sex, ageMin, ageMax, nutrient, kind, basis, value,
         requiredText(file, row, 'unit'), source],
      );
    }
    written += 1;
  }

  reports.push({
    file, written, skipped,
    reason: 'lignes sans valeur — tranche d’âge non couverte par la source',
  });
}

// ── unit_default (§6) ───────────────────────────────────────────────────────

async function loadUnits(db: pg.Pool): Promise<void> {
  const file = 'unit-default.csv';
  const { rows } = await read(file);
  let written = 0;
  let skipped = 0;

  for (const row of rows) {
    const grams = optionalNumber(file, row, 'grams');
    if (grams === null) { skipped += 1; continue; }
    if (grams <= 0) throw new SeedError(file, row.line, 'un poids doit être strictement positif');

    const source = requireSource(file, row);
    const unit = requiredText(file, row, 'unit');

    if (!dryRun) {
      await db.query(
        `insert into unit_default (unit, grams, source) values ($1, $2, $3)
         on conflict (unit) do update set grams = excluded.grams, source = excluded.source`,
        [unit, grams, source],
      );
    }
    written += 1;
  }

  reports.push({
    file, written, skipped,
    reason: 'unités non pesées — l’app demandera la quantité',
  });
}

// ── seasonal_produce (§8bis) ────────────────────────────────────────────────

async function loadSeasonal(db: pg.Pool): Promise<void> {
  const file = 'seasonal-produce.csv';
  const { rows } = await read(file);
  let written = 0;
  let skipped = 0;
  const unknownCodes: string[] = [];

  for (const row of rows) {
    if ((row.values['months'] ?? '').trim().length === 0) { skipped += 1; continue; }

    const source = requireSource(file, row);
    const name = requiredText(file, row, 'name');
    const kind = requiredText(file, row, 'kind');
    if (kind !== 'legume' && kind !== 'fruit') {
      throw new SeedError(file, row.line, `kind doit valoir legume ou fruit, pas ${kind}`);
    }
    const monthList = parseMonths(file, row, 'months');
    const region = (row.values['region'] ?? '').trim() || 'FR';

    // Le rattachement passe par un code Ciqual explicite. Aucun rapprochement
    // par ressemblance de nom : une coche fausse ruine le jeu (§8bis).
    let foodId: string | null = null;
    const ciqualCode = (row.values['ciqual_code'] ?? '').trim();
    if (ciqualCode.length > 0) {
      const found = await db.query<{ id: string }>(
        "select id from food where source = 'ciqual' and external_id = $1",
        [ciqualCode],
      );
      foodId = found.rows[0]?.id ?? null;
      if (foodId === null) unknownCodes.push(`${name} (${ciqualCode})`);
    }

    if (!dryRun) {
      await db.query(
        `insert into seasonal_produce (name, kind, months, region, food_id)
         values ($1, $2, $3, $4, $5)
         on conflict (name, region) do update set
           kind = excluded.kind, months = excluded.months, food_id = excluded.food_id`,
        [name, kind, monthList, region, foodId],
      );
    }
    written += 1;
  }

  if (unknownCodes.length > 0) {
    console.log(`⚠️  codes Ciqual introuvables : ${unknownCodes.join(', ')}`);
  }
  reports.push({
    file, written, skipped,
    reason: 'produits sans mois — la bande de saison les ignore',
  });
}

// ── rapport ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const files = await readdir(DIR);
  const expected = ['nutrient-reference.csv', 'unit-default.csv', 'seasonal-produce.csv'];
  const missing = expected.filter((f) => !files.includes(f));
  if (missing.length > 0) throw new Error(`fichier(s) de seed absent(s) : ${missing.join(', ')}`);

  const pool = getPool();
  try {
    await loadReferences(pool);
    await loadUnits(pool);
    await loadSeasonal(pool);

    console.log(dryRun ? 'Simulation — rien n’a été écrit.\n' : '');
    for (const report of reports) {
      console.log(`${report.file}`);
      console.log(`  ${report.written} ligne(s) chargée(s)`);
      if (report.skipped > 0) {
        console.log(`  ${report.skipped} ligne(s) ignorée(s) : ${report.reason}`);
      }
    }

    const empty = reports.filter((r) => r.written === 0).map((r) => r.file);
    if (empty.length > 0) {
      console.log(
        `\n${empty.join(', ')} : encore vide(s). C’est un état nominal — l’app\n` +
          'affiche « indisponible » plutôt que d’inventer. Voir les commentaires\n' +
          'en tête de chaque fichier pour savoir quoi y mettre.',
      );
    }
  } finally {
    if (!dryRun) await closePool();
    else await closePool();
  }
}

await main();
