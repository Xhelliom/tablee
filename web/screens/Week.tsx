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
import { Fragment, useEffect, useState } from 'react';
import { api, type Nutrient, type WeekResponse } from '../api.ts';
import { Avatar } from '../components/Avatar.tsx';
import {
  BAR_NUTRIENTS, NUTRIENT_COLOR, NUTRIENT_LABELS, familyLabel, localDate, shortDay,
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
          <Diversity data={data.diversity} days={days} />
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
      <div className="fab-space" />
    </>
  );
}

/**
 * La variété du foyer (10/2026) : un titre-compte, une rangée-résumé (combien
 * de catégories d'aliments différentes chaque jour — la « diversité »), puis, à la
 * demande, la grille catégorie × jour. L'intensité d'un point de la grille est le nombre d'aliments
 * **différents** de la catégorie ce jour-là — plus foncé = plus varié, jamais
 * « plus mangé » : cinq fois le même pain valent un aliment. Pas de cible, pas
 * de pourcentage, pas de ligne par convive (I5) ; un jour vide n'est pas un
 * manque, c'est un point à peine tracé. Teinte : le terracotta de la marque,
 * en dégradé d'opacité ; il ne bascule pas la nuit (voir tokens.css). Toucher une catégorie déplie ses aliments.
 */
const OPACITY = [0, .35, .65, 1];
// ponytail: seuils de la rangée-résumé (1, 2-3, 4 et plus) choisis à l'œil, sans
// source : ils ne disent rien d'un « bien » ou d'un « trop ». À revoir si la
// légende prête à confusion.
const familyLevel = (n: number): number => (n >= 4 ? 3 : n >= 2 ? 2 : n);

function Dot({ level, label }: { level: number; label: string }): React.ReactElement {
  return (
    <span role="img" aria-label={label} style={{ display: 'flex', justifyContent: 'center' }}>
      <span style={level > 0
        ? { width: 12, height: 12, borderRadius: 6, background: 'var(--coral)', opacity: OPACITY[level] ?? 1 }
        : { width: 3, height: 3, borderRadius: 2, background: 'var(--border-strong)', opacity: .5 }} />
    </span>
  );
}

function Diversity({ data, days }: {
  data: WeekResponse['diversity'];
  days: string[];
}): React.ReactElement {
  const [detail, setDetail] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const { foods, families, mealsWithoutFood } = data.household;
  const columns = `108px repeat(${days.length}, minmax(0, 1fr))`;
  const grid = { display: 'grid', gridTemplateColumns: columns, alignItems: 'center' } as const;
  const muted = { fontSize: 11, color: 'var(--text-muted)' } as const;
  const perDay = days.map((date) => data.families.filter((f) => f.days.some((d) => d.date === date)).length);
  const key = (text: string, n: number): React.ReactElement => (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4, marginRight: 8 }}>
      <Dot level={n} label="" />{text}
    </span>
  );
  return (
    <div className="card" style={{ padding: '14px 15px' }}>
      <p style={{ fontSize: 15 }}>
        {`${foods} aliment${foods > 1 ? 's' : ''} différent${foods > 1 ? 's' : ''}, ` +
          `${families} catégorie${families > 1 ? 's' : ''}`}
      </p>
      {mealsWithoutFood > 0 ? (
        <p style={{ ...muted, marginTop: 2 }}>
          {`${mealsWithoutFood} repas sans aliment rattaché, non compté${mealsWithoutFood > 1 ? 's' : ''}`}
        </p>
      ) : null}
      {data.families.length > 0 ? (
        <>
          <div style={{ ...grid, marginTop: 14 }}>
            <span />
            {days.map((date) => (
              <span key={date} style={{ ...muted, textAlign: 'center' }}>{shortDay(date).slice(0, 2)}</span>
            ))}
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '10px 0' }}>Diversité</span>
            {days.map((date, i) => (
              <Dot key={date} level={familyLevel(perDay[i] ?? 0)}
                label={`${shortDay(date)} : ${perDay[i]} catégorie${(perDay[i] ?? 0) > 1 ? 's' : ''}`} />
            ))}
          </div>
          <div style={{ ...muted, display: 'flex', marginTop: 4 }}>
            {key('1 catégorie', 1)}{key('2 à 3', 2)}{key('4 et plus', 3)}
          </div>
          <button type="button" aria-expanded={detail} onClick={() => setDetail(!detail)}
            style={{
              all: 'unset', cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)',
              textDecoration: 'underline', textUnderlineOffset: 3, display: 'block', marginTop: 12,
            }}>
            {detail ? 'Masquer le détail' : 'Détail par catégorie'}
          </button>
          {detail ? (
            <>
              <div style={{ ...grid, marginTop: 8 }}>
                {data.families.map(({ family, days: present }) => {
                  const expanded = open === family;
                  return (
                    <Fragment key={family}>
                      <button type="button" aria-expanded={expanded}
                        onClick={() => setOpen(expanded ? null : family)}
                        style={{
                          all: 'unset', cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)',
                          padding: '9px 0',
                          ...(expanded ? { textDecoration: 'underline', textUnderlineOffset: 3 } : {}),
                        }}>
                        {familyLabel(family)}
                      </button>
                      {days.map((date) => {
                        const n = present.find((d) => d.date === date)?.foods.length ?? 0;
                        return (
                          <Dot key={date} level={Math.min(n, 3)}
                            label={`${familyLabel(family)}, ${shortDay(date)} : ${n} aliment${n > 1 ? 's' : ''}`} />
                        );
                      })}
                      {expanded ? (
                        <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--text-secondary)', paddingBottom: 6 }}>
                          {present.map(({ date, foods: names }) => (
                            <p key={date} style={{ marginTop: 2 }}>
                              <span style={{ color: 'var(--text-muted)' }}>{shortDay(date)} </span>
                              {names.join(', ')}
                            </p>
                          ))}
                        </div>
                      ) : null}
                    </Fragment>
                  );
                })}
              </div>
              <div style={{ ...muted, display: 'flex', marginTop: 8 }}>
                {key('1 aliment', 1)}{key('2 aliments', 2)}{key('3 et plus', 3)}
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </div>
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
