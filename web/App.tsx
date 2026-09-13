/**
 * Coquille de l'app : barre de titre terracotta, écran courant, navigation
 * basse.
 *
 * `/share` sort du cadre : l'écran de réception d'un partage Jow n'a ni
 * navigation basse ni retour à l'accueil. Android l'ouvre par-dessus une autre
 * app, l'utilisateur valide et repart — c'est un chemin, pas une destination.
 */
import type { ReactElement } from 'react';
import { useSegments } from './router.tsx';
import { SessionProvider, useSession } from './session.tsx';
import { Chrome } from './components/Chrome.tsx';
import { LoginScreen } from './screens/Login.tsx';
import { TodayScreen } from './screens/Today.tsx';
import { ShareScreen } from './screens/Share.tsx';
import { QuickAddScreen } from './screens/QuickAdd.tsx';
import { MealDetailScreen } from './screens/MealDetail.tsx';
import { WeekScreen } from './screens/Week.tsx';
import { HistoryScreen } from './screens/History.tsx';
import { MembersScreen } from './screens/Members.tsx';

export function App(): ReactElement {
  return (
    <SessionProvider>
      <Routes />
    </SessionProvider>
  );
}

function Routes(): ReactElement {
  const segments = useSegments();
  const { loading, household } = useSession();

  if (loading) {
    return (
      <div className="app">
        <p className="empty">Un instant…</p>
      </div>
    );
  }

  if (household === null) return <LoginScreen />;

  switch (segments[0]) {
    case undefined:
      return <Chrome tab="accueil"><TodayScreen /></Chrome>;
    case 'share':
      return <ShareScreen />;
    case 'ajouter':
      return <QuickAddScreen />;
    case 'repas':
      return segments[1] === undefined
        ? <Chrome tab="accueil"><TodayScreen /></Chrome>
        : <MealDetailScreen mealId={segments[1]} />;
    case 'semaine':
      return <Chrome tab="semaine"><WeekScreen /></Chrome>;
    case 'historique':
      return <Chrome tab="historique"><HistoryScreen /></Chrome>;
    case 'membres':
      return <Chrome tab="membres"><MembersScreen /></Chrome>;
    default:
      return (
        <Chrome tab="accueil">
          <p className="empty">Cette page n’existe pas.</p>
        </Chrome>
      );
  }
}
