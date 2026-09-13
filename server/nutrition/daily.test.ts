import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bilanJournalier, type DailyMeal } from './daily.ts';
import { findReference, type ReferenceTable } from './references.ts';
import { ageAt, ageBracket, isMinor } from './age.ts';

/** Aucune borne connue — le point de départ de tous les cas. */
const VIDE = { kcal: null, proteinG: null, carbG: null, fatG: null, fiberG: null };

/**
 * Par défaut les bornes hautes suivent les valeurs : une mesure exacte est un
 * intervalle de largeur nulle. Un test qui veut un total non borné passe
 * `max` explicitement.
 */
const repas = (over: Partial<DailyMeal>): DailyMeal => {
  const base: DailyMeal = {
    share: 1, ...VIDE,
    gramsTotal: null, gramsPlant: null, gramsClassified: null,
    ...over,
  };
  return {
    ...base,
    max: over.max ?? {
      kcal: base.kcal, proteinG: base.proteinG, carbG: base.carbG,
      fatG: base.fatG, fiberG: base.fiberG,
    },
  };
};

/**
 * Repères fictifs, **de test uniquement**. `nutrient_reference` est livrée
 * vide et le reste tant que l'ANSES n'y a pas été recopiée avec sa source
 * (§9). Ces lignes servent à vérifier le code qui les lit, jamais à alimenter
 * la base.
 */
const REPERES_DE_TEST: ReferenceTable[] = [
  { sex: 'ALL', ageMin: 18, ageMax: 120, nutrient: 'protein_g', value: 60, unit: 'g', source: 'fixture de test' },
  { sex: 'ALL', ageMin: 18, ageMax: 120, nutrient: 'fiber_g', value: 30, unit: 'g', source: 'fixture de test' },
  { sex: 'F', ageMin: 18, ageMax: 120, nutrient: 'carb_g', value: 250, unit: 'g', source: 'fixture de test' },
  { sex: 'ALL', ageMin: 18, ageMax: 120, nutrient: 'carb_g', value: 300, unit: 'g', source: 'fixture de test' },
];

const bar = (result: ReturnType<typeof bilanJournalier>, nutrient: string) => {
  const found = result.bars.find((b) => b.nutrient === nutrient);
  assert.ok(found !== undefined, `barre ${nutrient} absente`);
  return found;
};

describe('bilanJournalier', () => {
  it('somme les repas de la journée au prorata de la part figée', () => {
    const result = bilanJournalier({
      sex: 'M', age: 40, references: REPERES_DE_TEST,
      meals: [repas({ proteinG: 30, share: 0.5 }), repas({ proteinG: 20, share: 0.25 })],
    });
    assert.equal(bar(result, 'proteinG').consumed, 20);
    assert.equal(bar(result, 'proteinG').percent, 33.3);
    assert.equal(bar(result, 'proteinG').state, 'disponible');
  });

  // ── Test structurant n° 3 (§15) ────────────────────────────────────────────
  it('une tranche d’âge sans repère affiche « indisponible », pas 0', () => {
    const enfant = bilanJournalier({
      sex: 'F', age: 7, references: REPERES_DE_TEST,   // aucune ligne ne couvre 7 ans
      meals: [repas({ proteinG: 25, fiberG: 8 })],
    });
    for (const b of enfant.bars) {
      assert.equal(b.reference, null, `${b.nutrient} ne devrait avoir aucun repère`);
      assert.equal(b.percent, null, `${b.nutrient} ne devrait avoir aucun pourcentage`);
      assert.notEqual(b.percent, 0);
    }
    // La consommation, elle, reste connue : c'est le repère qui manque.
    assert.equal(bar(enfant, 'proteinG').consumed, 25);
    assert.equal(bar(enfant, 'proteinG').state, 'disponible');
  });

  // Avec la table livrée vide, c'est l'état de **toutes** les barres.
  it('n’affiche aucun pourcentage tant que nutrient_reference est vide', () => {
    const result = bilanJournalier({
      sex: 'M', age: 40, references: [],
      meals: [repas({ proteinG: 30, carbG: 100, fatG: 20, fiberG: 9, kcal: 700 })],
    });
    for (const b of result.bars) {
      assert.equal(b.reference, null);
      assert.equal(b.percent, null);
    }
  });

  it('signale un minorant quand un repas n’a pas la valeur', () => {
    const result = bilanJournalier({
      sex: 'M', age: 40, references: REPERES_DE_TEST,
      meals: [repas({ fiberG: 9 }), repas({ fiberG: null })],
    });
    const fibres = bar(result, 'fiberG');
    assert.equal(fibres.state, 'partiel');
    assert.equal(fibres.missingMeals, 1);
    assert.equal(fibres.consumed, 9);
  });

  it('ne montre rien plutôt que zéro quand aucun repas n’a la valeur', () => {
    const result = bilanJournalier({
      sex: 'M', age: 40, references: REPERES_DE_TEST,
      meals: [repas({ fiberG: null })],
    });
    assert.equal(bar(result, 'fiberG').state, 'indisponible');
    assert.equal(bar(result, 'fiberG').consumed, null);
    assert.equal(bar(result, 'fiberG').percent, null);
  });

  it('une journée sans repas n’est pas une journée à zéro', () => {
    const result = bilanJournalier({ sex: 'F', age: 40, references: REPERES_DE_TEST, meals: [] });
    assert.equal(result.mealCount, 0);
    for (const b of result.bars) {
      assert.equal(b.consumed, null);
      assert.equal(b.state, 'indisponible');
    }
    assert.equal(result.plant.state, 'indisponible');
    assert.equal(result.plant.percent, null);
  });
});

