/**
 * Le vocabulaire produit, en un seul endroit (§8ter).
 *
 * « Qui était à table ? » plutôt que « participants ». « Pour combien ? »
 * plutôt que « servings ». « Ce soir » plutôt que « créneau dîner ».
 * Le vocabulaire système est la moitié de l'effet tableau de bord, et il se
 * réintroduit tout seul dès qu'on nomme un libellé depuis le champ de la base.
 *
 * On parle **qualité et variété**, jamais calories et objectifs (R7).
 */
import type { Nutrient, Slot } from '../api.ts';

/**
 * Les régimes proposés à la saisie.
 *
 * Des **faits déclarés**, jamais un jugement (I2) : « végétarien » est un
 * régime, « mange mal » n'en est pas un. La colonne `eater.diets` est un
 * `text[]` libre — cette liste est ce que l'interface propose, pas ce que la
 * base accepte.
 */
export const DIET_CHOICES: { value: string; label: string }[] = [
  { value: 'vegetarien', label: 'Végétarien' },
  { value: 'vegetalien', label: 'Végétalien' },
  { value: 'sans_porc', label: 'Sans porc' },
  { value: 'sans_gluten', label: 'Sans gluten' },
  { value: 'sans_lactose', label: 'Sans lactose' },
];

const DIET_LABELS = new Map(DIET_CHOICES.map(({ value, label }) => [value, label]));

/** Un régime tel qu'il s'écrit à l'écran. Une valeur inconnue se dit telle quelle. */
export const dietLabel = (value: string): string => DIET_LABELS.get(value) ?? value;

export const SLOT_LABELS: Record<Slot, string> = {
  petit_dej: 'Petit-déj',
  dejeuner: 'Déjeuner',
  gouter: 'Goûter',
  diner: 'Dîner',
  collation: 'Collation',
};

/** Le même créneau, dit comme on le dit à la maison. */
export const SLOT_WHEN: Record<Slot, string> = {
  petit_dej: 'Ce matin',
  dejeuner: 'Ce midi',
  gouter: 'Au goûter',
  diner: 'Ce soir',
  collation: 'Dans la journée',
};

export const SLOT_ORDER: Slot[] = ['petit_dej', 'dejeuner', 'gouter', 'diner', 'collation'];

export const NUTRIENT_LABELS: Record<Nutrient, string> = {
  kcal: 'Énergie',
  proteinG: 'Protéines',
  carbG: 'Glucides',
  fatG: 'Lipides',
  fiberG: 'Fibres',
};

export const NUTRIENT_SHORT: Record<Nutrient, string> = {
  kcal: 'kc',
  proteinG: 'Pr',
  carbG: 'Gl',
  fatG: 'Li',
  fiberG: 'Fi',
};

/**
 * Les quatre barres chiffrées de l'accueil. `kcal` n'en fait pas partie : les
 * calories existent en base, elles ne sont jamais la métrique mise en avant
 * (R7), et jamais un objectif sur un profil mineur (I5).
 */
export const BAR_NUTRIENTS: Nutrient[] = ['proteinG', 'carbG', 'fatG', 'fiberG'];

/** Les cinq couleurs — sur des données nutritionnelles, et nulle part ailleurs. */
export const NUTRIENT_COLOR: Record<Nutrient | 'plant', string> = {
  kcal: 'var(--text-secondary)',
  proteinG: 'var(--n-prot)',
  carbG: 'var(--n-gluc)',
  fatG: 'var(--n-lip)',
  fiberG: 'var(--n-fibre)',
  plant: 'var(--n-veg)',
};

export const CONFIDENCE_LABELS = {
  haute: 'Valeurs sourcées',
  moyenne: 'Estimation',
  basse: 'À vérifier',
} as const;

const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

export const monthName = (month: number): string => MONTHS[month - 1] ?? '';

/** « DIMANCHE 13 SEPTEMBRE » — le sur-titre de l'accueil. */
export function longDate(date: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date(`${date}T12:00:00`));
}

export function shortDay(date: string): string {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }).format(new Date(`${date}T12:00:00`));
}

/** « Hier soir », « Vendredi » — pour la liste des restes. */
export function relativeDay(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const days = Math.round(
    (startOfDay(now).getTime() - startOfDay(date).getTime()) / 86_400_000,
  );
  if (days === 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 7) return new Intl.DateTimeFormat('fr-FR', { weekday: 'long' }).format(date);
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(date);
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * Le créneau qu'on propose par défaut à cette heure-ci — un tap de moins, et
 * c'est presque toujours le bon.
 */
export function currentSlot(now = new Date()): Slot {
  const hour = now.getHours();
  if (hour < 10) return 'petit_dej';
  if (hour < 14) return 'dejeuner';
  if (hour < 18) return 'gouter';
  if (hour < 23) return 'diner';
  return 'collation';
}

/** Initiale affichée dans l'anneau d'un membre. */
export const initial = (firstName: string): string => firstName.slice(0, 1).toUpperCase();
