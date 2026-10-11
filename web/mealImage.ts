/**
 * L'image d'un plat se dessine **après** son enregistrement (`POST
 * /api/meals/:id/image`, demandé sans être attendu) : l'accueil a déjà chargé
 * le repas quand elle arrive. Ce module annonce son arrivée aux écrans montés,
 * et garde les annonces récentes pour ceux qui arrivent entre-temps (un
 * détour par un autre onglet pendant la génération).
 *
 * Il ne déclenche aucune génération et ne persiste rien : passé quelques
 * minutes, un écran qui monte recharge de toute façon des données fraîches.
 * Une génération manquée n'annonce rien, et le bol dessiné reste.
 */

export interface ImageAnnoncee {
  mealId: string;
  imageUrl: string;
}

/** Au-delà, l'écran qui monte a des données plus fraîches que l'annonce. */
const RÉCENT_MS = 5 * 60_000;

let dernières: { annonce: ImageAnnoncee; at: number }[] = [];

export function annoncerImage(mealId: string, imageUrl: string): void {
  const at = Date.now();
  dernières = [...dernières, { annonce: { mealId, imageUrl }, at }]
    .filter((entrée) => at - entrée.at < RÉCENT_MS)
    .slice(-20);
  window.dispatchEvent(
    new CustomEvent<ImageAnnoncee>('tablee:image-prete', { detail: { mealId, imageUrl } }),
  );
}

/** Les images arrivées depuis peu, pour un écran qui monte après coup. */
export function imagesRécentes(): ImageAnnoncee[] {
  const now = Date.now();
  dernières = dernières.filter((entrée) => now - entrée.at < RÉCENT_MS);
  return dernières.map((entrée) => entrée.annonce);
}

/** Appelle `cb` à chaque image annoncée tant que l'écran est monté. */
export function écouterImages(cb: (annonce: ImageAnnoncee) => void): () => void {
  const handler = (event: Event): void => {
    cb((event as CustomEvent<ImageAnnoncee>).detail);
  };
  window.addEventListener('tablee:image-prete', handler);
  return () => window.removeEventListener('tablee:image-prete', handler);
}
