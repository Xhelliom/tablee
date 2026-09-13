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
      /** Position du plafond sur l'échelle de la barre, en % de la cible. */
      ceiling:
        bar?.reference != null && bar.referenceMax != null
          ? (bar.referenceMax.value / bar.reference.value) * 100
          : null,
      standing: bar?.standing ?? null,
      hasTarget: true,
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
    hasReference: true,
    ceiling: null,
    standing: null,
    // §8 : « pas de cible chiffrée affichée ». La barre montre la valeur du
    // jour, pas une progression vers quoi que ce soit — donc pas de trait.
    hasTarget: false,
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
 * L'échelle va de 0 à la cible (100 %) — c'est ce qui en fait une progression
 * lisible : « à mi-hauteur, il en manque la moitié ». Le plafond, quand il
 * existe, est un trait au-dessus ; le dépassement se voit à la barre qui le
 * franchit.
 *
 * La partie pleine s'arrête à la borne basse de ce qui a été mangé. Une
 * extension translucide monte jusqu'à la borne haute quand la source ne donne
 * qu'un intervalle. Sans borne haute, la hachure dit que ça peut monter sans
 * dire jusqu'où. On ne dessine jamais le milieu d'un intervalle : ce serait un
 * chiffre que personne n'a mesuré.
 */
function Bar(column: {
  label: string; color: string; percent: number | null; percentMax: number | null;
  state: string; hasReference: boolean; ceiling: number | null; standing: string | null;
  hasTarget: boolean;
}): React.ReactElement {
  const known = column.percent !== null;
  // L'échelle laisse voir un dépassement raisonnable au-dessus de la cible, et
  // au-dessus du plafond quand il y en a un.
  const scale = Math.max(130, (column.ceiling ?? 0) + 15);
  const height = (value: number): number =>
    Math.max(3, (Math.min(value, scale) / scale) * HEIGHT);

  const low = known ? height(column.percent as number) : 2;
  const high =
    column.percentMax !== null && column.percentMax > (column.percent ?? 0)
      ? height(column.percentMax)
      : low;

  const title = !known
    ? column.hasReference
      ? `${column.label} : donnée indisponible`
      : `${column.label} : repère indisponible pour cet âge`
    : column.hasTarget
      ? `${column.label} : ${formatPercentRange(column.percent, column.percentMax)} du repère`
      : `${column.label} : ${formatPercentRange(column.percent, column.percentMax)} du repas`;

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
      {/* Le repère à atteindre : un trait discret, pour que « plein » veuille
          dire quelque chose même quand la barre le dépasse. */}
      {known && column.hasTarget ? (
        <span style={{
          position: 'absolute', left: -1, right: -1, bottom: height(100),
          borderTop: '1px dashed var(--border-strong)', opacity: .7,
        }} />
      ) : null}
      {/* Le plafond, quand la source en publie un. */}
      {known && column.ceiling !== null ? (
        <span style={{
          position: 'absolute', left: -1, right: -1, bottom: height(column.ceiling),
          borderTop: '1px solid var(--text-warning)', opacity: .55,
        }} />
      ) : null}
      {/* Au-dessus de la borne basse : ce qui est possible sans être acquis. */}
      {known && high > low ? (
        <span style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: high,
          borderRadius: 3, background: column.color, opacity: .28,
        }} />
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
