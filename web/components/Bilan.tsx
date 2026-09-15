/**
 * Le bilan du jour d'une personne, en barres horizontales.
 *
 * Proposition validée le 14/09/2026 (`docs/proposition-accueil.html`). Sur
 * l'accueil, il remplace les colonnes de `NutrientBars` — 17 px de large,
 * chacune sur sa propre échelle, nommées de deux lettres. Elles restent sur la
 * fiche famille, où elles ne sont qu'un aperçu.
 *
 * Trois choses à ne pas défaire :
 *
 *   **Une échelle commune**, 0 à 160 % du repère : le trait du repère tombe au
 *   même endroit sur chaque ligne. Un plafond plus haut — les protéines vont
 *   jusqu'à 2,7 fois le repère chez les 4-5 ans — prolonge la zone grisée
 *   jusqu'au bout, sans trait ; la valeur écrite, elle, reste exacte.
 *
 *   **Un statut est un mot et une icône avant d'être une couleur.** Terracotta
 *   pour ce qui reste à mettre dans l'assiette — celui du bouton qui y répond —,
 *   vert pour atteint, ambre pour au-delà, gris pour ce qu'on ne sait pas. Pas
 *   de rouge : rien n'est une faute.
 *
 *   **Le texte ne porte jamais la couleur d'un nutriment** (§8ter). Elle reste
 *   sur la barre et sur la pastille à côté du nom.
 *
 * Et ce qu'il refuse, comme `NutrientBars` : une barre à zéro pour une valeur
 * inconnue, et le milieu d'un intervalle dessiné comme s'il était mesuré.
 */
import { useState } from 'react';
import type { BarState, DailyBalance, Nutrient, NutrientBar, PlantBar } from '../api.ts';
import { Avatar } from './Avatar.tsx';
import { IconCheckCircle, IconInfo, IconPlusCircle, IconUpCircle } from '../icons.tsx';
import { BAR_NUTRIENTS, NUTRIENT_COLOR, NUTRIENT_LABELS } from '../design/vocabulary.ts';
import { formatGrams, formatPercentRange } from '../design/quantities.ts';
import { ReferenceSheet } from './ReferenceSheet.tsx';

/** Le haut de l'échelle, en % du repère. */
export const SCALE = 160;

/** La colonne des valeurs est fixe : sinon les pistes n'ont plus la même largeur. */
const VALUE_WIDTH = 58;

/** Une position sur la piste, en % de sa largeur. */
const at = (percent: number, scale: number): string =>
  `${(Math.max(0, Math.min(percent, scale)) / scale) * 100}%`;

export type Tone = 'todo' | 'ok' | 'over' | 'unknown';

export const TONE_COLOR: Record<Tone, string> = {
  todo: 'var(--coral-600)',
  ok: 'var(--text-success)',
  over: 'var(--text-warning)',
  unknown: 'var(--text-secondary)',
};

export const TONE_ICON: Record<Tone, typeof IconInfo> = {
  todo: IconPlusCircle,
  ok: IconCheckCircle,
  over: IconUpCircle,
  unknown: IconInfo,
};

