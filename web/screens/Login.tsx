/**
 * Connexion et inscription.
 *
 * Le §7 a été renversé : chacun son compte, et l'inscription est **ouverte** —
 * des amis doivent pouvoir créer leur foyer sans passer par l'hébergeur (§16).
 *
 * Un seul écran pour les deux gestes, parce que la question « ai-je déjà un
 * compte ? » n'a pas à coûter une navigation. Le formulaire change, pas la
 * page.
 */
import { useState } from 'react';
import { ApiError } from '../api.ts';
import { useSession } from '../session.tsx';
import { IconBowl } from '../icons.tsx';

/** Même minimum que le serveur. Le dire avant, pas après le refus. */
const MIN_MOT_DE_PASSE = 12;

export function LoginScreen(): React.ReactElement {
  const { signIn, signUp } = useSession();
  const [mode, setMode] = useState<'connexion' | 'inscription'>('connexion');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const inscription = mode === 'inscription';

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (inscription) await signUp(email, password, name.trim());
      else await signIn(email, password);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? messageLisible(cause, inscription)
          : inscription
            ? 'inscription impossible'
            : 'connexion impossible',
      );
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
        <p className="display">
          {inscription ? <>Bienvenue<br />à table</> : <>Bonjour<br />la maison</>}
        </p>
        <p className="meta" style={{ marginTop: 10 }}>
          {inscription
            ? 'Un compte par personne. Le foyer se crée juste après.'
            : 'Le suivi alimentaire de la famille, un plat à la fois.'}
        </p>

        <form onSubmit={(e) => { void submit(e); }} style={{ marginTop: 24 }} className="stack">
          {inscription ? (
            <div>
              <label className="label" htmlFor="name">Votre prénom</label>
              <input
                id="name" className="field" value={name} autoComplete="given-name"
                onChange={(e) => setName(e.target.value)} required
              />
            </div>
          ) : null}

          <div>
            <label className="label" htmlFor="email">Adresse e-mail</label>
            <input
              id="email" className="field" type="email" value={email}
              autoComplete={inscription ? 'email' : 'username'}
              onChange={(e) => setEmail(e.target.value)} required
            />
          </div>

          <div>
            <label className="label" htmlFor="password">Mot de passe</label>
            <input
              id="password" className="field" type="password" value={password}
              autoComplete={inscription ? 'new-password' : 'current-password'}
              minLength={inscription ? MIN_MOT_DE_PASSE : undefined}
              onChange={(e) => setPassword(e.target.value)} required
            />
            {inscription ? (
              <p className="meta" style={{ marginTop: 6 }}>
                {MIN_MOT_DE_PASSE} caractères au moins.
              </p>
            ) : null}
          </div>

          {error !== null ? <p style={{ fontSize: 13, color: 'var(--text-warning)' }}>{error}</p> : null}

          <button className="btn" type="submit" disabled={busy}>
            {busy
              ? 'Un instant…'
              : inscription ? 'Créer mon compte' : 'Entrer'}
          </button>
        </form>

        <button
          type="button"
          className="btn btn--quiet"
          style={{ marginTop: 14 }}
          onClick={() => { setMode(inscription ? 'connexion' : 'inscription'); setError(null); }}
        >
          {inscription ? 'J’ai déjà un compte' : 'Créer un compte'}
        </button>
      </div>
    </div>
  );
}

/**
 * Les messages de better-auth sont en anglais et parlent de « credentials ».
 * Les deux cas qui arrivent vraiment méritent une phrase qui aide.
 */
function messageLisible(error: ApiError, inscription: boolean): string {
  if (error.status === 401 || error.code === 'INVALID_EMAIL_OR_PASSWORD') {
    return 'Adresse ou mot de passe incorrect.';
  }
  if (error.status === 422 || /exist/i.test(error.message)) {
    return inscription
      ? 'Un compte existe déjà avec cette adresse.'
      : error.message;
  }
  return error.message;
}
