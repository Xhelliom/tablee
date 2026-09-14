/**
 * Le type d'accès à la base — ce que le compilateur refuse.
 *
 * Les assertions de ce fichier ne s'exécutent pas : elles sont vérifiées par
 * `tsc --noEmit`, qui compile tout `server/`, tests compris. Un `@ts-expect-error`
 * qui cesserait d'être une erreur **casse le typecheck** — c'est ce qui rend
 * ce garde-fou vivant plutôt que décoratif.
 *
 * Ce qui est vérifié : un `pg.Pool` ne peut pas atteindre une fonction du
 * domaine. Il ne porte aucun `app.household_id`, la RLS de la 008 ne lui rend
 * donc rien, et « rien » ressemble à « le foyer est vide ».
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type pg from 'pg';
import type { HouseholdDb, UnscopedDb } from './db.ts';
import { getMeal } from './repo/meals.ts';
import { loadReferences } from './repo/refs.ts';
import { listHouseholdsForUser } from './repo/households.ts';

const ID = '00000000-0000-4000-8000-000000000000';

describe('le client de foyer (dette n° 9)', () => {
  /**
   * Aucune de ces fonctions n'est appelée : elles sont déclarées pour que
   * `tsc` les typecheck, et laissées mortes pour que rien ne touche la base.
   */
  it('refuse le pool sur une fonction du domaine', () => {
    const pool = undefined as unknown as pg.Pool;

    const jamais = async (): Promise<void> => {
      // @ts-expect-error un pool ne porte aucun foyer : `meal` ne rendrait rien.
      await getMeal(pool, ID, ID);
    };

    assert.equal(typeof jamais, 'function');
  });

  it('accepte le pool là où la lecture est légitimement hors foyer', () => {
    const pool = undefined as unknown as pg.Pool;

    const jamais = async (): Promise<void> => {
      // Le référentiel public et la résolution d'avant-foyer : `UnscopedDb`.
      await loadReferences(pool);
      await listHouseholdsForUser(pool, ID);
    };

    assert.equal(typeof jamais, 'function');
  });

  it('accepte un client de foyer partout, y compris hors RLS', () => {
    const db = undefined as unknown as HouseholdDb;

    const jamais = async (): Promise<void> => {
      // Un client marqué reste un client : lire `nutrient_reference` depuis
      // une requête scopée est normal. C'est l'inverse qui ne doit pas passer.
      const unscoped: UnscopedDb = db;
      await loadReferences(unscoped);
      await getMeal(db, ID, ID);
    };

    assert.equal(typeof jamais, 'function');
  });
});
