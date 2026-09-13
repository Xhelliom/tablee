import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lastMonthOfSeason } from './refs.ts';

describe('lastMonthOfSeason', () => {
  it('donne le dernier mois consécutif de la saison en cours', () => {
    // Le raisin : de septembre à octobre. En septembre, il part fin octobre.
    assert.equal(lastMonthOfSeason([9, 10], 9), 10);
    assert.equal(lastMonthOfSeason([6, 7, 8, 9], 7), 9);
  });

  it('suit une saison qui passe l’hiver', () => {
    // Le poireau : novembre à février. Un simple maximum donnerait 11.
    assert.equal(lastMonthOfSeason([11, 12, 1, 2], 12), 2);
    assert.equal(lastMonthOfSeason([11, 12, 1, 2], 1), 2);
  });

  it('rend le mois courant quand la saison s’arrête là', () => {
    assert.equal(lastMonthOfSeason([9], 9), 9);
    assert.equal(lastMonthOfSeason([3, 4, 9], 9), 9);
  });

  it('ne boucle pas sur une saison de douze mois', () => {
    const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    assert.equal(lastMonthOfSeason(months, 5), 5);
  });
});
