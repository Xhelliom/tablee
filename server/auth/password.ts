/**
 * §7 — mot de passe du foyer, haché en argon2id.
 *
 * Un seul compte pour tout le foyer : app auto-hébergée, usage familial. Le
 * jour où l'app sort du foyer, ce choix est à revoir en entier (§16) — ce
 * n'est pas un changement d'échelle mais de nature.
 */
import { Algorithm, hash, verify } from '@node-rs/argon2';

/**
 * Paramètres OWASP pour argon2id (19 Mio, 2 passes, parallélisme 1). Le coût
 * mémoire est ce qui compte : un foyer se connecte quelques fois par mois,
 * 19 Mio par vérification ne gêne personne et renchérit sérieusement une
 * attaque hors ligne.
 */
const OPTIONS = { algorithm: Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < 8) {
    throw new Error('le mot de passe du foyer doit faire au moins 8 caractères');
  }
  return hash(plain, OPTIONS);
}

/**
 * Vérifie un mot de passe. Un hash illisible en base renvoie `false` au lieu
 * de lever : un enregistrement abîmé ne doit pas transformer un échec de
 * connexion en erreur 500, qui en dirait plus long à qui essaie.
 */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain, OPTIONS);
  } catch {
    return false;
  }
}
