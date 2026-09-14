/**
 * Ce que l'assistant sait du foyer — la forme du prompt du §14, sans réseau.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeHousehold, type HouseholdFacts } from './conseil.ts';

const FOYER: HouseholdFacts = {
  ages: [41, 39, 7],
  diets: ['vegetarien'],
  mealCount: 9,
  dishes: ['Galette complète', 'Oeuf, cru'],
  percents: { proteinG: [110, 90], carbG: [], fatG: [], fiberG: [60, 70, 80] },
  plant7d: 41.2,
  plant28d: 38,
};

describe('assistant — ce que le modèle sait du foyer (§14)', () => {
  it('résume en tranches d’âge, régimes et moyennes du foyer, sans l’énergie', () => {
    assert.equal(describeHousehold(FOYER), [
      'Foyer : 2 adultes, 1 enfant de 6-9 ans.',
      'Régimes : 1 végétarien.',
      'Depuis une semaine : 9 repas saisis. La saisie peut être incomplète.',
      '- part végétale : 41 % (quatre semaines : 38 %)',
      '- protéines : 100 % du repère du jour, en moyenne sur 2 journées de convives',
      '- fibres : 70 % du repère du jour, en moyenne sur 3 journées de convives',
      'Plats et aliments : Galette complète ; Oeuf, cru.',
    ].join('\n'));
  });

  it('dit qu’il n’y a rien plutôt que d’aligner des moyennes vides', () => {
    const vide = describeHousehold({
      ...FOYER, mealCount: 0, dishes: [], plant7d: null,
      percents: { proteinG: [], carbG: [], fatG: [], fiberG: [] },
    });
    assert.equal(vide, 'Foyer : 2 adultes, 1 enfant de 6-9 ans.\nRégimes : 1 végétarien.\nAucun repas saisi depuis une semaine.');
  });

  it('accorde un repas unique au singulier', () => {
    assert.match(describeHousehold({ ...FOYER, mealCount: 1 }), /: 1 repas saisi\. /);
  });
});
