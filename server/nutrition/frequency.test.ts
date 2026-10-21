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
  grams: 100, basis: 'plat', alcoholPer100g: null, ...over,
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

  describe('alcool (max_drinks)', () => {
    const alcool = ref({ kind: 'max_drinks', value: 10, categories: ['boisson_alcoolisee'] });
    const vin = (over: Partial<FrequencyLine>): FrequencyLine =>
      line({ category: 'boisson_alcoolisee', name: 'Vin rouge', grams: 100, alcoholPer100g: 10, ...over });

    it('ne dit rien (null) sans boisson saisie, même avec des repas', () => {
      const [s] = bilanFrequences({
        references: [alcool], lines: [line({})], participants: [adult('m1')], mealCount: 1,
      });
      assert.equal(s?.current, null);
      assert.equal(s?.met, null);
    });

    it('compte des verres standard de 10 g, par adulte, sans les mineurs', () => {
      const [s] = bilanFrequences({
        references: [alcool],
        // 300 g de vin à 10 g/100 g = 30 g d'alcool = 3 verres, partagés à parts égales.
        lines: [vin({ grams: 300 })],
        participants: [adult('m1', 'a', 0.5), adult('m1', 'b', 0.5), child('m1')],
        mealCount: 1,
      });
      assert.equal(s?.unit, 'verres');
      assert.equal(s?.current, 1.5);
      assert.equal(s?.met, true);
    });

    it('ignore le vin d’une recette Jow : un ingrédient de cuisson', () => {
      const [s] = bilanFrequences({
        references: [alcool], lines: [vin({ basis: 'portion' })],
        participants: [adult('m1')], mealCount: 1,
      });
      assert.equal(s?.current, null);
    });

    it('rien pour un repas sans adulte', () => {
      const [s] = bilanFrequences({
        references: [alcool], lines: [vin({})], participants: [child('m1')], mealCount: 1,
      });
      assert.equal(s?.current, null);
    });

    it('une teneur inconnue rend le compte partiel, pas faux', () => {
      const [s] = bilanFrequences({
        references: [alcool], lines: [vin({}), vin({ alcoholPer100g: null })],
        participants: [adult('m1')], mealCount: 1,
      });
      assert.equal(s?.current, 1);
      assert.equal(s?.partial, true);
    });
  });
});
