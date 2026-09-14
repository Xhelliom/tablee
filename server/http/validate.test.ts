/**
 * La couche qui refuse — testée sur ses refus.
 *
 * `server/http/validate.ts` est le seul endroit où une valeur venue du réseau
 * devient une valeur du domaine. Les tests d'intégration ne l'exercent que par
 * ses chemins heureux : ils envoient des corps bien formés, et une validation
 * qui laisserait tout passer y serait invisible.
 *
 * Ce fichier fait l'inverse. Il vérifie ce qui est **rejeté**, et avec quel
 * code : un 400 lisible à l'écran plutôt qu'un 500 ou, pire, une écriture
 * silencieuse de travers.
 *
 * Deux refus valent plus que les autres :
 *
 *   — `share` envoyé par le client (R2). Les parts sont calculées à
 *     l'écriture puis figées ; les accepter du dehors rendrait l'historique
 *     incohérent sans moyen de le rattraper.
 *   — une chaîne vide là où on attend un nombre. `Number('')` vaut 0, et
 *     « 0 g » n'est pas « on ne sait pas » (I1).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError } from './errors.ts';
import {
  array, body, int, isoDate, isoDateTime, mealItems, num, optionalStr, optionalUuid,
  participants, sex, slot, source, str, stringArray, timezone, uuid,
} from './validate.ts';

/** Le refus attendu : un 400, et le code d'erreur qui remonte à l'écran. */
function refuse(fn: () => unknown, { code = 'requete_invalide' } = {}): ApiError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ApiError, `attendu une ApiError, reçu ${String(error)}`);
    assert.equal(error.status, 400, `attendu un 400, reçu ${error.status}`);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail('aucun refus : la valeur est passée');
}

const UUID = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

describe('validate — les types faux', () => {
  it('refuse un corps qui n’est pas un objet', () => {
    for (const valeur of [null, undefined, 'texte', 42, true, ['a']]) {
      refuse(() => body(valeur));
    }
    assert.deepEqual(body({ a: 1 }), { a: 1 });
  });

  it('refuse une chaîne absente, vide, ou qui n’en est pas une', () => {
    for (const valeur of [undefined, null, '', '   ', 42, true, {}, ['a']]) {
      refuse(() => str(valeur, 'name'));
    }
    assert.equal(str('  Léa  ', 'name'), 'Léa', 'la chaîne acceptée est rognée');
  });

  it('refuse un nombre qui n’en est pas un', () => {
    for (const valeur of [undefined, null, true, {}, [], 'douze', NaN, Infinity, -Infinity]) {
      refuse(() => num(valeur, 'quantity'));
    }
    assert.equal(num('12.5', 'quantity'), 12.5, 'un nombre en chaîne reste accepté');
  });

  /**
   * `Number('')` vaut 0. Sans ce refus, un champ laissé vide s'enregistrerait
   * comme une quantité nulle — une valeur fausse, là où l'absence était la
   * vérité. Le client envoie `null` pour l'inconnu.
   */
  it('refuse une chaîne vide là où un nombre est attendu, plutôt que d’y lire 0', () => {
    for (const blanc of ['', '   ', '\t', '\n']) {
      refuse(() => num(blanc, 'quantityG'));
    }
  });

  it('refuse un entier qui a des décimales', () => {
    refuse(() => int(1.5, 'guestCount'));
    assert.equal(int('3', 'guestCount'), 3);
  });

  it('refuse un nombre hors bornes', () => {
    refuse(() => num(-1, 'quantity', { min: 0, max: 100 }));
    refuse(() => num(101, 'quantity', { min: 0, max: 100 }));
    assert.equal(num(0, 'quantity', { min: 0, max: 100 }), 0, '0 est une valeur, pas une absence');
  });

  it('refuse un sexe, un créneau ou une source hors de la liste', () => {
    for (const valeur of ['X', 'f', '', null, 1]) refuse(() => sex(valeur));
    for (const valeur of ['souper', '', null, 1, ['diner']]) refuse(() => slot(valeur));
    for (const valeur of ['scan', '', null, 1]) refuse(() => source(valeur));

    assert.equal(sex('F'), 'F');
    assert.equal(slot('diner'), 'diner');
    assert.equal(source('jow'), 'jow');
  });

  it('refuse une liste qui n’en est pas une', () => {
    for (const valeur of [undefined, null, 'a,b', {}, 42]) refuse(() => array(valeur, 'items'));
    assert.deepEqual(array([], 'items'), []);
  });
});

