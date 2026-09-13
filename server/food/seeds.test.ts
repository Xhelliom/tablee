import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  months, optionalNumber, parseCsv, requireSource, requiredNumber, requiredText, SeedError,
} from './seeds.ts';

const row = (values: Record<string, string>, line = 2): { values: Record<string, string>; line: number } =>
  ({ values, line });

describe('parseCsv', () => {
  it('lit un fichier avec commentaires et lignes vides', () => {
    const csv = [
      '# un commentaire',
      'unit,grams,source',
      '',
      'Poignée,30,"Pesée maison, 09/2026"',
      '# encore un commentaire',
      'Gousse,5,Pesée maison',
    ].join('\n');
    const { columns, rows } = parseCsv(csv);
    assert.deepEqual(columns, ['unit', 'grams', 'source']);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.values['source'], 'Pesée maison, 09/2026');
    assert.equal(rows[1]?.values['unit'], 'Gousse');
  });

  it('garde le numéro de ligne, pour que les erreurs soient localisables', () => {
    const { rows } = parseCsv('a,b\n\n1,2\n3,4');
    assert.equal(rows[0]?.line, 3);
    assert.equal(rows[1]?.line, 4);
  });

  it('lit les guillemets doublés', () => {
    const { rows } = parseCsv('a\n"il dit ""oui"""');
    assert.equal(rows[0]?.values['a'], 'il dit "oui"');
  });
});

describe('requireSource', () => {
  // Le garde-fou mécanique de I1 : rien n'entre en base sans provenance.
  it('refuse une ligne sans source', () => {
    assert.throws(() => requireSource('f.csv', row({ source: '' })), SeedError);
    assert.throws(() => requireSource('f.csv', row({ source: '   ' })), SeedError);
    assert.throws(() => requireSource('f.csv', row({})), SeedError);
  });

  it('nomme le fichier et la ligne fautive', () => {
    try {
      requireSource('unit-default.csv', row({ source: '' }, 17));
      assert.fail('aurait dû lever');
    } catch (error) {
      assert.match(String(error), /unit-default\.csv:17/);
      assert.match(String(error), /source/);
    }
  });

  it('accepte une source renseignée', () => {
    assert.equal(requireSource('f.csv', row({ source: ' ANSES 2016 ' })), 'ANSES 2016');
  });
});

describe('lecture des valeurs', () => {
  it('traite une case vide comme « non renseigné », pas comme zéro', () => {
    assert.equal(optionalNumber('f.csv', row({ grams: '' }), 'grams'), null);
    assert.equal(optionalNumber('f.csv', row({}), 'grams'), null);
  });

  it('accepte la virgule décimale', () => {
    assert.equal(optionalNumber('f.csv', row({ v: '2,5' }), 'v'), 2.5);
  });

  it('refuse une valeur illisible plutôt que de la contourner', () => {
    assert.throws(() => optionalNumber('f.csv', row({ v: 'environ 30' }), 'v'), SeedError);
    assert.throws(() => requiredNumber('f.csv', row({ v: '' }), 'v'), SeedError);
    assert.throws(() => requiredText('f.csv', row({ v: '  ' }), 'v'), SeedError);
  });
});

describe('months', () => {
  it('lit les formes courantes et trie', () => {
    assert.deepEqual(months('f.csv', row({ m: '9 10 11' }), 'm'), [9, 10, 11]);
    assert.deepEqual(months('f.csv', row({ m: '[11;12;1;2]' }), 'm'), [1, 2, 11, 12]);
    assert.deepEqual(months('f.csv', row({ m: '5 5 6' }), 'm'), [5, 6]);
  });

  it('refuse un mois hors bornes', () => {
    assert.throws(() => months('f.csv', row({ m: '0 5' }), 'm'), SeedError);
    assert.throws(() => months('f.csv', row({ m: '13' }), 'm'), SeedError);
    assert.throws(() => months('f.csv', row({ m: 'septembre' }), 'm'), SeedError);
  });
});
