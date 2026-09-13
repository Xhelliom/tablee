import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CIQUAL_NUTRIENTS,
  decodeCiqual,
  parseCompoChunk,
  parseFoods,
  parseRecords,
  parseTeneur,
} from './ciqual.ts';

describe('parseTeneur', () => {
  it('lit une valeur à virgule décimale, bornes égales', () => {
    assert.deepEqual(parseTeneur(' 90,5 '), { value: 90.5, max: 90.5, kind: 'valeur' });
    assert.deepEqual(parseTeneur('0'), { value: 0, max: 0, kind: 'valeur' });
  });

  // I1 : le cœur du sujet, et il ne bouge pas. Ces deux formes sont des
  // absences de mesure. Les écrire 0 ferait afficher « 0 g de fibres » là où
  // Ciqual dit « on ne sait pas » — la différence se voit à l'écran, elle doit
  // exister en base.
  it('ne convertit jamais une absence de mesure en zéro ni en borne', () => {
    for (const raw of ['-', '', '   ', 'traces', 'Traces']) {
      assert.deepEqual(
        parseTeneur(raw),
        { value: null, max: null, kind: raw.trim().toLowerCase() === 'traces' ? 'traces' : 'absente' },
        `« ${raw} » devrait rester entièrement inconnu`,
      );
    }
  });

  // La doc Ciqual (§1.2.1) appelle « <10 » une **valeur maximale**. C'est une
  // information publiée : on la garde comme majorant, jamais comme mesure.
  it('garde le majorant d’un « inférieur à », sans le prendre pour une mesure', () => {
    assert.deepEqual(parseTeneur('< 0,5'), { value: 0, max: 0.5, kind: 'seuil' });
    assert.deepEqual(parseTeneur('<50'), { value: 0, max: 50, kind: 'seuil' });
    // Et surtout : la borne n'est pas la valeur.
    assert.notEqual(parseTeneur('< 2,2').value, 2.2);
  });

  it('distingue les raisons de l’absence', () => {
    assert.equal(parseTeneur('-').kind, 'absente');
    assert.equal(parseTeneur('traces').kind, 'traces');
    assert.equal(parseTeneur('< 2,2').kind, 'seuil');
    assert.equal(parseTeneur('abc').kind, 'illisible');
  });

  it('n’invente pas de borne quand le « < » n’est suivi de rien de lisible', () => {
    assert.deepEqual(parseTeneur('< '), { value: null, max: null, kind: 'illisible' });
  });
});

describe('parseRecords', () => {
  const xml = `<?xml version="1.0" encoding="windows-1252" ?>
<TABLE>
   <COMPO>
      <alim_code> 1000 </alim_code>
      <const_code> 328 </const_code>
      <teneur> 274 </teneur>
      <min missing=" " />
      <code_confiance> C </code_confiance>
   </COMPO>
   <COMPO>
      <alim_code> 1001 </alim_code>
      <const_code> 328 </const_code>
      <teneur> - </teneur>
   </COMPO>
</TABLE>`;

  it('découpe les enregistrements et détache les champs', () => {
    const records = [...parseRecords(xml, 'COMPO')];
    assert.equal(records.length, 2);
    assert.equal(records[0]?.['alim_code'], '1000');
    assert.equal(records[0]?.['teneur'], '274');
  });

  it('traite un champ `missing` comme un champ absent', () => {
    const records = [...parseRecords(xml, 'COMPO')];
    assert.equal(records[0]?.['min'], null);
    assert.equal(records[1]?.['min'], undefined);
  });

  it('ne rend rien pour une balise absente, sans lever', () => {
    assert.deepEqual([...parseRecords(xml, 'ALIM')], []);
    assert.deepEqual([...parseRecords('pas du xml', 'COMPO')], []);
  });

  it('décode les entités XML', () => {
    const entities = '<T><ALIM><alim_nom_fr> Sel &amp; poivre </alim_nom_fr></ALIM></T>';
    assert.equal([...parseRecords(entities, 'ALIM')][0]?.['alim_nom_fr'], 'Sel & poivre');
  });
});

describe('parseFoods', () => {
  const xml = `<TABLE>
   <ALIM>
      <alim_code> 13000 </alim_code>
      <alim_nom_fr> Carotte, crue </alim_nom_fr>
      <alim_grp_code> 02 </alim_grp_code>
      <alim_ssgrp_code> 0201 </alim_ssgrp_code>
   </ALIM>
   <ALIM>
      <alim_nom_fr> Aliment sans code </alim_nom_fr>
   </ALIM>
</TABLE>`;

  it('ignore un aliment sans code plutôt que d’échouer sur le lot', () => {
    const foods = parseFoods(xml);
    assert.equal(foods.length, 1);
    assert.deepEqual(foods[0], {
      code: '13000',
      name: 'Carotte, crue',
      groupCode: '02',
      subgroupCode: '0201',
    });
  });
});

describe('parseCompoChunk', () => {
  it('ne retient que les cinq constituants de la V1', () => {
    const xml = `<TABLE>
      <COMPO><alim_code> 1 </alim_code><const_code> 328 </const_code><teneur> 90,5 </teneur></COMPO>
      <COMPO><alim_code> 1 </alim_code><const_code> 10260 </const_code><teneur> 2,1 </teneur></COMPO>
      <COMPO><alim_code> 1 </alim_code><const_code> 34100 </const_code><teneur> traces </teneur></COMPO>
    </TABLE>`;
    const rows = parseCompoChunk(xml);
    assert.deepEqual(rows.map((r) => r.column), ['kcal_100g', 'fiber_100g']);
    assert.equal(rows[0]?.teneur.value, 90.5);
    assert.equal(rows[1]?.teneur.value, null);
    assert.equal(rows[1]?.teneur.max, null, 'traces reste sans majorant');
  });

  it('couvre exactement les cinq macros du §9', () => {
    assert.deepEqual(Object.values(CIQUAL_NUTRIENTS).sort(), [
      'carb_100g', 'fat_100g', 'fiber_100g', 'kcal_100g', 'protein_100g',
    ]);
  });
});

describe('decodeCiqual', () => {
  it('lit le windows-1252 des libellés accentués', () => {
    // « Protéines » en windows-1252 : é = 0xE9.
    const bytes = Uint8Array.from([0x50, 0x72, 0x6f, 0x74, 0xe9, 0x69, 0x6e, 0x65, 0x73]);
    assert.equal(decodeCiqual(bytes), 'Protéines');
  });
});
