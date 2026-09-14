/**
 * État partagé : le compte, le foyer actif, et les convives.
 *
 * Le §7 a été renversé le 13/09/2026 — comptes individuels, foyers multiples.
 * Le sélecteur « c'est moi » disparaît donc : ce n'est plus une préférence
 * locale mais le compte connecté qui dit qui saisit, et `meal.created_by` le
 * porte côté serveur.
 *
 * ── Trois états, et non deux ────────────────────────────────────────────────
 *
 * `anonyme` amène la connexion. `sans_foyer` amène « crée ou rejoins un
 * foyer » — **pas** la connexion : la personne est connectée, lui redemander
 * son mot de passe serait absurde. `actif` amène l'app. Les confondre est
 * l'erreur la plus facile à commettre ici, d'où un type qui l'interdit.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, type Eater } from './api.ts';

export interface Household {
  id: string;
  name: string;
  timezone?: string;
  organizationId?: string;
}

export interface HouseholdChoice extends Household {
  role: Role;
}

export type Role = 'parent' | 'adulte';

export interface Account {
  id: string;
  email: string;
  name: string;
}

/** Ce que rend `GET /api/me`. */
type Me =
  | { state: 'anonyme' }
  | { state: 'sans_foyer'; user: Account; households: HouseholdChoice[] }
  | {
      state: 'actif';
      user: Account;
      household: Household;
      role: Role;
      households: HouseholdChoice[];
    };

interface SessionValue {
  loading: boolean;
  state: Me['state'];
  user: Account | null;
  household: Household | null;
  /** Le rôle dans le foyer actif. `parent` gère les accès, `adulte` saisit. */
  role: Role | null;
  /** Tous les foyers du compte — une personne peut en avoir plusieurs. */
  households: HouseholdChoice[];
  eaters: Eater[];
  refreshEaters: () => Promise<void>;
  reload: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  /** `true` quand l'adresse doit d'abord être confirmée : pas de session alors. */
  signUp: (email: string, password: string, name: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  createHousehold: (name: string) => Promise<void>;
  switchHousehold: (organizationId: string) => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<Me>({ state: 'anonyme' });
  const [eaters, setEaters] = useState<Eater[]>([]);

  const refreshEaters = useCallback(async () => {
    const { eaters: list } = await api.get<{ eaters: Eater[] }>('/api/eaters');
    setEaters(list);
  }, []);

  const load = useCallback(async () => {
    const next = await api.get<Me>('/api/me');
    setMe(next);
    if (next.state === 'actif') await refreshEaters().catch(() => setEaters([]));
    else setEaters([]);
    setLoading(false);
  }, [refreshEaters]);

  useEffect(() => {
    void load().catch(() => setLoading(false));
  }, [load]);

  const reload = useCallback(async () => {
    setLoading(true);
    await load();
  }, [load]);

  const value = useMemo<SessionValue>(() => {
    const user = me.state === 'anonyme' ? null : me.user;
    const household = me.state === 'actif' ? me.household : null;
    const role = me.state === 'actif' ? me.role : null;
    const households = me.state === 'anonyme' ? [] : me.households;

    return {
      loading,
      state: me.state,
      user,
      household,
      role,
      households,
      eaters,
      refreshEaters,
      reload,

      /**
       * `callbackURL` : où ramène le lien de confirmation d'adresse, quand
       * l'instance envoie des mails — une invitation ouverte avant d'avoir un
       * compte y survit. Le chemin **seul** : sur `/share`, la query porte le
       * texte de partage Jow et son jeton `key` (I6), qui finirait dans un mail.
       */
      signIn: async (email, password) => {
        await api.post('/api/auth/sign-in/email', { email, password, callbackURL: window.location.pathname });
        await reload();
      },

      signUp: async (email, password, name) => {
        const { token } = await api.post<{ token: string | null }>(
          '/api/auth/sign-up/email',
          { email, password, name, callbackURL: window.location.pathname },
        );
        // Pas de session : l'adresse est à confirmer. Surtout pas de `reload`,
        // qui démonterait l'écran de connexion et le message qui le dit.
        if (token === null) return true;
        await reload();
        return false;
      },

      signOut: async () => {
        await api.post('/api/auth/sign-out');
        setMe({ state: 'anonyme' });
        setEaters([]);
      },

      /**
       * Le foyer se crée en créant l'organisation : le serveur crée le foyer
       * dans la foulée, pour qu'aucune organisation n'existe sans le sien.
       */
      createHousehold: async (name) => {
        const created = await api.post<{ id: string }>('/api/auth/organization/create', {
          name,
          slug: slugify(name),
        });
        await api.post('/api/auth/organization/set-active', { organizationId: created.id });
        await reload();
      },

      switchHousehold: async (organizationId) => {
        await api.post('/api/auth/organization/set-active', { organizationId });
        await reload();
      },
    };
  }, [loading, me, eaters, refreshEaters, reload]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/**
 * Un identifiant d'URL lisible pour le foyer.
 *
 * Le suffixe aléatoire n'est pas cosmétique : le slug est **unique sur toute
 * l'instance**, et deux familles qui appellent leur foyer « Maison » — ce qui
 * arrivera — verraient la seconde création échouer sans comprendre pourquoi.
 */
function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 32);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base.length > 0 ? base : 'foyer'}-${suffix}`;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value === null) throw new Error('useSession hors de SessionProvider');
  return value;
}
