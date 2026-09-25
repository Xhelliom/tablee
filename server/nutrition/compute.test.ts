import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculerNutrition, type FoodValues, type MealInput, type NutritionItem } from './compute.ts';
import type { UnitDefaults } from './units.ts';

const VIDE: UnitDefaults = new Map();

const food = (
  name: string,
  per100g: Partial<FoodValues['per100g']>,
  plantBased: boolean | null,
  per100gMax: Partial<FoodValues['per100g']> = {},
): FoodValues => ({
  name,
  plantBased,
  per100g: { kcal: null, proteinG: null, carbG: null, fatG: null, fiberG: null, ...per100g },
  // Par défaut les bornes hautes suivent les valeurs : une mesure exacte est
  // un intervalle de largeur nulle.
  per100gMax: {
    kcal: null, proteinG: null, carbG: null, fatG: null, fiberG: null,
    ...per100g, ...per100gMax,
  },
});

const RIZ = food('Riz blanc, cuit', { kcal: 130, proteinG: 2.7, carbG: 28, fatG: 0.3, fiberG: 0.4 }, true);
const POULET = food('Poulet, blanc, cuit', { kcal: 148, proteinG: 30, carbG: 0, fatG: 3.2, fiberG: 0 }, false);
/**
 * Ciqual publie « < 0,5 » pour les lipides de la banane : borne basse 0, borne
 * haute 0,5. C'est le cas qui a motivé tout l'encadrement.
 */
const BANANE = food(
  'Banane, pulpe, crue',
  { kcal: 90.5, proteinG: 1.06, carbG: 19.7, fiberG: 2.7, fatG: 0 },
  true,
  { fatG: 0.5 },
);

/** Un aliment dont Ciqual écrit « traces » : non nul, mais sans majorant. */
const SEL = food('Sel, non iodé', { kcal: 0 }, null);

const item = (label: string, f: FoodValues | null, grams: number | null): NutritionItem => ({
  label, food: f, quantity: grams, unit: 'g', quantityG: grams,
});

const meal = (over: Partial<MealInput>): MealInput => ({
  servings: 1, source: 'manuel', recipe: null, items: [], ...over,
});

describe('calculerNutrition — repas découpé par IA', () => {
  it('reste une estimation, même entièrement rattaché (R6)', () => {
    const result = calculerNutrition(meal({ source: 'ia', items: [item('du riz', RIZ, 150)] }), VIDE);
    assert.equal(result.kcal, 195);
    assert.equal(result.confidence, 'moyenne');
  });

  it('ne remonte pas une confiance déjà basse', () => {
    const result = calculerNutrition(meal({ source: 'ia', items: [item('une truffe', null, 20)] }), VIDE);
    assert.equal(result.confidence, 'basse');
  });
});

