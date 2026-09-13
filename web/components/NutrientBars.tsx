/**
 * Les cinq barres, en détail (§8).
 *
 * R3 : **en pourcentage du repère du jour, jamais en grammes bruts.** Les
 * grammes n'apparaissent qu'en légende secondaire, et jamais comme la valeur
 * qu'on lit en premier.
 *
 * Quatre états à distinguer, et il faut les quatre :
 *
 *   valeur + repère    la barre, en %
 *   valeur sans repère la tranche d'âge n'est couverte par aucune source (§9)
 *   valeur partielle   un repas de la journée n'a pas cette valeur — minorant
 *   rien de connu      pas de barre. Surtout pas une barre à zéro.
 */
import type { DailyBalance } from '../api.ts';
import { BAR_NUTRIENTS, NUTRIENT_COLOR, NUTRIENT_LABELS, NUTRIENT_SHORT } from '../design/vocabulary.ts';
import { formatPercentRange } from '../design/quantities.ts';

const HEIGHT = 58;

export function NutrientBars({ balance }: { balance: DailyBalance }): React.ReactElement {
  const columns = BAR_NUTRIENTS.map((nutrient) => {
    const bar = balance.bars.find((b) => b.nutrient === nutrient);
    return {
      key: nutrient as string,
      short: NUTRIENT_SHORT[nutrient],
      label: NUTRIENT_LABELS[nutrient],
      color: NUTRIENT_COLOR[nutrient],
      percent: bar?.percent ?? null,
      percentMax: bar?.percentMax ?? null,
      state: bar?.state ?? 'indisponible',
      hasReference: bar?.reference != null,
    };
  });
  columns.push({
    key: 'plant',
    short: 'Vé',
    label: 'Végétal',
    color: NUTRIENT_COLOR.plant,
    percent: balance.plant.percent,
    percentMax: balance.plant.percent,
    state: balance.plant.state,
    // §8 : la barre Végétal n'a pas de cible chiffrée, par construction.
    hasReference: true,
  });

  return (
    <div>
      <div style={{ display: 'flex', gap: 7, alignItems: 'flex-end', justifyContent: 'center', height: HEIGHT }}>
        {columns.map(({ key, ...column }) => (
          <Bar key={key} {...column} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 7, justifyContent: 'center', marginTop: 6 }}>
        {columns.map((column) => (
          <span key={column.key} title={column.label}
                style={{ width: 17, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
            {column.short}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Une barre, et ce qu'elle sait de son incertitude.
 *
 * La partie pleine va jusqu'à la borne basse — ce qui est garanti atteint. Une
 * extension translucide monte jusqu'à la borne haute quand la source ne donne
 * qu'un intervalle. Quand il n'y a pas de borne haute du tout, la hachure dit
 * que la barre pourrait monter sans dire jusqu'où.
 *
 * On ne dessine jamais le milieu d'un intervalle : ce serait un chiffre que
 * personne n'a mesuré.
 */
function Bar(column: {
  label: string; color: string; percent: number | null; percentMax: number | null;
  state: string; hasReference: boolean;
}): React.ReactElement {
  const known = column.percent !== null;
  const height = (value: number): number => Math.max(3, Math.min(value, 130) / 130 * HEIGHT);
  const low = known ? height(column.percent as number) : 2;
  const high =
    column.percentMax !== null && column.percentMax > (column.percent ?? 0)
      ? height(column.percentMax)
      : low;

  const title = !known
    ? column.hasReference
      ? `${column.label} : donnée indisponible`
      : `${column.label} : repère indisponible pour cet âge`
    : `${column.label} : ${formatPercentRange(column.percent, column.percentMax)}`;

  return (
    <div
      title={title}
      aria-label={title}
      style={{
        width: 17, height: HEIGHT, background: 'var(--surface-2)', borderRadius: 3,
        display: 'flex', alignItems: 'flex-end', position: 'relative',
        border: '.5px solid var(--border)',
      }}
    >
      {/* Au-dessus de la borne basse : ce qui est possible sans être acquis. */}
      {known && high > low ? (
        <span
          style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, height: high,
            borderRadius: 3, background: column.color, opacity: .28,
          }}
        />
      ) : null}
      <span
        style={{
          width: '100%', height: low, borderRadius: 3, display: 'block',
          position: 'relative', zIndex: 1,
          background: known ? column.color : 'var(--border-strong)',
          // Sans borne haute, le total ne peut que monter : la hachure le dit
          // sans prétendre savoir jusqu'où.
          backgroundImage: known && column.state === 'partiel'
            ? 'repeating-linear-gradient(45deg, rgba(255,255,255,.55) 0 3px, transparent 3px 6px)'
            : undefined,
        }}
      />
    </div>
  );
}
