/**
 * Vérifie au démarrage que l'étanchéité entre foyers est réellement en place.
 *
 * ── Pourquoi ce fichier existe ──────────────────────────────────────────────
 *
 * La migration 008 pose des policies Row-Level Security, et le §16 en fait une
 * garantie du produit : un foyer ne voit pas les données d'un autre, y compris
 * quand une requête a oublié son `where`.
 *
 * Sauf qu'un **superutilisateur Postgres contourne la RLS**, et il le fait en
 * silence : les policies existent, `\d` les affiche, les requêtes passent, et
 * pas une ligne de journal ne signale qu'elles ne filtrent rien. C'est
 * exactement arrivé pendant l'écriture de cette migration — 178 tests au vert
 * avec une isolation entièrement décorative, parce que le rôle de
 * développement avait été créé superutilisateur.
 *
 * Un verrou dont on ne peut pas dire s'il est fermé est pire que pas de verrou :
 * on cesse de vérifier. D'où cette vérification, qui ne coûte qu'une requête au
 * démarrage, et qui **empêche de servir** plutôt que d'avertir. Une alerte dans
 * un journal que personne ne lit n'aurait rien changé au cas ci-dessus.
 */
import type pg from 'pg';

/** Les tables dont la 008 dit qu'elles doivent être sous policy. */
const TABLES_SCOPÉES = [
  'eater', 'meal', 'meal_template', 'family_note', 'weekly_insight', 'recipe',
  'household_recipe',
];

export class IsolationError extends Error {}

interface Diagnostic {
  superuser: boolean;
  /** Tables attendues sous RLS qui ne le sont pas, ou pas en `force`. */
  sansPolicy: string[];
}

export async function diagnoseIsolation(db: pg.Pool): Promise<Diagnostic> {
  const { rows: roleRows } = await db.query<{ superuser: boolean }>(
    'select rolsuper as superuser from pg_roles where rolname = current_user',
  );

  const { rows: tableRows } = await db.query<{ relname: string }>(
    `select c.relname
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = any($1)
       and (c.relrowsecurity = false or c.relforcerowsecurity = false)`,
    [TABLES_SCOPÉES],
  );

  return {
    superuser: roleRows[0]?.superuser ?? false,
    sansPolicy: tableRows.map((r) => r.relname).sort(),
  };
}

/**
 * Lève si l'isolation n'est pas effective. À appeler avant d'écouter : servir
 * sans elle reviendrait à promettre aux familles invitées quelque chose qui
 * n'est pas vrai.
 */
export async function assertIsolation(db: pg.Pool): Promise<void> {
  const { superuser, sansPolicy } = await diagnoseIsolation(db);
  const problèmes: string[] = [];

  if (superuser) {
    problèmes.push(
      'Le rôle de connexion est superutilisateur, et un superutilisateur ' +
        'contourne la RLS : les policies de la 008 ne filtrent rien.\n' +
        '  Corriger :  ALTER ROLE <role> NOSUPERUSER;\n' +
        "  (le rôle reste propriétaire de ses tables, les migrations continuent de passer)",
    );
  }

  if (sansPolicy.length > 0) {
    problèmes.push(
      `Tables sans RLS active et forcée : ${sansPolicy.join(', ')}.\n` +
        '  Corriger :  npm run migrate',
    );
  }

  if (problèmes.length > 0) {
    throw new IsolationError(
      "L'étanchéité entre foyers n'est pas effective — le serveur ne démarre pas.\n\n" +
        problèmes.map((p) => `• ${p}`).join('\n\n') +
        '\n\nVoir db/migrations/008_rls.sql et le §16 de la spec.',
    );
  }
}
