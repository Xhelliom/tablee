-- 011 — quelles recettes un foyer connaît.
--
-- ── Pourquoi ce fichier existe ──────────────────────────────────────────────
--
-- La 007 a tranché, et elle a eu raison : une recette Jow est **globale**
-- (`household_id is null`), parce que c'est de la donnée publique et que la
-- mutualiser évite à chaque foyer de retélécharger les mêmes pages. Seule une
-- recette saisie à la main — titre libre, « Blanquette de mamie Jeanne » —
-- appartient à son foyer.
--
-- Ce qu'il manquait : **qui a importé quoi**. Tant que rien n'affichait la
-- liste des recettes, la question ne se posait pas. Dès qu'un écran la montre,
-- deux choses cassent d'un coup :
--
--   1. Un foyer verrait les recettes lues par le foyer d'à côté. Le titre est
--      public, le fait de l'avoir cherché ne l'est pas — et le §16 promet
--      qu'un foyer ne voit pas les données d'un autre.
--   2. On ne saurait pas lister les recettes lues mais **jamais mangées**,
--      faute du moindre lien entre elles et un foyer. Or c'est précisément
--      celles-là qu'on vient chercher.
--
-- D'où cette table d'association, et pas un `household_id` sur `recipe` : la
-- même recette Jow est légitimement connue de plusieurs foyers à la fois.
--
-- ── Ce qu'elle ne fait pas ──────────────────────────────────────────────────
--
-- Elle ne planifie rien. Une recette n'a pas d'état « prévue » : elle a une
-- date de dernier repas, ou pas de date du tout. Un vrai menu de la semaine
-- serait une autre table et une décision de spec (§15), pas un champ de plus
-- glissé ici.

create table household_recipe (
  household_id  uuid        not null references household(id) on delete cascade,
  recipe_id     uuid        not null references recipe(id)    on delete cascade,
  first_seen_at timestamptz not null default now(),
  primary key (household_id, recipe_id)
);

create index on household_recipe (recipe_id);

comment on table household_recipe is
  'Les recettes qu''un foyer a lues, mangées ou non. Une recette Jow est '
  'globale (007) : c''est ici, et seulement ici, que se dit qui la connaît.';

comment on column household_recipe.first_seen_at is
  'Première lecture par ce foyer. Pas une date de repas : une recette peut '
  'être connue et jamais mangée — c''est même le cas intéressant.';

-- ── RLS ─────────────────────────────────────────────────────────────────────
--
-- Table du domaine, scopée comme les autres (008). `force` compris : sans lui
-- le rôle propriétaire — c'est-à-dire l'application — contournerait la policy
-- et tout ce fichier serait décoratif.

alter table household_recipe enable row level security;
alter table household_recipe force  row level security;

create policy household_recipe_lecture on household_recipe for select
  using (household_id = app_current_household());

create policy household_recipe_ecriture on household_recipe for all
  using      (household_id = app_current_household())
  with check (household_id = app_current_household());

-- ── Reprise de l'existant, foyer par foyer ──────────────────────────────────
--
-- Les repas déjà enregistrés disent, rétroactivement, quelles recettes chaque
-- foyer connaît. Sans cette reprise, la liste s'ouvrirait vide sur une
-- instance qui tourne depuis des semaines.
--
-- ⚠️ La boucle n'est pas un ornement. Un `insert … select … from meal` écrit
-- d'un bloc ici ne reprendrait **rien**, en silence : la migration tourne avec
-- le rôle de l'application, `meal` est en `force row level security`, et une
-- connexion qui n'a pas posé `app.household_id` ne voit aucune ligne. Zéro
-- ligne reprise ressemblerait alors à « il n'y avait rien à reprendre ».
-- C'est le piège décrit en tête de la 008, et il vient de se refermer une
-- fois de plus pendant l'écriture de ce fichier.
--
-- On fait donc ce que fait l'application à chaque requête : on se place dans
-- un foyer, on lit ce qui le concerne, on recommence. `household` est
-- délibérément hors RLS, la liste est donc lisible telle quelle.
--
-- Les recettes lues puis abandonnées avant cette migration sont perdues : rien
-- ne les rattachait à un foyer, c'est exactement le manque que cette table
-- comble.

do $$
declare
  foyer uuid;
begin
  for foyer in select id from household loop
    perform set_config('app.household_id', foyer::text, true);

    insert into household_recipe (household_id, recipe_id, first_seen_at)
    select m.household_id, m.recipe_id, min(m.eaten_at)
    from meal m
    where m.recipe_id is not null
    group by m.household_id, m.recipe_id
    on conflict do nothing;

    -- Une recette manuelle appartient déjà à son foyer : elle est connue de
    -- lui par construction.
    insert into household_recipe (household_id, recipe_id, first_seen_at)
    select r.household_id, r.id, r.created_at
    from recipe r
    where r.household_id = foyer
    on conflict do nothing;
  end loop;
end $$;
