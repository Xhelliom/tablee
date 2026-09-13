import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bilanJournalier, type DailyMeal } from './daily.ts';
import {
  findCeiling, findEnergyShareRange, findReference, type ReferenceTable,
} from './references.ts';
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
  { sex: 'ALL', ageMin: 18, ageMax: 120, nutrient: 'protein_g', kind: 'RNP', basis: 'absolu', derived: false, value: 60, unit: 'g', source: 'fixture de test' },
  { sex: 'ALL', ageMin: 18, ageMax: 120, nutrient: 'fiber_g', kind: 'AS', basis: 'absolu', derived: false, value: 30, unit: 'g', source: 'fixture de test' },
  { sex: 'F', ageMin: 18, ageMax: 120, nutrient: 'carb_g', kind: 'RNP', basis: 'absolu', derived: false, value: 250, unit: 'g', source: 'fixture de test' },
  { sex: 'ALL', ageMin: 18, ageMax: 120, nutrient: 'carb_g', kind: 'RNP', basis: 'absolu', derived: false, value: 300, unit: 'g', source: 'fixture de test' },
  // Un intervalle en % de l'AET, tel que l'ANSES le publie pour les lipides :
  // il ne doit jamais servir de dénominateur à une consommation en grammes.
  { sex: 'ALL', ageMin: 18, ageMax: 120, nutrient: 'fat_g', kind: 'IR_MIN', basis: 'pct_aet', derived: false, value: 35, unit: '%', source: 'fixture de test' },
  { sex: 'ALL', ageMin: 18, ageMax: 120, nutrient: 'fat_g', kind: 'IR_MAX', basis: 'pct_aet', derived: false, value: 40, unit: '%', source: 'fixture de test' },
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

describe('natures de repère', () => {
  // Le piège : « 30 g de lipides » comparés à un intervalle de référence de
  // « 35 % de l'apport énergétique » donnerait 86 % de quelque chose qui
  // n'existe pas. Les deux natures ne se mélangent pas.
  it('n’utilise jamais un pourcentage d’AET comme repère en grammes', () => {
    assert.equal(findReference(REPERES_DE_TEST, 'M', 40, 'fatG'), null);

    const result = bilanJournalier({
      sex: 'M', age: 40, references: REPERES_DE_TEST,
      meals: [repas({ fatG: 30 })],
    });
    const lipides = bar(result, 'fatG');
    assert.equal(lipides.reference, null);
    assert.equal(lipides.percent, null);
    assert.equal(lipides.consumed, 30, 'la consommation reste connue');
  });

  it('rend l’intervalle en % de l’AET à qui le demande explicitement', () => {
    const range = findEnergyShareRange(REPERES_DE_TEST, 'M', 40, 'fatG');
    assert.deepEqual(range, { min: 35, max: 40, source: 'fixture de test' });
    assert.equal(findEnergyShareRange(REPERES_DE_TEST, 'M', 40, 'fiberG'), null);
  });

  it('préfère une RNP à un AS quand les deux existent', () => {
    const table: ReferenceTable[] = [
      { sex: 'ALL', ageMin: 18, ageMax: 120, nutrient: 'fiber_g', kind: 'AS', basis: 'absolu', derived: false, value: 30, unit: 'g', source: 'a' },
      { sex: 'ALL', ageMin: 18, ageMax: 120, nutrient: 'fiber_g', kind: 'RNP', basis: 'absolu', derived: false, value: 25, unit: 'g', source: 'b' },
    ];
    assert.equal(findReference(table, 'M', 40, 'fiberG')?.kind, 'RNP');
  });
});

