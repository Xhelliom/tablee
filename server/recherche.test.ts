/**
 * La recherche d'aliments, contre une vraie base : ce que tapent Jow et les
 * gens, face à ce qu'écrit Ciqual.
 *
 * Tous les rattachements passent par elle — l'ingrédient d'une recette, la
 * saisie libre, le découpage par IA. Une recherche qui ne trouve pas « Œuf »
 * laisse l'ingrédient sans valeurs, et l'utilisateur conclut que l'aliment
 * n'existe pas.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type pg from 'pg';
import { searchFoods } from './repo/foods.ts';
import { closeTestPool, resetDatabase, SKIP_MESSAGE, testDatabaseUrl, testPool } from './test-support/db.ts';

const enabled = testDatabaseUrl() !== null;

describe('recherche d’aliments', { skip: enabled ? false : SKIP_MESSAGE }, () => {
  let pool: pg.Pool;
  const noms = async (query: string): Promise<string[]> =>
    (await searchFoods(pool, query, 5)).map((food) => food.name);

  before(async () => {
    pool = await testPool();
    await resetDatabase(pool);
    // Les noms tels que Ciqual les écrit : sans ligature, avec la préparation
    // après la virgule.
    for (const name of ['Oeuf, cru', 'Sauce soja, préemballée', 'Sauce tomate', 'Haricot vert, cru', 'Thé vert, infusé']) {
      await pool.query(
        `insert into food (source, external_id, name, plant_based) values ('manuel', $1, $1, null)`,
        [name],
      );
    }
  });

  after(async () => {
    await closeTestPool();
  });

  it('trouve « Oeuf » depuis la ligature de « Œuf »', async () => {
    assert.deepEqual(await noms('Œuf'), ['Oeuf, cru']);
  });

  it('propose « Sauce soja » à « Sauce soja salée », qu’un mot de trop faisait échouer', async () => {
    assert.equal((await noms('Sauce soja salée'))[0], 'Sauce soja, préemballée');
  });

  it('met en tête l’aliment qui porte le plus de mots', async () => {
    const trouvés = await noms('Haricot vert (frais)');
    assert.equal(trouvés[0], 'Haricot vert, cru');
    assert.ok(trouvés.includes('Thé vert, infusé'), 'un seul mot suffit, mais passe après');
  });

  it('n’élargit pas quand tous les mots trouvent déjà', async () => {
    assert.deepEqual(await noms('Sauce tomate'), ['Sauce tomate']);
  });
});
