/**
 * Les petites icônes des régimes. Un trait, `currentColor` : elles prennent la
 * couleur du texte autour, jamais l'une des cinq couleurs de nutriments (§8ter).
 * Pas d'icône pour les régimes sans image évidente — le libellé suffit.
 */
import type { ReactElement } from 'react';

const SLASH = <path d="M3 3l10 10" />;

const SHAPES: Record<string, ReactElement> = {
  // une feuille
  vegetarien: <path d="M3 13c0-6 4-9 10-9 0 6-3 10-9 10M3 13l6-6" />,
  // une pousse
  vegetalien: <path d="M8 14V8M8 8C8 5 6 4 3 4c0 3 2 4 5 4zM8 9c0-2 2-3 5-3 0 2-2 3-5 3z" />,
  // une tranche de viande, barrée
  sans_viande: <><ellipse cx="8" cy="8" rx="5.5" ry="4" />{SLASH}</>,
  // un poisson, barré
  sans_poisson: <><path d="M2 8c2-3 5-3 7-1l4-2v6l-4-2c-2 2-5 2-7-1z" />{SLASH}</>,
};

export function hasDietIcon(diet: string): boolean {
  return diet in SHAPES;
}

export function DietIcon({ diet }: { diet: string }): ReactElement | null {
  const shape = SHAPES[diet];
  if (shape === undefined) return null;
  return (
    <svg
      width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {shape}
    </svg>
  );
}