describe('bilanJournalier — barre Végétal', () => {
  it('pondère par les grammes de l’assiette, pas par repas', () => {
    const result = bilanJournalier({
      sex: 'M', age: 40, references: [],
      meals: [
        repas({ share: 0.5, gramsTotal: 400, gramsPlant: 400, gramsClassified: 400 }),
        repas({ share: 0.5, gramsTotal: 100, gramsPlant: 0, gramsClassified: 100 }),
      ],
    });
    // 200 g végétaux sur 250 g consommés — pas la moyenne de 100 % et 0 %.
    assert.equal(result.plant.percent, 80);
    assert.equal(result.plant.state, 'disponible');
  });

  it('n’a pas de repère chiffré, par construction (§8)', () => {
    const result = bilanJournalier({
      sex: 'F', age: 12, references: REPERES_DE_TEST,
      meals: [repas({ gramsTotal: 300, gramsPlant: 150, gramsClassified: 300 })],
      householdPlantAverage7d: 41.2,
    });
    assert.equal(result.plant.percent, 50);
    assert.equal(result.plant.householdAverage7d, 41.2);
    assert.equal(Object.hasOwn(result.plant, 'reference'), false);
  });

  it('reste indisponible quand aucun gramme n’est classé', () => {
    const result = bilanJournalier({
      sex: 'M', age: 40, references: [],
      meals: [repas({ gramsTotal: 500, gramsPlant: 0, gramsClassified: 0 })],
    });
    assert.equal(result.plant.percent, null);
    assert.equal(result.plant.state, 'indisponible');
    assert.equal(result.plant.coverage, 0);
  });

  it('dit sur quelle fraction de la journée la part végétale est connue', () => {
    const result = bilanJournalier({
      sex: 'M', age: 40, references: [],
      meals: [repas({ gramsTotal: 400, gramsPlant: 100, gramsClassified: 200 })],
    });
    assert.equal(result.plant.state, 'partiel');
    assert.equal(result.plant.coverage, 50);
  });
});

describe('findReference', () => {
  it('préfère une ligne sexuée à une ligne générique', () => {
    const ref = findReference(REPERES_DE_TEST, 'F', 30, 'carbG');
    assert.equal(ref?.value, 250);
    assert.equal(findReference(REPERES_DE_TEST, 'M', 30, 'carbG')?.value, 300);
  });

  it('n’interpole pas et ne reprend pas la tranche voisine', () => {
    assert.equal(findReference(REPERES_DE_TEST, 'F', 17, 'protein_g' as never), null);
    assert.equal(findReference(REPERES_DE_TEST, 'F', 17, 'proteinG'), null);
  });

  it('porte toujours sa source', () => {
    assert.equal(findReference(REPERES_DE_TEST, 'M', 40, 'proteinG')?.source, 'fixture de test');
  });
});

