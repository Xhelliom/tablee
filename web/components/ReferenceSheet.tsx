/**
 * « D'où ça vient, et qu'est-ce que ça veut dire » — la feuille qui s'ouvre
 * sous le petit « i » des barres.
 *
 * Un repère nutritionnel affiché sans sa provenance demande qu'on lui fasse
 * confiance sur parole. C'est précisément ce que I1 refuse : les valeurs
 * servent de base à des conseils destinés à des enfants, elles doivent pouvoir
 * être contestées. Cet écran est donc le pendant visible de la colonne
 * `source` — il rend la chaîne consultable sans ouvrir la base.
 *
 * ⚠️ **Aucun chiffre de calories ici** (I5). Les cibles en grammes dérivent
 * d'un besoin énergétique, mais c'est l'intervalle d'origine qu'on montre
 * (« 10 à 20 % de l'énergie de la journée ») et les documents cités — jamais
 * le terme en kcal. Il reste en base pour qui veut refaire le calcul.
 */
import type { DailyBalance, NutrientBar } from '../api.ts';
import { BAR_NUTRIENTS, NUTRIENT_COLOR, NUTRIENT_LABELS } from '../design/vocabulary.ts';
import { formatGrams } from '../design/quantities.ts';
import { IconClose } from '../icons.tsx';
// Import circulaire avec `Bilan`, qui ouvre cette feuille : sans danger tant
// que ces trois noms ne servent qu'au rendu, jamais au chargement du module.
import { EmptyTrack, SCALE, Track } from './Bilan.tsx';

interface Props {
  balance: DailyBalance;
  firstName: string;
  onClose: () => void;
}

export function ReferenceSheet({ balance, firstName, onClose }: Props): React.ReactElement {
  // Ce que les exemples ont en commun ; chacun change ce qu'il montre. Ici et
  // pas au niveau du module : `SCALE` n'existe pas encore quand il se charge.
  const example = {
    color: NUTRIENT_COLOR.proteinG, percentMax: null, state: 'disponible' as const,
    scale: SCALE, reference: true, ceiling: null, marker: null, label: '',
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`D’où viennent les repères de ${firstName}`}
      style={overlay}
      onClick={onClose}
    >
      <div style={sheet} onClick={(event) => event.stopPropagation()}>
        <header style={header}>
          <p style={{ fontSize: 15 }}>D’où viennent ces barres</p>
          <button type="button" onClick={onClose} aria-label="Fermer"
                  style={{ background: 'none', border: 0, padding: 4, cursor: 'pointer', color: 'var(--on-coral)', display: 'flex' }}>
            <IconClose size={18} />
          </button>
        </header>

        <div style={body}>
          <section style={{ marginBottom: 18 }}>
            <p style={sectionTitle}>Comment les lire</p>
            {/* Dessinés par la vraie piste de l'accueil, pas imités : une
                légende qui s'écarterait du graphe expliquerait autre chose que
                lui. Les pourcentages sont des positions d'exemple, pas des
                valeurs. */}
            <ul style={legend}>
              <li style={legendRow}>
                <span aria-hidden="true" style={exampleBox}><Track {...example} percent={70} /></span>
                <span>La barre avance vers le <b>repère du jour</b>, le trait le plus marqué. Quand elle le franchit, il est atteint.</span>
              </li>
              <li style={legendRow}>
                <span aria-hidden="true" style={exampleBox}><Track {...example} percent={105} ceiling={145} /></span>
                <span>La zone grisée va du repère au <b>plafond</b>, marqué d’un petit trait gris quand la source en publie un.</span>
              </li>
              <li style={legendRow}>
                <span aria-hidden="true" style={exampleBox}><Track {...example} state="encadre" percent={40} percentMax={90} /></span>
                <span>La partie pâle, translucide, est possible sans être acquise&nbsp;: la source ne donne qu’un intervalle.</span>
              </li>
              <li style={legendRow}>
                <span aria-hidden="true" style={exampleBox}><Track {...example} state="partiel" percent={55} /></span>
                <span>Des hachures veulent dire <b>au moins ça</b>&nbsp;: un aliment n’est pas rattaché au référentiel, le total ne peut que monter.</span>
              </li>
              <li style={legendRow}>
                <span aria-hidden="true" style={exampleBox}><EmptyTrack /></span>
                <span>Une piste vide, en pointillé, veut dire <b>on ne sait pas</b>. Jamais zéro.</span>
              </li>
            </ul>
          </section>

          {BAR_NUTRIENTS.map((nutrient) => {
            const bar = balance.bars.find((b) => b.nutrient === nutrient);
            return bar === undefined ? null : (
              <Explanation key={nutrient} bar={bar} />
            );
          })}

          <section style={{ marginTop: 4 }}>
            <p style={sectionTitle}>
              <span style={{ ...dot, background: NUTRIENT_COLOR.plant }} />
              Végétal
            </p>
            <p style={text}>
              Part des grammes du repas venant d’aliments d’origine végétale.
              <b> Pas de cible</b> : c’est une tendance, pas un objectif. La
              barre montre la valeur du jour, et la moyenne du foyer sur sept
              jours est rappelée sous les barres.
            </p>
          </section>

          <p style={{ ...text, marginTop: 18, color: 'var(--text-muted)' }}>
            Ces repères valent pour une population, avec une activité physique
            moyenne. Quelqu’un de très sportif en dépense davantage. Ils
            indiquent un ordre de grandeur, pas un besoin personnel.
          </p>
        </div>
      </div>
    </div>
  );
}

