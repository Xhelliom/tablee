/**
 * L'épinglage de la source Ciqual.
 *
 * Ce qui est vérifié ici n'est pas « le téléchargement marche » — ça, un vrai
 * `npm run seed:food` le dit mieux — mais **ce qui se passe quand un fichier
 * n'est pas celui attendu**. C'est tout ce qui autorise le seed à sortir sur
 * le réseau : sans ce refus, `food` pourrait changer de contenu sans qu'aucun
 * diff du dépôt ne le montre.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import {
  downloadCiqual, fingerprintExports, locateExports, readCiqualSource,
} from './ciqual-source.ts';

const dossiers: string[] = [];
const dossier = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tablee-ciqual-'));
  dossiers.push(dir);
  return dir;
};

after(async () => {
  for (const dir of dossiers) await rm(dir, { recursive: true, force: true });
});

/** Un `fetch` de mensonge, qui rend les octets qu'on lui donne. */
const faux = (corps: Buffer, status = 200): typeof fetch =>
  () => Promise.resolve(new Response(corps, { status }));

describe('manifeste de la source Ciqual', () => {
  it('épingle deux fichiers, en HTTPS, avec de vraies empreintes', async () => {
    const source = await readCiqualSource();

    for (const fichier of [source.files.alim, source.files.compo]) {
      const url = new URL(fichier.url);
      assert.equal(url.protocol, 'https:');
      // Deux distributions officielles se sont succédé : le ZIP de l'ANSES
      // jusqu'à la table 2020, l'entrepôt de la recherche depuis la 2025. Rien
      // d'autre — ce n'est pas l'hôte qui garantit le contenu, mais un miroir
      // quelconque n'a rien à faire dans le manifeste.
      assert.match(url.hostname, /(^|\.)(anses\.fr|recherche\.data\.gouv\.fr)$/);
      assert.match(fichier.sha256, /^[a-f0-9]{64}$/);
      assert.ok(fichier.bytes > 0);
    }
    assert.notEqual(source.files.alim.file, source.files.compo.file);
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    assert.ok(source.etl >= 1, 'la version d’ETL commence à 1');
    // La citation part dans le journal du seed : elle doit nommer la source.
    assert.match(source.source, /ANSES/);
  });

  it('rend la même empreinte que les fichiers posés sur le disque', async () => {
    // L'empreinte combinée du manifeste et celle d'un export local doivent se
    // calculer pareil : sinon les deux chemins d'import ne se comparent plus,
    // et `referential_import` ne veut plus rien dire d'un démarrage à l'autre.
    const dir = await dossier();
    const source = await readCiqualSource();
    await writeFile(path.join(dir, source.files.alim.file), 'a');
    await writeFile(path.join(dir, source.files.compo.file), 'b');
    const fichiers = await locateExports(dir);
    assert.ok(fichiers !== null);

    const attendu = createHash('sha256')
      .update(createHash('sha256').update('a').digest())
      .update(createHash('sha256').update('b').digest())
      .digest('hex');
    assert.equal(await fingerprintExports(fichiers), attendu);
  });
});

describe('téléchargement de l’export', () => {
  it('refuse un fichier qui ne fait pas la taille épinglée, sans rien écrire', async () => {
    const dir = await dossier();
    await assert.rejects(
      downloadCiqual(dir, { fetchImpl: faux(Buffer.from('une page d’erreur en HTML')) }),
      /octets reçus/,
    );
    assert.deepEqual(await readdir(dir), [], 'rien ne doit rester sur le disque');
  });

  it('refuse un fichier de la bonne taille mais de mauvaise empreinte', async () => {
    const dir = await dossier();
    const source = await readCiqualSource();
    // Bon calibre, mauvais contenu : c'est exactement le cas qu'une
    // vérification de taille seule laisserait passer.
    const imposteur = Buffer.alloc(source.files.alim.bytes, 0x42);

    await assert.rejects(
      downloadCiqual(dir, { fetchImpl: faux(imposteur) }),
      /empreinte de alim_/,
    );
    assert.deepEqual(await readdir(dir), []);
  });

  it('rapporte un refus du serveur plutôt que de le prendre pour un export', async () => {
    const dir = await dossier();
    await assert.rejects(
      downloadCiqual(dir, { fetchImpl: faux(Buffer.alloc(0), 503) }),
      /a répondu 503/,
    );
  });

  it('avec --no-download, dit quoi poser et où, sans sortir sur le réseau', async () => {
    const dir = await dossier();
    let appelé = false;
    const espion = (() => {
      appelé = true;
      return Promise.resolve(new Response(''));
    }) as typeof fetch;

    await assert.rejects(
      downloadCiqual(dir, { download: false, fetchImpl: espion }),
      /aucun export Ciqual/,
    );
    assert.equal(appelé, false);
  });
});

describe('export posé à la main', () => {
  it('ne confond pas alim_grp_*.xml avec alim_*.xml', async () => {
    const dir = await dossier();
    await writeFile(path.join(dir, 'alim_grp_2020_07_07.xml'), '<groupes/>');
    assert.equal(await locateExports(dir), null, 'les groupes seuls ne font pas un export');

    await writeFile(path.join(dir, 'alim_2020_07_07.xml'), '<aliments/>');
    await writeFile(path.join(dir, 'compo_2020_07_07.xml'), '<compo/>');

    const trouvé = await locateExports(dir);
    assert.equal(path.basename(trouvé?.alim ?? ''), 'alim_2020_07_07.xml');
  });

  it('rend une empreinte stable, qui bouge dès qu’un fichier bouge', async () => {
    const dir = await dossier();
    await writeFile(path.join(dir, 'alim_2020_07_07.xml'), '<aliments/>');
    await writeFile(path.join(dir, 'compo_2020_07_07.xml'), '<compo/>');
    const fichiers = await locateExports(dir);
    assert.ok(fichiers !== null);

    const avant = await fingerprintExports(fichiers);
    assert.equal(await fingerprintExports(fichiers), avant, 'stable à contenu égal');

    await writeFile(fichiers.compo, '<compo>autre chose</compo>');
    assert.notEqual(await fingerprintExports(fichiers), avant);
  });
});
