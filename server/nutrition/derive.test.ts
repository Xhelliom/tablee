import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  deriveTargets, energyTargets, KCAL_PER_GRAM,
  type EnergyReference, type PercentReference,
} from './derive.ts';

const pct = (
  nutrient: string, kind: string, value: number, ageMin: number, ageMax: number,
  sex: 'F' | 'M' | 'ALL' = 'ALL',
): PercentReference => ({ sex, ageMin, ageMax, nutrient, kind, value, source: `IR ${nutrient}` });

const energy = (
  sex: 'F' | 'M', ageMin: number, ageMax: number, kcal: number,
): EnergyReference => ({ sex, ageMin, ageMax, kcal, source: `BE ${sex}` });

describe('deriveTargets', () => {
  it('traduit un intervalle en % en grammes', () => {
    // Homme adulte : 10 % de 2600 kcal à 4 kcal/g = 65 g de protéines.
    const derived = deriveTargets(
      [pct('protein_g', 'IR_MIN', 10, 18, 120)],
      [energy('M', 18, 69, 2600)],
    );
    const homme = derived.filter((d) => d.sex === 'M');
    assert.equal(homme.length, 1);
    assert.equal(homme[0]?.value, 65);
    assert.equal(homme[0]?.ageMin, 18);
    assert.equal(homme[0]?.ageMax, 69);
  });

  it('applique le facteur propre à chaque nutriment', () => {
    // Les lipides sont à 9 kcal/g, pas 4 : 35 % de 2600 = 101 g, pas 228.
    const derived = deriveTargets(
      [pct('fat_g', 'IR_MIN', 35, 18, 120)],
      [energy('M', 18, 69, 2600)],
    );
    assert.equal(derived[0]?.value, 101);
    assert.equal(KCAL_PER_GRAM.fat_g, 9);
  });

  it('sexue la cible quand le besoin énergétique l’est', () => {
    const derived = deriveTargets(
      [pct('protein_g', 'IR_MIN', 10, 18, 120)],
      [energy('M', 18, 69, 2600), energy('F', 18, 59, 2100)],
    );
    assert.equal(derived.find((d) => d.sex === 'M')?.value, 65);
    assert.equal(derived.find((d) => d.sex === 'F')?.value, 53);   // 10 % × 2100 / 4
  });

  /**
   * Le cœur du module. L'ANSES publie les protéines par 4-5 / 6-9 / 10-13 /
   * 14-17 ans et les besoins énergétiques par 4-6 / 7-10 / 11-14 / 15-17 ans.
   * Le croisement produit ses propres tranches, qu'on ne choisit pas.
   */
  it('croise deux découpages d’âge qui ne coïncident pas', () => {
    const derived = deriveTargets(
      [pct('protein_g', 'IR_MIN', 6, 4, 5), pct('protein_g', 'IR_MIN', 7, 6, 9)],
      [energy('M', 4, 6, 1521), energy('M', 7, 10, 1851)],
    );
    const garcons = derived.filter((d) => d.sex === 'M');

    // 4-5 ans : 6 % de 1521 → 23 g. 6 ans : 7 % de 1521 → 27 g. 7-9 ans : 7 %
    // de 1851 → 32 g. Trois tranches là où chaque source n'en voyait que deux.
    assert.deepEqual(
      garcons.map((d) => [d.ageMin, d.ageMax, d.value]),
      [[4, 5, 23], [6, 6, 27], [7, 9, 32]],
    );
  });

  it('recolle les années consécutives de même valeur', () => {
    const derived = deriveTargets(
      [pct('fat_g', 'IR_MIN', 35, 4, 17)],
      [energy('M', 4, 6, 1500), energy('M', 7, 10, 1500)],
    );
    // Même pourcentage et même énergie sur 4-10 : une seule tranche, pas sept.
    const garcons = derived.filter((d) => d.sex === 'M');
    assert.equal(garcons.length, 1);
    assert.deepEqual([garcons[0]?.ageMin, garcons[0]?.ageMax], [4, 10]);
  });

  // I1 : une année qu'une des deux sources ne couvre pas ne donne rien. Pas
  // d'extrapolation, pas de reprise de la tranche voisine.
  it('ne produit rien là où une des deux sources se tait', () => {
    const derived = deriveTargets(
      [pct('protein_g', 'IR_MIN', 10, 0, 120)],
      [energy('M', 18, 69, 2600)],
    );
    const garcons = derived.filter((d) => d.sex === 'M');
    assert.equal(garcons.length, 1);
    assert.equal(garcons[0]?.ageMin, 18);
    assert.equal(garcons[0]?.ageMax, 69, 'rien au-delà de 69 ans');

    // Aucun intervalle publié : rien du tout.
    assert.deepEqual(deriveTargets([], [energy('M', 18, 69, 2600)]), []);
    // Aucun besoin énergétique : rien non plus.
    assert.deepEqual(deriveTargets([pct('protein_g', 'IR_MIN', 10, 18, 120)], []), []);
  });

  it('ignore les fibres, dont le repère est déjà publié en grammes', () => {
    const derived = deriveTargets(
      [pct('fiber_g', 'AS', 30, 18, 120)],
      [energy('M', 18, 69, 2600)],
    );
    assert.deepEqual(derived, []);
  });

  it('garde la chaîne de calcul complète dans la source', () => {
    const derived = deriveTargets(
      [pct('protein_g', 'IR_MIN', 10, 18, 120)],
      [energy('M', 18, 69, 2600)],
    );
    const source = derived[0]?.source ?? '';
    assert.match(source, /^dérivé : /, 'doit s’annoncer comme dérivé, pas comme recopié');
    assert.match(source, /10 % AET/);
    assert.match(source, /2600 kcal/);
    assert.match(source, /4 kcal\/g/);
    assert.match(source, /1169\/2011/);
  });
});

