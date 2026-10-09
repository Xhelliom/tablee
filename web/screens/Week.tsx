/**
 * V2 — la vue semaine : 7 jours × membres.
 *
 * Ce qu'elle montre : la régularité de la **saisie** et la tendance de la part
 * végétale. Ce qu'elle ne montre pas, et ne montrera pas : ni série, ni score
 * par personne (§14bis, I5). Un « 12 jours d'affilée » sur la ligne d'un
 * enfant transforme les repas en performance.
 *
 * Une case vide se lit « rien de saisi », jamais « rien mangé » — d'où
 * l'absence de zéro.
 *
 * ⚠️ Changé le 14/09/2026 — des cases de 22 × 26 px, sans valeur, deviennent
 * un petit graphe par personne : colonnes de 24 × 96 px, le trait de la
 * moyenne des jours saisis, la dernière valeur écrite
 * (`docs/proposition-accueil.html`). Toujours rien qui se compte par personne.
 */
import { useEffect, useState } from 'react';
import { api, type Nutrient, type WeekResponse } from '../api.ts';
import { Avatar } from '../components/Avatar.tsx';
import {
  BAR_NUTRIENTS, NUTRIENT_COLOR, NUTRIENT_LABELS, localDate, shortDay,
} from '../design/vocabulary.ts';

/** La hauteur d'un graphe, pour 100 % de part végétale. */
const PLOT = 96;

type Cell = WeekResponse['cells'][number];

