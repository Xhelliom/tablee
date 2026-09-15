/**
 * §4 — réception d'un partage Jow. Le chemin critique de l'app.
 *
 * Android ouvre `/share?title=…&text=…&url=…` par-dessus Jow. Objectif du §13 :
 * **enregistrer en trois taps** — choisir le créneau, cocher qui était là,
 * valider. Tout est donc pré-rempli : le créneau selon l'heure, les parts selon
 * ce que Jow prévoit, les convives selon les membres actifs.
 *
 * ⚠️ Renversé le 15/09/2026 — les parts suivent qui est à table, plus
 * `coversCount`. Jow publie la plupart de ses recettes « pour 1 » (6 sur 8 dans
 * `server/jow/fixtures/`) : enregistré sans toucher au compteur, un dîner à
 * quatre comptait une seule assiette partagée entre quatre, et tous les bilans
 * restaient loin sous les repères. Le nombre de Jow reste affiché, en rappel.
 *
 * I6 : le texte partagé porte `key` et `userId`, qui sont des jetons de compte.
 * Il n'est jamais affiché tel quel, jamais mis dans l'URL après coup, et le
 * serveur ne persiste que sa version expurgée.
 *
 * L'écran de confirmation est séparé du lecteur d'URL (`SharedRecipe`) parce
 * qu'il a trois entrées : le partage Android, « Coller un lien Jow »
 * (`JowLink.tsx`) et la liste des recettes déjà connues (`Recipes.tsx`). Le
 * pas de confirmation est le même dans les trois cas — ce qui change est
 * seulement d'où vient la recette, d'où la prop `source`.
 *
 * Le texte partagé y arrive par une prop et **jamais par la query string** :
 * le passer par l'URL remettrait le jeton de compte dans l'historique du
 * navigateur, ce que le partage Android nous impose déjà sans qu'on ait à le
 * reproduire nous-mêmes.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type ResolveResponse, type Slot } from '../api.ts';
import { navigate, useRoute } from '../router.tsx';
import { useSession } from '../session.tsx';
import { ModalHeader } from '../components/Chrome.tsx';
import { ConfidenceBadge, Warnings } from '../components/Confidence.tsx';
import { RemainsPicker, eatenHint, split } from '../components/Leftovers.tsx';
import { Stepper } from '../components/Stepper.tsx';
import { WhoWasThere } from '../components/WhoWasThere.tsx';
import { IconBowl } from '../icons.tsx';
import { SLOT_ORDER, SLOT_WHEN, currentSlot } from '../design/vocabulary.ts';
import { formatGrams, formatNumber } from '../design/quantities.ts';

export function ShareScreen(): React.ReactElement {
  const { query } = useRoute();

  // Jow met le titre **et** l'URL dans `text` : c'est `text` qu'il faut parser,
  // pas seulement `url` (§4).
  const shared = useMemo(
    () => [query.get('text'), query.get('url'), query.get('title')]
      .filter((v): v is string => v !== null && v.length > 0)
      .join('\n'),
    [query],
  );

  return (
    <SharedRecipe
      source={{ kind: 'partage', text: shared }}
      heading="Reçu depuis Jow"
      onClose={() => navigate('/')}
    />
  );
}

/**
 * D'où vient la recette à confirmer. `partage` porte un texte à lire — il peut
 * contenir un jeton de compte, et ne ressort donc jamais d'ici sans passer par
 * le serveur ; `recette` désigne une recette déjà en base, qu'il suffit de
 * relire.
 */
export type RecipeSource =
  | { kind: 'partage'; text: string }
  | { kind: 'recette'; recipeId: string };

interface SharedRecipeProps {
  source: RecipeSource;
  heading: string;
  onClose: () => void;
  /** Repli quand la recette n'a pas pu être lue. Par défaut, l'ajout rapide. */
  onManual?: () => void;
}

/**
 * Le pas de confirmation : ce que Jow publie, qui était à table, et on
 * enregistre. Identique quelle que soit la porte d'entrée.
 */
