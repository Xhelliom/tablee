/**
 * Mise en mots d'un encadrement.
 *
 * Trois façons de dire une quantité, et il faut les trois — elles ne
 * décrivent pas le même état de connaissance :
 *
 *   `12,5 g`             on sait
 *   `entre 0 et 0,5 g`   la source ne publie qu'un majorant (Ciqual : « < 0,5 »)
 *   `au moins 31 g`      un aliment échappe au référentiel, le total peut monter
 *
 * Ne jamais afficher le milieu d'un intervalle comme s'il était mesuré : c'est
 * exactement le chiffre plausible et faux que l'app refuse (I1).
 */

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

export function formatRange(
  min: number | null,
  max: number | null,
  unit = 'g',
): string {
  if (min === null && max === null) return 'valeur inconnue';
  if (min === null) return `au plus ${nf.format(max as number)} ${unit}`;
  if (max === null) return `au moins ${nf.format(min)} ${unit}`;
  if (Math.abs(max - min) < 0.05) return `${nf.format(min)} ${unit}`;
  // « entre 0 et 0,5 g » se lit mieux que « 0–0,5 g » dans une ligne de texte.
  return `entre ${nf.format(min)} et ${nf.format(max)} ${unit}`;
}

/** Même chose en pourcentage du repère, pour les barres. */
export function formatPercentRange(min: number | null, max: number | null): string {
  if (min === null && max === null) return 'indisponible';
  if (max === null) return `au moins ${nf.format(min as number)} %`;
  if (min === null) return `au plus ${nf.format(max)} %`;
  if (Math.abs(max - min) < 0.5) return `${nf.format(min)} %`;
  return `entre ${nf.format(min)} et ${nf.format(max)} %`;
}

/**
 * Une masse, avec son unité. Passe au kilogramme au-delà de 1 000 g, parce que
 * « 1,2 kg » se lit et « 1200 g » se compte.
 *
 * L'unité fait partie du retour : une quantité sans unité n'est pas une
 * quantité, et l'oubli ne se voit qu'une fois à l'écran.
 */
export function formatGrams(grams: number | null): string {
  if (grams === null) return 'quantité inconnue';
  return grams >= 1000 ? `${nf.format(grams / 1000)} kg` : `${nf.format(grams)} g`;
}

/** Un pourcentage simple, à une décimale, en français. */
export function formatPercent(value: number | null): string {
  return value === null ? 'indisponible' : `${nf.format(value)} %`;
}