export function WeekScreen(): React.ReactElement {
  const [data, setData] = useState<WeekResponse | null>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const from = shiftWeeks(offset);
    void api.get<WeekResponse>(`/api/week?from=${from}&days=7`).then(setData).catch(() => setData(null));
  }, [offset]);

  if (data === null) return <p className="empty">Un instant…</p>;

  const days = Array.from({ length: data.days }, (_, i) => addDays(data.from, i));
  const cell = (date: string, eaterId: string): Cell | undefined =>
    data.cells.find((c) => c.date === date && c.eaterId === eaterId);
  const known = data.cells.filter((c) => c.meals > 0 && c.plantRatio !== null);
  // ponytail: moyenne simple des jours saisis, non pondérée par les grammes —
  // c'est ce que dit la légende. À pondérer si elle s'écarte trop de celle de l'accueil.
  const average = known.length === 0
    ? null
    : Math.round(known.reduce((sum, c) => sum + (c.plantRatio ?? 0), 0) / known.length);
  const today = localDate();

  return (
    <>
      <div className="sec" style={{ paddingTop: 20 }}>
        <p className="eyebrow">La semaine</p>
        <p className="display" style={{ marginTop: 6 }}>{weekLabel(data.from)}</p>
      </div>

      <div className="sec spread" style={{ paddingTop: 14 }}>
        <button type="button" className="chip" style={{ cursor: 'pointer' }}
                onClick={() => setOffset((o) => o - 1)}>
          Semaine précédente
        </button>
        {offset < 0 ? (
          <button type="button" className="chip" style={{ cursor: 'pointer' }}
                  onClick={() => setOffset((o) => o + 1)}>
            Suivante
          </button>
        ) : null}
      </div>

      {data.eaters.length === 0 ? (
        <p className="empty">Personne n’est encore enregistré.</p>
      ) : (
        <section className="sec" style={{
          paddingTop: 22, paddingBottom: 18, display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <p style={{ fontSize: 14 }}>La tablée, jour par jour</p>
          <HouseholdWeek days={days} nutrients={data.nutrients} today={today} />
          <p style={{ fontSize: 14, marginTop: 8 }}>Part végétale, jour par jour</p>
          <Legend average={average} />
          {data.eaters.map((eater) => (
            <PlantWeek
              key={eater.id}
              eaterId={eater.id}
              firstName={eater.firstName}
              days={days}
              today={today}
              average={average}
              cells={days.map((date) => cell(date, eater.id))}
            />
          ))}
        </section>
      )}
      {data.frequencies.length > 0 ? <Frequencies items={data.frequencies} /> : null}
      <div className="fab-space" />
    </>
  );
}

/**
 * Les repères en aliments et en fréquences de Santé publique France. Ce sont
 * des repères **adultes**, lus pour le foyer : aucun plafond ne descend sur la
 * fiche d'un convive, et le texte du document est cité sous chaque ligne.
 */
function Frequencies({ items }: { items: WeekResponse['frequencies'] }): React.ReactElement {
  return (
    <section className="sec" style={{ paddingBottom: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ fontSize: 14 }}>Les repères de la semaine</p>
      <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
        Repères de Santé publique France pour les adultes, comptés pour le foyer.
      </p>
      {items.map((item) => {
        const limit = item.kind === 'max_grams';
        const current = item.current === null
          ? 'rien de saisi'
          : `${item.partial ? 'au moins ' : ''}${item.current}\u00a0${item.unit}`;
        return (
          <div key={item.code} className="card" style={{ padding: '12px 15px' }}>
            <p style={{ fontSize: 14 }}>{item.label}</p>
            <p style={{ fontSize: 13, marginTop: 2 }}>
              {`${current} · repère\u00a0: ${limit ? 'au plus' : 'au moins'} ${item.target}\u00a0${item.unit}`}
            </p>
            <p style={{ fontSize: 11, marginTop: 4, color: 'var(--text-secondary)' }}>
              {`« ${item.citation} » — ${item.source}`}
            </p>
          </div>
        );
      })}
    </section>
  );
}

/** Les quatre jauges de la colonne foyer : tout sauf l'énergie (I5). */
const SEGMENTS = BAR_NUTRIENTS.filter((n): n is Exclude<Nutrient, 'kcal'> => n !== 'kcal');

/**
 * Les quatre barres en moyenne du foyer, empilées par jour (10/2026), dans
 * l'ordre du bilan, protéines en haut. Chaque segment remplit son quart de
 * colonne selon son % du repère, plafonné à 100 : ce sont quatre jauges
 * indépendantes, pas un total qui se lirait « 240 % de quelque chose ».
 *
 * Rien par personne ici, et aucun chiffre sur les segments : les graphes par
 * convive restent végétaux (§14bis), et la forme suffit à voir ce qui manque.
 * Le détail chiffré vit dans le bilan du jour, pas dans une tendance.
 */
function HouseholdWeek({
  days, nutrients, today,
}: {
  days: string[];
  nutrients: WeekResponse['nutrients'];
  today: string;
}): React.ReactElement {
  const columns = `repeat(${days.length}, minmax(0, 1fr))`;
  const byDate = new Map(nutrients.map((n) => [n.date, n]));

  return (
    <div className="card" style={{ padding: '14px 15px' }}>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '6px 14px',
        fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10,
      }}>
        {SEGMENTS.map((nutrient) => (
          <span key={nutrient} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: NUTRIENT_COLOR[nutrient] }} />
            {NUTRIENT_LABELS[nutrient]}
          </span>
        ))}
      </div>
      <div style={{
        position: 'relative', height: PLOT, borderBottom: '1px solid var(--border)',
        display: 'grid', gridTemplateColumns: columns,
      }}>
        {days.map((date) => {
          const day = byDate.get(date);
          return (
            <div key={date} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'flex-end', gap: 2, paddingBottom: 1,
            }}
              role="img"
              aria-label={ariaJour(date, day)}
            >
              {day === undefined || day.eaters === 0 ? (
                <span style={{ width: 24, height: 20, borderRadius: 4, border: '.5px dashed var(--border-strong)' }} />
              ) : (
                SEGMENTS.map((nutrient) => {
                  const percent = day.means[nutrient];
                  if (percent === null) return <span key={nutrient} style={{ width: 24, height: SEG }} />;
                  return (
                    <span key={nutrient} style={{
                      width: 24, height: Math.max(3, Math.min(100, percent) / 100 * SEG),
                      borderRadius: 3, background: NUTRIENT_COLOR[nutrient],
                    }} />
                  );
                })
              )}
            </div>
          );
        })}
      </div>
      <DayLabels days={days} today={today} columns={columns} />
    </div>
  );
}

/** La hauteur d'un segment : quatre jauges et leurs intervalles tiennent dans le graphe. */
const SEG = 22;

/** Ce que la colonne raconte, pour qui ne la voit pas — et au survol, en bonus. */
function ariaJour(date: string, day: WeekResponse['nutrients'][number] | undefined): string {
  if (day === undefined || day.eaters === 0) return `${shortDay(date)} : rien de saisi`;
  const parts = SEGMENTS.map((nutrient) => {
    const percent = day.means[nutrient];
    return `${NUTRIENT_LABELS[nutrient]} ${percent === null ? 'non renseigné' : `${percent} % du repère`}`;
  });
  return `${shortDay(date)} : ${parts.join(', ')}`;
}

