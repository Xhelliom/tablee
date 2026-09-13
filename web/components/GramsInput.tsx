/**
 * Une quantité en grammes, avec son unité **toujours visible**.
 *
 * Le piège évité ici : mettre « g » en `placeholder`. Le placeholder disparaît
 * dès qu'une valeur est saisie, et l'écran finit par afficher « Banane 120 »
 * sans dire 120 de quoi. Une quantité sans unité n'est pas une quantité.
 *
 * L'unité est donc un élément à part, accolé au champ, et elle reste là quoi
 * qu'il arrive. Elle est en retrait visuel : c'est le nombre qu'on lit, l'unité
 * ne fait que le qualifier.
 */
import type { CSSProperties } from 'react';

interface Props {
  /** Grammes, ou `null` quand la quantité n'est pas connue. */
  value: number | null;
  /** Appelé à la sortie du champ, pas à chaque frappe. */
  onCommit: (grams: number | null) => void;
  /** Ce qu'on pèse, pour l'étiquette d'accessibilité. */
  label: string;
  disabled?: boolean;
  /** Repart de `value` quand la liste change sous le champ. */
  resetKey?: string | number;
}

export function GramsInput({
  value, onCommit, label, disabled = false, resetKey,
}: Props): React.ReactElement {
  return (
    <span style={wrapper}>
      <input
        key={resetKey ?? value ?? 'vide'}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        defaultValue={value ?? ''}
        // Le placeholder ne sert qu'au champ vide : l'unité, elle, est à côté.
        placeholder="—"
        aria-label={`Quantité de ${label}, en grammes`}
        disabled={disabled}
        onBlur={(event) => {
          const raw = event.target.value.trim();
          const grams = raw === '' ? null : Number(raw);
          if (grams !== null && !Number.isFinite(grams)) return;
          if (grams === value) return;
          onCommit(grams);
        }}
        style={field}
      />
      <span aria-hidden="true" style={unit}>g</span>
    </span>
  );
}

const wrapper: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '5px 9px',
  borderRadius: 'var(--radius)',
  border: '.5px solid var(--border)',
  background: 'var(--surface-2)',
  flexShrink: 0,
};

const field: CSSProperties = {
  width: 52,
  border: 0,
  outline: 'none',
  background: 'transparent',
  fontFamily: 'inherit',
  fontSize: 13,
  color: 'var(--text-primary)',
  textAlign: 'right',
  padding: 0,
  // Les flèches natives volent de la place sur un champ de 52 px.
  MozAppearance: 'textfield',
};

const unit: CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
};
