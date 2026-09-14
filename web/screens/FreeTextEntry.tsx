/**
 * §5, voie 2 — saisie texte avec recherche dans `food`.
 *
 * En V1 la recherche est plein texte sur le référentiel Ciqual : on cherche
 * « courgette », on choisit, on donne une quantité. L'éclatement automatique
 * d'un « big mac + frites moyennes » par un LLM est prévu en V3, avec
 * validation — pas avant.
 *
 * La quantité en grammes est demandée, pas devinée. Quand l'aliment porte ses
 * propres équivalences (`food.unit_weights`), elles sont proposées ; sinon
 * c'est le gramme, parce que `unit_default` est vide et qu'inventer le poids
 * d'une poignée est exactement ce qu'interdit I1.
 *
 * ⚠️ Précisé le 14/09/2026 — la V3 commence ici. Quand le serveur a une clé
 * (`ANTHROPIC_API_KEY`), « Découper avec l'IA » éclate un repas tapé d'un trait
 * en lignes rapprochées de Ciqual, grammes **estimés** compris. Ce n'est pas le
 * poids d'une poignée écrit dans une table : il est proposé ligne à ligne, dit
 * « estimé », se corrige avant l'enregistrement, et le repas porte la source
 * `ia`, plafonnée à « Estimation » (R6). La recherche aliment par aliment
 * reste, pour qui n'en veut pas ou pour une instance sans clé.
 *
 * ⚠️ Renversé le 14/09/2026 — la description passe devant. Un même champ
 * servait aux deux et se présentait comme une recherche : on ajoutait les
 * aliments un à un sans voir le découpage. Avec une clé, on décrit d'abord son
 * plat ; la recherche, dessous, complète à la main ce que l'IA a manqué. Sans
 * clé, l'écran reste celui de la V1.
 *
 * L'ordre suit le geste, pas les données : décrire, relire l'assiette,
 * compléter à la main, puis dire quand et qui. « Enregistrer » reste collé au
 * bas de l'écran : après un découpage, la liste le poussait hors de vue.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api, ApiError, type FoodSearchResponse, type FoodSummary, type Meal, type Slot,
} from '../api.ts';
import { navigate } from '../router.tsx';
import { useSession } from '../session.tsx';
import { ModalHeader } from '../components/Chrome.tsx';
import { GramsInput } from '../components/GramsInput.tsx';
import { WhoWasThere } from '../components/WhoWasThere.tsx';
import { IconClose, IconSearch } from '../icons.tsx';
import { SLOT_ORDER, SLOT_WHEN, currentSlot } from '../design/vocabulary.ts';

interface Draft {
  /**
   * Stable d'un rendu à l'autre. Une clé tirée de l'index remontait toutes les
   * lignes qui suivent une ligne retirée : leur saisie repartait, et leur
   * entrée se rejouait.
   */
  key: number;
  foodId: string | null;
  label: string;
  grams: number | null;
  /**
   * Présent sur une ligne découpée par l'IA, et là seulement : les aliments
   * Ciqual proposés (vide si le référentiel ne connaît rien), et des grammes
   * qui sont une estimation.
   */
  foods?: FoodSummary[];
}

/** Ce que rend `POST /api/meals/decoupage`. */
interface Découpage {
  items: { label: string; grams: number | null; foods: FoodSummary[]; foodId: string | null }[];
}

let prochaineClé = 0;

