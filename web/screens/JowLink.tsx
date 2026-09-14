/**
 * §4, seconde porte — coller un lien Jow à la main.
 *
 * Le share target d'Android reste le chemin normal, et il ne bouge pas. Mais
 * il n'existe que là : sur un ordinateur, dans un navigateur mobile où la PWA
 * n'est pas installée, ou quand la recette arrive par SMS plutôt que par la
 * feuille de partage, il n'y avait tout simplement aucun moyen d'enregistrer
 * une recette Jow. Cet écran est ce moyen ; tout ce qui suit est partagé avec
 * `/share`, au texte collé près.
 *
 * I6 : le lien collé peut porter `key` et `userId`, qui sont des jetons de
 * compte. Deux conséquences visibles dans le code :
 *
 *   - il n'y a **pas** de route `/lien?text=…`, qui aurait été plus courte à
 *     écrire mais aurait écrit le jeton dans l'historique du navigateur ;
 *   - c'est `/api/recipes/peek` qui rend la version expurgée, et c'est elle
 *     seule qui poursuit le chemin. Le texte brut ne quitte pas cet état.
 */
import { useRef, useState } from 'react';
import { api, type PeekResponse } from '../api.ts';
import { ModalHeader } from '../components/Chrome.tsx';
import { SharedRecipe } from './Share.tsx';

export function JowLink({ onClose }: { onClose: () => void }): React.ReactElement {
  const [text, setText] = useState('');
  const [shared, setShared] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  if (shared !== null) {
    return (
      <SharedRecipe
        source={{ kind: 'partage', text: shared }}
        heading="Depuis un lien Jow"
        onClose={onClose}
        onManual={() => setShared(null)}
      />
    );
  }

  /**
   * On demande au serveur ce qu'il reconnaît plutôt que de refaire ici la
   * lecture du lien : `parseShareText` est le contrat (`docs/jow-contract.md`),
   * et une seconde expression régulière dans le front s'en écarterait au
   * premier changement de Jow. L'aller-retour ne coûte rien — `peek` ne touche
   * pas au réseau.
   */
  const submit = async (): Promise<void> => {
    setReading(true);
    setError(null);
    try {
      const { share, redacted } = await api.post<PeekResponse>('/api/recipes/peek', { text });
      if (share.jowRecipeId === null && share.url === null) {
        setError('Aucun lien Jow reconnu. Colle l’adresse complète de la recette.');
        setReading(false);
        return;
      }
      setShared(redacted);
    } catch {
      setError('Le lien n’a pas pu être lu.');
      setReading(false);
    }
  };

  /**
   * Un tap au lieu d'un appui long : sur téléphone c'est le geste qui coûte le
   * plus cher de tout l'écran. Le presse-papiers peut être refusé (permission,
   * navigateur, contexte non sécurisé) — dans ce cas on ne dit rien et on rend
   * la main au champ, qui se colle à l'ancienne.
   */
  const paste = async (): Promise<void> => {
    try {
      const clipboard = await navigator.clipboard.readText();
      if (clipboard.trim().length > 0) setText(clipboard);
    } catch {
      field.current?.focus();
    }
  };

  const empty = text.trim().length === 0;

  return (
    <div className="app">
      <ModalHeader title="Coller un lien Jow" onClose={onClose} />

      <div className="sec" style={{ paddingTop: 16 }}>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
          Colle ici l’adresse de la recette, ou le message de partage entier.
          L’app va la lire chez Jow.
        </p>

        <textarea
          ref={field}
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={3}
          placeholder="https://jow.fr/recipes/…"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="field"
          style={{ marginTop: 14, fontSize: 14, lineHeight: 1.5, resize: 'vertical' }}
        />

        {typeof navigator !== 'undefined' && navigator.clipboard !== undefined ? (
          <button type="button" className="chip" style={{ marginTop: 10, cursor: 'pointer' }}
                  onClick={() => { void paste(); }}>
            Coller
          </button>
        ) : null}

        {error !== null ? (
          <p style={{
            fontSize: 13, lineHeight: 1.5, marginTop: 12, padding: '10px 12px',
            borderRadius: 'var(--radius)',
            background: 'var(--bg-warning)', color: 'var(--text-warning)',
          }}>
            {error}
          </p>
        ) : null}

        <button type="button" className="btn" style={{ marginTop: 16 }}
                disabled={empty || reading}
                onClick={() => { void submit(); }}>
          {reading ? 'Lecture…' : 'Lire la recette'}
        </button>
      </div>
    </div>
  );
}
