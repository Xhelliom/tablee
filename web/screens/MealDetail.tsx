/**
 * Détail d'un repas : composition, nutrition, qui était à table, badge de
 * confiance — et l'édition (V2).
 *
 * Deux choses que cet écran doit rendre visibles et que rien d'autre ne rend
 * visibles :
 *
 * - **Ce qui manque.** Un ingrédient dont l'unité n'a pas d'équivalence
 *   sourcée, un aliment non rattaché au référentiel : ils sont affichés comme
 *   tels, avec le moyen de les corriger. « Une donnée manquante doit se voir. »
 * - **D'où viennent les chiffres.** Snapshot de la recette, somme des items,
 *   estimation : le badge de confiance le dit (R6).
 *
 * R2 : modifier le repas recalcule la nutrition. Les parts ne bougent que si
 * l'on change qui était à table.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  api, type FoodSummary, type Meal, type MealItem, type RecipeIngredient,
} from '../api.ts';
import { navigate } from '../router.tsx';
import { useSession } from '../session.tsx';
import { ModalHeader } from '../components/Chrome.tsx';
import { ConfidenceBadge } from '../components/Confidence.tsx';
import { Stepper } from '../components/Stepper.tsx';
import { WhoWasThere } from '../components/WhoWasThere.tsx';
import { IconBowl, IconClose, IconPlus, IconStar, IconTrash } from '../icons.tsx';
import {
  BAR_NUTRIENTS, NUTRIENT_COLOR, NUTRIENT_LABELS, SLOT_LABELS, SLOT_ORDER,
  SLOT_WHEN, longDate,
} from '../design/vocabulary.ts';
import { formatPercent, formatRange } from '../design/quantities.ts';

export function MealDetailScreen({ mealId }: { mealId: string }): React.ReactElement {
  const { members } = useSession();
  const [meal, setMeal] = useState<Meal | null>(null);
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { meal: found } = await api.get<{ meal: Meal }>(`/api/meals/${mealId}`);
      setMeal(found);
      if (found.recipe !== null) {
        const { recipe } = await api.get<{ recipe: { ingredients: RecipeIngredient[] } }>(
          `/api/recipes/${found.recipe.id}`,
        );
        setIngredients(recipe.ingredients);
      }
    } catch {
      setError('repas introuvable');
    }
  }, [mealId]);

  useEffect(() => { void load(); }, [load]);

  const patch = async (body: Record<string, unknown>): Promise<void> => {
    setBusy(true);
    try {
      const { meal: updated } = await api.patch<{ meal: Meal }>(`/api/meals/${mealId}`, body);
      setMeal(updated);
    } catch {
      setError('la modification n’a pas pu être enregistrée');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    await api.delete(`/api/meals/${mealId}`);
    navigate('/', { replace: true });
  };

  const makeTemplate = async (): Promise<void> => {
    if (meal === null) return;
    const name = window.prompt(
      'Nom de l’habitude (il apparaîtra dans l’ajout rapide)',
      meal.recipe?.title ?? SLOT_LABELS[meal.slot],
    );
    if (name === null || name.trim().length === 0) return;
    await api.post('/api/templates', { mealId, name: name.trim() });
    window.alert('Ajouté aux habituels.');
  };

  if (error !== null) return <p className="empty">{error}</p>;
  if (meal === null) return <p className="empty">Un instant…</p>;

  const present = new Set(meal.participants.map((p) => p.memberId));
  const nutrition = meal.nutrition;
  const title = meal.recipe?.title ?? meal.items.map((i) => i.label).join(', ') ?? '';

  return (
    <div className="app">
      <ModalHeader title={SLOT_LABELS[meal.slot]} onClose={() => navigate('/')} />

      <section style={{ padding: '14px 16px', background: 'var(--surface-2)' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          {meal.recipe?.imageUrl != null ? (
            <img src={meal.recipe.imageUrl} alt=""
                 style={{ width: 54, height: 54, borderRadius: 'var(--radius)', objectFit: 'cover' }} />
          ) : (
            <span className="thumb" style={{ width: 54, height: 54 }}><IconBowl size={24} /></span>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 16, lineHeight: 1.35 }}>{title || 'Repas'}</p>
            <p className="meta" style={{ marginTop: 4 }}>{longDate(meal.eatenAt.slice(0, 10))}</p>
            {nutrition !== null ? (
              <div style={{ marginTop: 8 }}>
                {/* R6 : le badge dit d'où viennent les chiffres d'à côté —
                    du snapshot publié par Jow, ou de la somme des aliments. */}
                <ConfidenceBadge
                  confidence={nutrition.confidence}
                  label={
                    nutrition.confidence === 'haute'
                      ? meal.recipe !== null
                        ? 'Valeurs de la recette'
                        : 'Valeurs du référentiel'
                      : undefined
                  }
                />
              </div>
            ) : null}
          </div>
        </div>

        {meal.leftoverOf !== null ? (
          <p className="meta" style={{ marginTop: 10 }}>
            2ᵉ service d’un plat déjà enregistré.
          </p>
        ) : null}
      </section>

      {/* ── Nutrition ─────────────────────────────────────────────────────── */}
      <section style={row}>
        <p className="label">Nutrition du plat entier</p>
        {nutrition === null ? (
          <p className="meta">Pas encore calculée.</p>
        ) : (
          <div className="stack" style={{ gap: 7 }}>
            {BAR_NUTRIENTS.map((nutrient) => (
              <div key={nutrient} className="spread">
                <span style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: NUTRIENT_COLOR[nutrient], display: 'inline-block',
                  }} />
                  {NUTRIENT_LABELS[nutrient]}
                </span>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {formatRange(nutrition[nutrient], nutrition.max[nutrient])}
                </span>
              </div>
            ))}
            <div className="spread">
              <span style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: NUTRIENT_COLOR.plant, display: 'inline-block',
                }} />
                Végétal
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {nutrition.plantRatio === null
                  ? 'origine des aliments inconnue'
                  : formatPercent(nutrition.plantRatio)}
              </span>
            </div>
            {nutrition.plantRatio !== null
             && nutrition.gramsClassified !== null
             && nutrition.gramsTotal !== null
             && nutrition.gramsClassified < nutrition.gramsTotal ? (
              <p className="meta">
                Calculé sur {Math.round((nutrition.gramsClassified / nutrition.gramsTotal) * 100)} %
                du repas — le reste n’est pas rattaché au référentiel.
              </p>
            ) : null}
          </div>
        )}
      </section>

      {/* ── Composition ───────────────────────────────────────────────────── */}
      {ingredients.length > 0 ? (
        <section style={row}>
          <p className="label">Ingrédients de la recette</p>
          <div className="stack" style={{ gap: 9 }}>
            {ingredients.map((ingredient) => (
              <IngredientRow key={ingredient.id} ingredient={ingredient} onLinked={() => { void load(); }} />
            ))}
          </div>
        </section>
      ) : null}

      {/* V2 — éditer un repas passé : le créneau et la composition, pas
          seulement les convives. Une erreur de saisie se corrige la semaine
          suivante, quand on la voit dans l'historique. */}
      {meal.recipe === null ? (
        <Composition
          items={meal.items}
          busy={busy}
          onChange={(items) => { void patch({ items }); }}
        />
      ) : meal.items.length > 0 ? (
        <section style={row}>
          <p className="label">Ajouté au plat</p>
          <div className="stack" style={{ gap: 7 }}>
            {meal.items.map((item) => (
              <div key={item.id} className="spread">
                <span style={{ fontSize: 13 }}>{item.label}</span>
                <span className="meta">
                  {item.quantityG !== null ? `${round(item.quantityG)} g` : 'quantité inconnue'}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="spread" style={row}>
        <span style={{ fontSize: 14 }}>Quel repas</span>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {SLOT_ORDER.map((option) => (
            <button
              key={option}
              type="button"
              disabled={busy}
              onClick={() => { void patch({ slot: option }); }}
              style={{
                fontSize: 13, padding: '5px 11px', borderRadius: 'var(--radius)',
                border: option === meal.slot ? '.5px solid var(--coral)' : '.5px solid var(--border)',
                background: option === meal.slot ? 'var(--coral)' : 'transparent',
                color: option === meal.slot ? '#fff' : 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              {SLOT_WHEN[option]}
            </button>
          ))}
        </div>
      </section>

      {/* ── Édition (V2) ──────────────────────────────────────────────────── */}
      <section className="spread" style={row}>
        <div>
          <p style={{ fontSize: 14 }}>Pour combien&nbsp;?</p>
          <p className="meta">Parts préparées</p>
        </div>
        <Stepper
          value={meal.servings}
          onChange={(servings) => { void patch({ servings }); }}
          min={0.5} max={20} step={0.5} label="Parts préparées"
        />
      </section>

      <section style={{ ...row, paddingBottom: 14 }}>
        <WhoWasThere
          members={members}
          present={present}
          onToggle={(memberId) => {
            const next = new Set(present);
            if (next.has(memberId)) next.delete(memberId);
            else next.add(memberId);
            void patch({
              participants: [...next].map((id) => ({ memberId: id, present: true })),
            });
          }}
          guestCount={meal.guestCount}
          onGuestCount={(guestCount) => { void patch({ guestCount }); }}
        />
      </section>

      <section style={{ ...row, display: 'flex', gap: 8 }}>
        <button type="button" className="card" style={action} disabled={busy}
                onClick={() => { void makeTemplate(); }}>
          <IconStar size={17} />
          En faire un habituel
        </button>
        <button type="button" className="card" style={action} disabled={busy}
                onClick={() => {
                  if (window.confirm('Supprimer ce repas ?')) void remove();
                }}>
          <IconTrash size={17} />
          Supprimer
        </button>
      </section>
      <div className="fab-space" />
    </div>
  );
}

/**
 * La composition d'un repas hors-Jow, éditable.
 *
 * Les modifications partent au serveur au `blur` et non à chaque frappe : une
 * requête par caractère ferait recalculer la nutrition dix fois pour rien.
 */
function Composition({
  items, busy, onChange,
}: {
  items: MealItem[];
  busy: boolean;
  onChange: (items: { foodId: string | null; label: string; quantity: number | null; unit: string | null; quantityG: number | null }[]) => void;
}): React.ReactElement {
  const [draft, setDraft] = useState(items);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodSummary[]>([]);

  useEffect(() => { setDraft(items); }, [items]);

  const send = (next: MealItem[]): void => {
    setDraft(next);
    onChange(next.map((item) => ({
      foodId: item.foodId,
      label: item.label,
      quantity: item.quantityG,
      unit: item.quantityG === null ? null : 'g',
      quantityG: item.quantityG,
    })));
  };

  const search = async (text: string): Promise<void> => {
    setQuery(text);
    if (text.trim().length < 2) { setResults([]); return; }
    const { foods } = await api.get<{ foods: FoodSummary[] }>(
      `/api/foods/search?q=${encodeURIComponent(text)}&limit=6`,
    );
    setResults(foods);
  };

  return (
    <section style={row}>
      <p className="label">Composition</p>
      <div className="stack" style={{ gap: 7 }}>
        {draft.map((item, index) => (
          <div key={item.id} className="spread">
            <span style={{ fontSize: 13, flex: 1, minWidth: 0 }}>{item.label}</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              defaultValue={item.quantityG ?? ''}
              placeholder="g"
              aria-label={`Quantité de ${item.label} en grammes`}
              disabled={busy}
              onBlur={(e) => {
                const grams = e.target.value === '' ? null : Number(e.target.value);
                if (grams === item.quantityG) return;
                send(draft.map((d, i) => (i === index ? { ...d, quantityG: grams } : d)));
              }}
              style={{
                width: 74, padding: '6px 9px', borderRadius: 'var(--radius)',
                border: '.5px solid var(--border)', fontFamily: 'inherit', fontSize: 13,
              }}
            />
            <button type="button" className="appbar__action" disabled={busy}
                    style={{ color: 'var(--text-muted)' }}
                    aria-label={`Retirer ${item.label}`}
                    onClick={() => send(draft.filter((_, i) => i !== index))}>
              <IconClose size={16} />
            </button>
          </div>
        ))}
        {draft.length === 0 ? <p className="meta">Rien d’enregistré dans ce repas.</p> : null}
      </div>

      <input
        className="field"
        style={{ marginTop: 10, fontSize: 14 }}
        value={query}
        placeholder="Ajouter un aliment…"
        onChange={(e) => { void search(e.target.value); }}
      />
      {results.length > 0 ? (
        <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
          {results.map((food) => (
            <li key={food.id}>
              <button
                type="button"
                onClick={() => {
                  send([
                    ...draft,
                    { id: food.id, foodId: food.id, label: food.name, quantity: null,
                      unit: null, quantityG: null, position: draft.length,
                      foodName: food.name, plantBased: food.plantBased },
                  ]);
                  setQuery('');
                  setResults([]);
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7, width: '100%',
                  padding: '7px 2px', fontSize: 13, background: 'none', border: 0,
                  borderBottom: '.5px solid var(--border)', textAlign: 'left', cursor: 'pointer',
                }}
              >
                <IconPlus size={14} />
                {food.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Un ingrédient Jow, et le moyen de le rattacher au référentiel.
 *
 * Jow publie des libellés, pas des codes Ciqual. Les rapprocher
 * automatiquement par ressemblance de chaîne produirait des rattachements faux
 * — et un rattachement faux fausse la part végétale sans le dire. On propose,
 * l'utilisateur tranche (§6, dernière étape).
 */
function IngredientRow({
  ingredient, onLinked,
}: { ingredient: RecipeIngredient; onLinked: () => void }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<FoodSummary[]>([]);
  const [done, setDone] = useState<string | null>(null);

  const search = async (): Promise<void> => {
    setOpen(true);
    // Le libellé Jow sert de requête de départ. Ce sont des suggestions : la
    // confirmation reste humaine, un rattachement faux faussant la part
    // végétale sans le dire.
    const { foods } = await api.get<{ foods: FoodSummary[] }>(
      `/api/foods/search?q=${encodeURIComponent(ingredient.label)}&limit=6`,
    );
    setResults(foods);
  };

  const link = async (foodId: string): Promise<void> => {
    const result = await api.post<{ propagated: number; recomputed: number }>(
      `/api/recipes/ingredients/${ingredient.id}/food`,
      { foodId },
    );
    setOpen(false);
    // Le rattachement vaut pour l'ingrédient Jow, pas pour cette recette : le
    // dire, sinon le geste paraît coûter un tap pour un seul plat.
    setDone(
      result.propagated > 1
        ? `Rattaché — ${result.propagated} recettes câblées d’un coup`
        : 'Rattaché, une fois pour toutes',
    );
    onLinked();
  };

  return (
    <div>
      <div className="spread">
        <span style={{ fontSize: 13 }}>{ingredient.label}</span>
        <span className="meta">
          {ingredient.quantityG !== null
            ? `${round(ingredient.quantityG)} g / convive`
            : `${ingredient.quantity ?? ''} ${ingredient.unit ?? ''} — non converti`}
        </span>
      </div>
      {done !== null ? (
        <span className="chip chip--success" style={{ marginTop: 5 }}>{done}</span>
      ) : ingredient.foodId === null ? (
        <button type="button" className="chip chip--warning"
                style={{ marginTop: 5, cursor: 'pointer' }}
                onClick={() => { void search(); }}>
          Rattacher à un aliment
        </button>
      ) : null}
      {open ? (
        <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
          {results.map((food) => (
            <li key={food.id}>
              <button type="button" onClick={() => { void link(food.id); }}
                      style={{
                        width: '100%', textAlign: 'left', padding: '7px 2px', fontSize: 13,
                        background: 'none', border: 0, borderBottom: '.5px solid var(--border)',
                        cursor: 'pointer',
                      }}>
                {food.name}
              </button>
            </li>
          ))}
          {results.length === 0 ? <li className="meta">Aucun aliment trouvé.</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

const row: React.CSSProperties = {
  padding: '12px 16px',
  borderTop: '.5px solid var(--border)',
  background: 'var(--surface-2)',
};

const action: React.CSSProperties = {
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
  padding: 11, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer',
};

const round = (value: number | null): string =>
  value === null ? '—' : String(Math.round(value * 10) / 10);
