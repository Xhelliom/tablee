/**
 * Les lettres que Jow publie pour une recette (Etiquettable les calcule).
 *
 * Un jugement porté sur un plat : jamais agrégé sur une personne ni sur le
 * foyer, jamais inventé pour un repas hors Jow — sans lettre, rien ne
 * s'affiche. En texte `meta`, sans couleur : les cinq couleurs de nutriments
 * sont réservées aux données nutritionnelles (CLAUDE.md).
 */
export function RecipeScores({ nutriScore, greenScore }: {
  nutriScore: string | null;
  greenScore: string | null;
}): React.ReactElement | null {
  const parts = [
    nutriScore !== null ? `Nutri-Score ${nutriScore}` : null,
    greenScore !== null ? `Green-Score ${greenScore}` : null,
  ].filter((p) => p !== null);
  return parts.length > 0 ? <span className="meta">{parts.join(' · ')}</span> : null;
}