describe('validate — les chaînes trop longues', () => {
  it('refuse au-delà de la longueur annoncée, et nomme le champ', () => {
    const erreur = refuse(() => str('a'.repeat(501), 'name'));
    assert.match(erreur.message, /name/, 'le message doit dire quel champ');
    assert.match(erreur.message, /trop long/);
    assert.equal(str('a'.repeat(500), 'name').length, 500, 'la limite elle-même passe');
  });

  it('applique la limite propre à chaque usage', () => {
    refuse(() => str('a'.repeat(81), 'diets[0]', { max: 80 }));
    refuse(() => stringArray(['ok', 'a'.repeat(81)], 'diets'));
    refuse(() => mealItems([{ label: 'a'.repeat(201) }]));
    refuse(() => mealItems([{ label: 'Riz', unit: 'a'.repeat(41) }]));
    refuse(() => timezone('a'.repeat(65), 'timezone'));
  });

  /**
   * Le texte de partage Jow arrive dans l'URL et peut être long ; la limite
   * n'est pas là pour le style, elle borne ce qui entre en base et ce qui
   * traverse le parseur.
   */
  it('borne aussi les éléments d’une liste, pas seulement la liste', () => {
    const erreur = refuse(() => stringArray([1], 'diets'));
    assert.match(erreur.message, /diets\[0\]/, 'l’index fautif doit être nommé');
  });
});

describe('validate — les identifiants', () => {
  it('refuse ce qui n’est pas un UUID', () => {
    for (const valeur of [
      'pas-un-uuid',
      '3f2b1c4d5e6f4a7b8c9d0e1f2a3b4c5d',
      '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5',
      '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5dd',
      'zzzzzzzz-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
      `${UUID} or 1=1`,
      '',
      null,
      undefined,
      42,
      {},
    ]) {
      refuse(() => uuid(valeur, 'eaterId'));
    }
    assert.equal(uuid(UUID, 'eaterId'), UUID);
    assert.equal(uuid(UUID.toUpperCase(), 'eaterId'), UUID.toUpperCase());
  });

  it('traite l’absence et la chaîne vide comme « pas d’identifiant »', () => {
    for (const vide of [undefined, null, '']) {
      assert.equal(optionalUuid(vide, 'foodId'), null);
    }
    refuse(() => optionalUuid('pas-un-uuid', 'foodId'));
    assert.equal(optionalStr('', 'unit'), null);
  });
});

describe('validate — les dates', () => {
  it('refuse une date mal formée ou qui n’existe pas', () => {
    for (const valeur of ['13/09/2026', '2026-9-13', '2026-02-30', '2026-13-01', 'hier', '']) {
      refuse(() => isoDate(valeur, 'birthDate'));
    }
    assert.equal(isoDate('2026-09-13', 'birthDate'), '2026-09-13');
    assert.equal(isoDate('2024-02-29', 'birthDate'), '2024-02-29', 'une année bissextile existe');
  });

  it('refuse un instant illisible, et normalise le reste en UTC', () => {
    for (const valeur of ['jamais', '', null, 42, '2026-13-01T00:00:00Z']) {
      refuse(() => isoDateTime(valeur, 'eaten_at'));
    }
    assert.equal(
      isoDateTime('2026-09-13T19:30:00+02:00', 'eaten_at'),
      '2026-09-13T17:30:00.000Z',
      'le décalage est conservé par la conversion, pas ignoré',
    );
  });
});

