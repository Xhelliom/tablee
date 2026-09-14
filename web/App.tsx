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
import { LoginScreen, ResetPasswordScreen } from './screens/Login.tsx';
import { TodayScreen } from './screens/Today.tsx';
import { ShareScreen } from './screens/Share.tsx';
import { QuickAddScreen } from './screens/QuickAdd.tsx';
import { MealDetailScreen } from './screens/MealDetail.tsx';
import { WeekScreen } from './screens/Week.tsx';
import { HistoryScreen } from './screens/History.tsx';
import { EatersScreen } from './screens/Eaters.tsx';
import { HouseholdScreen } from './screens/Household.tsx';
import { OnboardingScreen } from './screens/Onboarding.tsx';
import { AcceptInvitationScreen } from './screens/Invitation.tsx';
import { HouseholdSettingsScreen } from './screens/HouseholdSettings.tsx';

export function App(): ReactElement {
  return (
    <SessionProvider>
      <Routes />
    </SessionProvider>
  );
}

function Routes(): ReactElement {
  const segments = useSegments();
  const { loading, state, eaters } = useSession();

  if (loading) {
    return (
      <div className="app">
        <p className="empty">Un instant…</p>
      </div>
    );
  }

  /**
   * L'invitation passe **avant** la porte : son lien doit fonctionner pour
   * quelqu'un qui n'a pas encore de compte. L'écran affiche alors la connexion
   * sans quitter l'URL, et l'acceptation reprend ensuite — même règle que pour
   * `/share`, qui ne doit jamais perdre ce qu'on était en train de faire.
   */
  const invitation = segments[0] === 'invitation' ? segments[1] : undefined;

  // Le lien de réinitialisation arrive par mail, par définition sans session.
  if (segments[0] === 'reinitialiser') return <ResetPasswordScreen />;
  if (state === 'anonyme') return <LoginScreen />;
  if (invitation !== undefined) return <AcceptInvitationScreen invitationId={invitation} />;
  if (state === 'sans_foyer') return <HouseholdScreen />;

  /**
   * Un foyer sans convive n'a rien à afficher, et surtout rien à enregistrer :
   * un repas sans assiette n'a personne à qui être attribué. On accueille donc
   * plutôt que de montrer une page vide.
   *
   * ⚠️ **`/share` en est exclu.** Android l'ouvre avec la recette dans l'URL ;
   * détourner cette navigation vers l'accueil perdrait ce que l'utilisateur
   * était en train de faire — la même règle que pour l'invitation, et le
   * chemin critique du produit.
   */
  if (eaters.length === 0 && segments[0] !== 'share') return <OnboardingScreen />;

  switch (segments[0]) {
    case 'bienvenue':
      return <OnboardingScreen />;
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
    case 'foyer':
      return <HouseholdSettingsScreen />;
    case 'membres':
      return <Chrome tab="membres"><EatersScreen /></Chrome>;
    default:
      return (
        <Chrome tab="accueil">
          <p className="empty">Cette page n’existe pas.</p>
        </Chrome>
      );
  }
}
