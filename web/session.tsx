/**
 * État partagé : la session du foyer et la liste des membres.
 *
 * §7 — un compte par foyer, pas de compte individuel. Le sélecteur « c'est
 * moi » dit qui saisit ; il ne protège rien, et c'est voulu : chaque barrière
 * de plus est une saisie de moins.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, type Member } from './api.ts';

interface Household {
  id: string;
  name: string;
  timezone?: string;
}

interface SessionValue {
  loading: boolean;
  household: Household | null;
  members: Member[];
  /** Qui saisit — mémorisé localement, jamais envoyé au serveur comme identité. */
  currentMemberId: string | null;
  setCurrentMemberId: (id: string | null) => void;
  refreshMembers: () => Promise<void>;
  signIn: (login: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

const STORAGE_KEY = 'tablee.currentMember';

export function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const [loading, setLoading] = useState(true);
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [currentMemberId, setCurrent] = useState<string | null>(
    () => window.localStorage.getItem(STORAGE_KEY),
  );

  const refreshMembers = useCallback(async () => {
    const { members: list } = await api.get<{ members: Member[] }>('/api/members');
    setMembers(list);
  }, []);

  const load = useCallback(async () => {
    const session = await api.get<{ authenticated: boolean; household?: Household }>(
      '/api/auth/session',
    );
    if (session.authenticated && session.household !== undefined) {
      setHousehold(session.household);
      await refreshMembers();
    } else {
      setHousehold(null);
      setMembers([]);
    }
    setLoading(false);
  }, [refreshMembers]);

  useEffect(() => {
    void load().catch(() => setLoading(false));
  }, [load]);

  const setCurrentMemberId = useCallback((id: string | null) => {
    setCurrent(id);
    if (id === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      loading,
      household,
      members,
      currentMemberId,
      setCurrentMemberId,
      refreshMembers,
      signIn: async (login, password) => {
        await api.post('/api/auth/login', { login, password });
        setLoading(true);
        await load();
      },
      signOut: async () => {
        await api.post('/api/auth/logout');
        setHousehold(null);
        setMembers([]);
      },
    }),
    [loading, household, members, currentMemberId, setCurrentMemberId, refreshMembers, load],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value === null) throw new Error('useSession hors de SessionProvider');
  return value;
}
