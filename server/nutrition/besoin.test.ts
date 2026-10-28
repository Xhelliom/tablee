import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { besoinEstime, KCAL_PAR_KG } from './besoin.ts';

const pesées = (kgs: number[], écart = 7): { day: string; trendKg: number }[] =>
  kgs.map((trendKg, i) => ({ day: new Date(Date.UTC(2026, 9, 1 + i * écart)).toISOString().slice(0, 10), trendKg }));

describe('besoinEstime', () => {
  it('poids stable : le besoin vaut l’apport, à confiance moyenne au mieux', () => {
    const need = besoinEstime({ intake: 2140, completeDays: 21, pesées: pesées([70, 70.2, 70.1, 70]) });
    assert.equal(need.kcal, 2150);
    assert.equal(need.confidence, 'moyenne');
  });

  it('poids qui monte : le besoin est sous l’apport, de la pente × 32,2 MJ/kg', () => {
    // +1,4 kg en 21 jours.
    const need = besoinEstime({ intake: 2500, completeDays: 21, pesées: pesées([70, 70.5, 71, 71.4]) });
    assert.equal(need.kcal, Math.round((2500 - (1.4 / 21) * KCAL_PAR_KG) / 50) * 50);
    assert.equal(need.confidence, 'basse', 'le facteur pèse : il surestime chez les plus minces');
  });

  it('se tait sous les seuils', () => {
    assert.equal(besoinEstime({ intake: 2000, completeDays: 13, pesées: pesées([70, 70, 70, 70]) }).kcal, null);
    assert.equal(besoinEstime({ intake: 2000, completeDays: 20, pesées: pesées([70, 70, 70]) }).kcal, null);
    assert.equal(besoinEstime({ intake: 2000, completeDays: 20, pesées: pesées([70, 70, 70, 70], 4) }).kcal, null,
      'pesées trop serrées : 12 jours, pas 14');
    assert.equal(besoinEstime({ intake: null, completeDays: 20, pesées: pesées([70, 70, 70, 70]) }).kcal, null);
  });

  it('jamais une confiance haute', () => {
    assert.notEqual(besoinEstime({ intake: 2000, completeDays: 28, pesées: pesées([70, 70, 70, 70, 70]) }).confidence, 'haute');
  });
});
