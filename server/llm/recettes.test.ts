/**
 * L'assistant de recettes, sans réseau : ce qu'il reçoit en plus du résumé du
 * foyer, et ce qu'on garde de ce qu'il rend.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RecipeSummary } from '../repo/recipes.ts';
import {
  describePriorities, describeRecipes, readIdeas, readProposals, recipeCandidates,
} from './recettes.ts';

const recette = (id: string, title: string, over: Partial<RecipeSummary> = {}): RecipeSummary => ({
  id, title, imageUrl: null, baseServings: 4, nutriScore: null, confidence: 'haute',
  lastEatenAt: null, timesEaten: 0, source: 'jow', url: null,
  perServing: { kcal: 320, proteinG: 18, carbG: 40, fatG: 10, fiberG: 12 },
  ...over,
});

describe('assistant de recettes — ce qui part', () => {
  it('ne choisit que parmi les recettes Jow qui publient une valeur visée', () => {
    const candidates = recipeCandidates([
      recette('r1', 'Chili sin carne'),
      // Un titre écrit par le foyer peut porter un prénom (I3).
      recette('r2', 'Blanquette de mamie Jeanne', { source: 'manuel' }),
      // L'énergie seule ne se vise pas (R7).
      recette('r3', 'Page Jow presque vide', {
        perServing: { kcal: 300, proteinG: null, carbG: null, fatG: null, fiberG: null },
      }),
    ]);
    assert.deepEqual(candidates.map((r) => r.id), ['r1']);
  });

  it('numérote les recettes avec leurs valeurs par portion, et dit quand il n’y en a aucune', () => {
    const chili = recette('r1', 'Chili  sin\ncarne', {
      timesEaten: 2, perServing: { kcal: 320, proteinG: 18, carbG: 40, fatG: 10, fiberG: null },
    });
    assert.equal(describeRecipes([chili]), [
      'Recettes que le foyer connaît, valeurs par portion publiées par Jow :',
      '1. Chili sin carne — protéines 18 g, glucides 40 g, lipides 10 g, fibres n.c. ; à table 2 fois',
    ].join('\n'));
    assert.match(describeRecipes([]), /\n\(aucune\)$/);
  });

  it('range les repères du moins atteint au plus atteint, sans en inventer', () => {
    assert.equal(
      describePriorities({ proteinG: [110, 90], carbG: [], fatG: [40], fiberG: [10, 14] }),
      'Repères du moins atteint au plus atteint : fibres, lipides, protéines.',
    );
    assert.equal(describePriorities({ proteinG: [], carbG: [], fatG: [], fiberG: [] }), null);
  });
});

describe('assistant de recettes — ce qui revient', () => {
  const candidates = [recette('r1', 'Chili sin carne'), recette('r2', 'Dahl de lentilles')];

  it('garde un numéro de la liste, une fois, et retire une raison chiffrée', () => {
    const proposals = readProposals({
      propositions: [
        { numero: 2, raison: 'Des légumineuses, pour les fibres.' },
        { numero: 2, raison: 'doublon' },
        { numero: 9, raison: 'une recette inventée' },
        { numero: 1, raison: 'Apporte 12 g de fibres.' },
      ],
    }, candidates);

    assert.deepEqual(
      proposals.map((p) => [p.recipe.id, p.reason]),
      [['r2', 'Des légumineuses, pour les fibres.'], ['r1', null]],
    );
  });

  it('rend une liste vide sur une réponse illisible, sans lever', () => {
    assert.deepEqual(readProposals(null, candidates), []);
    assert.deepEqual(readProposals('pas du JSON', candidates), []);
    assert.deepEqual(readProposals({ propositions: [null, { numero: '1' }] }, candidates), []);
  });

  it('garde deux idées au plus, et écarte entière une idée chiffrée', () => {
    const ideas = readIdeas({
      idees: [
        { titre: 'Dahl de lentilles corail', raison: 'Des légumineuses, pour les fibres.' },
        { titre: 'Salade 3 haricots', raison: 'Des haricots pour varier.' },
        { titre: 'Soupe de pois cassés', raison: 'Environ 10 g de fibres par bol.' },
        { titre: '  ', raison: 'sans nom' },
        { titre: 'Chili sin carne', raison: 'Des haricots rouges et du maïs.' },
        { titre: 'Taboulé de boulgour', raison: 'Une céréale complète.' },
      ],
    });
    assert.deepEqual(ideas.map((i) => i.title), ['Dahl de lentilles corail', 'Chili sin carne']);
    assert.deepEqual(readIdeas({ propositions: [] }), []);
  });
});