describe('validate — les fuseaux', () => {
  it('refuse un fuseau inconnu, avec son propre code d’erreur', () => {
    for (const valeur of ['Europe/Nulle-Part', 'Paris', 'GMT+2', 'UTC+2', '../etc/passwd']) {
      refuse(() => timezone(valeur, 'timezone'), { code: 'fuseau_inconnu' });
    }
  });

  it('refuse un fuseau absent', () => {
    for (const vide of [undefined, null, '']) refuse(() => timezone(vide, 'timezone'));
  });

  it('accepte les identifiants IANA', () => {
    for (const bon of ['Europe/Paris', 'Indian/Reunion', 'America/Cayenne', 'UTC']) {
      assert.equal(timezone(bon, 'timezone'), bon);
    }
  });
});

describe('validate — les convives (R2)', () => {
  /**
   * La règle structurante du §11 : `meal_participant.share` est calculé à
   * l'écriture puis figé. Un client qui l'enverrait imposerait une répartition
   * que rien ne recalcule — et modifier un `portion_coef` ne rattraperait pas
   * l'historique, puisque justement il ne le réécrit jamais.
   */
  it('refuse un `share` venu du client', () => {
    const erreur = refuse(() => participants([{ eaterId: UUID, share: 0.9 }]));
    assert.match(erreur.message, /calculées par le serveur/);
  });

  it('refuse un `share` même nul, même caché derrière un présent valide', () => {
    refuse(() => participants([{ eaterId: UUID, share: 0 }]));
    refuse(() => participants([{ eaterId: UUID }, { eaterId: UUID, share: null }]));
  });

  it('refuse un convive malformé', () => {
    refuse(() => participants('moi'));
    refuse(() => participants([null]));
    refuse(() => participants(['moi']));
    refuse(() => participants([{}]));
    refuse(() => participants([{ eaterId: 'moi' }]));
    refuse(() => participants([{ eaterId: UUID }, { eaterId: 42 }]));
  });

  it('accepte la forme attendue, et « présent » par défaut', () => {
    assert.deepEqual(participants([{ eaterId: UUID }]), [{ eaterId: UUID, present: true }]);
    assert.deepEqual(
      participants([{ eaterId: UUID, present: false }]),
      [{ eaterId: UUID, present: false }],
    );
    // Une liste vide passe ici et plus loin : un repas peut n'avoir aucun
    // convive présent, `writeShares` n'écrit alors aucune part.
    assert.deepEqual(participants([]), []);
  });
});

describe('validate — les lignes d’un repas', () => {
  it('refuse une ligne sans libellé', () => {
    refuse(() => mealItems([{ quantityG: 120 }]));
    refuse(() => mealItems([{ label: '   ', quantityG: 120 }]));
    refuse(() => mealItems(['Riz']));
  });

  it('refuse une quantité négative ou démesurée', () => {
    refuse(() => mealItems([{ label: 'Riz', quantityG: -1 }]));
    refuse(() => mealItems([{ label: 'Riz', quantityG: 100_001 }]));
    refuse(() => mealItems([{ label: 'Riz', quantity: -0.5, unit: 'Kilogramme' }]));
  });

  it('refuse un foodId qui n’est pas un identifiant', () => {
    refuse(() => mealItems([{ label: 'Riz', foodId: 'riz' }]));
  });

  it('garde l’inconnu à null plutôt qu’à zéro', () => {
    assert.deepEqual(
      mealItems([{ label: 'Riz', quantity: null, unit: null, quantityG: null, foodId: null }]),
      [{ foodId: null, label: 'Riz', quantity: null, unit: null, quantityG: null }],
    );
    assert.deepEqual(
      mealItems([{ label: 'Riz' }]),
      [{ foodId: null, label: 'Riz', quantity: null, unit: null, quantityG: null }],
      'un champ absent est inconnu, pas zéro',
    );
  });
});
