/**
 * Barre de titre et navigation.
 *
 * §8ter : le terracotta porte tout le chrome, en aplat plein. Les cinq
 * couleurs de nutriments n'apparaissent nulle part ici — ni sur l'onglet
 * actif, ni sur un badge, ni sur un fond.
 */
import type { ReactNode } from 'react';
import { navigate } from '../router.tsx';
import { useSession } from '../session.tsx';
import { IconBowl, IconHistory, IconHome, IconLogout, IconUsers, IconWeek } from '../icons.tsx';

export type Tab = 'accueil' | 'semaine' | 'historique' | 'membres';

const TABS: { tab: Tab; path: string; label: string; Icon: typeof IconHome }[] = [
  { tab: 'accueil', path: '/', label: 'Aujourd’hui', Icon: IconHome },
  { tab: 'semaine', path: '/semaine', label: 'La semaine', Icon: IconWeek },
  { tab: 'historique', path: '/historique', label: 'Historique', Icon: IconHistory },
  { tab: 'membres', path: '/membres', label: 'La famille', Icon: IconUsers },
];

export function Chrome({ tab, children }: { tab: Tab; children: ReactNode }): React.ReactElement {
  const { signOut } = useSession();

  return (
    <div className="app" style={{ display: 'flex', flexDirection: 'column' }}>
      <header className="appbar">
        <div className="appbar__brand">
          <span className="appbar__logo"><IconBowl size={14} /></span>
          Tablée
        </div>
        <button
          type="button"
          className="appbar__action"
          onClick={() => { void signOut(); }}
          aria-label="Se déconnecter"
        >
          <IconLogout size={19} />
        </button>
      </header>

      <main style={{ flex: 1 }}>{children}</main>

      <nav className="nav" aria-label="Navigation principale">
        {TABS.map(({ tab: name, path, label, Icon }) => (
          <button
            key={name}
            type="button"
            onClick={() => navigate(path)}
            aria-current={name === tab ? 'page' : undefined}
            aria-label={label}
          >
            <Icon size={21} />
          </button>
        ))}
      </nav>
    </div>
  );
}

/**
 * En-tête des écrans modaux (`/share`, `/ajouter`, détail d'un repas) : une
 * croix, un titre, rien d'autre. On y entre pour faire une chose.
 */
export function ModalHeader({
  title, onClose,
}: { title: string; onClose: () => void }): React.ReactElement {
  return (
    <header className="appbar">
      <div className="appbar__brand">
        <button type="button" className="appbar__action" onClick={onClose}
                aria-label="Fermer" style={{ color: 'var(--on-coral)' }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
        {title}
      </div>
    </header>
  );
}