describe('calculerNutrition — repas Jow', () => {
  const galette = {
    perServing: { kcal: 320, proteinG: 18, carbG: 16, fatG: 20, fiberG: 12 },
    confidence: 'haute' as const,
  };

  it('met le snapshot par portion à l’échelle des parts préparées', () => {
    const result = calculerNutrition(meal({ source: 'jow', recipe: galette, servings: 4 }), VIDE);
    assert.equal(result.kcal, 1280);
    assert.equal(result.fiberG, 48);
    assert.equal(result.confidence, 'haute');
    // Jow ne publie pas de majorants : une valeur est là ou elle ne l'est pas.
    assert.equal(result.max.kcal, 1280);
  });

  it('reprend la confiance de la recette', () => {
    const result = calculerNutrition(
      meal({ source: 'jow', recipe: { ...galette, confidence: 'moyenne' } }),
      VIDE,
    );
    assert.equal(result.confidence, 'moyenne');
  });

  it('dégrade la confiance quand le snapshot est partiel, sans combler le trou', () => {
    const partiel = { perServing: { ...galette.perServing, fiberG: null }, confidence: 'haute' as const };
    const result = calculerNutrition(meal({ source: 'jow', recipe: partiel }), VIDE);
    assert.equal(result.fiberG, null);
    assert.equal(result.confidence, 'moyenne');
    assert.match(result.warnings.join(' '), /absente\(s\) de la recette/);
  });

  it('ne compte pas zéro quand la recette ne publie rien', () => {
    const vide = {
      perServing: { kcal: null, proteinG: null, carbG: null, fatG: null, fiberG: null },
      confidence: 'basse' as const,
    };
    const result = calculerNutrition(meal({ source: 'jow', recipe: vide }), VIDE);
    assert.equal(result.kcal, null);
    assert.equal(result.proteinG, null);
    assert.equal(result.confidence, 'basse');
  });

  // §3 du contrat Jow : les quantités sont par convive, la nutrition par
  // portion. `servings` met les deux à l'échelle, chacun de son côté.
  it('met les ingrédients à l’échelle des parts pour la part végétale', () => {
    const result = calculerNutrition(
      meal({
        source: 'jow',
        recipe: galette,
        servings: 4,
        recipeIngredients: [item('Riz', RIZ, 100), item('Poulet', POULET, 100)],
      }),
      VIDE,
    );
    assert.equal(result.gramsTotal, 800);
    assert.equal(result.gramsPlant, 400);
    assert.equal(result.plantRatio, 50);
  });

  // ⚠️ Renversé le 22/09/2026 : « compléter un repas » — un ajout (le dessert)
  // rejoint le repas, recette ou non, et **compte** dans les totaux. Avant, le
  // snapshot faisait foi et l'écran affichait un ajout qui ne pesait rien.
  it('compte les ajouts au plat dans les totaux d’un repas à recette', () => {
    const result = calculerNutrition(
      meal({ source: 'jow', recipe: galette, items: [item('Riz', RIZ, 100)] }),
      VIDE,
    );
    assert.equal(result.kcal, 450);          // 320 de la galette + 130 du riz
    assert.equal(result.proteinG, 20.7);     // 18 + 2,7
    assert.equal(result.fiberG, 12.4);       // 12 + 0,4
    assert.equal(result.confidence, 'haute');
    assert.equal(result.max.kcal, 450);
  });

  it('comble ce que la recette ne publie pas, sans inventer un zéro', () => {
    const partiel = { perServing: { ...galette.perServing, fiberG: null }, confidence: 'haute' as const };
    const result = calculerNutrition(
      meal({ source: 'jow', recipe: partiel, items: [item('Riz', RIZ, 100)] }),
      VIDE,
    );
    // Le trou de la recette est comblé par l'ajout, et le défaut de la recette
    // reste signalé (confiance « moyenne »).
    assert.equal(result.fiberG, 0.4);
    assert.equal(result.kcal, 450);
    assert.equal(result.confidence, 'moyenne');
  });

  it('déborne le haut quand un ajout échappe au référentiel', () => {
    const result = calculerNutrition(
      meal({ source: 'jow', recipe: galette, items: [item('Dessert maison', null, 120)] }),
      VIDE,
    );
    assert.equal(result.kcal, 320, 'la recette reste le minorant');
    assert.equal(result.max.kcal, null, 'le dessert inconnu déborne le haut');
    assert.equal(result.confidence, 'basse');
  });
});

