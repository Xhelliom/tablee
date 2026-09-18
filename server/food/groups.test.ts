import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classify, isKnownSubgroup, knownSubgroups } from './groups.ts';

describe('classify', () => {
  it('classe les sous-groupes non ambigus', () => {
    assert.deepEqual(classify('0201', 'Carotte, crue'), { category: 'legume', plantBased: true });
    assert.deepEqual(classify('0405', 'Saumon, cuit'), { category: 'poisson', plantBased: false });
    assert.deepEqual(classify('0410', 'Œuf, cuit dur'), { category: 'oeuf', plantBased: false });
  });

  // `null` veut dire « non classé », pas « pas végétal » (§10). Un plat
  // composé peut être l'un ou l'autre : on ne tranche pas à sa place.
  it('laisse les sous-groupes mixtes non classés', () => {
    assert.equal(classify('0103', 'Lasagnes aux légumes').plantBased, null);
    assert.equal(classify('0702', 'Chocolat au lait').plantBased, null);
    assert.equal(classify('0903', 'Margarine').plantBased, null);
  });

  it('suit le libellé Ciqual pour les substituts végétaux', () => {
    // Ciqual nomme ses substituts sans ambiguïté : c'est la source qui
    // tranche, pas une supposition sur le rayon du supermarché.
    const specialite = classify('0503', 'Spécialité végétale type fromage, à la noix de cajou, préemballée');
    assert.equal(specialite.plantBased, true);
    assert.equal(specialite.category, 'fromage');
    assert.equal(classify('0503', 'Camembert').plantBased, false);
  });

  it('ne tranche pas un mélange végétal et laitier', () => {
    assert.equal(classify('0903', 'Matière grasse mélangée (végétale et laitière) à 50-63% MG').plantBased, null);
  });

  it('ne range pas au hasard un sous-groupe inconnu', () => {
    assert.deepEqual(classify('9999', 'Aliment futur'), { category: null, plantBased: null });
    assert.equal(isKnownSubgroup('9999'), false);
    assert.equal(isKnownSubgroup('0201'), true);
  });

  it('accepte les codes entourés d’espaces, comme l’export les publie', () => {
    assert.equal(classify(' 0201 ', 'Carotte').category, 'legume');
  });

  it('couvre tous les sous-groupes de l’export 2025', () => {
    // Les codes réellement portés par les 3 484 aliments de l'export épinglé.
    const used = [
      '0101','0102','0103','0104','0105','0106','0201','0202','0203','0204','0205',
      '0301','0302','0303','0304','0305','0401','0402','0403','0404','0405','0406',
      '0407','0408','0409','0410','0501','0502','0503','0504','0601','0602','0603',
      '0701','0702','0703','0704','0705','0706','0707','0708','0709','0801','0802',
      '0803','0901','0902','0903','0904','0905','1001','1002','1003','1004','1005',
      '1006','1007','1008','1009','1010','1101','1102','1103','1104','0000',
    ];
    const missing = used.filter((code) => !isKnownSubgroup(code));
    assert.deepEqual(missing, [], `sous-groupes non classés : ${missing.join(', ')}`);

    // Un code de plus que l'export en compte, et un seul : 0411, que la table
    // 2025 a retiré. Il reste classé pour les `food` importés d'un export
    // antérieur — le seed ne supprime rien. Cette liste est ce qui empêche
    // d'accumuler des codes morts sans s'en apercevoir.
    const retirés = ['0411'];
    assert.deepEqual(
      knownSubgroups().filter((code) => !used.includes(code)).sort(),
      retirés,
    );
  });
});
