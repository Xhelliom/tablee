/**
 * Ce qui reste dans le plat (§6bis, 15/09/2026).
 *
 * On ne demande pas « combien de parts avez-vous mangé ? », que personne ne
 * sait : on demande pour combien on a cuisiné et ce qui reste. Les parts
 * mangées s'en déduisent, et `servings` les enregistre comme avant — le calcul
 * du §11 ne voit aucune différence.
 *
 * Sans recette, ce qui est saisi est ce qui a été servi — la pizza entière — et
 * le nombre de parts ne sert à rien : seul « Il en reste ? » est demandé, et le
 * calcul ne compte que la part mangée.
 *
 * Des paliers, pas un pourcentage : un « 25 % » posé à côté de barres en « % du
 * repère du jour » se lirait comme de la nutrition. Et « un fond » vaut 10 % :
 * c'est à peu près toujours juste, et plus honnête qu'un chiffre précis.
 */
import type { Meal } from '../api.ts';
import { navigate } from '../router.tsx';
import { IconChevron, IconFridge } from '../icons.tsx';
import { formatNumber } from '../design/quantities.ts';
import { relativeDay } from '../design/vocabulary.ts';

const REMAINS = [
  { value: 0, label: 'Rien' },
  { value: 0.1, label: 'Un fond' },
  { value: 0.25, label: '¼' },
  { value: 0.5, label: '½' },
  { value: 0.75, label: '¾' },
] as const;

/** Ce qu'on avait devant soi et ce qui en reste → ce qu'on enregistre. */
export function split(base: number, fraction: number): { servings: number; remainingServings: number } {
  const remainingServings = round(base * fraction);
  return { servings: round(base - remainingServings), remainingServings };
}

/** Le palier le plus proche de ce qu'un repas a déclaré. `null` se lit « rien ». */
export function remainsOf(
  meal: Pick<Meal, 'servings' | 'remainingServings'>,
): (typeof REMAINS)[number] {
  const left = meal.remainingServings ?? 0;
  if (left <= 0) return REMAINS[0];
  const fraction = left / (meal.servings + left);
  return REMAINS.slice(1).reduce((best, r) =>
    Math.abs(r.value - fraction) < Math.abs(best.value - fraction) ? r : best);
}

export function eatenHint(servings: number): string {
  const s = servings >= 2 ? 's' : '';
  return `${formatNumber(servings)} part${s} mangée${s} à ce repas`;
}

/** Le libellé et les paliers. L'appelant fournit la ligne qui les porte. */
export function RemainsPicker({
  label, hint, value, onChange, disabled = false,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (fraction: number) => void;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <>
      <div>
        <p style={{ fontSize: 14 }}>{label}</p>
        <p className="meta">{hint}</p>
      </div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {REMAINS.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              style={{
                fontSize: 13, padding: '5px 11px', borderRadius: 'var(--radius)',
                border: selected ? '.5px solid var(--coral)' : '.5px solid var(--border)',
                background: selected ? 'var(--coral)' : 'transparent',
                color: selected ? 'var(--on-coral)' : 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </>
  );
}

/** « Hier · il en reste ¼ » — sous le nom d'un plat qui attend. */
export function leftoverDetail(meal: Meal): string {
  return `${capitalize(relativeDay(meal.eatenAt))} · il en reste ${remainsOf(meal).label.toLowerCase()}`;
}

/** Un plat qui attend, sur l'accueil. « Restes de… » ouvre la même feuille. */
export function LeftoverRow({ meal }: { meal: Meal }): React.ReactElement {
  return (
    <button type="button" className="card row" onClick={() => navigate(`/restes/${meal.id}`)}>
      <IconFridge size={18} style={{ color: 'var(--text-secondary)', marginLeft: 4 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 500, display: 'block' }}>
          {dishTitle(meal)}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {leftoverDetail(meal)}
        </span>
      </span>
      <IconChevron size={17} style={{ color: 'var(--text-muted)' }} />
    </button>
  );
}

/** Le nom d'un plat : sa recette, sinon ce qu'il contient. */
export function dishTitle(meal: Pick<Meal, 'recipe' | 'items'>): string {
  return meal.recipe?.title ?? (meal.items.map((item) => item.label).join(', ') || 'Plat');
}

/** Sans recette, pas de parts à montrer : seulement ce que devient le reste. */
export const UNCOUNTED_HINT = 'Ce qui reste n’est compté pour personne';

const round = (value: number): number => Math.round(value * 100) / 100;
const capitalize = (text: string): string => text.slice(0, 1).toUpperCase() + text.slice(1);