export function BilanCard({
  eaterId,
  firstName,
  balance,
  referencesLoaded,
}: {
  eaterId: string;
  firstName: string;
  balance: DailyBalance;
  /** Sans repères chargés, « indisponible pour cet âge » serait faux. */
  referencesLoaded: boolean;
}): React.ReactElement {
  const [explaining, setExplaining] = useState(false);
  const uncertain = balance.bars.filter((b) => b.state === 'encadre' || b.state === 'partiel');

  return (
    <div className="card" style={{ padding: '16px 15px' }}>
      <div className="spread" style={{ alignItems: 'center' }}>
        <p style={{ fontSize: 17, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Avatar seed={eaterId} size={26} />
          {firstName}
        </p>
        <p className="meta">
          {balance.mealCount === 0
            ? 'Aucun repas enregistré aujourd’hui'
            : `${balance.mealCount} repas aujourd’hui`}
        </p>
      </div>

      {/* L'axe, une fois pour toutes les lignes. */}
      <div aria-hidden="true" style={{
        display: 'flex', gap: 8, marginTop: 14, fontSize: 11, color: 'var(--text-secondary)',
      }}>
        <span style={{ position: 'relative', flex: 1, height: 14 }}>
          <span style={{ position: 'absolute', left: 0 }}>% du repère du jour</span>
          <span style={{ position: 'absolute', left: at(100, SCALE), transform: 'translateX(-50%)' }}>
            repère
          </span>
        </span>
        <span style={{ width: VALUE_WIDTH }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 8 }}>
        {BAR_NUTRIENTS.map((nutrient) => (
          <NutrientRow
            key={nutrient}
            nutrient={nutrient}
            bar={balance.bars.find((b) => b.nutrient === nutrient)}
            referencesLoaded={referencesLoaded}
          />
        ))}
      </div>

      <PlantRow plant={balance.plant} />

      <div style={{
        marginTop: 14, paddingTop: 12, borderTop: '.5px solid var(--border)',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        {/* Une incertitude qu'on n'explique pas se lit comme un bug. */}
        {uncertain.length > 0 ? (
          <p className="meta" style={{ display: 'flex', gap: 8, lineHeight: 1.5 }}>
            <IconInfo size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{uncertaintySentence(uncertain)}</span>
          </p>
        ) : null}
        {/* Un repère affiché sans sa provenance demande qu'on lui fasse
            confiance sur parole. */}
        <button
          type="button"
          className="meta"
          onClick={() => setExplaining(true)}
          style={{
            alignSelf: 'flex-start', background: 'none', border: 0, padding: '4px 0',
            cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2,
          }}
        >
          D’où viennent ces repères
        </button>
      </div>

      {explaining ? (
        <ReferenceSheet balance={balance} firstName={firstName} onClose={() => setExplaining(false)} />
      ) : null}
    </div>
  );
}

function NutrientRow({
  nutrient,
  bar,
  referencesLoaded,
}: {
  nutrient: Nutrient;
  bar: NutrientBar | undefined;
  referencesLoaded: boolean;
}): React.ReactElement {
  const { tone, text } = standingOf(bar, referencesLoaded);
  const Icon = TONE_ICON[tone];
  const label = NUTRIENT_LABELS[nutrient];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div className="spread" style={{ gap: 10 }}>
        <Name color={NUTRIENT_COLOR[nutrient]} label={label} />
        <span style={{
          display: 'flex', alignItems: 'center', gap: 5, textAlign: 'right',
          fontSize: 12, fontWeight: 500, color: TONE_COLOR[tone],
        }}>
          <Icon size={14} strokeWidth={2} style={{ flexShrink: 0 }} />
          {text}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {bar !== undefined && bar.percent !== null ? (
          <Track
            color={NUTRIENT_COLOR[nutrient]}
            percent={bar.percent}
            percentMax={bar.percentMax}
            state={bar.state}
            scale={SCALE}
            reference
            ceiling={bar.reference !== null && bar.referenceMax !== null
              ? (bar.referenceMax.value / bar.reference.value) * 100
              : null}
            marker={null}
            label={`${label} : ${formatPercentRange(bar.percent, bar.percentMax)} du repère`}
          />
        ) : (
          <EmptyTrack />
        )}
        <Value percent={bar?.percent ?? null} percentMax={bar?.percentMax ?? null} />
      </div>
    </div>
  );
}

/**
 * §8 — la part végétale se lit en tendance, pas en objectif : sa propre
 * échelle (0 à 100 % de l'assiette), aucun statut, et la moyenne du foyer sur
 * sept jours en simple trait. Aucune cible chiffrée (R7, I5).
 */
function PlantRow({ plant }: { plant: PlantBar }): React.ReactElement {
  return (
    <div style={{
      marginTop: 16, paddingTop: 14, borderTop: '.5px solid var(--border)',
      display: 'flex', flexDirection: 'column', gap: 7,
    }}>
      <div className="spread" style={{ gap: 10 }}>
        <Name color={NUTRIENT_COLOR.plant} label="Part végétale" />
        <span className="meta">de l’assiette, sans repère</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {plant.percent !== null ? (
          <Track
            color={NUTRIENT_COLOR.plant}
            percent={plant.percent}
            percentMax={null}
            state={plant.state}
            scale={100}
            reference={false}
            ceiling={null}
            marker={plant.householdAverage7d}
            label={`Part végétale : ${formatPercentRange(plant.percent, plant.percent)} de l’assiette`}
          />
        ) : (
          <EmptyTrack />
        )}
        <Value percent={plant.percent} percentMax={null} />
      </div>
      {plant.percent === null ? (
        <p className="meta">Indisponible : les aliments du jour ne sont pas rattachés au référentiel.</p>
      ) : plant.householdAverage7d !== null ? (
        <p className="meta">
          {`Le trait : moyenne du foyer sur 7 jours, ${Math.round(plant.householdAverage7d)}\u00a0%`}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Une piste, et ce qu'elle sait de son incertitude.
 *
 * La partie pleine s'arrête à la borne basse ; une extension pâle monte à la
 * borne haute quand la source ne donne qu'un intervalle ; sans borne haute, la
 * hachure dit que ça peut monter sans dire jusqu'où.
 */
export function Track({
  color, percent, percentMax, state, scale, reference, ceiling, marker, label,
}: {
  color: string;
  percent: number;
  percentMax: number | null;
  state: BarState;
  scale: number;
  /** Le trait du repère, et la zone grisée jusqu'au plafond. */
  reference: boolean;
  /** Le plafond, en % du repère. `null` quand la source n'en publie pas. */
  ceiling: number | null;
  /** Un trait gris sans zone : la moyenne du foyer, sur la part végétale. */
  marker: number | null;
  label: string;
}): React.ReactElement {
  return (
    <span role="img" aria-label={label} style={{
      position: 'relative', flex: 1, height: 12, borderRadius: 2, background: 'var(--surface-1)',
    }}>
      {reference ? (
        <span style={{
          position: 'absolute', top: 0, bottom: 0, left: at(100, scale), background: 'var(--band)',
          right: ceiling === null || ceiling >= scale ? 0 : `calc(100% - ${at(ceiling, scale)})`,
        }} />
      ) : null}
      {percentMax !== null && percentMax > percent ? (
        <span style={{
          position: 'absolute', top: 0, bottom: 0, left: 0, width: at(percentMax, scale),
          borderRadius: '0 4px 4px 0', backgroundColor: color, opacity: .28,
        }} />
      ) : null}
      <span style={{
        position: 'absolute', top: 0, bottom: 0, left: 0, width: `max(3px, ${at(percent, scale)})`,
        borderRadius: '0 4px 4px 0', backgroundColor: color,
        ...(state === 'partiel'
          ? { backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,.55) 0 3px, transparent 3px 6px)' }
          : {}),
      }} />
      {reference ? <Tick left={at(100, scale)} color="var(--text-primary)" /> : null}
      {ceiling !== null && ceiling < scale ? <Tick left={at(ceiling, scale)} color="var(--text-muted)" /> : null}
      {marker !== null ? <Tick left={at(marker, scale)} color="var(--text-secondary)" /> : null}
    </span>
  );
}

function Tick({ left, color }: { left: string; color: string }): React.ReactElement {
  return (
    <span style={{
      position: 'absolute', left: `calc(${left} - 1px)`, top: -3, width: 2, height: 18,
      borderRadius: 1, background: color,
    }} />
  );
}

/** Rien de connu : pas de barre. Surtout pas une barre à zéro. */
export function EmptyTrack(): React.ReactElement {
  return (
    <span style={{ flex: 1, height: 12, borderRadius: 2, border: '.5px dashed var(--border-strong)' }} />
  );
}

function Value({ percent, percentMax }: { percent: number | null; percentMax: number | null }): React.ReactElement {
  const low = percent === null ? null : Math.round(percent);
  const high = percentMax === null ? null : Math.round(percentMax);
  const range = low !== null && high !== null && high > low;
  return (
    <span style={{
      width: VALUE_WIDTH, flexShrink: 0, textAlign: 'right', whiteSpace: 'nowrap',
      fontSize: range ? 12 : 14, fontWeight: 500, fontVariantNumeric: 'tabular-nums',
    }}>
      {low === null ? '' : range ? `${low}–${high}\u00a0%` : `${low}\u00a0%`}
    </span>
  );
}

function Name({ color, label }: { color: string; label: string }): React.ReactElement {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 14 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}

/**
 * Le statut d'une barre, en mots.
 *
 * Le ton reste un constat, jamais un reproche (R7) — « il manque » et non « tu
 * n'as pas assez », « au-delà » et non « trop ».
 */
function standingOf(bar: NutrientBar | undefined, referencesLoaded: boolean): { tone: Tone; text: string } {
  if (bar === undefined || bar.reference === null) {
    return { tone: 'unknown', text: referencesLoaded ? 'Repère indisponible pour cet âge' : 'Repères non chargés' };
  }
  if (bar.percent === null) return { tone: 'unknown', text: 'Donnée indisponible' };
  if (bar.standing === 'au_dela' && bar.excess !== null) {
    return { tone: 'over', text: `${formatGrams(bar.excess)} au-delà` };
  }
  if (bar.standing === 'sous' && bar.remaining !== null && bar.remaining > 0) {
    // Le reste se compte depuis la borne basse : quand la valeur est encadrée
    // ou partielle, il en manque peut-être moins. On ne réclame pas ce qui a
    // peut-être déjà été mangé.
    const nuance = bar.state === 'disponible' ? '' : ' au plus';
    return { tone: 'todo', text: `Il manque ${formatGrams(bar.remaining)}${nuance}` };
  }
  return { tone: 'ok', text: 'Dans le repère' };
}

function uncertaintySentence(bars: NutrientBar[]): string {
  const names = (state: BarState): string =>
    bars.filter((b) => b.state === state).map((b) => NUTRIENT_LABELS[b.nutrient].toLowerCase()).join(', ');
  const parts: string[] = [];
  if (names('encadre') !== '') parts.push(`${names('encadre')} : la source ne donne qu’un intervalle`);
  if (names('partiel') !== '') {
    parts.push(`${names('partiel')} : au moins ce qui est affiché, un aliment n’est pas rattaché`);
  }
  const sentence = parts.join(' · ');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}
