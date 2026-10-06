-- 021 — Journal des gestes super-admin.
--
-- ── Pourquoi ce fichier existe ─────────────────────────────────────────────
--
-- Deux super-admins qui se marchent dessus sans le savoir — l'un verrouille ce
-- que l'autre répare — est le mode de panne normal d'une page d'administration
-- partagée. Le remède n'est pas un verrou de plus, c'est une mémoire : qui a
-- fait quoi, quand, sur quel lien.
--
-- `admin_action` n'est donc ni un log applicatif ni une table du domaine :
-- c'est le cahier de la plateforme. Écrit par les seules routes
-- `/api/admin/*` (`consignerAction`, `server/repo/admin.ts`), lu par elles
-- seules. Aucune RLS dessus : la garde est la route elle-même, comme pour
-- `platform_admin` — une policy sur une table que seul le super-admin touche
-- n'ajouterait qu'une façon de se tromper.
--
-- `actor_user_id` tombe à NULL quand le compte est supprimé (`on delete set
-- null`) : la ligne survit à son auteur — c'est précisément à ça qu'elle
-- sert. `detail` porte l'avant et l'après quand ils sont connus sans
-- surcoût, jamais plus : un journal qui grossit d'un kilo-octet par geste
-- reste lisible dans dix ans.
--
-- Par défaut tout est permis puis consigné : le journal n'autorise ni
-- n'interdit rien, il raconte. L'autorisation reste `assertSuperAdmin`.

create table admin_action (
  id            uuid primary key default gen_random_uuid(),
  at            timestamptz not null default now(),
  actor_user_id text references "user" ("id") on delete set null,
  action        text not null,
  target        text not null default '',
  detail        jsonb not null default '{}'::jsonb
);

comment on table admin_action is
  'Le cahier du super-admin : qui a fait quoi, quand, sur quel lien. Écrit et '
  'lu par les seules routes /api/admin/*.';

create index on admin_action (at desc);
