/**
 * Le « − 4 + » des maquettes : parts mangées, invités.
 *
 * Un pas, pas un clavier. Saisir « pour combien ? » au clavier numérique sur
 * un téléphone coûte trois gestes de plus, et l'app se joue à un tap près.
 */
import { IconMinus, IconPlus } from '../icons.tsx';

interface Props {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  disabled?: boolean;
}

export function Stepper({
  value, onChange, min = 0, max = 20, step = 1, label, disabled = false,
}: Props): React.ReactElement {
  const clamp = (next: number): number =>
    Math.round(Math.min(Math.max(next, min), max) * 100) / 100;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-secondary)' }}>
      <button
        type="button"
        className="appbar__action"
        style={{ color: 'inherit' }}
        onClick={() => onChange(clamp(value - step))}
        disabled={disabled || value <= min}
        aria-label={`${label} : diminuer`}
      >
        <IconMinus size={18} />
      </button>
      <span style={{ fontSize: 17, fontWeight: 500, color: 'var(--text-primary)', minWidth: 22, textAlign: 'center' }}>
        {value}
      </span>
      <button
        type="button"
        className="appbar__action"
        style={{ color: 'inherit' }}
        onClick={() => onChange(clamp(value + step))}
        disabled={disabled || value >= max}
        aria-label={`${label} : augmenter`}
      >
        <IconPlus size={18} />
      </button>
    </div>
  );
}
