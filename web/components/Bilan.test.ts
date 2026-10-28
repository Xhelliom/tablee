/**
 * I5, filet 3 : l'écran. `BilanCard` ne rend la ligne « Énergie, moyenne sur
 * 7 jours » que si `energyAverage7d` existe ; sans lui (un mineur), rien ne
 * la remplace. Rendu côté serveur : pas de DOM, pas de dépendance de plus.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BilanCard } from './Bilan.tsx';
import type { DailyBalance } from '../api.ts';

const rendu = (balance: DailyBalance): string =>
  renderToStaticMarkup(createElement(BilanCard, {
    eaterId: 'e1', firstName: 'Test', balance, referencesLoaded: true, when: 'aujourd’hui',
  }));

const base: DailyBalance = { bars: [], mealCount: 0, plant: {
  state: 'indisponible', percent: null, coverage: null, householdAverage7d: null,
} };

describe('BilanCard — moyenne d’énergie', () => {
  it('l’affiche, avec la mise en garde « minimum », quand elle existe', () => {
    const html = rendu({ ...base, energyAverage7d: { average: 1200, days: 2, completeOnly: false, reference: null, percent: null, bySlot: {} } });
    assert.match(html, /Énergie, moyenne sur 7 jours/);
    assert.match(html, /est un minimum/);
  });

  it('dit sur combien de journées complètes elle porte, sans parler de minimum', () => {
    const html = rendu({ ...base, energyAverage7d: {
      average: 1900, days: 2, completeOnly: true, reference: null, percent: null, bySlot: {},
    } });
    assert.match(html, /2 journées complètes/);
    assert.doesNotMatch(html, /est un minimum/);
  });

  it('n’affiche rien à sa place quand elle est absente (mineur)', () => {
    const html = rendu(base);
    assert.doesNotMatch(html, /Énergie/);
    assert.doesNotMatch(html, /minimum/);
    assert.doesNotMatch(html, /Répartition/);
  });

  it('répartit par moment de la journée et dit que les collations peuvent manquer', () => {
    const html = rendu({ ...base, energyAverage7d: {
      average: 1200, days: 2, completeOnly: false, reference: null, percent: null, bySlot: { diner: 60, dejeuner: 40 },
    } });
    assert.match(html, /Déjeuner <strong[^>]*>40 %/);
    assert.ok(html.indexOf('Déjeuner') < html.indexOf('Dîner'), 'ordre de la journée');
    assert.match(html, /collations[^<]*sous-estimée/);
  });
});