describe('calculerNutrition — somme des items', () => {
  it('somme les valeurs pour 100 g au prorata des grammes', () => {
    const result = calculerNutrition(
      meal({ items: [item('Riz', RIZ, 150), item('Poulet', POULET, 100)] }),
      VIDE,
    );
    assert.equal(result.kcal, 343);          // 130×1,5 + 148
    assert.equal(result.proteinG, 34.05);    // 2,7×1,5 + 30
    assert.equal(result.confidence, 'haute');
  });

  // Le cœur du modèle : la source publie un majorant, on le garde.
  it('encadre un total quand la source ne donne qu’un majorant', () => {
    const result = calculerNutrition(
      meal({ items: [item('Riz', RIZ, 100), item('Banane', BANANE, 100)] }),
      VIDE,
    );
    // Riz 0,3 g exact + banane entre 0 et 0,5 g.
    assert.equal(result.fatG, 0.3, 'borne basse');
    assert.equal(result.max.fatG, 0.8, 'borne haute');
    // Et surtout : la borne n'a pas été prise pour une mesure.
    assert.notEqual(result.fatG, 0.8);
    // Les autres nutriments restent exacts, bornes égales.
    assert.equal(result.proteinG, 3.76);
    assert.equal(result.max.proteinG, 3.76);
  });

  // I1 : la borne haute disparaît, la borne basse survit. « Au moins 2,7 g »
  // est vrai et utile ; l'ancien « valeur inconnue » jetait ce qu'on savait.
  it('rend un minorant, et jamais un total présenté comme exact, quand un aliment est inconnu', () => {
    const result = calculerNutrition(
      meal({ items: [item('Riz', RIZ, 100), item('Sel', SEL, 5)] }),
      VIDE,
    );
    assert.equal(result.proteinG, 2.7, 'ce qui est garanti atteint');
    assert.equal(result.max.proteinG, null, 'le total peut monter : pas de majorant');
    assert.match(result.warnings.join(' '), /protéines : valeur inconnue pour Sel/);
  });

  it('ne rend aucune borne pour un nutriment dont aucun aliment ne dit rien', () => {
    const result = calculerNutrition(meal({ items: [item('Sel', SEL, 5)] }), VIDE);
    // Un plancher à 0 serait exact et parfaitement trompeur à l'écran.
    assert.equal(result.fiberG, null);
    assert.equal(result.max.fiberG, null);
  });

  it('ignore un item sans aliment rattaché et le dit', () => {
    const result = calculerNutrition(
      meal({ items: [item('Riz', RIZ, 100), item('Plat de la cantine', null, 200)] }),
      VIDE,
    );
    assert.equal(result.kcal, 130);
    assert.equal(result.confidence, 'basse');
    assert.match(result.warnings.join(' '), /non rattaché au référentiel/);
  });

  it('ignore un item dont l’unité n’a pas d’équivalence sourcée', () => {
    const result = calculerNutrition(
      meal({
        items: [
          { label: 'Salade', food: RIZ, quantity: 1, unit: 'Poignée', quantityG: null },
          item('Riz', RIZ, 100),
        ],
      }),
      VIDE,
    );
    assert.equal(result.kcal, 130);
    assert.equal(result.confidence, 'basse');
    assert.equal(result.items[0]?.quantityG, null);
    assert.match(result.items[0]?.unresolved ?? '', /à préciser/);
  });

  it('résout les grammes manquants et les rend à l’appelant', () => {
    const defaults: UnitDefaults = new Map([['piece|tout', { grams: 60, source: 'test' }]]);
    const result = calculerNutrition(
      meal({ items: [{ label: 'Œuf', food: POULET, quantity: 2, unit: 'Pièce', quantityG: null }] }),
      defaults,
    );
    assert.equal(result.items[0]?.quantityG, 120);
  });

  it('déclasse un repas dont une quantité vient du repli par défaut (R6)', () => {
    const defaults: UnitDefaults = new Map([['cuillere a soupe|tout', { grams: 15, source: 'test' }]]);
    const result = calculerNutrition(
      meal({ items: [{ label: 'Riz', food: RIZ, quantity: 2, unit: 'Cuillère à soupe', quantityG: null }] }),
      defaults,
    );
    assert.equal(result.items[0]?.quantityG, 30);
    assert.equal(result.confidence, 'basse');
  });

  it('compte les cuillères d’un ingrédient Jow dans la part végétale, et le dit', () => {
    const defaults: UnitDefaults = new Map([['cuillere a soupe|tout', { grams: 15, source: 'test' }]]);
    const huile = food('Huile d’olive', { kcal: 900 }, true);
    const result = calculerNutrition(
      meal({
        source: 'jow',
        servings: 2,
        recipe: { perServing: { kcal: 300, proteinG: 10, carbG: 30, fatG: 10, fiberG: 3 }, confidence: 'haute' },
        recipeIngredients: [{ label: 'Huile', food: huile, quantity: 1, unit: 'Cuillère à soupe', quantityG: null }],
      }),
      defaults,
    );
    assert.equal(result.gramsTotal, 30, 'une cuillère par convive, deux convives');
    assert.equal(result.plantRatio, 100);
    assert.ok(result.warnings.some((w) => /approximatives/.test(w)), result.warnings.join(' | '));
  });

  it('n’a pas de valeurs plutôt que zéro quand aucun item n’est exploitable', () => {
    const result = calculerNutrition(meal({ items: [item('Mystère', null, 100)] }), VIDE);
    for (const value of [result.kcal, result.proteinG, result.carbG, result.fatG, result.fiberG]) {
      assert.equal(value, null);
    }
    assert.equal(result.confidence, 'basse');
  });

  it('déclasse une saisie par photo, quoi qu’elle contienne', () => {
    const result = calculerNutrition(
      meal({ source: 'photo', items: [item('Riz', RIZ, 100)] }),
      VIDE,
    );
    assert.equal(result.confidence, 'basse');
  });
});

