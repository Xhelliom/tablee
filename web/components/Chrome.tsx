/**
 * Barre de titre et navigation.
 *
 * §8ter : le terracotta porte tout le chrome, en aplat plein. Les cinq
 * couleurs de nutriments n'apparaissent nulle part ici — ni sur l'onglet
 * actif, ni sur un badge, ni sur un fond.
 *
 * En haut à droite, le compte et non la sortie. Le bouton déconnectait d'un
 * seul tap, et un tap malencontreux perdait la session : « Se déconnecter »
 * vit désormais dans le menu qu'il ouvre, à deux gestes.
 */
import { useRef, type ReactNode } from 'react';
import { navigate } from '../router.tsx';
import { useSession } from '../session.tsx';
import { IconBowl, IconChat, IconHistory, IconHome, IconUsers, IconWeek } from '../icons.tsx';
import { Avatar, accountSeed } from './Avatar.tsx';

export type Tab = 'accueil' | 'semaine' | 'historique' | 'conseils' | 'membres';

const TABS: { tab: Tab; path: string; label: string; Icon: typeof IconHome }[] = [
  { tab: 'accueil', path: '/', label: 'Aujourd’hui', Icon: IconHome },
  { tab: 'semaine', path: '/semaine', label: 'La semaine', Icon: IconWeek },
  { tab: 'historique', path: '/historique', label: 'Historique', Icon: IconHistory },
  { tab: 'conseils', path: '/conseils', label: 'Conseils', Icon: IconChat },
  { tab: 'membres', path: '/membres', label: 'La famille', Icon: IconUsers },
];

export function Chrome({ tab, children }: { tab: Tab; children: ReactNode }): React.ReactElement {
  const { user, signOut, ia, eaters } = useSession();
  const menu = useRef<HTMLDivElement>(null);
  const seed = user === null ? null : accountSeed(user.id, eaters);

  return (
    <div className="app" style={{ display: 'flex', flexDirection: 'column' }}>
      <header className="appbar">
        <div className="appbar__brand">
          <span className="appbar__logo"><IconBowl size={14} /></span>
          Tablée
        </div>
        {/* ponytail: `popover` natif — le clic ailleurs et Échap le ferment sans une ligne de JS. */}
        <button
          type="button"
          className="appbar__profil"
          popoverTarget="menu-compte"
          aria-label={`Votre compte : ${user?.name ?? ''}`}
        >
          {seed === null ? '?' : <Avatar seed={seed} size={28} />}
        </button>
        <div id="menu-compte" popover="auto" ref={menu} className="menu card">
          <div style={{ padding: '8px 14px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
            {seed === null ? null : <Avatar seed={seed} size={36} />}
            <div>
              <p style={{ fontSize: 14 }}>{user?.name}</p>
              <p className="meta" style={{ marginTop: 2 }}>{user?.email}</p>
            </div>
          </div>
          <button
            type="button" className="row"
            onClick={() => { menu.current?.hidePopover(); navigate('/profil'); }}
          >
            Votre profil
          </button>
          <button type="button" className="row" onClick={() => { void signOut(); }}>
            Se déconnecter
          </button>
        </div>
      </header>

      <main style={{ flex: 1 }}>{children}</main>

      <nav className="nav" aria-label="Navigation principale">
        {/* Sans clé API côté serveur, pas d'onglet qui mènerait à un refus. */}
        {TABS.filter(({ tab: name }) => ia || name !== 'conseils').map(({ tab: name, path, label, Icon }) => (
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
