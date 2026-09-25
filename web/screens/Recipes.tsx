/**
 * §6bis — les recettes que le foyer connaît déjà, et un tap pour dire « on l'a
 * mangée ».
 *
 * ── Pourquoi cet écran n'ajoute presque rien ────────────────────────────────
 *
 * Les recettes sont en base depuis leur lecture : `saveJowRecipe` écrit la
 * recette **avant** que le repas soit enregistré. Partager cinq recettes et
 * n'en valider aucune laissait donc cinq recettes que rien ne montrait. Cet
 * écran est une fenêtre sur ce stock, pas une fonction de plus — et c'est
 * pourquoi il ne planifie rien : une recette n'a pas d'état « prévue », elle a
 * une date de dernier repas ou pas de date du tout.
 *
 * Ce qui n'a jamais été mangé passe devant : c'est ce qu'on vient y chercher.
 */
import { useEffect, useState } from 'react';
import { api, type RecipeSummary } from '../api.ts';
import { ModalHeader } from '../components/Chrome.tsx';
import { ConfidenceBadge } from '../components/Confidence.tsx';
import { IconBowl, IconChevron } from '../icons.tsx';
import { relativeDay } from '../design/vocabulary.ts';
import { SharedRecipe } from './Share.tsx';

export function Recipes({ onClose }: { onClose: () => void }): React.ReactElement {
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<{ recipes: RecipeSummary[] }>('/api/recipes')
      .then((response) => setRecipes(response.recipes))
      .catch(() => setError('La liste n’a pas pu être chargée.'));
  }, []);

  if (chosen !== null) {
    return (
      <SharedRecipe
        source={{ kind: 'recette', recipeId: chosen }}
        heading="Enregistrer ce plat"
        onClose={onClose}
        onManual={() => setChosen(null)}
      />
    );
  }

  const jamais = recipes?.filter((r) => r.lastEatenAt === null) ?? [];
  const déjà = recipes?.filter((r) => r.lastEatenAt !== null) ?? [];

  return (
    <div className="app">
      <ModalHeader title="Mes recettes" onClose={onClose} />

      {error !== null ? <p className="empty">{error}</p> : null}
      {recipes === null && error === null ? <p className="empty">Un instant…</p> : null}

      {recipes !== null && recipes.length === 0 ? (
        <div className="sec" style={{ paddingTop: 16 }}>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
            Aucune recette pour l’instant. Elles arrivent toutes seules : une
            recette partagée depuis Jow, ou collée ici, reste connue du foyer
            même si le repas n’est pas enregistré — et un plat décrit avec
            l’IA, ou photographié, y entre dès qu’il est enregistré.
          </p>
        </div>
      ) : null}

      {jamais.length > 0 ? (
        <Section
          title="Jamais enregistrées"
          hint="Lues depuis Jow, mais aucun repas ne les a encore utilisées."
          recipes={jamais}
          onChoose={setChosen}
        />
      ) : null}

      {déjà.length > 0 ? (
        <Section title="Déjà à table" recipes={déjà} onChoose={setChosen} />
      ) : null}

      <div className="fab-space" />
    </div>
  );
}

function Section({ title, hint, recipes, onChoose }: {
  title: string;
  hint?: string;
  recipes: RecipeSummary[];
  onChoose: (id: string) => void;
}): React.ReactElement {
  return (
    <div className="sec" style={{ paddingTop: 14 }}>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: hint === undefined ? 10 : 4 }}>
        {title}
      </p>
      {hint !== undefined ? (
        <p className="meta" style={{ lineHeight: 1.5, marginBottom: 10 }}>{hint}</p>
      ) : null}

      <div className="stack">
        {recipes.map((recipe) => (
          <button key={recipe.id} type="button" className="card row"
                  onClick={() => onChoose(recipe.id)}>
            {recipe.imageUrl !== null ? (
              <img src={recipe.imageUrl} alt=""
                   style={{
                     width: 42, height: 42, borderRadius: 'var(--radius)',
                     objectFit: 'cover', flexShrink: 0,
                   }} />
            ) : (
              <span className="thumb" style={{ width: 42, height: 42 }}><IconBowl size={20} /></span>
            )}

            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 500, display: 'block', lineHeight: 1.3 }}>
                {recipe.title}
              </span>
              <span className="meta" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 3 }}>
                {recipe.lastEatenAt === null
                  ? `Prévue pour ${recipe.baseServings}`
                  : `${capitalize(relativeDay(recipe.lastEatenAt))}`}
                {recipe.timesEaten > 1 ? ` · ${recipe.timesEaten} fois` : ''}
                {recipe.confidence !== 'haute' ? (
                  <ConfidenceBadge confidence={recipe.confidence} />
                ) : null}
              </span>
            </span>

            <IconChevron size={17} style={{ color: 'var(--text-muted)' }} />
          </button>
        ))}
      </div>
    </div>
  );
}

const capitalize = (text: string): string => text.slice(0, 1).toUpperCase() + text.slice(1);
