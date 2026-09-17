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
import {
  deriveTargets, energyTargets, type EnergyReference, type PercentReference,
} from '../server/nutrition/derive.ts';
import { normalizeUnit } from '../server/nutrition/units.ts';
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
         on conflict (sex, age_min, age_max, nutrient, kind, basis) do update set
           value = excluded.value, unit = excluded.unit, source = excluded.source`,
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

// ── energy_reference, puis dérivation des cibles (§9) ───────────────────────

async function loadEnergy(db: pg.Pool): Promise<void> {
  const file = 'energy-reference.csv';
  const { rows } = await read(file);
  let written = 0;
  let skipped = 0;

  for (const row of rows) {
    const kcal = optionalNumber(file, row, 'kcal');
    if (kcal === null) { skipped += 1; continue; }
    if (kcal <= 0) throw new SeedError(file, row.line, 'un besoin énergétique doit être positif');

    const source = requireSource(file, row);
    const sex = requiredText(file, row, 'sex').toUpperCase();
    if (sex !== 'F' && sex !== 'M') throw new SeedError(file, row.line, `sexe inconnu : ${sex}`);

    if (!dryRun) {
      await db.query(
        `insert into energy_reference (sex, age_min, age_max, kcal, pal, source)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (sex, age_min, age_max) do update set
           kcal = excluded.kcal, pal = excluded.pal, source = excluded.source`,
        [
          sex, requiredNumber(file, row, 'age_min'), requiredNumber(file, row, 'age_max'),
          kcal, optionalNumber(file, row, 'pal'), source,
        ],
      );
    }
    written += 1;
  }

  reports.push({ file, written, skipped, reason: 'tranches sans besoin énergétique' });
}

/**
 * Traduit les intervalles en % de l'AET en cibles en grammes, et recopie le
 * besoin énergétique des majeurs en repère affichable (017).
 *
 * Rejouée à chaque seed et **remplacée intégralement** : ces lignes sont un
 * produit, pas une saisie. Si un intervalle ou un besoin énergétique change,
 * les cibles suivent sans laisser de reliquat.
 */
async function deriveAbsoluteTargets(db: pg.Pool): Promise<void> {
  const { rows: percents } = await db.query<PercentReference>(
    `select sex, age_min as "ageMin", age_max as "ageMax", nutrient, kind, value, source
     from nutrient_reference
     where basis = 'pct_aet'`,
  );
  const { rows: energies } = await db.query<EnergyReference>(
    `select sex, age_min as "ageMin", age_max as "ageMax", kcal, source
     from energy_reference`,
  );

  // Les cibles en grammes portent leur unité, l'énergie la sienne : `unit` ne
  // peut plus être écrit en dur à l'insertion depuis que les deux cohabitent.
  const derived: { sex: string; ageMin: number; ageMax: number; nutrient: string;
    kind: string; value: number; unit: string; source: string }[] = [
    ...deriveTargets(percents, energies).map((row) => ({ ...row, unit: 'g' })),
    ...energyTargets(energies),
  ];

  if (!dryRun) {
    await db.query("delete from nutrient_reference where derived and basis = 'absolu'");
    for (const row of derived) {
      await db.query(
        `insert into nutrient_reference
           (sex, age_min, age_max, nutrient, kind, basis, value, unit, source, derived)
         values ($1, $2, $3, $4, $5, 'absolu', $6, $7, $8, true)
         on conflict (sex, age_min, age_max, nutrient, kind, basis) do update set
           value = excluded.value, unit = excluded.unit,
           source = excluded.source, derived = true`,
        [row.sex, row.ageMin, row.ageMax, row.nutrient, row.kind,
         row.value, row.unit, row.source],
      );
    }
  }

  reports.push({
    file: '(dérivé)',
    written: derived.length,
    skipped: 0,
    reason: '',
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
    // Migration 013 : un repli par forme. Vide = pour toutes les formes.
    const forme = (row.values['forme'] ?? '').trim() || 'tout';
    if (forme !== 'tout' && forme !== 'poudre') {
      throw new SeedError(file, row.line, `forme inconnue : ${forme} (tout ou poudre)`);
    }

    if (!dryRun) {
      await db.query(
        `insert into unit_default (unit, forme, grams, source) values ($1, $2, $3, $4)
         on conflict (unit, forme) do update set grams = excluded.grams, source = excluded.source`,
        [unit, forme, grams, source],
      );
    }
    written += 1;
  }

  reports.push({
    file, written, skipped,
    reason: 'unités non pesées — l’app demandera la quantité',
  });
}

// ── food.unit_weights (§6) ──────────────────────────────────────────────────

/**
 * Les conversions propres à un aliment : une pièce d'œuf, une cuillère de
 * parmesan, un litre de lait. `unit_default` n'a qu'une valeur par unité, pour
 * tous les aliments ; elles ne peuvent vivre que là.
 *
 * `food.unit_weights` n'est écrit que d'ici, et **remplacé intégralement** à
 * chaque seed : une ligne retirée du fichier ne laisse pas de poids orphelin
 * en base. Le réimport Ciqual n'y touche pas.
 *
 * La source est exigée ligne par ligne, puis ne suit pas en base — le jsonb
 * porte des grammes, pas de provenance. Même compromis que la saisonnalité
 * (dette n° 14) : le fichier versionné reste la trace, et l'app affiche ces
 * conversions en « Estimation » (`resolveUnit`).
 */
async function loadFoodUnitWeights(db: pg.Pool): Promise<void> {
  const file = 'food-unit-weight.csv';
  const { rows } = await read(file);
  const parCode = new Map<string, Record<string, number>>();
  let written = 0;
  let skipped = 0;

  for (const row of rows) {
    const grams = optionalNumber(file, row, 'grams');
    if (grams === null) { skipped += 1; continue; }
    if (grams <= 0) throw new SeedError(file, row.line, 'un poids doit être strictement positif');
    requireSource(file, row);
    const code = requiredText(file, row, 'ciqual_code');
    // La clé est celle que `resolveUnit` cherche : « Cuillère à soupe » et
    // « cuillere a soupe » doivent tomber au même endroit.
    const unit = normalizeUnit(requiredText(file, row, 'unit'));
    parCode.set(code, { ...(parCode.get(code) ?? {}), [unit]: grams });
    written += 1;
  }

  const unknownCodes: string[] = [];
  if (!dryRun) {
    const client = await db.connect();
    try {
      await client.query('begin');
      await client.query(`update food set unit_weights = '{}'::jsonb where unit_weights <> '{}'::jsonb`);
      for (const [code, weights] of parCode) {
        const { rowCount } = await client.query(
          `update food set unit_weights = $2::jsonb where source = 'ciqual' and external_id = $1`,
          [code, JSON.stringify(weights)],
        );
        if (rowCount === 0) unknownCodes.push(code);
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  if (unknownCodes.length > 0) {
    console.log(`⚠️  ${file} : codes Ciqual introuvables — ${unknownCodes.join(', ')}. Le référentiel est-il chargé ?`);
  }
  reports.push({
    file, written, skipped,
    reason: 'lignes sans poids — l’app demandera la quantité',
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

    // Appelée pour sa vérification, pas pour sa valeur : `seasonal_produce`
    // n'a pas de colonne `source`, contrairement à `nutrient_reference` et
    // `unit_default`. Le CSV l'exige quand même — une ligne sans provenance ne
    // se charge pas — mais l'app ne peut pas la citer. Dette n° 14.
    requireSource(file, row);
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
  const expected = [
    'nutrient-reference.csv', 'energy-reference.csv',
    'unit-default.csv', 'food-unit-weight.csv', 'seasonal-produce.csv',
  ];
  const missing = expected.filter((f) => !files.includes(f));
  if (missing.length > 0) throw new Error(`fichier(s) de seed absent(s) : ${missing.join(', ')}`);

  const pool = getPool();
  try {
    await loadReferences(pool);
    await loadEnergy(pool);
    // Après les deux, puisqu'elle les croise.
    await deriveAbsoluteTargets(pool);
    await loadUnits(pool);
    await loadFoodUnitWeights(pool);
    await loadSeasonal(pool);

    console.log(dryRun ? 'Simulation — rien n’a été écrit.\n' : '');
    for (const report of reports) {
      if (report.file === '(dérivé)') {
        console.log('repères écrits par le seed');
        console.log(
          `  ${report.written} repère(s), tous marqués \`derived\` en base :\n` +
            '  les cibles en grammes, calculées depuis les intervalles en % de l’AET\n' +
            '  et les besoins énergétiques, avec leur chaîne de calcul en source ;\n' +
            '  et le repère d’énergie des majeurs, recopié tel quel (017).',
        );
        continue;
      }
      console.log(`${report.file}`);
      console.log(`  ${report.written} ligne(s) chargée(s)`);
      if (report.skipped > 0) {
        console.log(`  ${report.skipped} ligne(s) ignorée(s) : ${report.reason}`);
      }
    }

    const empty = reports.filter((r) => r.written === 0 && r.file !== '(dérivé)').map((r) => r.file);
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
