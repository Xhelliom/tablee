/**
 * Lecture de l'export XML de la table Ciqual (ANSES).
 *
 * L'export est composé de quatre fichiers plats, encodés en windows-1252 :
 *
 *   alim_<date>.xml      un aliment par ligne (code, nom, groupe, sous-groupe)
 *   const_<date>.xml     le catalogue des constituants (code → libellé)
 *   compo_<date>.xml     la composition : (aliment, constituant) → teneur
 *   sources_<date>.xml   la traçabilité des mesures, non utilisée ici
 *
 * Le module ne fait que **lire** : il ne complète rien, ne convertit rien et
 * n'invente rien. Une teneur que Ciqual ne publie pas ressort à `null`.
 *
 * `source` de la spec (R1) : chaque ligne insérée porte `source='ciqual'` et
 * `external_id` = code aliment Ciqual, ce qui permet de remonter à la mesure
 * d'origine sur le site de l'ANSES.
 */

/**
 * Constituants retenus pour la V1 — les cinq macros du §9 de la spec.
 *
 * Les codes sont ceux du catalogue Ciqual (`const_2020_07_07.xml`) :
 *
 *   328    Energie, Règlement UE N° 1169/2011 (kcal/100 g)
 *   25000  Protéines, N x facteur de Jones (g/100 g)
 *   31000  Glucides (g/100 g)
 *   40000  Lipides (g/100 g)
 *   34100  Fibres alimentaires (g/100 g)
 *
 * L'énergie est prise sous sa forme réglementaire (celle des étiquettes), pas
 * sous la forme « N x facteur Jones » (333) : deux définitions différentes, on
 * en choisit une et on s'y tient plutôt que de les mélanger au gré des trous.
 *
 * Les protéines sont lues sur 25000 uniquement, sans repli sur 25003
 * (N x 6.25) : ce sont deux conventions de calcul distinctes, et un repli
 * silencieux mêlerait deux définitions dans la même colonne.
 *
 * Les micronutriments sont hors V1 (§17 de la spec). `micros` reste vide.
 */
export const CIQUAL_NUTRIENTS = {
  '328': 'kcal_100g',
  '25000': 'protein_100g',
  '31000': 'carb_100g',
  '40000': 'fat_100g',
  '34100': 'fiber_100g',
} as const;

export type NutrientColumn = (typeof CIQUAL_NUTRIENTS)[keyof typeof CIQUAL_NUTRIENTS];

/** Pourquoi une teneur ne donne pas de nombre. Tous ces cas valent `null`. */
export type TeneurKind = 'valeur' | 'absente' | 'traces' | 'seuil' | 'illisible';

export interface Teneur {
  /** Borne basse : ce qui est garanti atteint. `null` si rien n'est connu. */
  value: number | null;
  /** Borne haute. `null` si la source ne borne pas. */
  max: number | null;
  kind: TeneurKind;
}

/**
 * Interprète une teneur Ciqual, sous forme d'**encadrement**.
 *
 * Quatre formes existent dans l'export, et la documentation officielle de la
 * table (« Table Ciqual 2020_doc_Excel_FR », §1.2.1) dit ce que chacune veut
 * dire. C'est elle qui fixe les règles ci-dessous, pas nous :
 *
 * | Forme    | Ce qu'en dit l'ANSES                                   | Encadrement     |
 * |----------|--------------------------------------------------------|-----------------|
 * | `12,5`   | une mesure                                             | `[12,5 ; 12,5]` |
 * | `-`      | « teneur pas connue [...] ne pas les assimiler à des zéro » | `[null ; null]` |
 * | `traces` | « détecté [...] sans pouvoir être précisément quantifié [...] ne peut être considérée nulle » | `[null ; null]` |
 * | `< 2,2`  | « une valeur maximale »                                | `[0 ; 2,2]`     |
 *
 * Le cas `< X` est le seul qui apporte de l'information : la source publie un
 * **majorant**. Les lipides d'une banane sont entre 0 et 0,5 g — le dire vaut
 * mieux que se taire, et vaut infiniment mieux qu'écrire 0,5 comme si c'était
 * une mesure (I1).
 *
 * `traces` reste sans borne haute : l'ANSES écrit « très faible » sans jamais
 * donner de seuil. Lui en inventer un serait exactement la valeur plausible et
 * fausse qu'on refuse — même si la tentation est grande, « traces » n'étant
 * sûrement pas 10 g.
 */