describe('bilanJournalier — progression, manque et dépassement', () => {
  /** Un homme adulte tel que le seed le produit : cible 65 g, plafond 130 g. */
  const PROTEINES: ReferenceTable[] = [
    { sex: 'M', ageMin: 18, ageMax: 69, nutrient: 'protein_g', kind: 'IR_MIN', basis: 'absolu', derived: true, value: 65, unit: 'g', source: 'dérivé : 10 % AET × 2600 kcal ÷ 4 kcal/g' },
    { sex: 'M', ageMin: 18, ageMax: 69, nutrient: 'protein_g', kind: 'IR_MAX', basis: 'absolu', derived: true, value: 130, unit: 'g', source: 'dérivé : 20 % AET × 2600 kcal ÷ 4 kcal/g' },
  ];

  it('dit ce qui manque tant que la cible n’est pas atteinte', () => {
    const result = bilanJournalier({
      sex: 'M', age: 40, references: PROTEINES,
      meals: [repas({ proteinG: 45 })],
    });
    const proteines = bar(result, 'proteinG');
    assert.equal(proteines.reference?.value, 65);
    assert.equal(proteines.percent, 69.2);
    assert.equal(proteines.remaining, 20);
    assert.equal(proteines.standing, 'sous');
    assert.equal(proteines.excess, null);
  });

  it('dit que c’est atteint sans réclamer davantage', () => {
    const result = bilanJournalier({
      sex: 'M', age: 40, references: PROTEINES,
      meals: [repas({ proteinG: 90 })],
    });
    const proteines = bar(result, 'proteinG');
    assert.equal(proteines.remaining, 0);
    assert.equal(proteines.standing, 'dans');
    assert.equal(proteines.excess, null, '90 g est dans l’intervalle, pas au-delà');
  });

  it('compte le dépassement à partir du plafond, pas de la cible', () => {
    const result = bilanJournalier({
      sex: 'M', age: 40, references: PROTEINES,
      meals: [repas({ proteinG: 145 })],
    });
    const proteines = bar(result, 'proteinG');
    assert.equal(proteines.standing, 'au_dela');
    assert.equal(proteines.excess, 15);        // 145 - 130, pas 145 - 65
    assert.equal(proteines.referenceMax?.value, 130);
  });

  // R7 : on n'adresse pas un reproche sur une incertitude. Tant que seule la
  // borne haute dépasse, rien n'est dépassé.
  it('ne déclare pas un dépassement sur une borne haute incertaine', () => {
    const result = bilanJournalier({
      sex: 'M', age: 40, references: PROTEINES,
      meals: [repas({ proteinG: 120, max: { kcal: null, proteinG: 140, carbG: null, fatG: null, fiberG: null } })],
    });
    const proteines = bar(result, 'proteinG');
    assert.equal(proteines.standing, 'dans');
    assert.equal(proteines.excess, null);
    assert.equal(proteines.consumedMax, 140, 'la borne haute reste visible');
  });

  it('n’a ni plafond ni dépassement pour les fibres', () => {
    const result = bilanJournalier({
      sex: 'M', age: 40, references: REPERES_DE_TEST,
      meals: [repas({ fiberG: 40 })],
    });
    const fibres = bar(result, 'fiberG');
    assert.equal(fibres.referenceMax, null);
    assert.equal(findCeiling(REPERES_DE_TEST, 'M', 40, 'fiberG'), null);
    assert.equal(fibres.standing, 'dans');
    assert.equal(fibres.excess, null, 'un apport satisfaisant ne se dépasse pas');
  });

  it('ne prend jamais un plafond pour une cible', () => {
    const plafondSeul: ReferenceTable[] = [PROTEINES[1] as ReferenceTable];
    // Viser le maximum serait le contraire de ce que dit la source.
    assert.equal(findReference(plafondSeul, 'M', 40, 'proteinG'), null);
  });

  it('ne dit rien du tout sans repère', () => {
    const result = bilanJournalier({
      sex: 'M', age: 40, references: [], meals: [repas({ proteinG: 45 })],
    });
    const proteines = bar(result, 'proteinG');
    assert.equal(proteines.remaining, null);
    assert.equal(proteines.standing, null);
    assert.equal(proteines.consumed, 45, 'la consommation reste connue');
  });
});
