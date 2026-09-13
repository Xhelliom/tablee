-- 007 — Comptes individuels, foyers multiples, et la scission compte / convive.
--
-- Renverse le §7 (« un compte par foyer ») et tranche le §16 (« si l'app sort
-- un jour du foyer »). Les deux encarts datés du 13/09/2026 de la spec
-- expliquent pourquoi ; ce fichier fait le travail.
--
-- ── L'erreur que cette migration répare ─────────────────────────────────────
--
-- Le schéma initial n'a qu'une table de personnes : `member`, qui porte un
-- `portion_coef`, un âge et des allergènes. C'est **une assiette**. Et
-- `meal.created_by` pointe dessus, c'est-à-dire que « qui a saisi » et « qui a
-- mangé » sont le même objet. Les deux ensembles ne coïncident pas :
--
--   les parents            compte + assiette
--   les enfants            assiette sans compte  (trop jeunes)
--   une nounou             compte sans assiette
--
-- D'où : `member` devient `eater`, et tout ce qui désignait « la personne qui
-- a agi » pointe désormais vers `"user"`.
--
-- ── Le partage du travail ───────────────────────────────────────────────────
--
-- better-auth possède l'identité : `user`, `session`, `account`,
-- `verification`, `organization`, `member`, `invitation`. Le DDL de ces sept
-- tables est **repris tel quel** de son générateur (`getMigrations`, version
-- 1.7.4) et figé ici — la règle du dépôt est que les migrations sont
-- numérotées et jamais modifiées après application, ce qui est incompatible
-- avec un CLI qui réécrit le schéma. Ne jamais relancer ce générateur en
-- écriture sur cette base : une montée de version se fait par une migration
-- 00x de plus.
--
-- Attention à deux collisions de noms, et c'est pour ça que l'ordre des
-- instructions ci-dessous compte :
--
--   `session`  better-auth remplace celle du §7, qui disparaît.
--   `member`   better-auth appelle ainsi le lien compte ↔ organisation.
--              Tablée appelait ainsi une assiette. D'où le renommage, **avant**
--              la création des tables d'authentification.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. L'assiette s'appelle `eater`
-- ───────────────────────────────────────────────────────────────────────────

alter table member rename to eater;
alter table member_preference rename to eater_preference;
alter table member_allergen rename to eater_allergen;

alter table eater_preference rename column member_id to eater_id;
alter table eater_allergen   rename column member_id to eater_id;
alter table meal_participant rename column member_id to eater_id;
alter table family_note      rename column member_id to eater_id;

comment on table eater is
  'Une personne dont on suit l''assiette. N''implique aucun compte : les '
  'enfants sont des convives sans identifiants. Le compte, c''est "user".';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. L'ancienne session du §7 s'en va
-- ───────────────────────────────────────────────────────────────────────────

-- Les jetons émis sous l'ancien schéma ne sont pas migrables : ils
-- authentifiaient un foyer, pas une personne. Tout le monde se reconnecte.
drop table session;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Les tables de better-auth, DDL figé
-- ───────────────────────────────────────────────────────────────────────────

create table "user" (
  "id"            text not null primary key,
  "name"          text not null,
  "email"         text not null unique,
  "emailVerified" boolean not null,
  "image"         text,
  "createdAt"     timestamptz default current_timestamp not null,
  "updatedAt"     timestamptz default current_timestamp not null
);

create table "session" (
  "id"                   text not null primary key,
  "expiresAt"            timestamptz not null,
  "token"                text not null unique,
  "createdAt"            timestamptz default current_timestamp not null,
  "updatedAt"            timestamptz not null,
  "ipAddress"            text,
  "userAgent"            text,
  "userId"               text not null references "user" ("id") on delete cascade,
  "activeOrganizationId" text
);

create table "account" (
  "id"                    text not null primary key,
  "accountId"             text not null,
  "providerId"            text not null,
  "userId"                text not null references "user" ("id") on delete cascade,
  "accessToken"           text,
  "refreshToken"          text,
  "idToken"               text,
  "accessTokenExpiresAt"  timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope"                 text,
  "password"              text,
  "createdAt"             timestamptz default current_timestamp not null,
  "updatedAt"             timestamptz not null
);

create table "verification" (
  "id"         text not null primary key,
  "identifier" text not null,
  "value"      text not null,
  "expiresAt"  timestamptz not null,
  "createdAt"  timestamptz default current_timestamp not null,
  "updatedAt"  timestamptz default current_timestamp not null
);

