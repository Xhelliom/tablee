/**
 * Détail d'un repas : composition, nutrition, qui était à table, badge de
 * confiance — l'édition (V2), et la possibilité de le **compléter après coup** :
 * un aliment ajouté rejoint le repas existant, il n'en crée jamais un second.
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
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api, type FoodSummary, type Meal, type MealItem, type RecipeIngredient,
} from '../api.ts';
import { navigate } from '../router.tsx';
import { useSession } from '../session.tsx';
import { ModalHeader } from '../components/Chrome.tsx';
import { ConfidenceBadge } from '../components/Confidence.tsx';
import { DécrirePlat, type LignesDécoupées } from '../components/DécrirePlat.tsx';
import { GramsInput } from '../components/GramsInput.tsx';
import {
  RemainsPicker, UNCOUNTED_HINT, eatenHint, remainsOf, rescaled, split,
} from '../components/Leftovers.tsx';
import { Stepper } from '../components/Stepper.tsx';
import { WhoWasThere } from '../components/WhoWasThere.tsx';
import {
  IconBowl, IconCamera, IconChevron, IconClose, IconPlus, IconSearch, IconStar, IconTrash,
} from '../icons.tsx';
import {
  BAR_NUTRIENTS, NUTRIENT_COLOR, NUTRIENT_LABELS, SLOT_LABELS, SLOT_ORDER,
  SLOT_WHEN, longDate,
} from '../design/vocabulary.ts';
import { formatGrams, formatPercent, formatRange } from '../design/quantities.ts';

export function MealDetailScreen({ mealId }: { mealId: string }): React.ReactElement {
  const { eaters, ia } = useSession();
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
      meal.recipe?.title ?? meal.title ?? SLOT_LABELS[meal.slot],
    );
    if (name === null || name.trim().length === 0) return;
    await api.post('/api/templates', { mealId, name: name.trim() });
    window.alert('Ajouté aux habituels.');
  };

  if (error !== null) return <p className="empty">{error}</p>;
  if (meal === null) return <p className="empty">Un instant…</p>;

  const present = new Set(meal.participants.map((p) => p.eaterId));
  const nutrition = meal.nutrition;
  const title = meal.recipe?.title ?? meal.title ?? meal.items.map((i) => i.label).join(', ');
  const isLeftover = meal.leftoverOf !== null;
  /** Ce qu'on avait devant soi : ce qui a été mangé, plus ce qui reste. */
  const base = meal.servings + (meal.remainingServings ?? 0);
  /** Des parts à montrer : tout plat, sauf un reste sans recette. */
  const counted = meal.recipe !== null || !isLeftover;

  return (
    <div className="app">
      <ModalHeader title={SLOT_LABELS[meal.slot]} onClose={() => navigate('/')} />

      <section style={{ padding: '14px 16px', background: 'var(--surface-2)' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          {meal.imageUrl !== null ? (
            <img src={meal.imageUrl} alt=""
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
                    du snapshot publié par Jow, de la somme des aliments, ou des
                    deux quand le repas à recette a été complété (22/09/2026). */}
                <ConfidenceBadge
                  confidence={nutrition.confidence}
                  label={
                    nutrition.confidence === 'haute'
                      ? meal.recipe !== null
                        ? meal.items.length > 0
                          ? 'Recette et ajouts'
                          : 'Valeurs de la recette'
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
            Deuxième service d’un plat déjà enregistré.
          </p>
        ) : null}
      </section>

      {/* ── Nutrition ─────────────────────────────────────────────────────── */}
      <section style={row}>
        <p className="label">Nutrition de ce qui a été mangé</p>
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
          suivante, quand on la voit dans l'historique.

          Depuis le 22/09/2026, un repas se complète après coup : la même
          composition pour tous les repas, recette ou non. Avec recette, ses
          lignes sont les « ajouts au plat » ; sans, la composition entière.
          Chaque ajout compte dans les totaux, recette ou pas (§11, renversé le
          même jour). On ajoute par la recherche d'aliment, par un libellé seul
          quand le référentiel ne connaît rien, ou en décrivant / photographiant
          avec `DécrirePlat` — le composant commun à la saisie et à la fiche. */}
      <Composition
        items={meal.items}
        busy={busy}
        ia={ia}
        personnes={Math.max(1, Math.round(base))}
        label={meal.recipe === null ? 'Composition' : 'Ajouté au plat'}
        onChange={(items) => { void patch({ items }); }}
      />

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
      {/* Un repas se corrige comme il s'est saisi : ce qu'on avait devant soi,
          ce qui en reste (15/09/2026, §6bis). Sans recette, le nombre de parts
          ne sert à rien — seule compte la part mangée de ce qui a été servi.
          ⚠️ Renversé le même jour : sans recette aussi, « Cuisiné pour » dit
          pour combien le plat a été préparé, et le changer remet chaque
          quantité à l'échelle. Seul un reste sans recette s'en passe : sa
          composition est déjà ce qui restait. */}
      {counted ? (
        <section className="spread" style={row}>
          <div>
            <p style={{ fontSize: 14 }}>{isLeftover ? 'Il restait' : 'Cuisiné pour'}</p>
            <p className="meta">
              {isLeftover
                ? 'Parts sorties du frigo'
                : meal.recipe !== null ? 'Personnes, plat entier' : 'Personnes — les quantités suivent'}
            </p>
          </div>
          <Stepper
            value={base}
            onChange={(next) => {
              if (busy) return;
              const parts = split(next, remainsOf(meal).value);
              // Avec recette, les parts suffisent : la nutrition vient de Jow.
              void patch(meal.recipe !== null ? parts : {
                ...parts,
                items: meal.items.map((item) => ({
                  foodId: item.foodId, label: item.label, unit: item.unit,
                  quantity: rescaled(item.quantity, next / base),
                  quantityG: rescaled(item.quantityG, next / base),
                })),
              });
            }}
            min={0.1} max={20} step={0.5}
            label={isLeftover ? 'Il restait' : 'Cuisiné pour'}
          />
        </section>
      ) : null}
      <section className="spread" style={row}>
        <RemainsPicker
          label={isLeftover ? 'Il en reste encore ?' : 'Il en reste ?'}
          hint={counted ? eatenHint(meal.servings) : UNCOUNTED_HINT}
          value={remainsOf(meal).value}
          disabled={busy}
          onChange={(fraction) => { void patch(split(base, fraction)); }}
        />
      </section>

      <section style={{ ...row, paddingBottom: 14 }}>
        <WhoWasThere
          eaters={eaters}
          present={present}
          onToggle={(eaterId) => {
            const next = new Set(present);
            if (next.has(eaterId)) next.delete(eaterId);
            else next.add(eaterId);
            void patch({
              participants: [...next].map((id) => ({ eaterId: id, present: true })),
            });
          }}
          guestCount={meal.guestCount}
          onGuestCount={(guestCount) => { void patch({ guestCount }); }}
        />
      </section>

      {/* Un reste ou un habituel arrive ici déjà créé, et chaque retouche part
          aussitôt. Sans ce bouton, rien ne le dit : on cherche « Enregistrer »
          là où le partage Jow et la saisie manuelle l'ont mis. */}
      <section style={row}>
        <button type="button" className="btn" disabled={busy} onClick={() => navigate('/')}>
          {busy ? 'Enregistrement…' : 'Terminé'}
        </button>
        <p className="meta" style={{ marginTop: 8, textAlign: 'center' }}>
          Déjà enregistré — chaque modification l’est aussitôt.
        </p>
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
 * Clé d'une ligne encore sans identifiant serveur — l'envoi part au premier
 * geste, et l'id réel revient avec la réponse. Un compteur plutôt qu'un libellé
 * ou un id d'aliment : ajouter deux fois « Tarte aux pommes » ne doit pas
 * donner deux clés identiques.
 */
let prochaineAddition = 0;

/**
 * La composition d'un repas, éditable — et le moyen de la **compléter après
 * coup**. Trois portes, comme à la saisie : chercher un aliment dans le
 * référentiel, l'ajouter tel quel quand la recherche ne trouve rien, ou
 * **décrire / photographier** avec `DécrirePlat` — le composant commun à la
 * fiche et à l'écran de saisie (22/09/2026).
 *
 * Les modifications partent au serveur au `blur` et non à chaque frappe : une
 * requête par caractère ferait recalculer la nutrition dix fois pour rien.
 *
 * Toute modification renvoie la liste **entière** des lignes : c'est ce qui
 * rattache l'ajout au repas existant, et ce qui conserve ses lignes d'avant.
 */

/** Une ligne de la fiche : une `MealItem`, plus les candidats Ciqual d'une ligne découpée par l'IA. */
interface Ligne extends MealItem {
  foods?: FoodSummary[];
}

function Composition({
  items, busy, ia, personnes, label, onChange,
}: {
  items: MealItem[];
  busy: boolean;
  ia: boolean;
  /** Pour combien le plat a été préparé : l'IA estime les grammes pour ce nombre-là. */
  personnes: number;
  label: string;
  onChange: (items: { foodId: string | null; label: string; quantity: number | null; unit: string | null; quantityG: number | null }[]) => void;
}): React.ReactElement {
  const [draft, setDraft] = useState<Ligne[]>(items);
  const [mode, setMode] = useState<'chercher' | 'decrire'>('chercher');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodSummary[]>([]);

  useEffect(() => { setDraft(items); }, [items]);

  const send = (next: Ligne[]): void => {
    setDraft(next);
    onChange(next.map((item) => ({
      foodId: item.foodId,
      label: item.label,
      // La quantité et l'unité d'origine restent : seul le poids résolu est
      // réécrit. Les aplatir en grammes parce qu'un dessert rejoint le plat
      // écraserait « 2 tranches » — une donnée, perdue pour rien.
      quantity: item.unit === null ? item.quantityG : item.quantity,
      unit: item.unit === null ? (item.quantityG === null ? null : 'g') : item.unit,
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

  /** Aucun aliment correspondant : le libellé seul vaut mieux que perdre la saisie. */
  const addFreeText = (): void => {
    const label = query.trim();
    if (label.length === 0) return;
    send([...draft, {
      id: `nouveau-${prochaineAddition++}`,
      foodId: null, label, quantity: null, unit: null, quantityG: null,
      position: draft.length, foodName: null, plantBased: null,
    }]);
    setQuery('');
    setResults([]);
  };

  /** `DécrirePlat` a découpé la description (ou la photo) : les lignes rejoignent celles du repas. */
  const ajouterDécoupé = ({ items: lignes }: LignesDécoupées): void => {
    const nouvelles = lignes.map((ligne): Ligne => ({
      id: `nouveau-${prochaineAddition++}`,
      foodId: ligne.foodId, label: ligne.label,
      quantity: ligne.grams, unit: ligne.grams === null ? null : 'g',
      quantityG: ligne.grams, position: draft.length,
      foodName: null, plantBased: null, foods: ligne.foods,
    }));
    send([...draft, ...nouvelles]);
  };

  return (
    <section style={row}>
      <div className="spread">
        <p className="label">{label}</p>
        {ia ? (
          // Un contrôle segmenté, et non une pastille comme « Quel repas » :
          // c'est un mode d'ajout, pas un choix de valeur. La piste est neutre,
          // le segment actif est creusé dedans — le terracotta reste aux choix
          // de valeur et aux actions.
          <div role="group" aria-label="Comment ajouter un aliment" style={segment}>
            <button type="button" className="seg__button" aria-pressed={mode === 'chercher'}
                    onClick={() => setMode('chercher')}
                    style={segmentButton(mode === 'chercher', false)}>
              <IconSearch size={14} />
              Chercher
            </button>
            <button type="button" className="seg__button" aria-pressed={mode === 'decrire'}
                    onClick={() => setMode('decrire')}
                    style={segmentButton(mode === 'decrire', true)}>
              <IconCamera size={14} />
              Décrire / photo
            </button>
          </div>
        ) : null}
      </div>

      {ia && mode === 'decrire' ? (
        <DécrirePlat personnes={personnes} onDécoupé={ajouterDécoupé} />
      ) : null}

      {/* Le contrôle segmenté du haut ne doit pas coller à la liste : 10 px,
          comme le champ de recherche qui la suit. */}
      <div className="stack" style={{ gap: 7, marginTop: 10 }}>
        {draft.map((item, index) => (
          <div key={item.id} className="spread" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13 }}>{item.label}
                {item.foods !== undefined && item.foods.length > 0 ? (
                  <span className="meta"> · estimé</span>
                ) : null}
              </span>
              {item.foods !== undefined && item.foods.length > 0 ? (
                // Les grammes viennent du modèle : l'aliment, lui, se choisit —
                // trois candidats Ciqual ramenés par le serveur, ou aucun.
                <select
                  className="field"
                  style={{ marginTop: 5, display: 'block', padding: '6px 8px', fontSize: 13, width: '100%' }}
                  value={item.foodId ?? ''}
                  aria-label={`Aliment du référentiel pour ${item.label}`}
                  onChange={(e) => {
                    const foodId = e.target.value === '' ? null : e.target.value;
                    send(draft.map((d, i) => (i === index ? { ...d, foodId } : d)));
                  }}
                >
                  {item.foods.map((food) => <option key={food.id} value={food.id}>{food.name}</option>)}
                  <option value="">Aucun de ceux-là</option>
                </select>
              ) : item.quantityG === null ? (
                <span className="meta" style={{ display: 'block' }}>
                  quantité à préciser — sans elle, l’aliment n’est pas compté
                </span>
              ) : null}
            </div>
            <GramsInput
              value={item.quantityG}
              label={item.label}
              disabled={busy}
              resetKey={item.id}
              onCommit={(grams) =>
                send(draft.map((d, i) => (i === index ? { ...d, quantityG: grams } : d)))
              }
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

      {mode === 'chercher' ? (
        <>
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
                        { id: `nouveau-${prochaineAddition++}`, foodId: food.id, label: food.name,
                          quantity: null, unit: null, quantityG: null, position: draft.length,
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
          ) : query.trim().length >= 2 ? (
            <button type="button" className="btn btn--quiet" style={{ marginTop: 10 }}
                    onClick={addFreeText}>
              Ajouter « {query.trim()} » sans valeurs
            </button>
          ) : null}
        </>
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
 *
 * Le libellé Jow n'est qu'un point de départ, et il tombe parfois loin : il
 * remplit un champ qui se réécrit. Sans lui, un ingrédient que la recherche
 * rate reste non rattaché pour toujours — aucun autre écran ne permet de le
 * reprendre.
 */
function IngredientRow({
  ingredient, onLinked,
}: { ingredient: RecipeIngredient; onLinked: () => void }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(ingredient.label);
  const [results, setResults] = useState<FoodSummary[]>([]);
  const [done, setDone] = useState<string | null>(null);
  // Une requête par frappe : la réponse d'un « pom » arrivée après celle de
  // « pomme » ne doit pas la recouvrir.
  const dernière = useRef('');

  // Le libellé Jow sert de requête de départ, puis c'est ce qui est tapé. Ce
  // sont des suggestions : la confirmation reste humaine, un rattachement faux
  // faussant la part végétale sans le dire.
  const search = async (text: string): Promise<void> => {
    setQuery(text);
    setOpen(true);
    dernière.current = text;
    if (text.trim().length < 2) { setResults([]); return; }
    const { foods } = await api.get<{ foods: FoodSummary[] }>(
      `/api/foods/search?q=${encodeURIComponent(text)}&limit=6`,
    );
    if (dernière.current === text) setResults(foods);
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
          {ingredient.quantityG === null
            ? `${ingredient.quantity ?? ''} ${(ingredient.unit ?? '').toLowerCase()} — non converti`
            : ingredient.estimate === null
              ? `${formatGrams(ingredient.quantityG)} par convive`
              // R6 : dire que c'est une estimation, et de quoi elle part. Pas « à
              // vérifier » : la conversion est commune à tous les foyers, et rien
              // sur cet écran ne permet de la corriger.
              : `≈ ${formatGrams(ingredient.quantityG)} par convive (${ingredient.quantity ?? ''} ${(ingredient.unit ?? '').toLowerCase()}) — ${ingredient.estimate === 'basse' ? 'approximatif' : 'estimé'}`}
        </span>
      </div>
      {done !== null ? (
        <span className="chip chip--success" style={{ marginTop: 5 }}>{done}</span>
      ) : open ? (
        // Un puits en retrait sous l'ingrédient, et non la suite de la liste :
        // posées à plat, les propositions se lisaient comme des ingrédients de
        // plus. Il remplace la pastille qui l'a ouvert, et reprend ses mots.
        <div className="apparait" style={puits}>
          <div className="spread">
            <span className="label" style={{ margin: 0 }}>Rattacher à un aliment</span>
            <button type="button" className="appbar__action"
                    style={{ color: 'var(--text-muted)' }}
                    aria-label="Fermer la recherche"
                    onClick={() => setOpen(false)}>
              <IconClose size={16} />
            </button>
          </div>
          <label style={champ}>
            <IconSearch size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              value={query}
              aria-label={`Chercher l’aliment de ${ingredient.label}`}
              placeholder="Chercher un aliment…"
              onChange={(e) => { void search(e.target.value); }}
              style={{
                border: 0, outline: 'none', flex: 1, minWidth: 0, fontSize: 15,
                background: 'transparent', fontFamily: 'inherit', color: 'var(--text-primary)',
              }}
            />
          </label>
          {results.length > 0 ? (
            <div className="card groupe" style={{ marginTop: 8 }}>
              {results.map((food) => (
                <button key={food.id} type="button" className="row porte"
                        onClick={() => { void link(food.id); }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14 }}>{food.name}</span>
                  {/* Rattacher un aliment sans teneur ne rendrait rien au bilan : le dire avant le tap. */}
                  {food.nutrientsKnown ? null : <span className="meta">valeur inconnue</span>}
                  <IconChevron size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                </button>
              ))}
            </div>
          ) : query.trim().length >= 2 ? (
            // Sous deux caractères rien n'a été cherché : ne pas annoncer un échec.
            <p className="meta" style={{ marginTop: 8 }}>Aucun aliment trouvé.</p>
          ) : null}
        </div>
      ) : ingredient.foodId === null ? (
        <button type="button" className="chip chip--warning"
                style={{ marginTop: 5, cursor: 'pointer' }}
                onClick={() => { void search(ingredient.label); }}>
          Rattacher à un aliment
        </button>
      ) : null}
    </div>
  );
}

/** En retrait sur la ligne : `--surface-1` sous `--surface-2`, de jour comme de nuit. */
const puits: React.CSSProperties = {
  marginTop: 8, padding: '8px 10px 10px', borderRadius: 'var(--radius-card)',
  background: 'var(--surface-1)',
};

const champ: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, padding: '10px 12px',
  borderRadius: 'var(--radius)', border: '.5px solid var(--border-strong)',
  background: 'var(--surface-2)',
};

const row: React.CSSProperties = {
  padding: '12px 16px',
  borderTop: '.5px solid var(--border)',
  background: 'var(--surface-2)',
};

const action: React.CSSProperties = {
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
  padding: 11, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer',
};

/** Le bouton d'un choix : terracotta sur le choix courant, transparent sinon. */
const segment: React.CSSProperties = {
  display: 'inline-flex', borderRadius: 'var(--radius)',
  border: '.5px solid var(--border)', background: 'var(--surface-1)',
  overflow: 'hidden',
};

/** Un segment : actif = creusé dans la piste ; inactif = posé dessus. Le second garde son filet de division. */
const segmentButton = (actif: boolean, separator: boolean): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '7px 10px', fontSize: 12, border: 0, cursor: 'pointer',
  background: actif ? 'var(--surface-2)' : 'transparent',
  color: actif ? 'var(--text-primary)' : 'var(--text-secondary)',
  boxShadow: separator ? 'inset .5px 0 0 0 var(--border)' : undefined,
});
