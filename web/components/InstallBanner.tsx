/**
 * L'invite d'installation de la PWA, depuis l'app elle-même.
 *
 * Le menu de Chrome propose déjà « Installer l'application », mais personne
 * ne va l'y chercher — et sans installation, pas de share target Android,
 * donc pas de partage depuis Jow (§4). D'où un bandeau qui le dit.
 *
 * Ce qu'il refuse : exister ailleurs que sur Chrome Android (et les Chromium
 * de bureau). `beforeinstallprompt` ne se déclenche que là, et seulement
 * quand l'app est installable et pas encore installée — c'est le navigateur
 * qui décide, pas nous. Partout ailleurs, le composant rend `null` et le site
 * ne change pas. Pas de mode d'emploi pour iOS : hors périmètre.
 */
import { useEffect, useState, type ReactElement } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

const KEY = 'tablee-installation-refusee';

/** `localStorage` lève en navigation privée : un refus non mémorisé n'est pas grave. */
function lire(): boolean {
  try { return window.localStorage.getItem(KEY) !== null; } catch { return false; }
}
function mémoriser(): void {
  try { window.localStorage.setItem(KEY, '1'); } catch { /* tant pis */ }
}

export function InstallBanner(): ReactElement | null {
  const [invite, setInvite] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Déjà lancée en mode application : rien à proposer.
    if (window.matchMedia('(display-mode: standalone)').matches || lire()) return;
    const onPrompt = (e: Event): void => {
      e.preventDefault(); // sinon Chrome affiche sa propre mini-barre
      setInvite(e as BeforeInstallPromptEvent);
    };
    const onInstalled = (): void => setInvite(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (invite === null) return null;

  return (
    <div className="install card" role="region" aria-label="Installer Tablée">
      <p>
        Installez Tablée sur le téléphone : elle s’ouvre comme une application,
        et Jow pourra lui envoyer ses recettes.
      </p>
      <div className="install__actions">
        <button type="button" className="btn btn--ghost" onClick={() => { mémoriser(); setInvite(null); }}>
          Plus tard
        </button>
        <button type="button" className="btn" onClick={() => { void invite.prompt(); setInvite(null); }}>
          Installer
        </button>
      </div>
    </div>
  );
}
