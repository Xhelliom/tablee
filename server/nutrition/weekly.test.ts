/**
 * Les tendances du foyer pour la vue semaine, sans base : des moyennes de %
 * du repère, jamais des grammes, jamais par personne.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DailyMeal } from './daily.ts';
import type { ReferenceTable } from './references.ts';
import { diversityByEater, weeklyMeans, type WeekDayInput } from './weekly.ts';

/** Repères fictifs, de test uniquement — même règle que `daily.test.ts`. */
const REPERES: ReferenceTable[] = [
  { sex: 'ALL', ageMin: 18, ageMax: 120, nutrient: 'protein_g', kind: 'RNP', basis: 'absolu', derived: false, value: 60, unit: 'g', source: 'fixture de test' },
  { sex: 'ALL', ageMin: 18, ageMax: 120, nutrient: 'fiber_g', kind: 'AS', basis: 'absolu', derived: false, value: 30, unit: 'g', source: 'fixture de test' },
  { sex: 'ALL', ageMin: 18, ageMax: 120, nutrient: 'carb_g', kind: 'RNP', basis: 'absolu', derived: false, value: 300, unit: 'g', source: 'fixture de test' },
  { sex: 'ALL', ageMin: 18, ageMax: 120, nutrient: 'fat_g', kind: 'RNP', basis: 'absolu', derived: false, value: 80, unit: 'g', source: 'fixture de test' },
];

const VIDE = { kcal: null, proteinG: null, carbG: null, fatG: null, fiberG: null };

const repas = (over: Partial<DailyMeal>): DailyMeal => {
  const base: DailyMeal = {
    share: 1, ...VIDE, gramsTotal: null, gramsPlant: null, gramsClassified: null, ...over,
  };
  return {
    ...base,
    max: over.max ?? {
      kcal: base.kcal, proteinG: base.proteinG, carbG: base.carbG,
      fatG: base.fatG, fiberG: base.fiberG,
    },
  };
};

const adulte = (meals: DailyMeal[]): WeekDayInput['members'][number] => ({ sex: 'M', age: 40, meals });

describe('weeklyMeans', () => {
  it('moyenne les % du repère des convives renseignés, par jour', () => {
    const [jour] = weeklyMeans([{
      date: '2026-10-05',
      members: [
        // 30 g de protéines pour 60 de repère : 50 %.
        adulte([repas({ proteinG: 30 })]),
        // 60 g : 100 %. Moyenne : 75 %.
        adulte([repas({ proteinG: 60 })]),
      ],
    }], REPERES);
    assert.equal(jour?.date, '2026-10-05');
    assert.equal(jour?.means.proteinG, 75);
    assert.equal(jour?.eaters, 2);
  });

  it('ignore qui n’est pas renseigné, sans l’écraser à zéro', () => {
    const [jour] = weeklyMeans([{
      date: '2026-10-05',
      members: [
        adulte([repas({ proteinG: 30 })]),
        // Pas de protéines connues : hors de la moyenne, pas à zéro.
        adulte([repas({})]),
      ],
    }], REPERES);
    assert.equal(jour?.means.proteinG, 50);
    // Mais il a bien mangé ce jour-là.
    assert.equal(jour?.eaters, 2);
  });

  it('rend null quand personne n’est renseigné, et compte les jours vides à zéro', () => {
    const [vide, plein] = weeklyMeans([
      { date: '2026-10-05', members: [] },
      { date: '2026-10-06', members: [adulte([])] },
    ], REPERES);
    assert.deepEqual(vide?.means, { proteinG: null, carbG: null, fatG: null, fiberG: null });
    assert.equal(vide?.eaters, 0);
    assert.equal(plein?.eaters, 0);
  });

  it('sans repères, aucune moyenne — jamais un zéro', () => {
    const [jour] = weeklyMeans([{
      date: '2026-10-05',
      members: [adulte([repas({ proteinG: 30 })])],
    }], []);
    assert.equal(jour?.means.proteinG, null);
    assert.equal(jour?.eaters, 1);
  });
});

describe('diversityByEater', () => {
  const row = (mealId: string, eaterId: string, foodId: string | null, category: string | null) =>
    ({ mealId, eaterId, foodId, category });

  it('compte aliments et familles distincts, et signale le repas sans aliment rattaché', () => {
    const { household, byEater } = diversityByEater([
      row('m1', 'a', 'carotte', 'legumes'), row('m1', 'b', 'carotte', 'legumes'),
      row('m1', 'a', 'poireau', 'legumes'), row('m2', 'a', 'riz', 'cereales'),
      row('m3', 'a', null, null), row('m3', 'b', null, null),
    ]);
    assert.deepEqual(household, { foods: 3, families: 2, mealsWithoutFood: 1 });
    assert.deepEqual(byEater['b'], { foods: 1, families: 1, mealsWithoutFood: 1 });
  });
});
