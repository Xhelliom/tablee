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
      state: bar?.state ?? 'indisponible',
      hasReference: bar?.reference != null,
      partial: (bar?.missingMeals ?? 0) > 0,
    };
  });
  columns.push({
    key: 'plant',
    short: 'Vé',
    label: 'Végétal',
    color: NUTRIENT_COLOR.plant,
    percent: balance.plant.percent,
    state: balance.plant.state,
    // §8 : la barre Végétal n'a pas de cible chiffrée, par construction.
    hasReference: true,
    partial: balance.plant.state === 'partiel',
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

function Bar(column: {
  label: string; color: string; percent: number | null;
  state: string; hasReference: boolean; partial: boolean;
}): React.ReactElement {
  const known = column.percent !== null;
  const height = known ? Math.max(3, Math.min(column.percent ?? 0, 130) / 130 * HEIGHT) : 2;

  const title = !known
    ? column.hasReference
      ? `${column.label} : donnée indisponible`
      : `${column.label} : repère indisponible pour cet âge`
    : `${column.label} : ${column.percent} %${column.partial ? ' au moins' : ''}`;

  return (
    <div
      title={title}
      aria-label={title}
      style={{
        width: 17, height: HEIGHT, background: 'var(--surface-2)', borderRadius: 3,
        display: 'flex', alignItems: 'flex-end',
        border: '.5px solid var(--border)',
      }}
    >
      <span
        style={{
          width: '100%', height, borderRadius: 3, display: 'block',
          background: known ? column.color : 'var(--border-strong)',
          // Une valeur partielle est un minorant : la hachure dit que la barre
          // monterait peut-être plus haut, sans prétendre savoir jusqu'où.
          backgroundImage: known && column.partial
            ? 'repeating-linear-gradient(45deg, rgba(255,255,255,.55) 0 3px, transparent 3px 6px)'
            : undefined,
        }}
      />
    </div>
  );
}