export function parseTeneur(raw: string | null | undefined): Teneur {
  const text = (raw ?? '').trim();
  if (text.length === 0 || text === '-') return { value: null, max: null, kind: 'absente' };
  if (/^traces$/i.test(text)) return { value: null, max: null, kind: 'traces' };

  if (text.startsWith('<')) {
    const bound = toNumber(text.slice(1));
    // Un « < » sans nombre lisible derrière n'apprend rien.
    return bound === null
      ? { value: null, max: null, kind: 'illisible' }
      : { value: 0, max: bound, kind: 'seuil' };
  }

  const value = toNumber(text);
  if (value === null) return { value: null, max: null, kind: 'illisible' };
  return { value, max: value, kind: 'valeur' };
}

/**
 * Virgule décimale et espaces fines de l'export.
 *
 * La chaîne vide est rejetée explicitement : `Number('')` vaut 0, et un « < »
 * suivi de rien deviendrait sinon un majorant à zéro — c'est-à-dire la
 * certitude que l'aliment n'en contient pas, tirée d'une case illisible.
 */
function toNumber(text: string): number | null {
  const cleaned = text.replace(/[\s\u202f\u00a0]/g, '').replace(',', '.');
  if (cleaned.length === 0) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Décode un buffer Ciqual. Les fichiers se déclarent en windows-1252 et le
 * sont réellement — vérifié sur les libellés accentués (« Protéines »,
 * « Cendres »). Décoder en UTF-8 donnerait des libellés abîmés qui finiraient
 * affichés tels quels dans l'app.
 */
export function decodeCiqual(buffer: Uint8Array): string {
  return new TextDecoder('windows-1252').decode(buffer);
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
};

function unescapeXml(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|apos);/g, (e) => ENTITIES[e] ?? e);
}

export type XmlRecord = Record<string, string | null>;

/**
 * Parcourt les enregistrements `<TAG>…</TAG>` d'un fragment XML Ciqual.
 *
 * L'export est généré par machine : une seule balise par ligne, pas
 * d'attributs hormis `missing=" "`, pas de CDATA, pas d'imbrication. Un
 * scanner suffit, et évite d'ajouter une dépendance pour lire quatre fichiers
 * de structure figée. Un champ `<x missing=" " />` ressort à `null`, comme un
 * champ absent : dans les deux cas Ciqual ne publie rien.
 *
 * Tolérant par principe, comme le parseur Jow : un enregistrement mal formé
 * est ignoré, il ne fait pas échouer le seed des 3 000 autres.
 */
export function* parseRecords(xml: string, tag: string): Generator<XmlRecord> {
  const block = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'g');
  const field = /<([A-Za-z_][\w]*)(?:\s+missing="[^"]*"\s*\/>|>([\s\S]*?)<\/\1>)/g;

  for (const match of xml.matchAll(block)) {
    const body = match[1];
    if (body === undefined) continue;
    const record: XmlRecord = {};
    for (const f of body.matchAll(field)) {
      const name = f[1];
      if (name === undefined) continue;
      const value = f[2];
      record[name.toLowerCase()] =
        value === undefined ? null : unescapeXml(value).trim() || null;
    }
    yield record;
  }
}

export interface CiqualFood {
  /** Code aliment Ciqual → `food.external_id`. */
  code: string;
  name: string;
  groupCode: string;
  subgroupCode: string;
}

/** Lit `alim_<date>.xml`. Un aliment sans code ou sans nom est ignoré. */
export function parseFoods(xml: string): CiqualFood[] {
  const out: CiqualFood[] = [];
  for (const record of parseRecords(xml, 'ALIM')) {
    const code = record['alim_code'];
    const name = record['alim_nom_fr'];
    if (code === null || code === undefined || name === null || name === undefined) continue;
    out.push({
      code,
      name,
      groupCode: record['alim_grp_code'] ?? '',
      subgroupCode: record['alim_ssgrp_code'] ?? '',
    });
  }
  return out;
}

export interface CompoRow {
  foodCode: string;
  column: NutrientColumn;
  teneur: Teneur;
}

/**
 * Lit un fragment de `compo_<date>.xml` et ne retient que les constituants de
 * `CIQUAL_NUTRIENTS`. Le fichier complet pèse ~57 Mo pour ~250 000 lignes,
 * d'où la lecture par fragments : le seed le passe en flux plutôt que de le
 * charger entier.
 */
export function parseCompoChunk(xml: string): CompoRow[] {
  const out: CompoRow[] = [];
  for (const record of parseRecords(xml, 'COMPO')) {
    const foodCode = record['alim_code'];
    const constCode = record['const_code'];
    if (foodCode === null || foodCode === undefined) continue;
    if (constCode === null || constCode === undefined) continue;
    const column = CIQUAL_NUTRIENTS[constCode as keyof typeof CIQUAL_NUTRIENTS];
    if (column === undefined) continue;
    out.push({ foodCode, column, teneur: parseTeneur(record['teneur']) });
  }
  return out;
}
