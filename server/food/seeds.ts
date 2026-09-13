/**
 * Chargement des tables de référence depuis des fichiers CSV versionnés.
 *
 * ── Pourquoi des fichiers, et pas un fetch au démarrage ─────────────────────
 *
 * 1. **I1.** Une valeur doit pouvoir être relue et contestée. Un fichier
 *    versionné se relit en diff et se retrouve avec `git blame` le jour où une
 *    barre paraît fausse. Un téléchargement au démarrage, non.
 * 2. Des chiffres qui changent sous les pieds entre deux redémarrages, ce sont
 *    des conseils destinés à des enfants qui changent avec, sans que personne
 *    n'ait rien décidé.
 * 3. L'app est auto-hébergée : elle doit repartir quand la box ne répond pas.
 * 4. Deux installations donnent la même base.
 *
 * La seule donnée qui reste récupérée à la demande est une recette Jow, au
 * moment du partage — et elle est mise en cache dans `recipe`.
 *
 * ── La colonne `source` ─────────────────────────────────────────────────────
 *
 * Elle est **obligatoire sur chaque ligne**, et le chargeur refuse un fichier
 * qui en manque une. C'est le seul garde-fou mécanique contre une valeur
 * arrivée là on ne sait comment. Un seed ne complète jamais un fichier
 * incomplet : il s'arrête et dit quelle ligne pose problème.
 */

export interface CsvRow {
  [column: string]: string;
  /** Ligne dans le fichier, pour que les erreurs soient localisables. */
}

export interface ParsedCsv {
  columns: string[];
  rows: { values: Record<string, string>; line: number }[];
}

/**
 * Lecteur CSV minimal : séparateur `,`, guillemets doubles, `#` en début de
 * ligne pour les commentaires. Les fichiers sont écrits à la main et relus à
 * la main ; il n'y a pas de raison d'y mettre autre chose.
 */
export function parseCsv(text: string): ParsedCsv {
  const lines = text.split(/\r?\n/);
  let columns: string[] | null = null;
  const rows: ParsedCsv['rows'] = [];

  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const cells = splitLine(raw);
    if (columns === null) {
      columns = cells.map((c) => c.trim());
      continue;
    }
    if (cells.every((c) => c.trim().length === 0)) continue;

    const values: Record<string, string> = {};
    columns.forEach((column, i) => {
      values[column] = (cells[i] ?? '').trim();
    });
    rows.push({ values, line: index + 1 });
  }

  return { columns: columns ?? [], rows };
}

function splitLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') { current += '"'; i += 1; }
        else quoted = false;
      } else current += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { cells.push(current); current = ''; continue; }
    current += char;
  }
  cells.push(current);
  return cells;
}

export class SeedError extends Error {
  constructor(readonly file: string, readonly line: number, message: string) {
    super(`${file}:${line} — ${message}`);
    this.name = 'SeedError';
  }
}

/**
 * Exige une `source` non vide. Appelée sur chaque ligne de chaque fichier :
 * c'est ce qui rend impossible d'écrire une valeur sans dire d'où elle vient
 * (§17, et I1).
 */
export function requireSource(file: string, row: { values: Record<string, string>; line: number }): string {
  const source = row.values['source'] ?? '';
  if (source.trim().length === 0) {
    throw new SeedError(file, row.line, 'colonne « source » vide — aucune valeur ne s’écrit sans sa provenance');
  }
  return source.trim();
}

/** Nombre décimal français ou anglais. Une case vide vaut « non renseigné ». */
export function optionalNumber(
  file: string,
  row: { values: Record<string, string>; line: number },
  column: string,
): number | null {
  const raw = (row.values[column] ?? '').trim();
  if (raw.length === 0) return null;
  const value = Number(raw.replace(',', '.'));
  if (!Number.isFinite(value)) {
    throw new SeedError(file, row.line, `« ${column} » illisible : ${raw}`);
  }
  return value;
}

export function requiredNumber(
  file: string,
  row: { values: Record<string, string>; line: number },
  column: string,
): number {
  const value = optionalNumber(file, row, column);
  if (value === null) throw new SeedError(file, row.line, `« ${column} » est obligatoire`);
  return value;
}

export function requiredText(
  file: string,
  row: { values: Record<string, string>; line: number },
  column: string,
): string {
  const raw = (row.values[column] ?? '').trim();
  if (raw.length === 0) throw new SeedError(file, row.line, `« ${column} » est obligatoire`);
  return raw;
}

/** `[9,10,11]` ou `9 10 11` → `[9, 10, 11]`. */
export function months(
  file: string,
  row: { values: Record<string, string>; line: number },
  column: string,
): number[] {
  const raw = (row.values[column] ?? '').trim();
  const parts = raw.replace(/[[\]]/g, '').split(/[\s;|]+/).filter((p) => p.length > 0);
  if (parts.length === 0) throw new SeedError(file, row.line, `« ${column} » est obligatoire`);

  const values = parts.map((part) => {
    const month = Number(part);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new SeedError(file, row.line, `mois invalide : ${part}`);
    }
    return month;
  });
  return [...new Set(values)].sort((a, b) => a - b);
}
