/**
 * §7 — connexion du foyer.
 *
 * Un compte, un mot de passe, une session de 30 jours. Pas de PIN par membre :
 * le sélecteur « c'est moi » de l'app dit qui saisit, il ne protège rien, et
 * c'est exactement ce qu'on veut — chaque barrière de plus est une saisie de
 * moins.
 */
import type { FastifyInstance } from 'fastify';
import { verifyPassword } from '../auth/password.ts';
import { COOKIE_NAME, createSession, destroySession, SESSION_DAYS } from '../auth/session.ts';
import { ApiError } from '../http/errors.ts';
import { body, str } from '../http/validate.ts';
import type { AppContext } from '../app.ts';

/**
 * `Secure` par défaut : le share target Android **exige** HTTPS (§4), donc la
 * production est en HTTPS de toute façon. `TABLEE_INSECURE_COOKIE=1` existe
 * pour le développement en local sur http://localhost, et nulle part ailleurs.
 */
function cookieOptions(maxAgeSeconds: number): Record<string, unknown> {
  return {
    path: '/',
    httpOnly: true,
    secure: process.env['TABLEE_INSECURE_COOKIE'] !== '1',
    sameSite: 'lax' as const,
    maxAge: maxAgeSeconds,
  };
}

export function authRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/auth/login', async (request, reply) => {
    const input = body(request.body);
    const login = str(input['login'], 'login', { max: 120 });
    const password = str(input['password'], 'password', { max: 200 });

    const { rows } = await ctx.pool.query<{ id: string; password_hash: string; name: string }>(
      'select id, password_hash, name from household where login = $1',
      [login],
    );
    const household = rows[0];

    // Même message et même coût pour un identifiant inconnu que pour un mot de
    // passe faux : sinon la page de connexion devient un annuaire.
    const ok =
      household !== undefined && (await verifyPassword(household.password_hash, password));
    if (!ok || household === undefined) {
      throw new ApiError(401, 'identifiants_invalides', 'identifiant ou mot de passe incorrect');
    }

    const session = await createSession(ctx.pool, household.id);
    reply.setCookie(COOKIE_NAME, session.token, cookieOptions(SESSION_DAYS * 24 * 3600));
    return { household: { id: household.id, name: household.name } };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[COOKIE_NAME];
    if (token !== undefined) await destroySession(ctx.pool, token);
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  /**
   * Sert au front à savoir s'il doit afficher l'écran de connexion. Absent du
   * tableau du §12, mais une PWA qui ouvre sur un formulaire alors que la
   * session est valide, c'est un tap perdu à chaque lancement.
   */
  app.get('/api/auth/session', async (request) => {
    const session = request.session;
    if (session === null) return { authenticated: false };
    const { rows } = await ctx.pool.query<{ id: string; name: string; timezone: string }>(
      'select id, name, timezone from household where id = $1',
      [session.householdId],
    );
    const household = rows[0];
    if (household === undefined) return { authenticated: false };
    return { authenticated: true, household };
  });
}
