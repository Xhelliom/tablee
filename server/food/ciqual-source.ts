/**
 * D'où vient l'export Ciqual, et comment on s'assure que c'est bien lui.
 *
 * ── La décision, et ce qui la tient ─────────────────────────────────────────
 *
 * CLAUDE.md dit « rien n'est téléchargé au démarrage : un fichier versionné se
 * relit en diff, un fetch au boot ne se relit pas ». L'objection est juste, et
 * c'est elle qui donne sa forme à ce module : ce qui est versionné, ici, c'est
 * l'**empreinte** (`db/seeds/ciqual-source.json`). Un fichier qui ne
 * correspond pas à la SHA-256 épinglée n'est pas importé du tout. Changer la
 * source reste donc un commit qui se relit, exactement comme une ligne de CSV
 * — et `food` ne peut pas changer de contenu sans que le dépôt le dise.
 *
 * Ce que ça achète : un déploiement neuf a son référentiel sans qu'un humain
 * télécharge des fichiers à la main dans un conteneur. Ce que ça coûte : le
 * cluster doit pouvoir joindre l'entrepôt une fois. Quand il ne le peut pas,
 * le seed le dit et l'app sert quand même — un référentiel absent affiche
 * « indisponible », il n'invente pas (I1).
 *
 * Les URL sont en HTTPS et suivies avec leurs redirections : ce n'est pas
 * elles qui garantissent quoi que ce soit, c'est l'empreinte. Un miroir
 * hostile qui rendrait d'autres octets échouerait à la vérification, et rien
 * ne serait écrit.
 *
 * ── ⚠️ Plus d'archive, depuis Ciqual 2025 (17/09/2026) ──────────────────────
 *
 * Jusqu'à la table 2020, l'ANSES publiait un ZIP de 3,5 Mo sur
 * `ciqual.anses.fr`, dont on extrayait deux entrées sur cinq. La table 2025
 * est publiée sur l'entrepôt de la recherche, **fichier par fichier**, sous
 * DOI et licence Etalab 2.0 — il n'y a plus de ZIP à ouvrir, donc plus de
 * lecteur ZIP (`zip.ts` est parti avec). Le manifeste porte désormais une
 * entrée par fichier, avec son empreinte : deux vérifications au lieu d'une,
 * et un fichier de trop ne peut plus se glisser dans l'archive sans se voir.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const MANIFESTE = fileURLToPath(new URL('../../db/seeds/ciqual-source.json', import.meta.url));

/** Un fichier de l'export, épinglé. */
export interface CiqualFile {
  /** Nom sous lequel il est écrit sur le disque — celui que l'ANSES lui donne. */
  file: string;
  url: string;
  sha256: string;
  bytes: number;
}

export interface CiqualSource {
  /** Date de publication de la table, telle que l'ANSES la nomme. */
  version: string;
  files: Record<keyof ExportFiles, CiqualFile>;
  /**
   * Empreinte de l'export entier, celle qui va dans `referential_import`.
   *
   * Elle n'est pas dans le manifeste : elle se **calcule** à partir des
   * empreintes des fichiers, exactement comme `fingerprintExports` le fait à
   * partir des fichiers eux-mêmes. Les deux chemins — téléchargé, posé à la
   * main — produisent donc la même valeur pour le même export, et un humain
   * n'a qu'une seule sorte d'empreinte à relire dans le diff.
   */
  sha256: string;
  /** Version de **notre** lecture de l'export. Voir le manifeste. */
  etl: number;
  source: string;
}

