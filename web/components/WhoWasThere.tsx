/**
 * « Qui était à table ? » — pas « participants » (§8ter).
 *
 * Le client envoie qui était présent ; **jamais les parts** (§12). Celles-ci
 * sont calculées par le serveur depuis les `portion_coef` du moment, puis
 * figées (R2). L'écran n'en montre pas non plus : « 0,167 du plat » n'aide
 * personne à table, et installe la comptabilité que l'app refuse (R7).
 */
import type { Eater } from '../api.ts';
import { IconCheck } from '../icons.tsx';
import { Avatar } from './Avatar.tsx';
import { Stepper } from './Stepper.tsx';

interface Props {
  eaters: Eater[];
  present: Set<string>;
  onToggle: (eaterId: string) => void;
  guestCount: number;
  onGuestCount: (count: number) => void;
}

export function WhoWasThere({
  eaters, present, onToggle, guestCount, onGuestCount,
}: Props): React.ReactElement {
  return (
    <div>
      <p style={{ fontSize: 14, marginBottom: 10 }}>Qui était à table&nbsp;?</p>
      <div className="grid2">
        {eaters.map((eater) => {
          const on = present.has(eater.id);
          return (
            <button
              key={eater.id}
              type="button"
              onClick={() => onToggle(eater.id)}
              aria-pressed={on}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '9px 10px', borderRadius: 'var(--radius)',
                border: `.5px solid ${on ? 'var(--coral)' : 'var(--border)'}`,
                background: on ? 'var(--coral-wash)' : 'var(--surface-2)',
                color: on ? 'var(--text-primary)' : 'var(--text-secondary)',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              {on ? (
                <IconCheck size={16} style={{ color: 'var(--coral-600)' }} />
              ) : (
                <span style={{
                  width: 16, height: 16, borderRadius: 4,
                  border: '.5px solid var(--border-strong)', display: 'block',
                }} />
              )}
              <Avatar seed={eater.id} size={20} />
              <span style={{ fontSize: 13 }}>{eater.firstName}</span>
            </button>
          );
        })}
      </div>

      {/* §6bis — les invités entrent au dénominateur des parts sans figurer
          dans la liste des membres. Un champ entier gère 1 comme 5. */}
      <div className="spread" style={{
        marginTop: 12, paddingTop: 12, borderTop: '.5px solid var(--border)',
      }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Invités</span>
        <Stepper value={guestCount} onChange={onGuestCount} min={0} max={20} label="Invités" />
      </div>
    </div>
  );
}
