/**
 * L'accueil — itération « journal » des maquettes, pas « tableau de bord ».
 *
 * Ordre d'apparition, et il compte : la date et ce qui s'est passé, la bande
 * de saison, le bilan, puis les repas et ce qui attend au frigo. Le chiffre
 * n'ouvre pas l'écran.
 * L'assistant de recettes vient en dernier : on le demande, il ne s'impose pas.
 *
 * ⚠️ Changé le 14/09/2026 — le bilan était un rang d'anneaux qu'on dépliait
 * d'un tap, en colonnes de 17 px. Il est ouvert d'office, en barres
 * horizontales, et les anneaux servent à choisir la personne
 * (`docs/proposition-accueil.html`). Ce n'est pas le retour du tableau de bord
 * écarté des maquettes : pas de grille uniforme, pas de score, et le titre dit
 * toujours ce qui s'est passé.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ApiError, api, type AssistantRecipesResponse, type DashboardResponse, type Meal, type Nutrient,
} from '../api.ts';
import { navigate } from '../router.tsx';
import { useSession } from '../session.tsx';
import { Avatar } from '../components/Avatar.tsx';
import { BilanCard, TONE_COLOR, TONE_ICON } from '../components/Bilan.tsx';
import { ConfidenceBadge } from '../components/Confidence.tsx';
import { LeftoverRow } from '../components/Leftovers.tsx';
import { MealCard } from '../components/MealCard.tsx';
import { NutrientRing } from '../components/NutrientRing.tsx';
import { SeasonStrip } from '../components/SeasonStrip.tsx';
import { IconBowl, IconPlus } from '../icons.tsx';
import { BAR_NUTRIENTS, NUTRIENT_LABELS, SLOT_ORDER, longDate } from '../design/vocabulary.ts';

type Entry = DashboardResponse['dashboard'][number];

export function TodayScreen(): React.ReactElement {
  const { eaters } = useSession();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** La personne choisie. `null` : sa propre assiette, sinon la première. */
  const [chosen, setChosen] = useState<string | null>(null);
  const [fridge, setFridge] = useState<Meal[]>([]);

  const load = useCallback(async () => {
    // À côté de la journée, pas avant elle : un frigo illisible ne doit pas
    // faire tomber l'accueil.
    void api.get<{ meals: Meal[] }>('/api/meals/leftovers?days=3')
      .then(({ meals }) => setFridge(meals))
      .catch(() => setFridge([]));
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
  const shown = data.dashboard.find((entry) => entry.eater.id === chosen)
    ?? data.dashboard.find((entry) => eaters.some((e) => e.id === entry.eater.id && e.isMe))
    ?? data.dashboard[0]
    ?? null;

  return (
    <>
      <div className="sec" style={{ paddingTop: 20 }}>
        <p className="eyebrow">{longDate(data.date)}</p>
        <p className="display" style={{ marginTop: 6 }}>{headline(meals.length)}</p>
      </div>

      <SeasonStrip produce={data.seasonal} month={data.month} />

      {shown === null ? (
        <div className="sec" style={{ padding: '18px 18px 16px' }}>
          <button type="button" className="btn btn--ghost" onClick={() => navigate('/membres')}>
            Ajouter qui vit ici
          </button>
        </div>
      ) : (
        <section className="sec" style={{
          paddingTop: 22, paddingBottom: 18, display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <p style={{ fontSize: 14 }}>Où en est la tablée</p>
          <HouseholdLines dashboard={data.dashboard} />
          {data.dashboard.length > 1 ? (
            <PersonTabs dashboard={data.dashboard} shownId={shown.eater.id} onChoose={setChosen} />
          ) : null}
          <BilanCard
            eaterId={shown.eater.id}
            firstName={shown.eater.firstName}
            balance={shown.balance}
            referencesLoaded={data.referencesLoaded}
          />
        </section>
      )}

      {/* §9 — tant que `nutrient_reference` est vide, aucun pourcentage n'est
          calculable. Le dire franchement vaut mieux que des barres creuses que
          l'on prendrait pour un bug. */}
      {!data.referencesLoaded && data.dashboard.length > 0 ? (
        <div className="sec" style={{ paddingBottom: 14 }}>
          <p style={{
            fontSize: 12, lineHeight: 1.5, padding: '10px 12px', borderRadius: 'var(--radius)',
            background: 'var(--bg-warning)', color: 'var(--text-warning)',
          }}>
            Les repères nutritionnels ne sont pas chargés : le bilan ne montre
            que la part végétale. Lancer <code>npm run seed:refs</code>, ou
            compléter <code>db/seeds/</code>.
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

        {fridge.length > 0 ? (
          <>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>Dans le frigo</p>
            {fridge.map((meal) => <LeftoverRow key={meal.id} meal={meal} />)}
          </>
        ) : null}

        <button
          type="button"
          className="row"
          onClick={() => navigate('/ajouter')}
          style={{ border: '.5px solid var(--coral-line)', borderRadius: 12 }}
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

      <AssistantRecipes />
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

interface Tally {
  nutrient: Nutrient;
  /** Les assiettes qui ont un repère pour ce nutriment. */
  covered: number;
  todo: number;
  ok: number;
}

/**
 * Au plus deux phrases pour toute la tablée : l'écart le plus partagé, et ce
 * que tout le monde a atteint.
 *
 * Elles comptent des assiettes et ne nomment personne. « 3 repères sur 4 » sous
 * un prénom serait un score (§14bis) ; « fibres à compléter pour 3 assiettes
 * sur 4 » dit ce qui manque sur la table. Rien avant le premier repas du jour :
 * à 7 h, tout est à compléter, et le dire n'apprend rien.
 */
function HouseholdLines({ dashboard }: { dashboard: Entry[] }): React.ReactElement | null {
  if (!dashboard.some((entry) => entry.balance.mealCount > 0)) return null;

  const tallies = BAR_NUTRIENTS.map((nutrient): Tally => {
    const tally: Tally = { nutrient, covered: 0, todo: 0, ok: 0 };
    for (const { balance } of dashboard) {
      const bar = balance.bars.find((b) => b.nutrient === nutrient);
      if (bar === undefined || bar.standing === null) continue;
      tally.covered += 1;
      if (bar.standing === 'sous' && bar.remaining !== null && bar.remaining > 0) tally.todo += 1;
      if (bar.standing === 'dans') tally.ok += 1;
    }
    return tally;
  });
  const gap = tallies.reduce<Tally | null>(
    (best, t) => (t.todo > 0 && (best === null || t.todo > best.todo) ? t : best),
    null,
  );
  const reached = tallies.find((t) => t.covered > 0 && t.ok === t.covered) ?? null;
  if (gap === null && reached === null) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {gap !== null ? (
        <HouseholdLine tone="todo" nutrient={gap.nutrient} words="à compléter" suffix={whom(gap.todo, gap.covered)} />
      ) : null}
      {reached !== null ? (
        <HouseholdLine tone="ok" nutrient={reached.nutrient} words="dans le repère" suffix={whom(reached.ok, reached.covered)} />
      ) : null}
    </div>
  );
}

function whom(count: number, covered: number): string {
  if (covered === 1) return '';
  if (count === covered) return ' pour toute la tablée';
  return ` pour ${count} assiette${count > 1 ? 's' : ''} sur ${covered}`;
}

function HouseholdLine({
  tone, nutrient, words, suffix,
}: { tone: 'todo' | 'ok'; nutrient: Nutrient; words: string; suffix: string }): React.ReactElement {
  const Icon = TONE_ICON[tone];
  return (
    <p style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 14, lineHeight: 1.4 }}>
      <Icon size={16} strokeWidth={2} style={{ color: TONE_COLOR[tone], flexShrink: 0, marginTop: 1 }} />
      <span>
        <span style={{ fontWeight: 500 }}>{NUTRIENT_LABELS[nutrient]}</span>{' '}
        <span style={{ fontWeight: 500, color: TONE_COLOR[tone] }}>{words}</span>
        {suffix}
      </span>
    </p>
  );
}

/**
 * Les anneaux, devenus le choix de la personne. Ils résument toujours les cinq
 * valeurs d'un coup d'œil ; le détail est dessous, et plus derrière un tap.
 */
function PersonTabs({
  dashboard, shownId, onChoose,
}: { dashboard: Entry[]; shownId: string; onChoose: (id: string) => void }): React.ReactElement {
  return (
    <div style={{ display: 'flex', overflowX: 'auto', marginTop: 4, borderBottom: '.5px solid var(--border)' }}>
      {dashboard.map(({ eater, balance }) => {
        const active = eater.id === shownId;
        return (
          <button
            key={eater.id}
            type="button"
            aria-pressed={active}
            aria-label={`Bilan de ${eater.firstName}`}
            onClick={() => onChoose(eater.id)}
            style={{
              flex: '1 0 76px', background: 'none', border: 0, padding: '6px 0 9px', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              boxShadow: active ? 'inset 0 -2px 0 var(--coral)' : 'none',
            }}
          >
            {/* Seul l'anneau pâlit : le prénom doit rester lisible. */}
            <span style={{ display: 'flex', opacity: active ? 1 : .55 }}>
              <NutrientRing balance={balance} firstName={eater.firstName} size={40} />
            </span>
            {/* Le dessin à côté du prénom, pas au centre de l'anneau : ses
                plantes vertes s'y liraient comme une donnée (§8ter). */}
            <span style={{
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 12, fontWeight: active ? 500 : 400,
              color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}>
              <Avatar seed={eater.id} size={16} />
              {eater.firstName}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * « Demander à l'assistant des recettes » : des plats qui rapprochent la
 * semaine des repères, sur demande et jamais d'office (I4).
 *
 * Les recettes affichées viennent de la base — le titre, la photo, la
 * confiance de Jow ; du modèle ne reviennent qu'un choix et une phrase. Les
 * idées, elles, viennent du modèle seul : aucune valeur, et un badge qui le
 * dit (R6). Le texte envoyé se relit sous la liste : ce qui sort du foyer doit
 * pouvoir se vérifier (R5).
 *
 * Absent sans clé API côté serveur, comme l'onglet « Conseils » : pas de bouton
 * qui mènerait à un refus.
 */
function AssistantRecipes(): React.ReactElement | null {
  const { ia } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<AssistantRecipesResponse | null>(null);

  if (!ia) return null;

  const ask = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setResponse(await api.post<AssistantRecipesResponse>('/api/assistant/recipes'));
    } catch (caught) {
      setResponse(null);
      setError(caught instanceof ApiError ? caught.message : 'l’assistant n’a pas pu être joint');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sec" style={{ paddingBottom: 18 }}>
      <button type="button" className="btn btn--ghost" disabled={busy}
              onClick={() => { void ask(); }}>
        {busy ? 'L’assistant cherche…' : 'Demander à l’assistant des recettes'}
      </button>
      {error !== null ? (
        <p className="meta" style={{ marginTop: 8, lineHeight: 1.5 }}>{error}</p>
      ) : null}

      {response !== null ? (
        <div className="stack" style={{ marginTop: 12 }}>
          {response.proposals.length === 0 && response.ideas.length === 0 ? (
            <p className="meta">L’assistant n’a retenu aucune recette cette fois.</p>
          ) : null}
          {response.proposals.map(({ recipe, reason }) => (
            <div key={recipe.id} className="card row" style={{ cursor: 'default' }}>
              {recipe.imageUrl !== null ? (
                <img src={recipe.imageUrl} alt="" className="thumb" />
              ) : (
                <span className="thumb"><IconBowl size={20} /></span>
              )}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 500, display: 'block', lineHeight: 1.3 }}>
                  {recipe.url !== null ? (
                    <a href={recipe.url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
                      {recipe.title}
                    </a>
                  ) : recipe.title}
                </span>
                {reason !== null ? (
                  <span className="meta" style={{ display: 'block', marginTop: 3, lineHeight: 1.5 }}>
                    {reason}
                  </span>
                ) : null}
                {recipe.confidence !== 'haute' ? (
                  <ConfidenceBadge confidence={recipe.confidence} />
                ) : null}
              </span>
            </div>
          ))}
          {response.ideas.length > 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              Idées hors de vos recettes
            </p>
          ) : null}
          {response.ideas.map((idea) => (
            <div key={idea.title} className="card row" style={{ cursor: 'default' }}>
              <span className="thumb"><IconBowl size={20} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 500, display: 'block', lineHeight: 1.3 }}>
                  {idea.title}
                </span>
                <span className="meta" style={{ display: 'block', margin: '3px 0 6px', lineHeight: 1.5 }}>
                  {idea.reason}
                </span>
                {/* R6 : aucune valeur ne vient avec une idée, et ça se voit. */}
                <ConfidenceBadge confidence="basse" label="Idée de l’assistant — à vérifier" />
              </span>
            </div>
          ))}
          {response.proposals.length > 0 || response.ideas.length > 0 ? (
            <p className="meta" style={{ lineHeight: 1.5 }}>
              L’assistant ne connaît ni les prénoms ni les allergies du foyer :
              vérifiez ce qu’il propose.
            </p>
          ) : null}
          <details className="meta">
            <summary style={{ cursor: 'pointer' }}>Ce que l’assistant a reçu</summary>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, lineHeight: 1.5, marginTop: 6 }}>
              {response.facts}
            </pre>
          </details>
        </div>
      ) : null}
    </div>
  );
}