/**
 * Les deux fichiers dont le seed a besoin. Les trois autres publiés par
 * l'ANSES — groupes, constituants, sources — pèsent 41 Mo et ne sont lus par
 * personne : les télécharger remplirait un disque pour rien.
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
  const texte = (clé: string, dans: Record<string, unknown> = champs): string => {
    const valeur = dans[clé];
    if (typeof valeur !== 'string' || valeur.length === 0) {
      throw new Error(`${MANIFESTE} : champ « ${clé} » manquant`);
    }
    return valeur;
  };
  const nombre = (clé: string, dans: Record<string, unknown> = champs): number => {
    const valeur = dans[clé];
    if (typeof valeur !== 'number' || !Number.isFinite(valeur)) {
      throw new Error(`${MANIFESTE} : champ « ${clé} » manquant`);
    }
    return valeur;
  };

  const bruts = champs['files'];
  if (typeof bruts !== 'object' || bruts === null) {
    throw new Error(`${MANIFESTE} : champ « files » manquant`);
  }
  const files = {} as Record<keyof ExportFiles, CiqualFile>;
  for (const clé of Object.keys(VOULUS) as (keyof ExportFiles)[]) {
    const entrée = (bruts as Record<string, unknown>)[clé];
    if (typeof entrée !== 'object' || entrée === null) {
      throw new Error(`${MANIFESTE} : fichier « ${clé} » manquant`);
    }
    const dans = entrée as Record<string, unknown>;
    const sha256 = texte('sha256', dans);
    if (!/^[a-f0-9]{64}$/.test(sha256)) {
      throw new Error(`${MANIFESTE} : « ${clé}.sha256 » n’est pas une empreinte SHA-256`);
    }
    // Le nom sert à retrouver le fichier au démarrage suivant (`locateExports`)
    // autant qu'à le reconnaître dans un `ls` : il doit suivre la convention de
    // l'ANSES, pas être choisi par nous.
    const file = texte('file', dans);
    if (!VOULUS[clé].test(file)) {
      throw new Error(`${MANIFESTE} : « ${clé}.file » ne ressemble pas à un ${clé}_*.xml`);
    }
    files[clé] = { file, url: texte('url', dans), sha256, bytes: nombre('bytes', dans) };
  }

  return {
    version: texte('version'),
    files,
    sha256: combine(Object.values(files).map((f) => Buffer.from(f.sha256, 'hex'))),
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
 * Un export trouvé sur le disque l'emporte-t-il sur le téléchargement ?
 *
 * Oui dans deux cas seulement : il **est** l'export épinglé — même empreinte
 * combinée, donc mêmes fichiers —, ou un `--dir` explicite le désigne, ce qui
 * est tout l'objet de cette option : apporter un export sur un cluster sans
 * sortie réseau, où l'on ne peut rien promettre de sa provenance.
 *
 * ⚠️ Non, en revanche, pour un export **dépareillé** resté dans `data/ciqual/`,
 * là où le seed écrit lui-même. C'est la table d'un déploiement précédent, et
 * elle écrasait la table épinglée sans que rien ne s'y oppose : un poste de
 * développement a réimporté la table 2020, avec ses 887 trous d'énergie,
 * par-dessus la 2025. Le journal le disait — après coup, et à qui le lisait.
 */
export function retenirLocal(
  empreinte: string | null, épinglée: string, dirExplicite: boolean,
): boolean {
  if (empreinte === null) return false;
  return empreinte === épinglée || dirExplicite;
}

/**
 * Empreinte d'un export **posé à la main**, pour que ce cas-là aussi soit
 * idempotent.
 *
 * `--dir` sert à pointer des fichiers apportés autrement : un cluster sans
 * sortie réseau, un poste de développement. On ne peut alors rien promettre de
 * leur provenance — mais on peut promettre qu'ils n'ont pas changé depuis le
 * dernier import, ce qui suffit à ne pas relire 70 Mo à chaque démarrage.
 */
export async function fingerprintExports(files: ExportFiles): Promise<string> {
  const digests: Buffer[] = [];
  for (const fichier of [files.alim, files.compo]) {
    const hash = createHash('sha256');
    await pipeline(createReadStream(fichier), hash);
    digests.push(hash.digest());
  }
  return combine(digests);
}

/** L'empreinte d'un export = l'empreinte de la suite des empreintes de ses
 *  fichiers, dans l'ordre `alim` puis `compo`. */