function DayLabels({ days, today, columns }: {
  days: string[]; today: string; columns: string;
}): React.ReactElement {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: columns, marginTop: 6,
      fontSize: 11, textAlign: 'center', color: 'var(--text-muted)',
    }}>
      {days.map((date) => (
        <span key={date} {...(date === today ? { style: { color: 'var(--text-primary)', fontWeight: 500 } } : {})}>
          {shortDay(date).slice(0, 2)}
        </span>
      ))}
    </div>
  );
}

function PlantWeek({
  eaterId, firstName, days, today, average, cells,
}: {
  eaterId: string;
  firstName: string;
  days: string[];
  today: string;
  average: number | null;
  cells: (Cell | undefined)[];
}): React.ReactElement {
  // Une seule valeur écrite, la dernière connue : un nombre sur chaque
  // colonne ne se lit plus.
  const lastKnown = cells.reduce(
    (found, c, i) => (c !== undefined && c.meals > 0 && c.plantRatio !== null ? i : found),
    -1,
  );
  const columns = `repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="card" style={{ padding: '14px 15px' }}>
      <p style={{ fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Avatar seed={eaterId} size={24} />
        {firstName}
      </p>
      <div style={{ position: 'relative', marginTop: 10, height: PLOT, borderBottom: '1px solid var(--border)' }}>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: columns }}>
          {cells.map((c, i) => (
            <div key={days[i]} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 3,
            }}>
              {i === lastKnown && c !== undefined && c.plantRatio !== null ? (
                // Détachée du trait de la moyenne quand elle tombe dessus.
                <span style={{
                  position: 'relative', zIndex: 1, padding: '0 3px', borderRadius: 3,
                  background: 'var(--surface-2)', fontSize: 11, color: 'var(--text-secondary)',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {`${Math.round(c.plantRatio)}\u00a0%`}
                </span>
              ) : null}
              <DayMark meals={c?.meals ?? 0} plantRatio={c?.plantRatio ?? null} />
            </div>
          ))}
        </div>
        {average !== null ? (
          <span style={{
            position: 'absolute', left: 0, right: 0, bottom: (average / 100) * PLOT, height: 1,
            background: 'var(--text-secondary)',
          }} />
        ) : null}
      </div>
      <DayLabels days={days} today={today} columns={columns} />
    </div>
  );
}

function DayMark({ meals, plantRatio }: { meals: number; plantRatio: number | null }): React.ReactElement {
  if (meals === 0) {
    return <span style={{ width: 24, height: 20, borderRadius: 4, border: '.5px dashed var(--border-strong)' }} />;
  }
  if (plantRatio === null) {
    return <span title={`${meals} repas`} style={{ width: 24, height: 3, background: 'var(--border-strong)' }} />;
  }
  return (
    <span
      title={`${meals} repas · ${Math.round(plantRatio)} % végétal`}
      style={{
        width: 24, height: Math.max(3, (plantRatio / 100) * PLOT),
        borderRadius: '4px 4px 0 0', background: NUTRIENT_COLOR.plant,
      }}
    />
  );
}

function Legend({ average }: { average: number | null }): React.ReactElement {
  const item: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: 11, color: 'var(--text-secondary)' }}>
      <span style={item}>
        <span style={{ width: 10, height: 10, borderRadius: 2, background: NUTRIENT_COLOR.plant }} />
        Part végétale de l’assiette
      </span>
      {average !== null ? (
        <span style={item}>
          <span style={{ width: 14, height: 1, background: 'var(--text-secondary)' }} />
          {`Moyenne des jours saisis, ${average}\u00a0%`}
        </span>
      ) : null}
      <span style={item}>
        <span style={{ width: 10, height: 10, borderRadius: 2, border: '.5px dashed var(--border-strong)' }} />
        Rien de saisi
      </span>
    </div>
  );
}

function addDays(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** Lundi de la semaine courante, décalé de `weeks`. */
function shiftWeeks(weeks: number): string {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + weeks * 7);
  return localDate(monday);
}

function weekLabel(from: string): string {
  const end = addDays(from, 6);
  const format = (date: string, withMonth: boolean): string =>
    new Intl.DateTimeFormat('fr-FR', withMonth ? { day: 'numeric', month: 'long' } : { day: 'numeric' })
      .format(new Date(`${date}T12:00:00`));
  return `Du ${format(from, false)}\nau ${format(end, true)}`;
}