describe('tranches prolongées', () => {
  /**
   * L'avis ANSES ne retient un besoin énergétique que jusqu'à 69 ans chez
   * l'homme. La tranche au-delà reprend la même valeur, mais **pas la même
   * provenance** : elle sort du périmètre de l'avis, et le dire est tout ce
   * qui sépare une prolongation assumée d'un repère inventé (I1).
   */
  const SOURCÉ = 'ANSES 2016, § besoin énergétique';
  const PROLONGÉ = 'ANSES 2016 — valeur des 18-69 ans, prolongée au-delà de 69 ans';

  it('ne fusionne pas une tranche prolongée avec la tranche sourcée', () => {
    const derived = deriveTargets(
      [pct('protein_g', 'IR_MIN', 10, 18, 120)],
      [
        { sex: 'M', ageMin: 18, ageMax: 69, kcal: 2600, source: SOURCÉ },
        { sex: 'M', ageMin: 70, ageMax: 120, kcal: 2600, source: PROLONGÉ },
      ],
    );
    const hommes = derived.filter((d) => d.sex === 'M');

    // Même valeur des deux côtés, et pourtant deux lignes : c'est la source
    // qui diffère, et elle doit rester lisible.
    assert.deepEqual(
      hommes.map((d) => [d.ageMin, d.ageMax, d.value]),
      [[18, 69, 65], [70, 120, 65]],
    );
    assert.match(hommes[0]?.source ?? '', /§ besoin énergétique/);
    assert.match(hommes[1]?.source ?? '', /prolongée au-delà de 69 ans/);
  });

  it('couvre tout âge adulte une fois la prolongation en place', () => {
    const derived = deriveTargets(
      [pct('protein_g', 'IR_MIN', 10, 18, 120)],
      [
        { sex: 'M', ageMin: 18, ageMax: 69, kcal: 2600, source: SOURCÉ },
        { sex: 'M', ageMin: 70, ageMax: 120, kcal: 2600, source: PROLONGÉ },
      ],
    );
    const couvre = (age: number): boolean =>
      derived.some((d) => d.sex === 'M' && age >= d.ageMin && age <= d.ageMax);
    for (const age of [18, 40, 69, 70, 85, 120]) {
      assert.ok(couvre(age), `${age} ans devrait avoir un repère`);
    }
    // Et toujours rien là où aucune source ne parle.
    assert.equal(couvre(3), false, 'aucune prolongation vers le bas');
  });
});

describe('energyTargets', () => {
  it('recopie le besoin énergétique d’un majeur, sans le recalculer', () => {
    const cibles = energyTargets([energy('M', 18, 69, 2600)]);
    assert.equal(cibles.length, 1);
    assert.deepEqual(
      { ...cibles[0], source: '' },
      { sex: 'M', ageMin: 18, ageMax: 69, nutrient: 'kcal', kind: 'BNM', value: 2600, unit: 'kcal', source: '' },
    );
    // La source est celle de la ligne d'origine, pas une chaîne de calcul :
    // rien n'a été dérivé de rien.
    assert.equal(cibles[0]?.source, 'BE M');
  });

  it('ne produit aucune ligne avant 18 ans (I5)', () => {
    // Les besoins énergétiques des enfants sont chargés et servent à dériver
    // les cibles en grammes. Ils ne doivent jamais devenir un repère affiché.
    const cibles = energyTargets([
      energy('M', 4, 6, 1521), energy('M', 7, 10, 1851),
      energy('M', 11, 14, 2263), energy('M', 15, 17, 2826),
      energy('F', 15, 17, 2253),
    ]);
    assert.deepEqual(cibles, []);
  });

  it('coupe à la majorité une tranche qui l’enjamberait', () => {
    // Aucune source ne publie une telle tranche aujourd'hui. Si l'une le
    // faisait, la moitié mineure ne doit pas passer avec l'autre.
    const cibles = energyTargets([energy('F', 15, 59, 2100)]);
    assert.equal(cibles.length, 1);
    assert.equal(cibles[0]?.ageMin, 18);
    assert.equal(cibles[0]?.ageMax, 59);
  });

  it('recolle les tranches de même valeur, comme les cibles en grammes', () => {
    // 18-69 et 70-120 portent la même valeur mais **pas** la même source : la
    // seconde est une prolongation assumée (dette n° 1). Elles restent deux
    // lignes, sinon la nuance disparaîtrait du repère affiché.
    const cibles = energyTargets([
      energy('M', 18, 69, 2600),
      { sex: 'M', ageMin: 70, ageMax: 120, kcal: 2600, source: 'BE M prolongé' },
    ]);
    assert.equal(cibles.length, 2);
    assert.equal(cibles[1]?.source, 'BE M prolongé');
  });
});