describe('age', () => {
  it('compte des années révolues', () => {
    assert.equal(ageAt('2016-09-14', new Date('2026-09-13T12:00:00Z')), 9);
    assert.equal(ageAt('2016-09-13', new Date('2026-09-13T12:00:00Z')), 10);
  });

  it('reconnaît un profil mineur', () => {
    assert.equal(isMinor('2010-01-01', new Date('2026-09-13T00:00:00Z')), true);
    assert.equal(isMinor('2000-01-01', new Date('2026-09-13T00:00:00Z')), false);
  });

  it('donne une tranche, jamais une date (I3)', () => {
    assert.equal(ageBracket(7), '6-9 ans');
    assert.equal(ageBracket(14), '13-15 ans');
    assert.equal(ageBracket(42), 'adulte');
  });

  it('refuse une date de naissance illisible', () => {
    assert.throws(() => ageAt('pas une date'));
  });
});

describe('bilanJournalier — repas dont l’origine est totalement inconnue', () => {
  it('ne les compte pas comme non végétaux', () => {
    // Un repas Jow dont aucun ingrédient n'est rattaché à Ciqual : sa part
    // végétale est `null`, pas 0. L'agrégat journalier doit l'ignorer, sinon
    // le zéro refusé au niveau du repas se réintroduit au niveau du jour.
    const result = bilanJournalier({
      sex: 'M', age: 40, references: [],
      meals: [
        repas({ share: 1, gramsTotal: 300, gramsPlant: 300, gramsClassified: 300 }),
        repas({ share: 1, gramsTotal: 700, gramsPlant: 0, gramsClassified: 0 }),
      ],
    });
    assert.equal(result.plant.percent, 100);
    assert.equal(result.plant.state, 'partiel', 'un repas a été écarté : il faut le dire');
    // 300 g classés sur les 1 000 g de la journée : la couverture le dit.
    assert.equal(result.plant.coverage, 30);
  });

  it('reste indisponible si aucun repas n’est classé', () => {
    const result = bilanJournalier({
      sex: 'M', age: 40, references: [],
      meals: [repas({ share: 1, gramsTotal: 700, gramsPlant: 0, gramsClassified: 0 })],
    });
    assert.equal(result.plant.percent, null);
    assert.equal(result.plant.state, 'indisponible');
  });
});

describe('bilanJournalier — encadrements', () => {
  it('additionne les intervalles au prorata de la part', () => {
    const result = bilanJournalier({
      sex: 'M', age: 40, references: REPERES_DE_TEST,
      meals: [
        repas({ fatG: 10, max: { ...VIDE, fatG: 12 }, share: 0.5 }),
        repas({ fatG: 4, max: { ...VIDE, fatG: 4 }, share: 1 }),
      ],
    });
    const lipides = bar(result, 'fatG');
    assert.equal(lipides.consumed, 9);       // 10×0,5 + 4
    assert.equal(lipides.consumedMax, 10);   // 12×0,5 + 4
    assert.equal(lipides.state, 'encadre');
  });

  it('dit « au moins » quand un repas échappe au référentiel', () => {
    const result = bilanJournalier({
      sex: 'M', age: 40, references: REPERES_DE_TEST,
      meals: [
        repas({ proteinG: 30, max: { ...VIDE, proteinG: 30 } }),
        repas({ proteinG: null, max: { ...VIDE } }),
      ],
    });
    const proteines = bar(result, 'proteinG');
    assert.equal(proteines.consumed, 30, 'ce qui est garanti atteint survit');
    assert.equal(proteines.consumedMax, null);
    assert.equal(proteines.state, 'partiel');
    assert.equal(proteines.missingMeals, 1);
    // Le pourcentage du repère suit la borne basse : 30 sur 60.
    assert.equal(proteines.percent, 50);
    assert.equal(proteines.percentMax, null);
  });

  it('reste exact quand toutes les bornes coïncident', () => {
    const result = bilanJournalier({
      sex: 'M', age: 40, references: REPERES_DE_TEST,
      meals: [repas({ proteinG: 30, max: { ...VIDE, proteinG: 30 } })],
    });
    assert.equal(bar(result, 'proteinG').state, 'disponible');
    assert.equal(bar(result, 'proteinG').percentMax, 50);
  });

  it('donne les deux pourcentages quand la journée est encadrée', () => {
    const result = bilanJournalier({
      sex: 'M', age: 40, references: REPERES_DE_TEST,
      meals: [repas({ fiberG: 15, max: { ...VIDE, fiberG: 18 } })],
    });
    // Repère fibres de test : 30 g.
    assert.equal(bar(result, 'fiberG').percent, 50);
    assert.equal(bar(result, 'fiberG').percentMax, 60);
  });
});
