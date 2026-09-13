import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { parseRecipeHtml, parseRecipeNode } from './parse.ts';

const DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));

interface Fixture {
  capturedAt: string;
  url: string;
  recipe: Record<string, unknown>;
}

function fixture(name: string): Fixture {
  return JSON.parse(readFileSync(`${DIR}${name}.json`, 'utf8')) as Fixture;
}

const FILES = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();

/** Enveloppe un nœud recette dans une page pour tester la chaîne complète. */
function page(recipe: unknown): string {
  const payload = JSON.stringify({ props: { pageProps: { recipe } } });
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${payload}</script></body></html>`;
}

describe('contrat Jow — échantillons figés', () => {
  it('couvre au moins 5 recettes différentes (critère de sortie Tâche 0)', () => {
    assert.ok(FILES.length >= 5, `seulement ${FILES.length} échantillon(s)`);
  });

  for (const file of FILES) {
    const name = file.replace(/\.json$/, '');
    it(`${name} : parsé en confiance haute`, () => {
      const fix = fixture(name);
      const recipe = parseRecipeNode(fix.recipe, { url: fix.url });

      assert.equal(recipe.confidence, 'haute', recipe.warnings.join(' | '));
      assert.ok(recipe.title.length > 0);
      assert.match(recipe.jowRecipeId ?? '', /^[a-f0-9]{24}$/);
      assert.ok(recipe.servings >= 1);
      assert.ok(recipe.ingredients.length > 0);
      for (const value of Object.values(recipe.nutrition)) {
        assert.equal(typeof value, 'number', 'valeur nutritionnelle absente');
      }
      assert.match(recipe.nutriScore ?? '', /^[A-E]$/);
    });
  }
});

describe('recette de référence (§3 de la spec)', () => {
  const fix = fixture('galette-vege-puree-de-carotte-et-tzatziki');
  const recipe = parseRecipeNode(fix.recipe, { url: fix.url });

  it('retrouve les valeurs relevées à la main', () => {
    assert.equal(recipe.title, 'Galette végé, purée de carotte & tzatziki');
    assert.deepEqual(recipe.nutrition, {
      kcal: 320,
      proteinG: 18,
      carbG: 16,
      fatG: 20,
      fiberG: 12,
    });
    assert.equal(recipe.nutriScore, 'B');
    assert.equal(recipe.greenScore, 'A+');
    assert.equal(recipe.servings, 1);
    assert.equal(recipe.ingredients.length, 5);
  });

  it('convertit les unités métriques et laisse les autres à null', () => {
    const byLabel = new Map(recipe.ingredients.map((i) => [i.label, i]));
    assert.equal(byLabel.get('Purée de carotte (surgelée)')?.quantityG, 100);
    assert.equal(byLabel.get('Tzatziki')?.quantityG, 50);
    // « 1 poignée » n'a pas de poids sans source : on ne le devine pas (I1, §6).
    assert.equal(byLabel.get('Salade (Mélange)')?.quantityG, null);
    assert.equal(byLabel.get('Steak végétal')?.quantityG, null);
    assert.ok(recipe.warnings.some((w) => w.includes('Salade (Mélange)')));
  });
});

describe('coversCount n’est pas un facteur d’échelle', () => {
  it('expose les parts prévues par Jow sans toucher aux valeurs par portion', () => {
    const fix = fixture('poulet-roti-et-duo-de-patates');
    const recipe = parseRecipeNode(fix.recipe, { url: fix.url });

    assert.equal(recipe.servings, 4, 'coversCount doit alimenter base_servings');
    // 868 kcal est bien une portion, pas le plat entier : le quart de poulet
    // par convive le confirme. Régression sensible — voir docs/jow-contract.md.
    assert.equal(recipe.nutrition.kcal, 868);
    const poulet = recipe.ingredients.find((i) => i.label.startsWith('Poulet'));
    assert.equal(poulet?.quantity, 0.25);
  });
});

describe('tolérance : une structure inattendue ne plante jamais', () => {
  it('page sans __NEXT_DATA__ → confiance basse', () => {
    const recipe = parseRecipeHtml('<html><body>bonjour</body></html>', {
      title: 'Gratin de courgettes',
    });
    assert.equal(recipe.confidence, 'basse');
    assert.equal(recipe.title, 'Gratin de courgettes');
    assert.deepEqual(recipe.ingredients, []);
    assert.equal(recipe.nutrition.kcal, null);
    assert.ok(recipe.warnings.length > 0);
  });

  it('JSON illisible → confiance basse', () => {
    const html = '<script id="__NEXT_DATA__" type="application/json">{oops</script>';
    assert.equal(parseRecipeHtml(html).confidence, 'basse');
  });

  it('payload sans nœud recette → confiance basse', () => {
    const html = page(undefined).replace('"recipe":undefined', '');
    assert.equal(parseRecipeHtml(html).confidence, 'basse');
  });

  it('nutrition partielle → confiance moyenne, pas de zéro inventé', () => {
    const recipe = parseRecipeHtml(
      page({
        title: 'Recette tronquée',
        coversCount: 2,
        nutritionalFacts: [{ id: 'ENERC', unit: 'kcal', amount: 300 }],
        constituents: [{ id: 'a'.repeat(24), name: 'Riz', quantityPerCover: 0.07, unit: { name: 'Kilogramme' } }],
      }),
    );
    assert.equal(recipe.confidence, 'moyenne');
    assert.equal(recipe.nutrition.kcal, 300);
    assert.equal(recipe.nutrition.proteinG, null, 'une valeur absente reste null, jamais 0');
    assert.equal(recipe.ingredients[0]?.quantityG, 70);
  });

  it('aucune valeur nutritionnelle → confiance basse', () => {
    const recipe = parseRecipeHtml(page({ title: 'Sans nutrition', constituents: [] }));
    assert.equal(recipe.confidence, 'basse');
  });

  it('unité inattendue → valeur écartée, jamais réinterprétée (I1)', () => {
    const recipe = parseRecipeHtml(
      page({
        title: 'Unités changées',
        nutritionalFacts: [
          { id: 'ENERC', unit: 'kJ', amount: 1339 },
          { id: 'PRO', unit: 'g', amount: 18 },
          { id: 'CHOAVL', unit: 'g', amount: 16 },
          { id: 'FAT', unit: 'g', amount: 20 },
          { id: 'FIBTG', unit: 'g', amount: 12 },
        ],
        constituents: [{ name: 'Riz', quantityPerCover: 1, unit: { name: 'Pièce' } }],
      }),
    );
    assert.equal(recipe.nutrition.kcal, null, 'des kJ ne deviennent pas des kcal');
    assert.equal(recipe.nutrition.proteinG, 18);
    assert.equal(recipe.confidence, 'moyenne');
    assert.ok(recipe.warnings.some((w) => w.includes('ENERC')));
  });

  it('ingrédients mal formés : ignorés un par un, pas de crash', () => {
    const recipe = parseRecipeHtml(
      page({
        title: 'Ingrédients cassés',
        nutritionalFacts: [],
        constituents: [null, 42, { quantityPerCover: 2 }, { name: 'Riz', unit: 'Gramme', quantityPerCover: 80 }],
      }),
    );
    assert.equal(recipe.ingredients.length, 1);
    assert.equal(recipe.ingredients[0]?.quantityG, 80);
  });
});
