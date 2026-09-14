/**
 * Ce qu'on garde de la réponse du modèle — sans réseau.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readSplit, SplitRefused } from './decoupage.ts';

describe('découpage par IA — ce qui revient', () => {
  it('garde les lignes lisibles et laisse à préciser les poids absurdes', () => {
    assert.deepEqual(
      readSplit({
        items: [
          { label: '2 œufs', search: 'œuf', grams: 110.4 },
          { label: 'du sel', search: 'sel', grams: -3 },
          { label: '  ', search: 'rien', grams: 10 },
        ],
      }),
      [
        { label: '2 œufs', search: 'œuf', grams: 110 },
        { label: 'du sel', search: 'sel', grams: null },
      ],
    );
  });

  it('refuse une réponse sans liste', () => {
    assert.throws(() => readSplit({ autre: 1 }), SplitRefused);
  });
});
