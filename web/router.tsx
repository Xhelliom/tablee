/**
 * Routeur minimal sur l'API History.
 *
 * Pas de hash : `/share` doit être une vraie URL — c'est elle qu'Android ouvre
 * depuis le menu de partage, avec `?title=…&text=…&url=…` (§4). Un routeur à
 * fragment casserait le share target, qui est le chemin critique de l'app.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

interface Route {
  path: string;
  query: URLSearchParams;
}

const RouteContext = createContext<Route>({ path: '/', query: new URLSearchParams() });

const read = (): Route => ({
  path: window.location.pathname,
  query: new URLSearchParams(window.location.search),
});

export function RouterProvider({ children }: { children: ReactNode }): ReactNode {
  const [route, setRoute] = useState<Route>(read);

  useEffect(() => {
    const update = (): void => setRoute(read());
    window.addEventListener('popstate', update);
    window.addEventListener('tablee:navigate', update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('tablee:navigate', update);
    };
  }, []);

  return <RouteContext.Provider value={route}>{children}</RouteContext.Provider>;
}

export const useRoute = (): Route => useContext(RouteContext);

export function navigate(to: string, { replace = false } = {}): void {
  if (replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  window.dispatchEvent(new Event('tablee:navigate'));
  window.scrollTo(0, 0);
}

export function useNavigate(): (to: string, options?: { replace?: boolean }) => void {
  return useCallback(navigate, []);
}

/**
 * Segments du chemin courant. `/repas/abc` → `['repas', 'abc']`. Assez pour
 * une app de sept écrans ; un jour où il en faudrait plus, ce sera le moment
 * de prendre une vraie bibliothèque, pas avant.
 */
export function useSegments(): string[] {
  const { path } = useRoute();
  return useMemo(() => path.split('/').filter(Boolean), [path]);
}
