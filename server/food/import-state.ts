/**
 * « Ce référentiel est-il déjà chargé, et depuis quelle source ? »
 *
 * Le seed tourne à chaque déploiement (`deploy/k8s/30-deployment.yaml`). Sans
 * cette question posée en une requête, il relirait 57 Mo de XML à chaque
 * redémarrage de pod pour réécrire exactement les mêmes lignes.
 *
 * Table hors RLS : elle décrit le référentiel public, pas un foyer. D'où le
 * `UnscopedDb`, nommé pour se voir en revue (CLAUDE.md).
 */
import type { UnscopedDb } from '../db.ts';

export interface ImportState {
  source: string;
  version: string;
  sha256: string;
  etl: number;
  rowCount: number;
  importedAt: Date;
}

/**
 * `version` écrite quand l'import vient de fichiers posés à la main plutôt que
 * de l'archive épinglée. L'empreinte, elle, reste une vraie empreinte — celle
 * des fichiers lus : on ne peut rien promettre de leur provenance, mais on
 * peut dire s'ils ont changé depuis le dernier import.
 */
export const VERSION_LOCALE = 'local';

export async function readImportState(
  db: UnscopedDb, source: string,
): Promise<ImportState | null> {
  const { rows } = await db.query<{
    source: string; version: string; sha256: string;
    etl: number; row_count: number; imported_at: Date;
  }>(
    `select source, version, sha256, etl, row_count, imported_at
       from referential_import where source = $1`,
    [source],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    source: row.source,
    version: row.version,
    sha256: row.sha256,
    etl: Number(row.etl),
    rowCount: Number(row.row_count),
    importedAt: row.imported_at,
  };
}

/**
 * L'import en base correspond-il exactement à la source qu'on s'apprête à
 * lire ? Les trois champs comptent : une nouvelle table ANSES change
 * `version` et `sha256`, un changement de notre mapping change `etl`.
 */
export function isUpToDate(
  state: ImportState | null, attendu: { version: string; sha256: string; etl: number },
): boolean {
  if (state === null) return false;
  return state.version === attendu.version
    && state.sha256 === attendu.sha256
    && state.etl === attendu.etl;
}

export async function recordImport(
  db: UnscopedDb,
  state: { source: string; version: string; sha256: string; etl: number; rowCount: number },
): Promise<void> {
  await db.query(
    `insert into referential_import (source, version, sha256, etl, row_count, imported_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (source) do update set
       version     = excluded.version,
       sha256      = excluded.sha256,
       etl         = excluded.etl,
       row_count   = excluded.row_count,
       imported_at = now()`,
    [state.source, state.version, state.sha256, state.etl, state.rowCount],
  );
}
