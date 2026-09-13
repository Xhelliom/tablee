/**
 * Applique les migrations SQL de `db/migrations/`, dans l'ordre des noms.
 *
 *   DATABASE_URL=postgres://… npm run migrate
 *   DATABASE_URL=postgres://… npm run migrate -- --dry-run
 *
 * Convention (CLAUDE.md) : un fichier appliqué n'est plus modifié. Le runner
 * en garde l'empreinte et refuse de continuer si un fichier déjà joué a
 * changé — sinon la base de production et le dépôt divergent en silence, et
 * plus personne ne sait ce qui est réellement appliqué.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const DIR = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const dryRun = process.argv.includes('--dry-run');

const url = process.env['DATABASE_URL'];
if (url === undefined || url.length === 0) {
  console.error('DATABASE_URL manquant');
  process.exit(1);
}

const sha = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);

/** Clé arbitraire mais stable : « tablee » en chiffres. Toute autre ferait. */
const MIGRATION_LOCK = 828_533;

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  /**
   * Un seul migrateur à la fois.
   *
   * En Kubernetes, les migrations tournent dans un `initContainer` : un
   * redéploiement, un redémarrage de pod ou un `maxSurge` à 1 peut en lancer
   * deux en même temps. Sans verrou, les deux lisent `schema_migration` vide,
   * appliquent le même fichier, et le second échoue sur la clé primaire — au
   * mieux. Le verrou consultatif est tenu jusqu'à la fermeture de la
   * connexion, et l'attente est ce qu'on veut : le second démarre quand le
   * premier a fini.
   */
  await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK]);

  await client.query(`
    create table if not exists schema_migration (
      filename    text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now()
    )
  `);

  const applied = new Map<string, string>(
    (await client.query<{ filename: string; checksum: string }>(
      'select filename, checksum from schema_migration',
    )).rows.map((r) => [r.filename, r.checksum]),
  );

  const files = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
  let count = 0;

  for (const file of files) {
    const sql = await readFile(DIR + file, 'utf8');
    const checksum = sha(sql);
    const previous = applied.get(file);

    if (previous !== undefined) {
      if (previous !== checksum) {
        throw new Error(
          `${file} a été modifié après application (${previous} → ${checksum}). ` +
            'Une migration appliquée ne se modifie pas : écrire une migration suivante.',
        );
      }
      continue;
    }

    if (dryRun) {
      console.log(`· ${file} serait appliqué`);
      count += 1;
      continue;
    }

    // Une migration est atomique : DDL transactionnel, c'est l'un des rares
    // luxes de Postgres. Un échec au milieu ne laisse pas un schéma bancal.
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query(
        'insert into schema_migration (filename, checksum) values ($1, $2)',
        [file, checksum],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw new Error(`${file} : ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log(`✓ ${file}`);
    count += 1;
  }

  console.log(
    count === 0
      ? `base à jour (${files.length} migration(s) déjà appliquée(s))`
      : `${count} migration(s) ${dryRun ? 'en attente' : 'appliquée(s)'}`,
  );
} finally {
  await client.end();
}
