/**
 * Les plats à venir : ce qu'on a commandé et pas encore mangé.
 *
 * Pas de planning — aucun jour, aucun ordre à choisir ici. On voit le stock,
 * on y ajoute une recette que le foyer connaît déjà, on retire un plat quand
 * il est mangé. Une recette nouvelle y entre en passant d'abord par un partage
 * Jow, comme pour « Mes recettes ».
 */
import { useCallback, useEffect, useState } from 'react';
import { api, type RecipeSummary, type UpcomingDish } from '../api.ts';
import { ModalHeader } from '../components/Chrome.tsx';
import { IconBowl } from '../icons.tsx';
import { navigate } from '../router.tsx';

export function UpcomingDishesScreen(): React.ReactElement {
  const [dishes, setDishes] = useState<UpcomingDish[] | null>(null);
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [d, r] = await Promise.all([
      api.get<{ dishes: UpcomingDish[] }>('/api/upcoming-dishes'),
      api.get<{ recipes: RecipeSummary[] }>('/api/recipes'),
    ]);
    setDishes(d.dishes);
    setRecipes(r.recipes);
  }, []);

  useEffect(() => {
    void load().catch(() => setError('La liste n’a pas pu être chargée.'));
  }, [load]);

  const agir = async (action: () => Promise<unknown>): Promise<void> => {
    setError(null);
    try {
      await action();
      await load();
    } catch {
      setError('Le changement n’a pas pu être enregistré.');
    }
  };

  return (
    <div className="app">
      <ModalHeader title="Plats à venir" onClose={() => navigate('/')} />

      {error !== null ? <p className="empty">{error}</p> : null}
      {dishes === null && error === null ? <p className="empty">Un instant…</p> : null}

      {dishes !== null ? (
        <div className="sec" style={{ paddingTop: 14 }}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
            Au programme ({dishes.length})
          </p>
          {dishes.length === 0 ? (
            <p className="meta" style={{ lineHeight: 1.5 }}>
              Rien en attente. Ajoutez les plats de la prochaine commande
              ci-dessous : on choisira le jour même.
            </p>
          ) : (
            <div className="stack">
              {dishes.map((dish) => (
                <Ligne key={dish.id} title={dish.recipe.title} imageUrl={dish.recipe.imageUrl}
                       action="Retirer"
                       onAction={() => void agir(() => api.delete(`/api/upcoming-dishes/${dish.id}`))} />
              ))}
            </div>
          )}
        </div>
      ) : null}

      {recipes.length > 0 ? (
        <div className="sec" style={{ paddingTop: 20 }}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
            Ajouter une recette connue
          </p>
          <div className="stack">
            {recipes.map((recipe) => (
              <Ligne key={recipe.id} title={recipe.title} imageUrl={recipe.imageUrl}
                     action="Ajouter"
                     onAction={() => void agir(() =>
                       api.post('/api/upcoming-dishes', { recipeId: recipe.id }))} />
            ))}
          </div>
        </div>
      ) : null}

      <div className="fab-space" />
    </div>
  );
}

function Ligne({ title, imageUrl, action, onAction }: {
  title: string; imageUrl: string | null; action: string; onAction: () => void;
}): React.ReactElement {
  return (
    <div className="card row">
      {imageUrl !== null ? (
        <img src={imageUrl} alt=""
             style={{ width: 42, height: 42, borderRadius: 'var(--radius)', objectFit: 'cover', flexShrink: 0 }} />
      ) : (
        <span className="thumb" style={{ width: 42, height: 42 }}><IconBowl size={20} /></span>
      )}
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, lineHeight: 1.3 }}>{title}</span>
      <button type="button" className="chip" onClick={onAction}>{action}</button>
    </div>
  );
}