function combine(digests: Buffer[]): string {
  const empreinte = createHash('sha256');
  for (const digest of digests) empreinte.update(digest);
  return empreinte.digest('hex');
}

export interface DownloadOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** `false` : ne télécharge rien, explique quoi poser et où. */
  download?: boolean;
}

/**
 * Télécharge les deux fichiers épinglés et les vérifie.
 *
 * Rien n'est écrit sur le disque avant la vérification : un fichier qui ne
 * correspond pas à son empreinte ne laisse aucune trace, pas même un fichier à
 * moitié écrit qu'un prochain lancement prendrait pour un export valide. C'est
 * aussi pourquoi `compo` est vérifié en mémoire malgré ses 66 Mio — le seul
 * autre moyen serait d'écrire d'abord et d'effacer après, ce qui laisse une
 * fenêtre pendant laquelle un export non vérifié existe.
 */
export async function downloadCiqual(
  dir: string, options: DownloadOptions = {},
): Promise<ExportFiles> {
  const source = await readCiqualSource();
  if (options.download === false) {
    throw new Error(
      `aucun export Ciqual dans ${dir}\n` +
        `  Télécharger ${Object.values(source.files).map((f) => f.url).join(' et ')}\n` +
        `  et les y poser sous leurs noms (${Object.values(source.files)
          .map((f) => f.file).join(', ')}),\n` +
        '  ou relancer sans --no-download pour que le seed s’en charge.',
    );
  }

  // Tout est vérifié avant que quoi que ce soit ne soit écrit : un `compo`
  // refusé ne doit pas laisser derrière lui un `alim` orphelin, que le
  // lancement suivant compterait comme la moitié d'un export posé à la main.
  const doFetch = options.fetchImpl ?? fetch;
  const vérifiés: [keyof ExportFiles, CiqualFile, Buffer][] = [];
  for (const [clé, fichier] of Object.entries(source.files) as [keyof ExportFiles, CiqualFile][]) {
    const réponse = await doFetch(fichier.url, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
      headers: { accept: 'application/xml' },
    });
    if (!réponse.ok) {
      throw new Error(`l’entrepôt a répondu ${réponse.status} sur ${fichier.url}`);
    }

    const octets = Buffer.from(await réponse.arrayBuffer());
    verify(octets, fichier);
    vérifiés.push([clé, fichier, octets]);
  }

  await mkdir(dir, { recursive: true });
  const écrits: Partial<ExportFiles> = {};
  for (const [clé, fichier, octets] of vérifiés) {
    const cible = path.join(dir, fichier.file);
    await writeFile(cible, octets);
    écrits[clé] = cible;
  }

  const { alim, compo } = écrits;
  if (alim === undefined || compo === undefined) {
    throw new Error('téléchargement incomplet de l’export Ciqual');
  }
  return { alim, compo };
}

/**
 * Le fichier est-il bien celui qui est épinglé ? Deux vérifications et non
 * une : la taille échoue tôt et lisiblement sur une page d'erreur HTML servie
 * en 200, l'empreinte tranche le reste.
 */
function verify(octets: Buffer, fichier: CiqualFile): void {
  if (octets.length !== fichier.bytes) {
    throw new Error(
      `${fichier.file} inattendu : ${octets.length} octets reçus, ${fichier.bytes} épinglés.\n` +
        '  Rien n’a été importé. Si l’ANSES a publié une nouvelle table, mettre à\n' +
        '  jour db/seeds/ciqual-source.json dans un commit.',
    );
  }
  const empreinte = createHash('sha256').update(octets).digest('hex');
  if (empreinte !== fichier.sha256) {
    throw new Error(
      `empreinte de ${fichier.file} : ${empreinte}\n` +
        `  épinglée dans db/seeds/ciqual-source.json : ${fichier.sha256}\n` +
        '  Rien n’a été importé : des valeurs nutritionnelles non vérifiées ne\n' +
        '  rentrent pas en base.',
    );
  }
}
