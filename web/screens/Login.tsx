/**
 * §7 — connexion du foyer. Un identifiant, un mot de passe, 30 jours.
 *
 * Le compte se crée en ligne de commande (`npm run household`) : il n'y a pas
 * d'inscription, l'app est auto-hébergée et le foyer est unique.
 */
import { useState } from 'react';
import { ApiError } from '../api.ts';
import { useSession } from '../session.tsx';
import { IconBowl } from '../icons.tsx';

export function LoginScreen(): React.ReactElement {
  const { signIn } = useSession();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(login, password);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'connexion impossible');
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <header className="appbar">
        <div className="appbar__brand">
          <span className="appbar__logo"><IconBowl size={14} /></span>
          Tablée
        </div>
      </header>

      <div className="sec" style={{ paddingTop: 28 }}>
        <p className="display">Bonjour<br />la maison</p>
        <p className="meta" style={{ marginTop: 10 }}>
          Un seul compte pour tout le foyer.
        </p>

        <form onSubmit={(e) => { void submit(e); }} style={{ marginTop: 24 }} className="stack">
          <div>
            <label className="label" htmlFor="login">Identifiant du foyer</label>
            <input
              id="login" className="field" value={login} autoComplete="username"
              onChange={(e) => setLogin(e.target.value)} required
            />
          </div>
          <div>
            <label className="label" htmlFor="password">Mot de passe</label>
            <input
              id="password" className="field" type="password" value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)} required
            />
          </div>
          {error !== null ? (
            <p style={{ fontSize: 13, color: 'var(--text-warning)' }}>{error}</p>
          ) : null}
          <button type="submit" className="btn" disabled={busy}>
            {busy ? 'Connexion…' : 'Entrer'}
          </button>
        </form>
      </div>
    </div>
  );
}
