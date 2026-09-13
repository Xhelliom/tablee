/**
 * L'écran d'entre-deux : connecté, mais pas encore dans un foyer.
 *
 * C'est l'état `sans_foyer` — un compte tout neuf, ou quelqu'un qui appartient
 * à plusieurs foyers et n'en a pas choisi. Le renvoyer vers la connexion serait
 * lui redemander un mot de passe qu'il vient de saisir ; c'est pour ça que le
 * serveur distingue trois états et non deux.
 */
import { useState } from 'react';
import { ApiError } from '../api.ts';
import { useSession } from '../session.tsx';
import { IconBowl } from '../icons.tsx';

export function HouseholdScreen(): React.ReactElement {
  const { user, households, createHousehold, switchHousehold, signOut } = useSession();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'opération impossible');
      setBusy(false);
    }
  };

  const plusieurs = households.length > 0;

  return (
    <div className="app">
      <header className="appbar">
        <div className="appbar__brand">
          <span className="appbar__logo"><IconBowl size={14} /></span>
          Tablée
        </div>
      </header>

      <div className="sec" style={{ paddingTop: 28 }}>
        <p className="display">
          {plusieurs ? <>Quel<br />foyer ?</> : <>Votre<br />foyer</>}
        </p>
        <p className="meta" style={{ marginTop: 10 }}>
          {plusieurs
            ? 'Vous appartenez à plusieurs foyers.'
            : `Bonjour ${user?.name ?? ''}. Il reste à créer votre foyer, ou à attendre une invitation.`}
        </p>

        {plusieurs ? (
          <div className="stack" style={{ marginTop: 20 }}>
            {households.map((foyer) => (
              <button
                key={foyer.id}
                type="button"
                className="card"
                disabled={busy}
                onClick={() => {
                  void run(() => switchHousehold(foyer.organizationId ?? ''));
                }}
              >
                <span style={{ fontSize: 16 }}>{foyer.name}</span>
                <span className="meta">{foyer.role === 'parent' ? 'Parent' : 'Adulte'}</span>
              </button>
            ))}
          </div>
        ) : null}

        <form
          onSubmit={(e) => { e.preventDefault(); void run(() => createHousehold(name.trim())); }}
          style={{ marginTop: plusieurs ? 28 : 24 }}
          className="stack"
        >
          <div>
            <label className="label" htmlFor="foyer">
              {plusieurs ? 'Ou créer un nouveau foyer' : 'Nom du foyer'}
            </label>
            <input
              id="foyer" className="field" value={name} placeholder="Chez nous"
              onChange={(e) => setName(e.target.value)} required maxLength={80}
            />
          </div>

          {error !== null ? <p style={{ fontSize: 13, color: 'var(--text-warning)' }}>{error}</p> : null}

          <button className="btn" type="submit" disabled={busy || name.trim() === ''}>
            {busy ? 'Un instant…' : 'Créer le foyer'}
          </button>
        </form>

        <p className="meta" style={{ marginTop: 20, lineHeight: 1.6 }}>
          Vous en serez <b>parent</b> : vous pourrez inviter les autres adultes
          et gérer qui a accès.
        </p>

        <button
          type="button" className="btn btn--quiet" style={{ marginTop: 20 }}
          onClick={() => { void signOut(); }}
        >
          Se déconnecter
        </button>
      </div>
    </div>
  );
}
