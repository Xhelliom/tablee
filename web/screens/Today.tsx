/**
 * L'accueil — itération « journal » des maquettes, pas « tableau de bord ».
 *
 * Ordre d'apparition, et il compte : la date et ce qui s'est passé, la bande
 * de saison, les anneaux, puis les repas. Le chiffre n'ouvre pas l'écran.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type DashboardResponse } from '../api.ts';
import { navigate } from '../router.tsx';
import { MealCard } from '../components/MealCard.tsx';
import { NutrientBars } from '../components/NutrientBars.tsx';
import { NutrientRing } from '../components/NutrientRing.tsx';
import { SeasonStrip } from '../components/SeasonStrip.tsx';
import { IconPlus } from '../icons.tsx';
import {
  BAR_NUTRIENTS, NUTRIENT_COLOR, NUTRIENT_LABELS, SLOT_ORDER, longDate,
} from '../design/vocabulary.ts';
import { formatGrams, formatPercent } from '../design/quantities.ts';

export function TodayScreen(): React.ReactElement {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Anneau ouvert : les cinq barres en % de la personne (§13). */
  const [openMember, setOpenMember] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<DashboardResponse>('/api/dashboard'));
    } catch {
      setError('impossible de charger la journée');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error !== null) return <p className="empty">{error}</p>;
  if (data === null) return <p className="empty">Un instant…</p>;

  const meals = [...data.meals].sort(
    (a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot),
  );
  const [hero, ...rest] = meals;
  const open = data.dashboard.find((entry) => entry.member.id === openMember) ?? null;

  return (
    <>
      <div className="sec" style={{ paddingTop: 20 }}>
        <p className="eyebrow">{longDate(data.date)}</p>
        <p className="display" style={{ marginTop: 6 }}>{headline(meals.length)}</p>
      </div>

      <SeasonStrip produce={data.seasonal} month={data.month} />

      <div className="sec" style={{ padding: '18px 18px 16px', display: 'flex', gap: 13, flexWrap: 'wrap' }}>
        {data.dashboard.map(({ member, balance }) => (
          <button
            key={member.id}
            type="button"
            onClick={() => setOpenMember((current) => (current === member.id ? null : member.id))}
            aria-expanded={openMember === member.id}
            aria-label={`Détail du bilan de ${member.firstName}`}
            style={{
              background: 'none', border: 0, padding: 0, textAlign: 'center', cursor: 'pointer',
              opacity: openMember === null || openMember === member.id ? 1 : .45,
            }}
          >
            <NutrientRing balance={balance} firstName={member.firstName} />
            <p style={{ marginTop: 3, fontSize: 11, color: 'var(--text-secondary)' }}>
              {member.firstName}
            </p>
          </button>
        ))}
        {data.dashboard.length === 0 ? (
          <button type="button" className="btn btn--ghost" onClick={() => navigate('/membres')}>
            Ajouter qui vit ici
          </button>
        ) : null}
      </div>

      {/* §13 — « les 5 barres en % » par personne. L'anneau les résume, le
          détail les déplie : un tap, sans quitter l'accueil. */}
      {open !== null ? (
        <section className="sec" style={{ paddingBottom: 16 }}>
          <div className="card" style={{ padding: '14px 15px' }}>
            <div className="spread" style={{ alignItems: 'flex-start' }}>
              <div>
                <p style={{ fontSize: 15 }}>{open.member.firstName}</p>
                <p className="meta" style={{ marginTop: 2 }}>
                  {open.balance.mealCount === 0
                    ? 'Aucun repas enregistré aujourd’hui'
                    : `${open.balance.mealCount} repas aujourd’hui`}
                </p>
              </div>
              <NutrientBars balance={open.balance} />
            </div>
            {standings(open.balance).length > 0 ? (
              <ul style={{
                listStyle: 'none', padding: 0, margin: '12px 0 0',
                display: 'flex', flexDirection: 'column', gap: 3,
                fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5,
              }}>
                {standings(open.balance).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
            {open.balance.bars.some((b) => b.state === 'encadre' || b.state === 'partiel') ? (
              <p className="meta" style={{ marginTop: 8, lineHeight: 1.5 }}>
                {uncertaintySentence(open.balance)}
              </p>
            ) : null}
            <p className="meta" style={{ marginTop: 8, lineHeight: 1.5 }}>
              {plantSentence(open.balance)}
            </p>
          </div>
        </section>
      ) : null}

      <Legend />

      {/* §9 — tant que `nutrient_reference` est vide, aucun pourcentage n'est
          calculable. Le dire franchement vaut mieux que des anneaux creux que
          l'on prendrait pour un bug. */}
      {!data.referencesLoaded && data.dashboard.length > 0 ? (
        <div className="sec" style={{ paddingBottom: 14 }}>
          <p style={{
            fontSize: 12, lineHeight: 1.5, padding: '10px 12px', borderRadius: 'var(--radius)',
            background: 'var(--bg-warning)', color: 'var(--text-warning)',
          }}>
            Les repères nutritionnels ne sont pas chargés : les anneaux ne
            montrent que la part végétale. Lancer <code>npm run seed:refs</code>,
            ou compléter <code>db/seeds/</code>.
          </p>
        </div>
      ) : null}

      <div className="sec stack" style={{ paddingBottom: 18 }}>
        {hero !== undefined ? (
          <MealCard meal={hero} hero seasonalCount={hero.seasonalCount}
                    onOpen={(id) => navigate(`/repas/${id}`)} />
        ) : null}
        {rest.map((meal) => (
          <MealCard key={meal.id} meal={meal} seasonalCount={meal.seasonalCount}
                    onOpen={(id) => navigate(`/repas/${id}`)} />
        ))}

        <button
          type="button"
          className="row"
          onClick={() => navigate('/ajouter')}
          style={{ border: '.5px solid rgba(216,90,48,.3)', borderRadius: 12 }}
        >
          <span className="thumb" style={{ background: 'var(--coral)', color: '#fff' }}>
            <IconPlus size={20} />
          </span>
          <span>
            <span style={{ fontSize: 14, display: 'block' }}>{addLabel(meals.length)}</span>
            <span className="meta">Ou partage depuis Jow</span>
          </span>
        </button>
      </div>
      <div className="fab-space" />
    </>
  );
}

/** Le sur-titre parle de ce qui s'est passé, pas d'un score. */
function headline(count: number): string {
  if (count === 0) return 'Rien\nà table';
  if (count === 1) return 'Un repas\nà table';
  return `${count} repas\nà table`;
}

function addLabel(count: number): string {
  return count === 0 ? 'Enregistrer un repas' : 'Ajouter un repas';
}

/**
 * Ce qui manque et ce qui est dépassé, en une ligne par nutriment concerné.
 *
 * C'est le but de l'écran : savoir où on en est sans lire un tableau. Le ton
 * reste un constat, jamais un reproche (R7) — « il manque » et non « tu n'as
 * pas assez », « au-delà du repère » et non « trop ».
 */
function standings(balance: DashboardResponse['dashboard'][number]['balance']): string[] {
  const lines: string[] = [];

  for (const bar of balance.bars) {
    if (bar.standing === null) continue;
    const label = NUTRIENT_LABELS[bar.nutrient].toLowerCase();

    if (bar.standing === 'au_dela' && bar.excess !== null) {
      lines.push(`${label} : ${formatGrams(bar.excess)} au-delà du repère`);
      continue;
    }
    if (bar.standing === 'sous' && bar.remaining !== null && bar.remaining > 0) {
      // Une valeur seulement encadrée par le bas se dit au conditionnel : on
      // ne réclame pas ce qui a peut-être déjà été mangé.
      const nuance = bar.state === 'partiel' ? ' au plus' : '';
      lines.push(`${label} : il manque ${formatGrams(bar.remaining)}${nuance}`);
    }
  }
  return lines;
}

/**
 * Dit pourquoi certaines barres sont hachurées ou dégradées, plutôt que de
 * laisser deviner. Une incertitude qu'on n'explique pas se lit comme un bug.
 */
function uncertaintySentence(balance: DashboardResponse['dashboard'][number]['balance']): string {
  const encadre = balance.bars.filter((b) => b.state === 'encadre');
  const partiel = balance.bars.filter((b) => b.state === 'partiel');
  const parts: string[] = [];
  if (encadre.length > 0) {
    parts.push(
      `${encadre.map((b) => NUTRIENT_LABELS[b.nutrient].toLowerCase()).join(', ')} : ` +
        'la source ne donne qu’un intervalle',
    );
  }
  if (partiel.length > 0) {
    parts.push(
      `${partiel.map((b) => NUTRIENT_LABELS[b.nutrient].toLowerCase()).join(', ')} : ` +
        'au moins ce qui est affiché, un aliment n’est pas rattaché',
    );
  }
  return parts.join(' · ');
}

/**
 * §8 — la barre Végétal se lit en tendance, pas en objectif : la valeur du
 * jour et la moyenne du foyer sur sept jours. Aucune cible chiffrée (R7, I5).
 */
function plantSentence(balance: { plant: { percent: number | null; householdAverage7d: number | null } }): string {
  const { percent, householdAverage7d } = balance.plant;
  if (percent === null) {
    return 'Part végétale indisponible : les aliments du jour ne sont pas rattachés au référentiel.';
  }
  if (householdAverage7d === null) {
    return `Part végétale du jour : ${formatPercent(percent)}.`;
  }
  return (
    `Part végétale du jour : ${formatPercent(percent)} — ` +
    `moyenne du foyer sur 7 jours : ${formatPercent(householdAverage7d)}.`
  );
}

function Legend(): React.ReactElement {
  return (
    <div className="sec" style={{
      display: 'flex', flexWrap: 'wrap', gap: '5px 12px',
      fontSize: 11, color: 'var(--text-secondary)', paddingBottom: 14,
    }}>
      {[...BAR_NUTRIENTS.map((n) => ({ label: NUTRIENT_LABELS[n], color: NUTRIENT_COLOR[n] })),
        { label: 'Végétal', color: NUTRIENT_COLOR.plant }].map((entry) => (
        <span key={entry.label}>
          <span style={{
            display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
            marginRight: 5, background: entry.color,
          }} />
          {entry.label}
        </span>
      ))}
    </div>
  );
}
