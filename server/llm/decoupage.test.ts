/**
 * Ce qu'on garde de la réponse du modèle — sans réseau.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FoodSummary } from '../repo/foods.ts';
import {
  applyChoices, describeCandidates, mealSplitter, readSplit, SplitRefused, type MatchedItem,
} from './decoupage.ts';
import type { Anonymized } from './index.ts';

describe('découpage par IA — ce qui revient', () => {
  it('garde le titre et les lignes lisibles, et laisse à préciser les poids absurdes', () => {
    assert.deepEqual(
      readSplit({
        title: '  Œufs au sel  ',
        items: [
          { label: '2 œufs', search: 'œuf', grams: 110.4 },
          { label: 'du sel', search: 'sel', grams: -3 },
          { label: '  ', search: 'rien', grams: 10 },
        ],
      }),
      {
        title: 'Œufs au sel',
        items: [
          { label: '2 œufs', search: 'œuf', grams: 110 },
          { label: 'du sel', search: 'sel', grams: null },
        ],
      },
    );
    assert.equal(readSplit({ title: '', items: [] }).title, null, 'un titre vide n’est pas un titre');
  });

  it('refuse une réponse sans liste', () => {
    assert.throws(() => readSplit({ autre: 1 }), SplitRefused);
  });

  it('dit au modèle pour combien le plat a été préparé, avant la description', async () => {
    let envoyé: unknown;
    const découper = mealSplitter((requête) => {
      envoyé = requête.messages[0]?.content;
      return Promise.resolve('{"items":[]}');
    });
    assert.deepEqual(await découper('des pâtes' as Anonymized, 4), { title: null, items: [] });
    assert.equal(envoyé, 'Cuisiné pour 4 personnes\n\ndes pâtes');

    // Avec une photo : l'image d'abord, puis la même consigne — texte vide compris.
    await découper('' as Anonymized, 2, { mimeType: 'image/jpeg', data: 'AAAA' });
    assert.deepEqual(envoyé, [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
      { type: 'text', text: 'Cuisiné pour 2 personnes\n\n' },
    ]);
  });
});

describe('découpage par IA — le choix dans Ciqual', () => {
  const food = (name: string): FoodSummary => ({
    id: name, name, source: 'ciqual', category: null, plantBased: null, nutrientsKnown: true, units: [],
  });
  // Les deux cas relevés sur la vraie table le 14/09/2026.
  const pâtes: MatchedItem = {
    label: 'des pâtes', grams: 200,
    foods: ['Pâte à pizza cuite', 'Pâte sablée, cuite', 'Pâtes sèches standard, cuites, non salées'].map(food),
  };
  const pomme: MatchedItem = { label: 'une pomme', grams: 150, foods: ['Pomme, sèche', 'Pomme, pulpe, crue'].map(food) };
  const noms = (items: MatchedItem[]): string[][] => items.map((item) => item.foods.map((f) => f.name));

  it('met en tête l’aliment désigné par son numéro, sans perdre les autres', () => {
    const choisis = applyChoices([pâtes, pomme], { choix: [{ ligne: 1, numero: 3 }, { ligne: 2, numero: 2 }] });
    assert.deepEqual(noms(choisis), [
      ['Pâtes sèches standard, cuites, non salées', 'Pâte à pizza cuite', 'Pâte sablée, cuite'],
      ['Pomme, pulpe, crue', 'Pomme, sèche'],
    ]);
    assert.deepEqual(choisis.map((item) => item.foodId), ['Pâtes sèches standard, cuites, non salées', 'Pomme, pulpe, crue']);
  });

  it('garde l’ordre de la recherche pour un numéro hors liste ou une réponse illisible', () => {
    const avant = noms([pâtes, pomme]);
    const horsListe = applyChoices([pâtes, pomme], { choix: [{ ligne: 1, numero: 9 }] });
    assert.deepEqual(noms(horsListe), avant);
    assert.deepEqual(horsListe.map((item) => item.foodId), ['Pâte à pizza cuite', 'Pomme, sèche']);
    assert.deepEqual(noms(applyChoices([pâtes, pomme], null)), avant);
  });

  it('ne présélectionne rien quand le modèle dit qu’aucun ne convient', () => {
    const [ligne] = applyChoices([pâtes], { choix: [{ ligne: 1, numero: null }] });
    assert.equal(ligne?.foodId, null);
    assert.deepEqual(noms(ligne === undefined ? [] : [ligne]), noms([pâtes]), 'la liste reste, pour choisir à la main');
  });

  it('numérote les candidats sous chaque ligne, sans aucune valeur', () => {
    assert.equal(
      describeCandidates([pomme, { label: 'une truffe', grams: null, foods: [] }]),
      'Ligne 1 : une pomme\n1. Pomme, sèche\n2. Pomme, pulpe, crue\n\nLigne 2 : une truffe\n(aucun candidat)',
    );
  });
});
