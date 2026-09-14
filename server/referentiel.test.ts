/**
 * L'état d'import du référentiel (migration 010), contre une vraie base.
 *
 * Ce que ça protège : le seed Ciqual tourne au démarrage de **chaque pod**, et
 * c'est cette table qui lui dit de ne rien faire. Une colonne mal nommée ou un
 * `on conflict` qui n'accroche pas ne casserait rien de visible — l'import
 * repartirait simplement à chaque redémarrage, trente secondes à chaque fois,
 * sans que personne ne s'en aperçoive avant la facture.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type pg from 'pg';
import { isUpToDate, readImportState, recordImport, VERSION_LOCALE } from './food/import-state.ts';
import { closeTestPool, SKIP_MESSAGE, testDatabaseUrl, testPool } from './test-support/db.ts';

const enabled = testDatabaseUrl() !== null;

const PIN = {
  version: '2020-07-07',
  sha256: 'cab13941ca693b7007c2f0fed2288fd5b94073fe6d598c9773297cf37aa59ca8',
  etl: 1,
};

describe('état d’import du référentiel (010)', { skip: enabled ? false : SKIP_MESSAGE }, () => {
  let pool: pg.Pool;

  before(async () => {
    pool = await testPool();
    await pool.query('delete from referential_import');
  });

  after(async () => {
    await pool.query('delete from referential_import');
    await closeTestPool();
  });

  it('une base neuve ne sait rien, donc importe', async () => {
    assert.equal(await readImportState(pool, 'ciqual'), null);
    assert.equal(isUpToDate(null, PIN), false);
  });

  it('retient ce qui a été importé, et ne réimporte plus', async () => {
    await recordImport(pool, { source: 'ciqual', ...PIN, rowCount: 3185 });

    const state = await readImportState(pool, 'ciqual');
    assert.equal(state?.version, PIN.version);
    assert.equal(state?.rowCount, 3185);
    assert.ok(state?.importedAt instanceof Date);
    assert.equal(isUpToDate(state, PIN), true);
  });

  it('réimporte quand l’ANSES publie une autre table', () => {
    const state = {
      source: 'ciqual', ...PIN, rowCount: 3185, importedAt: new Date(),
    };
    assert.equal(isUpToDate(state, { ...PIN, version: '2024-01-01', sha256: 'a'.repeat(64) }), false);
  });

  it('réimporte quand c’est **notre** lecture de l’archive qui change', () => {
    const state = {
      source: 'ciqual', ...PIN, rowCount: 3185, importedAt: new Date(),
    };
    // Même archive, mapping différent : les lignes en base ne sont plus celles
    // que le code produirait aujourd'hui. C'est à ça que sert `etl`.
    assert.equal(isUpToDate(state, { ...PIN, etl: PIN.etl + 1 }), false);
  });

  it('écrase l’import précédent au lieu d’en empiler un second', async () => {
    await recordImport(pool, {
      source: 'ciqual', version: VERSION_LOCALE, sha256: 'b'.repeat(64), etl: 1, rowCount: 12,
    });

    const { rows } = await pool.query<{ n: string }>(
      "select count(*) as n from referential_import where source = 'ciqual'",
    );
    assert.equal(rows[0]?.n, '1');

    const state = await readImportState(pool, 'ciqual');
    assert.equal(state?.version, VERSION_LOCALE);
    assert.equal(state?.rowCount, 12);
  });
});
