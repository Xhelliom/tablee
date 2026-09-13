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
  value: number | null;
  kind: TeneurKind;
}

/**
 * Interprète une teneur Ciqual.
 *
 * Quatre formes existent dans l'export :
 *
 *   `12,5`    une valeur — virgule décimale
 *   `-`       non déterminée : Ciqual n'a pas la donnée
 *   `traces`  présent en quantité non quantifiable
 *   `< 2,2`   inférieur au seuil de quantification
 *
 * **Les trois dernières valent `null`, jamais `0`** (I1, et §5 point 3 de la
 * spec). `traces` n'est pas zéro, et `< 2,2` n'est pas 2,2 : c'est une borne,
 * pas une mesure. Reporter la borne comme une valeur produirait exactement le
 * genre de chiffre plausible et faux que l'app doit refuser d'afficher.
 */
export function parseTeneur(raw: string | null | undefined): Teneur {
  const text = (raw ?? '').trim();
  if (text.length === 0 || text === '-') return { value: null, kind: 'absente' };
  if (/^traces$/i.test(text)) return { value: null, kind: 'traces' };
  if (text.startsWith('<')) return { value: null, kind: 'seuil' };

  const value = Number(text.replace(/\s| /g, '').replace(',', '.'));
  if (!Number.isFinite(value)) return { value: null, kind: 'illisible' };
  return { value, kind: 'valeur' };
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