create table "organization" (
  "id"        text not null primary key,
  "name"      text not null,
  "slug"      text not null unique,
  "logo"      text,
  "createdAt" timestamptz not null,
  "metadata"  text
);

create table "member" (
  "id"             text not null primary key,
  "organizationId" text not null references "organization" ("id") on delete cascade,
  "userId"         text not null references "user" ("id") on delete cascade,
  "role"           text not null,
  "createdAt"      timestamptz not null
);

create table "invitation" (
  "id"             text not null primary key,
  "organizationId" text not null references "organization" ("id") on delete cascade,
  "email"          text not null,
  "role"           text,
  "status"         text not null,
  "expiresAt"      timestamptz not null,
  "createdAt"      timestamptz default current_timestamp not null,
  "inviterId"      text not null references "user" ("id") on delete cascade
);

create index "session_userId_idx"          on "session" ("userId");
create index "account_userId_idx"          on "account" ("userId");
create index "verification_identifier_idx" on "verification" ("identifier");
create index "member_organizationId_idx"   on "member" ("organizationId");
create index "member_userId_idx"           on "member" ("userId");
create index "invitation_organizationId_idx" on "invitation" ("organizationId");
create index "invitation_email_idx"        on "invitation" ("email");

comment on table "member" is
  'better-auth : appartenance d''un compte à un foyer, avec son rôle. Ce '
  'n''est PAS un convive — celui-là s''appelle "eater".';

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Le foyer garde son nom de domaine, et reçoit son identité
-- ───────────────────────────────────────────────────────────────────────────
--
-- `household` reste la table du domaine : c'est elle que référencent les dix
-- tables qui portent un `household_id`, et les renommer en `organization_id`
-- ferait entrer un mot d'authentification dans le vocabulaire métier pour rien.
-- L'organisation better-auth lui est rattachée, pas l'inverse.

alter table household
  drop column login,
  drop column password_hash,
  add  column organization_id text unique
       references "organization" ("id") on delete cascade;

-- Volontairement `null`-able. Un foyer créé avant cette migration n'a pas
-- d'organisation, donc aucun compte pour y entrer — ses identifiants viennent
-- d'être supprimés juste au-dessus. Il est inatteignable, et le rester est le
-- comportement correct : la résolution du foyer actif part toujours de
-- l'organisation. Le supprimer serait détruire des données sans qu'on l'ait
-- demandé.
comment on column household.organization_id is
  'Identité du foyer, côté better-auth. NULL = foyer antérieur à la 007, sans '
  'compte associé, donc injoignable par l''application.';

-- ───────────────────────────────────────────────────────────────────────────
-- 5. « Qui a agi » désigne un compte, plus une assiette
-- ───────────────────────────────────────────────────────────────────────────
--
-- Les valeurs existantes ne sont pas convertibles : elles désignent des
-- convives, et aucune correspondance convive → compte n'existe ni ne peut être
-- devinée. La colonne est donc refaite à neuf plutôt que traduite au jugé —
-- une attribution fausse vaut moins qu'une attribution absente.

alter table meal drop column created_by;
alter table meal add  column created_by text references "user" ("id") on delete set null;
comment on column meal.created_by is
  'Le compte qui a saisi le repas. Distinct des convives, qui sont dans '
  'meal_participant.';

alter table jow_food_link drop column confirmed_by;
alter table jow_food_link add  column confirmed_by text references "user" ("id") on delete set null;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Les recettes manuelles cessent d'être visibles par toute l'instance
-- ───────────────────────────────────────────────────────────────────────────
--
-- `recipe` n'avait pas de `household_id`, ce qui était sans conséquence tant
-- qu'un seul foyer vivait sur l'instance. Avec plusieurs, une recette saisie à
-- la main — titre libre — serait lisible par tous. Les recettes Jow, elles,
-- restent globales : c'est de la donnée publique, et la partager évite à
-- chaque foyer de la re-télécharger.

alter table recipe
  add column household_id uuid references household(id) on delete cascade;

alter table recipe add constraint recipe_portee_coherente check (
  (source = 'jow'    and household_id is null) or
  (source = 'manuel' and household_id is not null)
);

comment on column recipe.household_id is
  'NULL pour une recette Jow (publique, mutualisée entre foyers). Renseigné '
  'pour une recette saisie à la main, qui n''appartient qu''à son foyer.';

create index on recipe (household_id);
