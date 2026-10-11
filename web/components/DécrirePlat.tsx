/**
 * Décrire (ou photographier) un plat, et le faire découper par l'IA — le
 * composant commun à la saisie d'un repas et à la fiche qui le complète.
 *
 * Rien n'est écrit ici : `POST /api/meals/decoupage` propose des lignes
 * rapprochées de Ciqual, grammes estimés compris, et l'écran ajoute ce que la
 * personne garde. La photo est réduite ici (1280 px, JPEG), n'est **pas
 * conservée**, et `onPhoto` prévient l'écran quand c'est elle qui a servi —
 * au repas né de ces lignes d'en porter la source, pas à la fiche qui
 * complète un repas déjà enregistré. Ce qui part chez Anthropic, et pourquoi :
 * en-tête de `server/llm/decoupage.ts`.
 */
import { useState } from 'react';
import { api, ApiError, type FoodSummary } from '../api.ts';

/** Ce que rend `POST /api/meals/decoupage`. */
export interface LignesDécoupées {
  /** La description reformulée en titre de plat ; `null` si le modèle n'en a pas donné. */
  title: string | null;
  /** Le texte découpé — vide quand c'est la photo qui a servi. */
  texte: string;
  items: { label: string; grams: number | null; foodId: string | null; foods: FoodSummary[] }[];
}

/** Ce que le téléphone a pris, réduit : une photo brute pèse des Mo, le modèle n'en lit pas mieux. */
async function réduire(file: File): Promise<{ mimeType: 'image/jpeg'; data: string }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const ratio = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const url = canvas.toDataURL('image/jpeg', 0.8);
  return { mimeType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) };
}

export function DécrirePlat({
  personnes, onDécoupé, onPhoto, onChargement,
}: {
  /** Pour combien le plat a été préparé : les grammes estimés valent pour ce nombre-là. */
  personnes: number;
  onDécoupé: (lignes: LignesDécoupées) => void;
  /** Appelé quand c'est la photo qui a servi — l'écran en fera la source du repas. */
  onPhoto?: () => void;
  /** Le modèle est en train de répondre : l'écran peut figer ce qui dépend du découpage. */
  onChargement?: (enCours: boolean) => void;
}): React.ReactElement {
  const [description, setDescription] = useState('');
  const [découpage, setDécoupage] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const découper = async (file?: File): Promise<void> => {
    const texte = description.trim();
    if ((texte === '' && file === undefined) || découpage) return;
    setDécoupage(true);
    onChargement?.(true);
    setErreur(null);
    try {
      const photo = file === undefined ? undefined : await réduire(file);
      const { title, items } = await api.post<{ title: string | null; items: LignesDécoupées['items'] }>(
        '/api/meals/decoupage',
        { text: texte, personnes, ...(photo === undefined ? {} : { photo }) },
      );
      if (photo !== undefined) onPhoto?.();
      onDécoupé({ title, texte, items });
      if (texte !== '') setDescription('');
    } catch (cause) {
      setErreur(cause instanceof ApiError ? cause.message : 'le découpage n’a pas abouti');
    }
    setDécoupage(false);
    onChargement?.(false);
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); void découper(); }}>
      <label className="display" htmlFor={`description-plat-${personnes}`} style={titre}>
        Décrivez<br />votre plat
      </label>
      <p className="meta" style={{ margin: '8px 0 14px', lineHeight: 1.5 }}>
        L’IA le découpe en aliments pour {personnes > 1 ? `${personnes} personnes` : 'une personne'}, vous
        vérifiez avant de l’ajouter.
      </p>
      <textarea
        id={`description-plat-${personnes}`} className="field" rows={3} maxLength={500}
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
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button type="submit" className="btn"
                disabled={découpage || description.trim() === ''}>
          {découpage ? 'Découpage…' : 'Découper avec l’IA'}
        </button>
        {/* Un label, pas un bouton : c'est le champ fichier qui ouvre l'appareil photo. */}
        <label className="btn btn--ghost" aria-disabled={découpage}
               style={découpage ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
          Photographier le plat
          <input
            type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
            disabled={découpage}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file !== undefined) void découper(file);
            }}
          />
        </label>
      </div>
      <p className="meta" style={{ marginTop: 8, lineHeight: 1.5 }}>
        Ne cadrez que l’assiette, sans personne. La photo sert au découpage et n’est pas conservée.
      </p>
      {erreur !== null ? (
        <p style={{ fontSize: 13, color: 'var(--text-warning)', marginTop: 8 }}>{erreur}</p>
      ) : null}
    </form>
  );
}

const titre: React.CSSProperties = { display: 'block', fontSize: 28 };