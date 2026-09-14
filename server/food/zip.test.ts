/**
 * Le lecteur ZIP, contre une archive écrite par une **autre** implémentation.
 *
 * L'échantillon est produit par le module `zipfile` de Python (voir l'en-tête
 * du fichier `fixtures/echantillon.zip` dans l'historique git) : se tester
 * contre une archive qu'on aurait écrite soi-même ne vérifierait que la
 * cohérence de nos propres suppositions.
 *
 * Ce qui compte ici n'est pas « l'extraction n'a pas levé » mais « ce qui sort
 * est exactement ce qui est entré ». D'où la vérification du CRC-32, et le cas
 * de l'archive corrompue.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
import { extractEntry, readEntries } from './zip.ts';

const ARCHIVE = readFileSync(
  fileURLToPath(new URL('./fixtures/echantillon.zip', import.meta.url)),
);

const dossiers: string[] = [];
const dossier = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tablee-zip-'));
  dossiers.push(dir);
  return dir;
};

after(async () => {
  for (const dir of dossiers) await rm(dir, { recursive: true, force: true });
});

describe('lecteur ZIP', () => {
  it('liste les entrées du répertoire central', () => {
    const entries = readEntries(ARCHIVE);
    assert.deepEqual(entries.map((e) => e.name).sort(), ['alim_2020_07_07.xml', 'lisezmoi.txt']);
  });

  it('extrait une entrée compressée, à l’octet près', async () => {
    const entry = readEntries(ARCHIVE).find((e) => e.name.startsWith('alim_'));
    assert.ok(entry !== undefined);
    assert.equal(entry.method, 8, 'échantillon attendu en deflate');

    const cible = path.join(await dossier(), 'alim.xml');
    await extractEntry(ARCHIVE, entry, cible);

    const contenu = await readFile(cible, 'utf8');
    assert.equal(contenu.length, entry.size);
    assert.match(contenu, /^<ALIM_FOLDER>/);
    assert.match(contenu, /<\/ALIM_FOLDER>$/);
  });

  it('extrait aussi une entrée non compressée', async () => {
    const entry = readEntries(ARCHIVE).find((e) => e.name === 'lisezmoi.txt');
    assert.ok(entry !== undefined);
    assert.equal(entry.method, 0, 'échantillon attendu en stored');

    const cible = path.join(await dossier(), 'lisezmoi.txt');
    await extractEntry(ARCHIVE, entry, cible);
    assert.equal(await readFile(cible, 'utf8'), 'échantillon de test');
  });
});

describe('lecteur ZIP — ce qu’il refuse', () => {
  it('refuse un fichier qui n’est pas une archive', () => {
    assert.throws(() => readEntries(Buffer.from('ceci n’est pas un zip')), /n’est pas une archive/);
  });

  it('refuse une entrée dont le contenu a été altéré', async () => {
    const corrompue = Buffer.from(ARCHIVE);
    const entry = readEntries(corrompue).find((e) => e.name === 'lisezmoi.txt');
    assert.ok(entry !== undefined);

    // L'entrée `stored` se modifie sans toucher au reste : on change une
    // lettre du contenu, les tailles restent bonnes, seul le CRC ne suit plus.
    const nameLength = corrompue.readUInt16LE(entry.localHeaderOffset + 26);
    const extraLength = corrompue.readUInt16LE(entry.localHeaderOffset + 28);
    const début = entry.localHeaderOffset + 30 + nameLength + extraLength;
    corrompue[début] = corrompue[début] === 0x58 ? 0x59 : 0x58;

    const cible = path.join(await dossier(), 'lisezmoi.txt');
    await assert.rejects(extractEntry(corrompue, entry, cible), /CRC-32 invalide/);
  });

  it('refuse une méthode de compression exotique', async () => {
    const entries = readEntries(ARCHIVE);
    const entry = { ...entries[0] as (typeof entries)[number], method: 14 };
    const cible = path.join(await dossier(), 'rien');
    await assert.rejects(extractEntry(ARCHIVE, entry, cible), /non gérée/);
  });
});
