import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bilanFrequences, type FrequencyLine, type FrequencyParticipant, type FrequencyReference,
} from './frequency.ts';

const ref = (over: Partial<FrequencyReference>): FrequencyReference => ({
  code: 'x', label: 'x', kind: 'min_times', value: 2, categories: ['legumineuse'],
  namePattern: null, source: 's', citation: 'c', ...over,
});
const line = (over: Partial<FrequencyLine>): FrequencyLine => ({
  mealId: 'm1', date: '2026-10-05', category: 'legumineuse', name: 'Lentille',
  grams: 100, basis: 'plat', ...over,
});
const adult = (mealId: string, eaterId = 'a', share = 1): FrequencyParticipant =>
  ({ mealId, eaterId, share, adult: true });
const child = (mealId: string): FrequencyParticipant =>
  ({ mealId, eaterId: 'e', share: 0.5, adult: false });

describe('bilanFrequences', () => {
  it('compte les repas distincts, pas les lignes', () => {
    const [s] = bilanFrequences({
      references: [ref({})],
      lines: [line({}), line({ name: 'Haricot rouge' }), line({ mealId: 'm2' })],
      participants: [], mealCount: 2,
    });
    assert.equal(s?.current, 2);
    assert.equal(s?.met, true);
  });

  it('dit « rien de saisi » (null) quand aucun repas, pas 0', () => {
    const [s] = bilanFrequences({ references: [ref({})], lines: [], participants: [], mealCount: 0 });
    assert.equal(s?.current, null);
    assert.equal(s?.met, null);
  });

  it('compte 0 fois quand des repas existent sans légumes secs', () => {
    const [s] = bilanFrequences({ references: [ref({})], lines: [], participants: [], mealCount: 3 });
    assert.equal(s?.current, 0);
    assert.equal(s?.met, false);
  });

  it('filtre le poisson gras sur le nom', () => {
    const [s] = bilanFrequences({
      references: [ref({ kind: 'min_times', value: 1, categories: ['poisson'], namePattern: 'saumon|sardine' })],
      lines: [
        line({ category: 'poisson', name: 'Cabillaud', mealId: 'm1' }),
        line({ category: 'poisson', name: 'Saumon, cuit', mealId: 'm2' }),
      ],
      participants: [], mealCount: 2,
    });
    assert.equal(s?.current, 1);
  });

  it('un plafond ne compte que les grammes des adultes, partagés par part', () => {
    const [s] = bilanFrequences({
      references: [ref({ kind: 'max_grams', value: 150, categories: ['charcuterie'] })],
      lines: [line({ category: 'charcuterie', name: 'Jambon', grams: 200, basis: 'plat' })],
      participants: [adult('m1', 'a', 0.5), child('m1')],
      mealCount: 1,
    });
    assert.equal(s?.current, 100);
    assert.equal(s?.met, true);
  });

  it('un plafond sans adulte à table est inconnu, pas respecté', () => {
    const [s] = bilanFrequences({
      references: [ref({ kind: 'max_grams', value: 150, categories: ['charcuterie'] })],
      lines: [line({ category: 'charcuterie', grams: 500 })],
      participants: [child('m1')], mealCount: 1,
    });
    assert.equal(s?.current, null);
    assert.equal(s?.met, null);
  });

  it('des grammes inconnus rendent le total partiel, sans le mettre à zéro', () => {
    const [s] = bilanFrequences({
      references: [ref({ kind: 'max_grams', value: 150, categories: ['charcuterie'] })],
      lines: [line({ category: 'charcuterie', grams: null })],
      participants: [adult('m1')], mealCount: 1,
    });
    assert.equal(s?.partial, true);
  });
});
