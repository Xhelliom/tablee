/**
 * Lecteur ZIP minimal — exactement ce qu'il faut pour l'archive Ciqual.
 *
 * ── Pourquoi ce fichier existe ──────────────────────────────────────────────
 *
 * L'export de l'ANSES est un `.zip`, et le seed doit pouvoir tourner **dans
 * l'image de service** : un `node:22-alpine` qui ne contient ni `unzip` ni
 * `curl`. Restaient trois routes — ajouter un binaire à l'image, ajouter une
 * dépendance npm, ou lire l'archive ici. Quatre-vingts lignes couvrant deux
 * méthodes de compression coûtent moins qu'un paquet de plus dans la chaîne
 * d'approvisionnement d'une app qui manipule des données d'enfants.
 *
 * ── Ce que ce lecteur refuse de faire ───────────────────────────────────────
 *
 * Pas de ZIP64, pas de chiffrement, pas d'archive multi-volume, et aucune
 * méthode de compression autre que `stored` et `deflate`. Chacun de ces cas
 * lève une erreur nommée plutôt que de produire un fichier à moitié juste :
 * ce qui en sort alimente une table de valeurs nutritionnelles, où une donnée
 * silencieusement tronquée est pire qu'un échec bruyant (I1).
 *
 * Le CRC-32 de chaque entrée est vérifié. C'est ce qui permet de dire « le
 * fichier extrait est bien celui que l'ANSES a publié » et pas seulement
 * « l'extraction n'a pas levé ».
 */
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';

const SIGNATURE_FIN_CENTRAL = 0x06054b50;
const SIGNATURE_ENTRÉE = 0x02014b50;
const SIGNATURE_LOCALE = 0x04034b50;

/** Taille maximale du commentaire d'archive : au-delà, la fin est introuvable. */
const COMMENTAIRE_MAX = 0xffff;

const STORED = 0;
const DEFLATE = 8;

export interface ZipEntry {
  name: string;
  /** `0` (stored) ou `8` (deflate). Tout le reste est refusé à l'extraction. */
  method: number;
  compressedSize: number;
  size: number;
  crc32: number;
  /** Position de l'en-tête local, d'où se déduit le début des données. */
  localHeaderOffset: number;
}

/**
 * Liste les entrées depuis le répertoire central, qui est l'index faisant foi
 * d'une archive — les en-têtes locaux, eux, peuvent mentir sur les tailles
 * quand l'archive a été écrite en flux.
 */
export function readEntries(zip: Buffer): ZipEntry[] {
  const fin = findEndOfCentralDirectory(zip);
  const count = zip.readUInt16LE(fin + 10);
  let offset = zip.readUInt32LE(fin + 16);

  if (count === 0xffff || offset === 0xffffffff) {
    throw new Error('archive ZIP64 : non gérée');
  }

  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (zip.readUInt32LE(offset) !== SIGNATURE_ENTRÉE) {
      throw new Error(`répertoire central illisible à l’entrée ${i}`);
    }
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);

    entries.push({
      name: zip.toString('utf8', offset + 46, offset + 46 + nameLength),
      method: zip.readUInt16LE(offset + 10),
      crc32: zip.readUInt32LE(offset + 16),
      compressedSize: zip.readUInt32LE(offset + 20),
      size: zip.readUInt32LE(offset + 24),
      localHeaderOffset: zip.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Écrit une entrée sur le disque, en flux.
 *
 * En flux et pas en `Buffer` : `compo_*.xml` fait 57 Mo décompressé, et rien
 * n'oblige à le tenir en mémoire pour l'écrire — le seed le relit ensuite en
 * flux lui aussi.
 */
export async function extractEntry(
  zip: Buffer, entry: ZipEntry, destination: string,
): Promise<void> {
  if (entry.method !== STORED && entry.method !== DEFLATE) {
    throw new Error(`${entry.name} : méthode de compression ${entry.method} non gérée`);
  }
  if (zip.readUInt32LE(entry.localHeaderOffset) !== SIGNATURE_LOCALE) {
    throw new Error(`${entry.name} : en-tête local introuvable`);
  }

  // Le nom et le champ « extra » de l'en-tête **local** peuvent différer en
  // longueur de ceux du répertoire central : ce sont ceux-là qui donnent le
  // début des données, pas les autres.
  const nameLength = zip.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLength = zip.readUInt16LE(entry.localHeaderOffset + 28);
  const start = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const payload = zip.subarray(start, start + entry.compressedSize);

  let crc = 0xffffffff;
  let written = 0;
  const contrôle = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      crc = updateCrc(crc, chunk);
      written += chunk.length;
      done(null, chunk);
    },
  });

  const étapes = entry.method === DEFLATE
    ? [Readable.from([payload]), createInflateRaw(), contrôle, createWriteStream(destination)]
    : [Readable.from([payload]), contrôle, createWriteStream(destination)];
  await pipeline(étapes);

  if (written !== entry.size) {
    throw new Error(`${entry.name} : ${written} octets extraits, ${entry.size} attendus`);
  }
  if (((crc ^ 0xffffffff) >>> 0) !== entry.crc32) {
    throw new Error(`${entry.name} : CRC-32 invalide, l’archive est corrompue`);
  }
}

/**
 * Le marqueur de fin se cherche **à reculons** : il est en queue d'archive,
 * suivi d'un commentaire de longueur variable. Chercher depuis le début
 * tomberait sur la même suite d'octets à l'intérieur d'un fichier compressé.
 */
function findEndOfCentralDirectory(zip: Buffer): number {
  const plancher = Math.max(0, zip.length - COMMENTAIRE_MAX - 22);
  for (let i = zip.length - 22; i >= plancher; i -= 1) {
    if (zip.readUInt32LE(i) === SIGNATURE_FIN_CENTRAL) return i;
  }
  throw new Error('ce fichier n’est pas une archive ZIP');
}

/** Table CRC-32 (polynôme 0xEDB88320), construite une fois. */
const TABLE_CRC = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let valeur = i;
    for (let bit = 0; bit < 8; bit += 1) {
      valeur = (valeur & 1) === 1 ? (valeur >>> 1) ^ 0xedb88320 : valeur >>> 1;
    }
    table[i] = valeur >>> 0;
  }
  return table;
})();

function updateCrc(crc: number, chunk: Buffer): number {
  let courant = crc;
  for (const octet of chunk) {
    courant = (TABLE_CRC[(courant ^ octet) & 0xff] as number) ^ (courant >>> 8);
  }
  return courant >>> 0;
}
