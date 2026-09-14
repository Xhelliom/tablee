/**
 * D'où vient l'export Ciqual, et comment on s'assure que c'est bien lui.
 *
 * ── La décision, et ce qui la tient ─────────────────────────────────────────
 *
 * CLAUDE.md dit « rien n'est téléchargé au démarrage : un fichier versionné se
 * relit en diff, un fetch au boot ne se relit pas ». L'objection est juste, et
 * c'est elle qui donne sa forme à ce module : ce qui est versionné, ici, c'est
 * l'**empreinte** (`db/seeds/ciqual-source.json`). Une archive qui ne
 * correspond pas à la SHA-256 épinglée n'est pas importée du tout. Changer la
 * source reste donc un commit qui se relit, exactement comme une ligne de CSV
 * — et `food` ne peut pas changer de contenu sans que le dépôt le dise.
 *
 * Ce que ça achète : un déploiement neuf a son référentiel sans qu'un humain
 * télécharge un zip à la main dans un conteneur. Ce que ça coûte : le cluster
 * doit pouvoir joindre `ciqual.anses.fr` une fois. Quand il ne le peut pas, le
 * seed le dit et l'app sert quand même — un référentiel absent affiche
 * « indisponible », il n'invente pas (I1).
 *
 * L'URL est en HTTPS et suivie avec ses redirections : ce n'est pas elle qui
 * garantit quoi que ce soit, c'est l'empreinte. Un miroir hostile qui rendrait
 * d'autres octets échouerait à la vérification, et rien ne serait écrit.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { extractEntry, readEntries } from './zip.ts';

const MANIFESTE = fileURLToPath(new URL('../../db/seeds/ciqual-source.json', import.meta.url));

export interface CiqualSource {
  /** Date de publication de la table, telle que l'ANSES la nomme. */
  version: string;
  url: string;
  sha256: string;
  bytes: number;
  /** Version de **notre** lecture de l'archive. Voir le manifeste. */
  etl: number;
  source: string;
}

/**
 * Les deux fichiers dont le seed a besoin. Les trois autres entrées de
 * l'archive — groupes, constituants, sources — pèsent 42 Mo et ne sont lues
 * par personne : les extraire remplirait un disque pour rien.
 */
const VOULUS = {
  alim: /^alim_\d[\w ]*\.xml$/,
  compo: /^compo_\d[\w ]*\.xml$/,
} as const;

export interface ExportFiles {
  alim: string;
  compo: string;
}

/** Lit l'empreinte épinglée. Lève si le manifeste est incomplet : sans lui, il
 *  n'y a rien à vérifier, donc rien à importer. */
export async function readCiqualSource(): Promise<CiqualSource> {
  const brut: unknown = JSON.parse(await readFile(MANIFESTE, 'utf8'));
  if (typeof brut !== 'object' || brut === null) {
    throw new Error(`${MANIFESTE} : manifeste illisible`);
  }
  const champs = brut as Record<string, unknown>;
  const texte = (clé: string): string => {
    const valeur = champs[clé];
    if (typeof valeur !== 'string' || valeur.length === 0) {
      throw new Error(`${MANIFESTE} : champ « ${clé} » manquant`);
    }
    return valeur;
  };
  const nombre = (clé: string): number => {
    const valeur = champs[clé];
    if (typeof valeur !== 'number' || !Number.isFinite(valeur)) {
      throw new Error(`${MANIFESTE} : champ « ${clé} » manquant`);
    }
    return valeur;
  };

  const sha256 = texte('sha256');
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error(`${MANIFESTE} : « sha256 » n’est pas une empreinte SHA-256`);
  }
  return {
    version: texte('version'),
    url: texte('url'),
    sha256,
    bytes: nombre('bytes'),
    etl: nombre('etl'),
    source: texte('source'),
  };
}

/** Cherche `alim_*.xml` et `compo_*.xml` déjà présents. `null` s'il en manque
 *  un : deux fichiers dépareillés ne s'importent pas. */
