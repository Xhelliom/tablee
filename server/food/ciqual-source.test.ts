/**
 * L'épinglage de la source Ciqual.
 *
 * Ce qui est vérifié ici n'est pas « le téléchargement marche » — ça, un vrai
 * `npm run seed:food` le dit mieux — mais **ce qui se passe quand l'archive
 * n'est pas celle attendue**. C'est tout ce qui autorise le seed à sortir sur
 * le réseau : sans ce refus, `food` pourrait changer de contenu sans qu'aucun
 * diff du dépôt ne le montre.
 */
import assert from 'node:assert/strict';
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
  it('épingle une URL HTTPS chez l’ANSES et une vraie empreinte', async () => {
    const source = await readCiqualSource();
    const url = new URL(source.url);

    assert.equal(url.protocol, 'https:');
    assert.match(url.hostname, /(^|\.)anses\.fr$/);
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    assert.ok(source.bytes > 0);
    assert.ok(source.etl >= 1, 'la version d’ETL commence à 1');
    // La citation part dans le journal du seed : elle doit nommer la source.
    assert.match(source.source, /ANSES/);
  });
});

describe('téléchargement de l’archive', () => {
  it('refuse une archive qui ne fait pas la taille épinglée, sans rien écrire', async () => {
    const dir = await dossier();
    await assert.rejects(
      downloadCiqual(dir, { fetchImpl: faux(Buffer.from('une page d’erreur en HTML')) }),
      /octets reçus/,
    );
    assert.deepEqual(await readdir(dir), [], 'rien ne doit rester sur le disque');
  });

  it('refuse une archive de la bonne taille mais de mauvaise empreinte', async () => {
    const dir = await dossier();
    const source = await readCiqualSource();
    // Bon calibre, mauvais contenu : c'est exactement le cas qu'une
    // vérification de taille seule laisserait passer.
    const imposteur = Buffer.alloc(source.bytes, 0x42);

    await assert.rejects(
      downloadCiqual(dir, { fetchImpl: faux(imposteur) }),
      /empreinte de l’archive Ciqual/,
    );
    assert.deepEqual(await readdir(dir), []);
  });

  it('rapporte un refus du serveur plutôt que de le prendre pour une archive', async () => {
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
