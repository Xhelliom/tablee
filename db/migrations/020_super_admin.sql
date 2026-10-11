-- 020 — Super-admin de la plateforme, et verrous d'association.
--
-- ── Pourquoi ce fichier existe ─────────────────────────────────────────────
--
-- Jusqu'ici, Tablée ne connaissait que des rôles **de foyer** (`parent`,
-- `adulte`, migration 007) : personne ne voyait l'instance entière. Sur une
-- machine qui héberge les foyers de plusieurs familles (§16), il faut pourtant
-- quelqu'un qui puisse voir tous les comptes, réparer un rattachement
-- convive ↔ compte parti de travers, et corriger une correspondance
-- ingrédient Jow ↔ aliment Ciqual qui fausse toutes les recettes qui la
-- partagent.
--
-- D'où un rôle **de plateforme**, disjoint des rôles de foyer :
--
--   `platform_admin`  le premier compte connecté de l'instance, puis ceux qu'il
--                     désigne. Voit tout, répare les liens, verrouille ceux qui
--                     ne doivent plus bouger. Ne mange nulle part : ce n'est pas
--                     un rôle de saisie, et il ne donne aucun droit dans un foyer
--                     où l'on n'est pas membre.
--
-- ⚠️ **Premier connecté, pas premier inscrit.** L'inscription crée le compte ;
-- c'est la résolution de session (`server/auth/identity.ts`) qui promeut, une
-- seule fois, quand la table est encore vide. Un compte créé mais jamais
-- connecté ne prend la place de personne.
--
-- ── Les verrous ────────────────────────────────────────────────────────────
--
-- Une association verrouillée refuse toute modification, y compris par un
-- `parent` de son foyer : seul un super-admin peut la déverrouiller, puis la
-- modifier. Deux endroits :
--
--   `jow_food_link.locked`  la correspondance ingrédient Jow ↔ aliment, globale
--                           et propagée à toutes les recettes. La verrouiller
--                           fige aussi la propagation : `linkIngredientToFood`
--                           refuse sans `force`.
--   `eater.link_locked`     le lien convive ↔ compte (`user_id`,
--                           `claim_email`) de cette fiche. Le reste de la fiche
--                           — prénom, portion, régimes — reste modifiable : seul
--                           le lien est gelé.
--
-- Par défaut tout est déverrouillé : le verrou est un geste explicite du
-- super-admin, jamais un état initial.

create table platform_admin (
  user_id    text primary key references "user" ("id") on delete cascade,
  created_at timestamptz not null default now()
);

comment on table platform_admin is
  'Les super-admins de la plateforme. Le premier compte connecté y entre seul ; '
  'les suivants y sont ajoutés par lui. Disjoint des rôles de foyer.';

alter table jow_food_link
  add column locked boolean not null default false;

comment on column jow_food_link.locked is
  'Verrou super-admin : refuse toute modification du lien, propagation comprise.';

alter table eater
  add column link_locked boolean not null default false;

comment on column eater.link_locked is
  'Verrou super-admin sur le lien convive ↔ compte (user_id, claim_email). '
  'Le reste de la fiche reste modifiable.';