export function SharedRecipe(
  { source, heading, onClose, onManual }: SharedRecipeProps,
): React.ReactElement {
  const { eaters } = useSession();

  const [state, setState] = useState<ResolveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot>(() => currentSlot());
  /** `null` tant qu'on n'y a pas touché : « Cuisiné pour » suit alors les cases cochées. */
  const [cookedByHand, setCookedByHand] = useState<number | null>(null);
  const [remains, setRemains] = useState(0);
  const [guestCount, setGuestCount] = useState(0);
  const [present, setPresent] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPresent(new Set(eaters.map((m) => m.id)));
  }, [eaters]);

  // L'effet dépend de deux chaînes, **pas de l'objet `source`** : une prop
  // objet est recréée à chaque rendu du parent, et la lecture repartirait en
  // boucle. Ces deux valeurs déterminent entièrement la requête.
  const { kind } = source;
  const clé = source.kind === 'partage' ? source.text : source.recipeId;

  useEffect(() => {
    if (kind === 'partage' && clé.length === 0) {
      setError('Aucun contenu partagé.');
      return;
    }
    // Une recette déjà en base se relit ; un texte partagé se résout, ce qui
    // peut demander un aller-retour chez Jow.
    const lecture = kind === 'recette'
      ? api.get<ResolveResponse>(`/api/recipes/${clé}`)
      : api.post<ResolveResponse>('/api/recipes/resolve', { text: clé });

    void lecture
      .then(setState)
      .catch(() => setError('La recette n’a pas pu être lue. Le repas peut être saisi à la main.'));
  }, [kind, clé]);

  const toggle = useCallback((eaterId: string) => {
    setPresent((current) => {
      const next = new Set(current);
      if (next.has(eaterId)) next.delete(eaterId);
      else next.add(eaterId);
      return next;
    });
  }, []);

  // Une part par personne à table, invités compris (voir l'en-tête). Jamais sous
  // 1 : le minimum du compteur, quand plus aucune case n'est cochée.
  const cooked = cookedByHand ?? Math.max(present.size + guestCount, 1);
  const parts = split(cooked, remains);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await api.post('/api/meals', {
        eatenAt: new Date().toISOString(),
        slot,
        source: 'jow',
        recipeId: state?.recipe?.id ?? null,
        ...parts,
        guestCount,
        participants: [...present].map((eaterId) => ({ eaterId, present: true })),
        // Expurgé côté serveur avant insertion, et de nouveau ici par principe.
        // Une recette relue depuis la liste n'a aucun texte d'origine : il n'y
        // a rien à stocker, et surtout rien à réinventer.
        ...(source.kind === 'partage' ? { rawInput: source.text } : {}),
      });
      // L'accueil, pas le détail : il reprend les blocs du formulaire, et
      // l'enregistrement paraissait resté sans effet.
      navigate('/', { replace: true });
    } catch {
      setError('Le repas n’a pas pu être enregistré.');
      setSaving(false);
    }
  };

  const recipe = state?.recipe ?? null;
  const title = recipe?.title ?? state?.parsed?.title ?? 'Repas partagé';
  const confidence = recipe?.confidence ?? state?.parsed?.confidence ?? 'basse';

  return (
    <div className="app">
      <ModalHeader title={heading} onClose={onClose} />

      {state === null && error === null ? (
        <p className="empty">Lecture de la recette…</p>
      ) : null}

      {error !== null ? (
        <div className="sec" style={{ paddingTop: 16 }}>
          <p style={{ fontSize: 14, lineHeight: 1.6 }}>{error}</p>
          <button type="button" className="btn btn--ghost" style={{ marginTop: 14 }}
                  onClick={onManual ?? (() => navigate('/ajouter'))}>
            Saisir le repas à la main
          </button>
        </div>
      ) : null}

      {state !== null ? (
        <>
          <section style={{ padding: '14px 16px', background: 'var(--surface-2)' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              {recipe?.imageUrl != null ? (
                <img src={recipe.imageUrl} alt=""
                     style={{ width: 54, height: 54, borderRadius: 'var(--radius)', objectFit: 'cover', flexShrink: 0 }} />
              ) : (
                <span className="thumb" style={{ width: 54, height: 54 }}><IconBowl size={24} /></span>
              )}
              <div>
                <p style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.35 }}>{title}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  <ConfidenceBadge confidence={confidence}
                                   label={confidence === 'haute' ? 'Résolue' : undefined} />
                  {recipe?.nutriScore != null ? (
                    <span className="meta">Nutri-Score {recipe.nutriScore}</span>
                  ) : null}
                  {state.seasonal > 0 ? (
                    <span className="meta">
                      {state.seasonal} produit{state.seasonal > 1 ? 's' : ''} de saison
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            {recipe !== null ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14 }}>
                {recipe.ingredients.map((ingredient) => (
                  <span
                    key={ingredient.id}
                    className={ingredient.quantityG === null ? 'chip chip--warning' : 'chip'}
                  >
                    {ingredient.label}
                    {ingredient.quantityG !== null
                      ? ` ${formatGrams(ingredient.quantityG)}`
                      : ingredient.quantity !== null && ingredient.unit !== null
                        ? ` ${formatNumber(ingredient.quantity)} ${ingredient.unit.toLowerCase()} ?`
                        : ''}
                  </span>
                ))}
              </div>
            ) : null}

            {/* « Une donnée manquante doit se voir » — §6 du contrat Jow. */}
            <Warnings warnings={state.warnings} />
          </section>

          <section className="spread" style={row}>
            <span style={{ fontSize: 14 }}>Quel repas</span>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {SLOT_ORDER.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSlot(option)}
                  style={{
                    fontSize: 13, padding: '5px 11px', borderRadius: 'var(--radius)',
                    border: option === slot ? '.5px solid var(--coral)' : '.5px solid var(--border)',
                    background: option === slot ? 'var(--coral)' : 'transparent',
                    color: option === slot ? '#fff' : 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  {SLOT_WHEN[option]}
                </button>
              ))}
            </div>
          </section>

          {/*
            `servings` reste ce qui a été **mangé à ce repas** : la nutrition
            vaut `parts × valeurs par portion`, répartie entre les présents.
            Mais on ne le demande plus (15/09/2026) — personne ne sait dire
            « 2,5 parts », tout le monde sait dire « il en reste un quart ».
            Ce qui reste n'est attribué à personne : il attend au frigo (§6bis).
          */}
          <section className="spread" style={row}>
            <div>
              <p style={{ fontSize: 14 }}>Cuisiné pour</p>
              <p className="meta">
                {recipe !== null ? `Personnes · recette prévue pour ${recipe.baseServings}` : 'Personnes'}
              </p>
            </div>
            <Stepper value={cooked} onChange={setCookedByHand} min={0.5} max={20} step={0.5}
                     label="Cuisiné pour" />
          </section>

          <section className="spread" style={row}>
            <RemainsPicker label="Il en reste ?" hint={eatenHint(parts.servings)}
                           value={remains} onChange={setRemains} />
          </section>

          <section style={{ ...row, paddingBottom: 14 }}>
            <WhoWasThere
              eaters={eaters}
              present={present}
              onToggle={toggle}
              guestCount={guestCount}
              onGuestCount={setGuestCount}
            />
          </section>

          <section style={row}>
            <button type="button" className="btn" onClick={() => { void save(); }}
                    disabled={saving || present.size === 0}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {present.size === 0 ? (
              <p className="meta" style={{ marginTop: 8, textAlign: 'center' }}>
                Coche au moins une personne.
              </p>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}

const row: React.CSSProperties = {
  padding: '12px 16px',
  borderTop: '.5px solid var(--border)',
  background: 'var(--surface-2)',
};