function Explanation({ bar }: { bar: NutrientBar }): React.ReactElement {
  const label = NUTRIENT_LABELS[bar.nutrient];

  return (
    <section style={{ marginBottom: 16 }}>
      <p style={sectionTitle}>
        <span style={{ ...dot, background: NUTRIENT_COLOR[bar.nutrient] }} />
        {label}
      </p>

      {bar.reference === null ? (
        <p style={text}>
          <b>Repère indisponible</b> pour cet âge. Aucune source consultée ne
          couvre cette tranche, et reprendre celle d’à côté reviendrait à
          inventer un repère.
        </p>
      ) : (
        <>
          <p style={text}>
            {bar.referenceMax === null
              ? `Objectif du jour : ${formatGrams(bar.reference.value)}.`
              : `Objectif du jour : ${formatGrams(bar.reference.value)}, ` +
                `à ne pas dépasser ${formatGrams(bar.referenceMax.value)}.`}
          </p>

          {bar.energyShare !== null && bar.energyShare.min !== null ? (
            <p style={text}>
              L’ANSES publie ce repère comme une part de l’énergie de la
              journée — {bar.energyShare.min} à {bar.energyShare.max ?? '—'} %.
              Il est traduit en grammes pour l’âge et le sexe de la personne.
            </p>
          ) : null}

          {bar.reference.kind === 'AS' ? (
            <p style={text}>
              C’est un <b>apport satisfaisant</b> : un niveau jugé suffisant à
              partir des données disponibles, pas un plafond. Rien à dépasser.
            </p>
          ) : null}

          <ul style={sources}>
            {bar.reference.citations.map((citation) => (
              <li key={citation}>{citation}</li>
            ))}
          </ul>

          {bar.reference.derived ? (
            // Répété par nutriment, et pas ramassé en note de bas de page :
            // les fibres, elles, sont recopiées telles quelles. La distinction
            // doit se lire en face de la valeur concernée.
            <p style={{ ...text, color: 'var(--text-muted)', marginTop: 3, fontSize: 11 }}>
              Valeur calculée à partir de ces sources, pas recopiée d’un tableau.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 50,
  background: 'var(--scrim)',
  display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
};

const sheet: React.CSSProperties = {
  width: '100%', maxWidth: 480, maxHeight: '86vh',
  background: 'var(--surface-2)',
  borderRadius: '16px 16px 0 0',
  display: 'flex', flexDirection: 'column',
  overflow: 'hidden',
};

const header: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '14px 16px',
  background: 'var(--coral)', color: 'var(--on-coral)',
  flexShrink: 0,
};

const body: React.CSSProperties = {
  padding: '16px 18px calc(24px + env(safe-area-inset-bottom))',
  overflowY: 'auto',
};

const sectionTitle: React.CSSProperties = {
  fontSize: 14, marginBottom: 6, display: 'flex', alignItems: 'center',
};

const dot: React.CSSProperties = {
  display: 'inline-block', width: 8, height: 8, borderRadius: '50%', marginRight: 7,
};

const text: React.CSSProperties = {
  fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary)', marginBottom: 4,
};

const legend: React.CSSProperties = {
  ...text, listStyle: 'none', margin: 0, padding: 0,
  display: 'flex', flexDirection: 'column', gap: 12,
};

const legendRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 14,
};

/** Assez large pour que le trait du repère et celui du plafond se séparent. */
const exampleBox: React.CSSProperties = {
  display: 'flex', width: 110, flexShrink: 0,
};

const sources: React.CSSProperties = {
  listStyle: 'none', margin: '8px 0 0', padding: 0,
  display: 'flex', flexDirection: 'column', gap: 3,
  fontSize: 11, lineHeight: 1.45, color: 'var(--text-muted)',
};
