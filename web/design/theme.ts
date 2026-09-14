/**
 * Clair, sombre, ou comme le téléphone.
 *
 * ── Presque tout se passe en CSS ────────────────────────────────────────────
 *
 * Les tokens sont écrits en `light-dark()` et `:root` porte
 * `color-scheme: light dark` : **suivre le système ne demande aucun
 * JavaScript**, et fonctionne donc dès la première peinture, avant que React
 * ne soit monté. C'est le cas de la grande majorité des gens, et c'est celui
 * qui doit être irréprochable.
 *
 * Ce module ne sert qu'au cas minoritaire : quelqu'un qui veut forcer un mode
 * quel que soit son téléphone. Il pose alors `data-theme` sur `<html>`, ce que
 * la feuille de style traduit en `color-scheme: only light|dark`.
 *
 * ── Pourquoi `color-scheme` plutôt qu'un second jeu de tokens ───────────────
 *
 * Parce qu'il emporte les contrôles natifs avec lui : le sélecteur de date —
 * que l'app utilise sur chaque fiche de convive —, les barres de défilement, la
 * couleur du curseur. Un bloc de variables de plus aurait laissé un calendrier
 * blanc éclatant au milieu d'un écran sombre.
 *
 * ── Ce que ça ne couvre pas ─────────────────────────────────────────────────
 *
 * L'écran de démarrage Android vient de `background_color` du manifeste, qui
 * est une valeur fixe : la spec des manifestes ne prévoit pas de variante
 * sombre. Il reste donc crème une demi-seconde avant que l'app ne s'ouvre en
 * sombre. Rien à faire côté app, et pas de quoi renoncer au reste.
 */

export type Theme = 'systeme' | 'clair' | 'sombre';

export const THEMES: { value: Theme; label: string }[] = [
  { value: 'systeme', label: 'Comme le téléphone' },
  { value: 'clair', label: 'Clair' },
  { value: 'sombre', label: 'Sombre' },
];

/**
 * Le réglage est **local à l'appareil**, pas au compte ni au foyer.
 *
 * Deux personnes partagent un foyer et pas leurs yeux ; et la même personne
 * peut vouloir du sombre sur son téléphone le soir et du clair sur la tablette
 * de la cuisine. Le mettre en base le rendrait commun aux deux, ce qui est le
 * contraire de ce qu'on veut.
 */
const KEY = 'tablee:theme';

const isTheme = (value: unknown): value is Theme =>
  value === 'systeme' || value === 'clair' || value === 'sombre';

/**
 * `localStorage` lève en navigation privée et quand le stockage est bloqué.
 * Un thème est un confort : il ne doit jamais empêcher l'app de démarrer.
 */
export function readTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(KEY);
    return isTheme(stored) ? stored : 'systeme';
  } catch {
    return 'systeme';
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  // Pas d'attribut = pas de `color-scheme: only …` = on suit le téléphone.
  if (theme === 'systeme') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function setTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    if (theme === 'systeme') window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, theme);
  } catch {
    // Écriture refusée : le choix vaut pour cette session, et c'est déjà ça.
  }
}
