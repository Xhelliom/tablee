/**
 * L'anneau d'une personne : cinq segments, un par nutriment (§8).
 *
 * Un segment absent se lit d'un coup — c'est tout l'intérêt de la forme, et
 * c'est pourquoi une valeur indisponible ne dessine **rien** plutôt qu'un
 * segment à zéro. Les deux se ressembleraient à l'écran alors qu'ils ne
 * veulent pas dire la même chose (§9, §11).
 *
 * Les cinq couleurs n'apparaissent qu'ici et dans les barres : jamais sur un
 * bouton, un onglet ou un fond (§8ter).
 */
import type { DailyBalance } from '../api.ts';
import { BAR_NUTRIENTS, NUTRIENT_COLOR, initial } from '../design/vocabulary.ts';

const RADIUS = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const SLOT = CIRCUMFERENCE / 5;
const GAP = 2.6;

interface Props {
  balance: DailyBalance;
  firstName: string;
  size?: number;
}

export function NutrientRing({ balance, firstName, size = 52 }: Props): React.ReactElement {
  const segments: { key: string; color: string; percent: number | null }[] = [
    ...BAR_NUTRIENTS.map((nutrient) => {
      const bar = balance.bars.find((b) => b.nutrient === nutrient);
      return { key: nutrient, color: NUTRIENT_COLOR[nutrient], percent: bar?.percent ?? null };
    }),
    { key: 'plant', color: NUTRIENT_COLOR.plant, percent: balance.plant.percent },
  ];

  return (
    <svg width={size} height={size} viewBox="0 0 52 52" role="img"
         aria-label={`Bilan de ${firstName}`}>
      <g transform="rotate(-90 26 26)">
        {/* La piste pointillée montre les cinq emplacements, pleins ou non. */}
        <circle
          cx="26" cy="26" r={RADIUS} fill="none" strokeWidth="4"
          stroke="rgba(216,90,48,.18)"
          strokeDasharray={`${SLOT - GAP} ${GAP}`}
        />
        {segments.map((segment, index) =>
          segment.percent === null ? null : (
            <circle
              key={segment.key}
              cx="26" cy="26" r={RADIUS} fill="none" strokeWidth="4" strokeLinecap="round"
              stroke={segment.color}
              strokeDasharray={`${fill(segment.percent)} ${CIRCUMFERENCE}`}
              strokeDashoffset={-SLOT * index}
            />
          ),
        )}
      </g>
      <text x="26" y="31" textAnchor="middle" fontSize="14" fill="var(--text-primary)"
            fontFamily="var(--font-ui)">
        {initial(firstName)}
      </text>
    </svg>
  );
}

/** Au-delà de 100 % le segment est plein : il ne déborde pas sur le voisin. */
function fill(percent: number): number {
  return Math.max(0, Math.min(percent, 100)) / 100 * (SLOT - GAP);
}
