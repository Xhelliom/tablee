import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeUnit, parseQuantity, resolveUnit, type UnitDefaults } from './units.ts';

/** `unit_default` telle qu'elle est livrée : vide, en attente de sources (§17). */
const VIDE: UnitDefaults = new Map();

describe('parseQuantity', () => {
  it('lit les fractions des recettes', () => {
    assert.equal(parseQuantity('1/10'), 0.1);
    assert.equal(parseQuantity('1 1/2'), 1.5);
    assert.equal(parseQuantity('3/4'), 0.75);
  });

  it('lit la virgule décimale', () => {
    assert.equal(parseQuantity('0,25'), 0.25);
    assert.equal(parseQuantity(0.25), 0.25);
  });

  it('ne remplace jamais une saisie illisible par 1', () => {
    for (const raw of ['', '   ', 'beaucoup', '1/0', null, undefined, NaN]) {
      assert.equal(parseQuantity(raw), null, `« ${String(raw)} » devrait valoir null`);
    }
  });
});

describe('resolveUnit', () => {
  it('convertit les unités de masse sans hypothèse', () => {
    assert.deepEqual(resolveUnit(0.1, 'Kilogramme', null, VIDE), {
      resolved: true, grams: 100, confidence: 'haute', via: 'masse',
    });
    assert.deepEqual(resolveUnit(50, 'g', null, VIDE), {
      resolved: true, grams: 50, confidence: 'haute', via: 'masse',
    });
  });

  it('préfère le poids porté par l’aliment au repli générique', () => {
    const defaults: UnitDefaults = new Map([['piece', { grams: 60, source: 'test' }]]);
    const poulet = { unitWeights: { piece: 1200 } };
    const resolution = resolveUnit(0.25, 'Pièce', poulet, defaults);
    assert.deepEqual(resolution, {
      resolved: true, grams: 300, confidence: 'haute', via: 'aliment',
    });
  });

  it('marque le repli générique comme une estimation', () => {
    // R6 : une conversion générique est une estimation, elle doit se voir.
    const defaults: UnitDefaults = new Map([['poignee', { grams: 30, source: 'test' }]]);
    const resolution = resolveUnit(1, 'Poignée', null, defaults);
    assert.deepEqual(resolution, {
      resolved: true, grams: 30, confidence: 'moyenne', via: 'defaut',
    });
  });

  // Cas nominal tant que `unit_default` est vide : la donnée manque, on demande.
  it('demande plutôt que de deviner quand l’unité n’a pas de source', () => {
    for (const unit of ['Poignée', 'Pièce', 'Cuillère à soupe', 'Gousse', 'Bouquet', 'Tranche']) {
      const resolution = resolveUnit(1, unit, null, VIDE);
      assert.equal(resolution.resolved, false, `${unit} ne devrait pas se résoudre`);
      if (!resolution.resolved) assert.match(resolution.reason, /à préciser/);
    }
  });

  // Écart assumé avec le point 1 du §6 : un volume n'est pas une masse.
  it('ne transforme pas un volume en masse sans densité', () => {
    for (const unit of ['Litre', 'ml', 'cl']) {
      assert.equal(resolveUnit(0.035, unit, null, VIDE).resolved, false);
    }
  });

  it('ignore la casse et les accents du libellé d’unité', () => {
    const defaults: UnitDefaults = new Map([['cuillere a soupe', { grams: 15, source: 'test' }]]);
    const resolution = resolveUnit(2, 'Cuillère à Soupe', null, defaults);
    assert.equal(resolution.resolved && resolution.grams, 30);
    assert.equal(normalizeUnit('  Cuillère à   soupe '), 'cuillere a soupe');
  });

  it('ne résout rien sans quantité ni unité', () => {
    assert.equal(resolveUnit(null, 'g', null, VIDE).resolved, false);
    assert.equal(resolveUnit(1, null, null, VIDE).resolved, false);
    assert.equal(resolveUnit(1, '  ', null, VIDE).resolved, false);
  });
});