describe('calculerNutrition — ce qui reste dans le plat (§6bis)', () => {
  it('ne compte que la part mangée de ce qui a été servi, grammes compris', () => {
    const result = calculerNutrition(
      meal({
        items: [item('Riz', RIZ, 200), item('Poulet', POULET, 200)],
        servings: 0.75, remainingServings: 0.25,
      }),
      VIDE,
    );
    assert.equal(result.kcal, 417);           // (260 + 296) × ¾
    assert.equal(result.max.kcal, 417);
    assert.equal(result.gramsTotal, 300);     // 400 g servis, 300 mangés
    assert.equal(result.plantRatio, 50);      // le rapport, lui, ne bouge pas
    assert.equal(result.items[0]?.quantityG, 200, 'la composition reste celle du plat servi');
  });

  it('laisse un repas sans reste déclaré tel qu’il était', () => {
    const result = calculerNutrition(
      meal({ items: [item('Riz', RIZ, 200)], servings: 1, remainingServings: null }),
      VIDE,
    );
    assert.equal(result.kcal, 260);
  });

  it('ne réduit pas un plat Jow : ses parts sont déjà la part mangée', () => {
    const result = calculerNutrition(
      meal({
        source: 'jow', servings: 3, remainingServings: 1,
        recipe: { perServing: { kcal: 500, proteinG: 20, carbG: 60, fatG: 15, fiberG: 5 }, confidence: 'haute' },
      }),
      VIDE,
    );
    assert.equal(result.kcal, 1500);
  });
});

describe('calculerNutrition — part végétale', () => {
  it('rapporte les grammes végétaux aux grammes connus', () => {
    const result = calculerNutrition(
      meal({ items: [item('Riz', RIZ, 150), item('Poulet', POULET, 50)] }),
      VIDE,
    );
    assert.equal(result.plantRatio, 75);
    assert.equal(result.gramsTotal, 200);
    assert.equal(result.gramsClassified, 200);
  });

  // « jamais 0 par défaut » (§11). Un gratin de courgettes dont les
  // ingrédients ne sont pas rattachés n'est pas un repas sans végétal.
  it('rend null, et non 0, quand aucun aliment n’est classé', () => {
    const result = calculerNutrition(
      meal({ items: [item('Plat inconnu', null, 300)] }),
      VIDE,
    );
    assert.equal(result.plantRatio, null);
    assert.match(result.warnings.join(' '), /part végétale indisponible/);
  });

  it('dit sur quelle fraction du repas la part végétale est calculée', () => {
    const inconnu = food('Sauce', {}, null);
    const result = calculerNutrition(
      meal({ items: [item('Riz', RIZ, 100), item('Sauce', inconnu, 100)] }),
      VIDE,
    );
    // Le §11 laisse les grammes non classés au dénominateur : 50 %, pas 100 %.
    assert.equal(result.plantRatio, 50);
    assert.equal(result.gramsClassified, 100);
    assert.match(result.warnings.join(' '), /50 % du repas seulement/);
  });

  it('n’a pas de part végétale quand aucune quantité n’est connue', () => {
    const result = calculerNutrition(
      meal({ items: [{ label: 'Salade', food: RIZ, quantity: 1, unit: 'Poignée', quantityG: null }] }),
      VIDE,
    );
    assert.equal(result.plantRatio, null);
    assert.equal(result.gramsTotal, null);
  });
});