export function FreeTextEntry({ onClose }: { onClose: () => void }): React.ReactElement {
  const { eaters, ia } = useSession();
  const [description, setDescription] = useState('');
  const [découpage, setDécoupage] = useState(false);
  const [erreurIA, setErreurIA] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodSummary[]>([]);
  /** `null` tant qu'aucune recherche n'a abouti : on ne dit rien avant de savoir. */
  const [referentialLoaded, setReferentialLoaded] = useState<boolean | null>(null);
  const [items, setItems] = useState<Draft[]>([]);
  const [slot, setSlot] = useState<Slot>(() => currentSlot());
  const [present, setPresent] = useState<Set<string>>(new Set());
  const [guestCount, setGuestCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => { setPresent(new Set(eaters.map((m) => m.id))); }, [eaters]);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    // Une frappe = une requête serait du bruit ; 200 ms suffisent à ne pas
    // sentir l'attente.
    timer.current = window.setTimeout(() => {
      void api
        .get<FoodSearchResponse>(`/api/foods/search?q=${encodeURIComponent(query)}`)
        .then((response) => {
          setResults(response.foods);
          setReferentialLoaded(response.referentialLoaded);
        })
        .catch(() => setResults([]));
    }, 200);
    return () => window.clearTimeout(timer.current);
  }, [query]);

  const add = (food: FoodSummary): void => {
    const ligne: Draft = { key: prochaineClé++, foodId: food.id, label: food.name, grams: null };
    setItems((current) => [...current, ligne]);
    setQuery('');
    setResults([]);
  };

  const découper = async (): Promise<void> => {
    const texte = description.trim();
    if (texte === '' || découpage) return;
    setDécoupage(true);
    setErreurIA(null);
    try {
      const { items: lignes } = await api.post<Découpage>('/api/meals/decoupage', { text: texte });
      // Le serveur dit quel aliment présélectionner — aucun quand l'IA n'en voit
      // pas qui convienne ; la liste permet d'en changer.
      const nouvelles = lignes.map((ligne): Draft => ({
        key: prochaineClé++,
        foodId: ligne.foodId,
        label: ligne.label,
        grams: ligne.grams,
        foods: ligne.foods,
      }));
      setItems((current) => [...current, ...nouvelles]);
      setDescription('');
    } catch (cause) {
      setErreurIA(cause instanceof ApiError ? cause.message : 'le découpage n’a pas abouti');
    }
    setDécoupage(false);
  };

  const addFreeText = (): void => {
    const label = query.trim();
    if (label.length === 0) return;
    // Aucun aliment rattaché : le repas sera enregistré, sa nutrition restera
    // inconnue et son badge le dira. Mieux que de perdre la saisie.
    const ligne: Draft = { key: prochaineClé++, foodId: null, label, grams: null };
    setItems((current) => [...current, ligne]);
    setQuery('');
  };

  const update = (key: number, patch: Partial<Draft>): void =>
    setItems((current) => current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));

  const toggle = useCallback((eaterId: string) => {
    setPresent((current) => {
      const next = new Set(current);
      if (next.has(eaterId)) next.delete(eaterId);
      else next.add(eaterId);
      return next;
    });
  }, []);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const { meal } = await api.post<{ meal: Meal }>('/api/meals', {
        eatenAt: new Date().toISOString(),
        slot,
        source: items.some((item) => item.foods !== undefined) ? 'ia' : 'texte',
        servings: 1,
        guestCount,
        participants: [...present].map((eaterId) => ({ eaterId, present: true })),
        items: items.map((item) => ({
          foodId: item.foodId,
          label: item.label,
          quantity: item.grams,
          unit: item.grams === null ? null : 'g',
          quantityG: item.grams,
        })),
      });
      navigate(`/repas/${meal.id}`, { replace: true });
    } catch {
      setError('Le repas n’a pas pu être enregistré.');
      setSaving(false);
    }
  };

  const estimé = items.some((item) => item.foods !== undefined);
  // Un bouton grisé sans raison se lit comme une panne.
  const manque = items.length === 0
    ? 'Ajoutez au moins un aliment.'
    : present.size === 0 ? 'Cochez qui était à table.' : null;

  return (
    <div className="app">
      <ModalHeader title="Saisir un repas" onClose={onClose} />

      <section style={{ ...bloc, borderTop: 0, paddingTop: 20, paddingBottom: 18 }}>
        {ia ? (
          <form onSubmit={(e) => { e.preventDefault(); void découper(); }}>
            <label className="display" htmlFor="description-plat" style={titre}>
              Décrivez<br />votre plat
            </label>
            <p className="meta" style={{ margin: '8px 0 14px', lineHeight: 1.5 }}>
              L’IA le découpe en aliments, vous vérifiez avant d’enregistrer.
            </p>
            <textarea
              id="description-plat" className="field" rows={3} maxLength={500}
              value={description}
              readOnly={découpage}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                // Entrée valide, comme dans un champ d'une ligne ; Maj+Entrée va à la ligne.
                if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
                e.preventDefault();
                void découper();
              }}
              placeholder="Des pâtes bolognaise, une salade verte et un yaourt"
              style={{ resize: 'none', lineHeight: 1.45 }}
            />
            <button type="submit" className="btn" style={{ marginTop: 10 }}
                    disabled={découpage || description.trim() === ''}>
              {découpage ? 'Découpage…' : 'Découper avec l’IA'}
            </button>
            {erreurIA !== null ? (
              <p style={{ fontSize: 13, color: 'var(--text-warning)', marginTop: 8 }}>{erreurIA}</p>
            ) : null}
          </form>
        ) : (
          <p className="display" style={titre}>Qu’y avait-il<br />au menu&nbsp;?</p>
        )}
      </section>

      {items.length > 0 || découpage ? (
        <section style={bloc}>
          <div className="spread">
            <p style={{ fontSize: 14 }}>Dans l’assiette</p>
            {/* Toute estimation porte sa confiance à l'écran, avant l'enregistrement aussi. */}
            {estimé ? <span className="chip">Estimation</span> : null}
          </div>
          {estimé ? (
            <p className="meta" style={{ marginTop: 4, lineHeight: 1.5 }}>
              Aliments et quantités proposés par l’IA, pour tout le repas&nbsp;: à vérifier.
            </p>
          ) : null}

          <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
            {items.map((item) => (
              <li key={item.key} className="apparait" style={ligne}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14 }}>
                    {item.label}
                    {item.foods !== undefined && item.grams !== null ? (
                      <span className="meta"> · estimé</span>
                    ) : null}
                  </p>
                  {item.foods !== undefined && item.foods.length > 0 ? (
                    <select
                      className="field" style={{ marginTop: 6, padding: '6px 8px', fontSize: 13 }}
                      value={item.foodId ?? ''}
                      aria-label={`Aliment du référentiel pour ${item.label}`}
                      onChange={(e) => update(item.key, { foodId: e.target.value === '' ? null : e.target.value })}
                    >
                      {item.foods.map((food) => <option key={food.id} value={food.id}>{food.name}</option>)}
                      <option value="">Aucun de ceux-là</option>
                    </select>
                  ) : null}
                  {/* Dire avant l'enregistrement ce qui ne sera pas compté, plutôt
                      que de le découvrir après coup sur un badge « à vérifier ».
                      La quantité manquante est en terracotta, comme « à compléter »
                      sur le bilan : un geste y répond. L'aliment inconnu, non. */}
                  {item.foodId === null ? (
                    <p className="meta" style={{ marginTop: 4 }}>
                      aliment non rattaché — sans valeurs nutritionnelles
                    </p>
                  ) : item.grams === null ? (
                    <p style={{ fontSize: 12, color: 'var(--coral-600)', marginTop: 4 }}>
                      quantité à préciser — sans elle, l’aliment n’est pas compté
                    </p>
                  ) : null}
                </div>
                <GramsInput
                  value={item.grams}
                  label={item.label}
                  resetKey={item.key}
                  onCommit={(grams) => update(item.key, { grams })}
                />
                <button type="button" className="appbar__action"
                        style={{ color: 'var(--text-muted)', marginTop: 3 }}
                        aria-label={`Retirer ${item.label}`}
                        onClick={() => setItems((c) => c.filter((draft) => draft.key !== item.key))}>
                  <IconClose size={16} />
                </button>
              </li>
            ))}
          </ul>

          {/* Deux appels au modèle : quelques secondes, qui doivent se voir. */}
          {découpage ? (
            <div role="status" style={{ ...ligne, display: 'block' }}>
              <span className="sr-only">L’IA découpe votre plat…</span>
              {[58, 40, 66].map((largeur) => (
                <span key={largeur} aria-hidden="true" className="attente" style={{
                  display: 'block', height: 10, width: `${largeur}%`, margin: '5px 0 13px',
                  borderRadius: 4, background: 'var(--surface-0)',
                }} />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section style={bloc}>
        <label htmlFor="recherche-aliment" style={{ display: 'block', fontSize: 14, marginBottom: 10 }}>
          {ia ? 'Ajouter un aliment à la main' : 'Chercher un aliment'}
        </label>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 9, padding: '11px 12px',
          borderRadius: 'var(--radius)', border: '.5px solid var(--border-strong)',
        }}>
          <IconSearch size={17} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            id="recherche-aliment"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addFreeText(); }}
            placeholder="Courgette, pain complet, yaourt…"
            style={{
              border: 0, outline: 'none', flex: 1, fontSize: 15,
              background: 'transparent', fontFamily: 'inherit', minWidth: 0,
            }}
          />
        </div>

        {results.length > 0 ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
            {results.slice(0, 8).map((food) => (
              <li key={food.id}>
                <button type="button" onClick={() => add(food)} style={resultRow}>
                  <span style={{ fontSize: 14 }}>{food.name}</span>
                  {food.kcal100g === null ? (
                    <span className="meta">valeur inconnue</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {/* Une recherche vide a deux causes, et elles n'appellent pas le même
            geste : « ce mot ne donne rien » se corrige en tapant autre chose,
            « le référentiel n'est pas chargé » ne se corrige pas à l'écran.
            Sans ce message, le second cas passe pour un bug de recherche. */}
        {referentialLoaded === false ? (
          <p style={{
            fontSize: 12, lineHeight: 1.5, marginTop: 10, padding: '10px 12px',
            borderRadius: 'var(--radius)',
            background: 'var(--bg-warning)', color: 'var(--text-warning)',
          }}>
            Le référentiel d’aliments n’est pas chargé : aucune recherche ne
            donnera de résultat. Lancer <code>npm run seed:food</code> sur le
            serveur. En attendant, un aliment saisi ici est enregistré sans
            valeurs nutritionnelles.
          </p>
        ) : null}

        {results.length === 0 && query.trim().length >= 2 ? (
          <button type="button" className="btn btn--quiet" style={{ marginTop: 10 }}
                  onClick={addFreeText}>
            Ajouter « {query.trim()} » sans valeurs
          </button>
        ) : null}
      </section>

      <section style={bloc}>
        <p style={{ fontSize: 14, marginBottom: 10 }}>Quel repas</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SLOT_ORDER.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === slot}
              onClick={() => setSlot(option)}
              style={{
                fontSize: 13, padding: '6px 12px', borderRadius: 'var(--radius)',
                border: option === slot ? '.5px solid var(--coral)' : '.5px solid var(--border)',
                background: option === slot ? 'var(--coral)' : 'transparent',
                color: option === slot ? '#fff' : 'var(--text-secondary)', cursor: 'pointer',
              }}
            >
              {SLOT_WHEN[option]}
            </button>
          ))}
        </div>
      </section>

      <section style={{ ...bloc, paddingBottom: 16 }}>
        <WhoWasThere eaters={eaters} present={present} onToggle={toggle}
                     guestCount={guestCount} onGuestCount={setGuestCount} />
      </section>

      <footer style={pied}>
        {error !== null ? (
          <p style={{ fontSize: 13, color: 'var(--text-warning)', marginBottom: 8 }}>{error}</p>
        ) : manque !== null ? (
          <p className="meta" style={{ marginBottom: 8, textAlign: 'center' }}>{manque}</p>
        ) : null}
        <button type="button" className="btn" disabled={saving || manque !== null}
                onClick={() => { void save(); }}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </footer>
    </div>
  );
}

const titre: React.CSSProperties = { display: 'block', fontSize: 28 };

const bloc: React.CSSProperties = {
  padding: '14px 16px',
  borderTop: '.5px solid var(--border)',
  background: 'var(--surface-2)',
};

const ligne: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 10,
  padding: '11px 0', borderTop: '.5px solid var(--border)',
};

/** Collé au bas de l'écran, comme la navigation des onglets. */
const pied: React.CSSProperties = {
  position: 'sticky', bottom: 0, zIndex: 5,
  padding: '12px 16px', paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
  borderTop: '.5px solid var(--border)', background: 'var(--surface-2)',
};

const resultRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  width: '100%', padding: '9px 2px', background: 'none', border: 0,
  borderBottom: '.5px solid var(--border)', textAlign: 'left', cursor: 'pointer',
};