export async function locateExports(dir: string): Promise<ExportFiles | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  // `alim_` seul attraperait aussi `alim_grp_`, qui décrit les groupes et non
  // les aliments : d'où le chiffre exigé juste après le tiret bas.
  const dernier = (motif: RegExp): string | undefined =>
    entries.filter((f) => motif.test(f)).sort().at(-1);

  const alim = dernier(VOULUS.alim);
  const compo = dernier(VOULUS.compo);
  if (alim === undefined || compo === undefined) return null;
  return { alim: path.join(dir, alim), compo: path.join(dir, compo) };
}

/**
 * Empreinte d'un export **posé à la main**, pour que ce cas-là aussi soit
 * idempotent.
 *
 * `--dir` sert à pointer des fichiers apportés autrement : un cluster sans
 * sortie réseau, un poste de développement. On ne peut alors rien promettre de
 * leur provenance — mais on peut promettre qu'ils n'ont pas changé depuis le
 * dernier import, ce qui suffit à ne pas relire 57 Mo à chaque démarrage.
 */
export async function fingerprintExports(files: ExportFiles): Promise<string> {
  const empreinte = createHash('sha256');
  for (const fichier of [files.alim, files.compo]) {
    const hash = createHash('sha256');
    await pipeline(createReadStream(fichier), hash);
    empreinte.update(hash.digest());
  }
  return empreinte.digest('hex');
}

export interface DownloadOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** `false` : ne télécharge rien, explique quoi poser et où. */
  download?: boolean;
}

/**
 * Télécharge l'archive épinglée, la vérifie, et en extrait les deux XML utiles.
 *
 * Rien n'est écrit sur le disque avant la vérification : une archive qui ne
 * correspond pas à l'empreinte ne laisse aucune trace, pas même un fichier à
 * moitié écrit qu'un prochain lancement prendrait pour un export valide.
 */
export async function downloadCiqual(
  dir: string, options: DownloadOptions = {},
): Promise<ExportFiles> {
  const source = await readCiqualSource();
  if (options.download === false) {
    throw new Error(
      `aucun export Ciqual dans ${dir}\n` +
        `  Télécharger ${source.url} et l’y décompresser,\n` +
        '  ou relancer sans --no-download pour que le seed s’en charge.',
    );
  }

  const doFetch = options.fetchImpl ?? fetch;
  const réponse = await doFetch(source.url, {
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
    headers: { accept: 'application/zip' },
  });
  if (!réponse.ok) {
    throw new Error(`l’ANSES a répondu ${réponse.status} sur ${source.url}`);
  }

  const archive = Buffer.from(await réponse.arrayBuffer());
  verify(archive, source);

  await mkdir(dir, { recursive: true });
  const entries = readEntries(archive);
  const extraits: Partial<ExportFiles> = {};
  for (const [clé, motif] of Object.entries(VOULUS) as [keyof ExportFiles, RegExp][]) {
    const entry = entries.filter((e) => motif.test(path.basename(e.name))).sort().at(-1);
    if (entry === undefined) {
      throw new Error(`l’archive ne contient pas de ${clé}_*.xml`);
    }
    const cible = path.join(dir, path.basename(entry.name));
    await extractEntry(archive, entry, cible);
    extraits[clé] = cible;
  }

  const { alim, compo } = extraits;
  if (alim === undefined || compo === undefined) {
    throw new Error('extraction incomplète de l’archive Ciqual');
  }
  return { alim, compo };
}

/**
 * L'archive est-elle bien celle qui est épinglée ? Deux vérifications et non
 * une : la taille échoue tôt et lisiblement sur une page d'erreur HTML servie
 * en 200, l'empreinte tranche le reste.
 */
function verify(archive: Buffer, source: CiqualSource): void {
  if (archive.length !== source.bytes) {
    throw new Error(
      `archive Ciqual inattendue : ${archive.length} octets reçus, ${source.bytes} épinglés.\n` +
        '  Rien n’a été importé. Si l’ANSES a publié une nouvelle table, mettre à\n' +
        '  jour db/seeds/ciqual-source.json dans un commit.',
    );
  }
  const empreinte = createHash('sha256').update(archive).digest('hex');
  if (empreinte !== source.sha256) {
    throw new Error(
      `empreinte de l’archive Ciqual : ${empreinte}\n` +
        `  épinglée dans db/seeds/ciqual-source.json : ${source.sha256}\n` +
        '  Rien n’a été importé : des valeurs nutritionnelles non vérifiées ne\n' +
        '  rentrent pas en base.',
    );
  }
}
