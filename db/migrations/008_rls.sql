-- 008 — Row-Level Security : l'étanchéité entre foyers descend dans la base.
--
-- ── Pourquoi ce fichier existe ──────────────────────────────────────────────
--
-- Jusqu'ici l'isolation tenait par discipline. Les entrées publiques scopent
-- correctement — `getMeal(db, householdId, id)` — mais les aides internes, non :
--
--     delete from meal_item where meal_id = $1
--
-- C'est **correct**, parce que l'appelant a vérifié avant. Ça l'est tant qu'un
-- seul foyer vit sur l'instance : un oubli y est un bug. Avec les familles
-- d'amis sur la même machine (§16, tranché le 13/09/2026), le même oubli
-- devient une fuite de données alimentaires d'enfants qui ne sont pas les
-- siens. Ce n'est pas le même objet, et ça ne se protège pas par la même
-- chose : une relecture attentive ne vaut pas une contrainte.
--
-- La base refuse donc d'elle-même. Une requête qui a oublié son `where` ne
-- ramène rien plutôt que de ramener le foyer d'à côté.
--
-- ── Comment le foyer courant arrive jusqu'ici ───────────────────────────────
--
-- L'application pose `app.household_id` sur **sa** connexion, une fois par
-- requête, juste après avoir résolu la session (`server/db.ts`,
-- `withHousehold`). Le paramètre est lu par les policies ci-dessous.
--
-- `current_setting('app.household_id', true)` — le `true` demande à Postgres
-- de rendre NULL plutôt que de lever quand le paramètre n'est pas posé. C'est
-- voulu : une connexion qui n'a rien posé ne voit **rien**, au lieu de faire
-- échouer la requête. Le défaut va dans le sens fermé.
--
-- ── force, et pas seulement enable ──────────────────────────────────────────
--
-- L'application se connecte avec le rôle propriétaire des tables, et un
-- propriétaire **contourne** les policies par défaut. `force row level
-- security` les lui applique quand même. Sans ce mot, tout ce fichier serait
-- décoratif.
--
-- ⚠️ Ça ne protège pas de l'hébergeur : il a le root et peut se connecter en
-- superutilisateur, qui lui contourne la RLS pour de bon. C'est assumé et écrit
-- dans le §16 — l'app ne montre rien, la machine reste la sienne, et ça se dit
-- tel quel aux familles invitées.

-- Le foyer de la connexion courante, ou NULL si rien n'est posé.
create or replace function app_current_household() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.household_id', true), '')::uuid $$;

comment on function app_current_household() is
  'Le foyer de la connexion courante, posé par withHousehold(). NULL hors '
  'requête authentifiée — et NULL ne voit rien.';

-- ───────────────────────────────────────────────────────────────────────────
-- Les tables scopées
-- ───────────────────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['eater', 'meal', 'meal_template', 'family_note', 'weekly_insight']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format($f$
      create policy %I on %I
        using      (household_id = app_current_household())
        with check (household_id = app_current_household())
    $f$, t || '_foyer', t);
  end loop;
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- `household` reste hors RLS, et ce n'est pas un oubli
-- ───────────────────────────────────────────────────────────────────────────
--
-- C'est la table qui **détermine** le foyer courant : la résoudre suppose de
-- la lire, et la lire suppose de connaître le foyer. Une policy dessus rendrait
-- la connexion impossible — l'application ne pourrait plus établir pour quel
-- foyer poser `app.household_id`.
--
-- Elle n'est pas pour autant lisible à l'aveugle. La seule requête qui la lit
-- sans foyer déjà connu est la résolution de session, et elle passe par une
-- jointure sur `"member"` :
--
--     where m."userId" = $1 and m."organizationId" = $2
--
-- Un foyer n'en sort donc que si le compte y est **effectivement** membre. La
-- garantie ne vient pas d'une policy, elle vient de la jointure — et une
-- jointure obligatoire sur l'appartenance est plus forte qu'un filtre qu'on
-- pourrait contourner en oubliant un `where`, puisqu'il n'existe aucun chemin
-- de lecture qui ne passe pas par elle.
--
-- Ce qu'elle contient, par ailleurs, c'est un nom et un fuseau horaire. Les
-- données du §16 — repas, convives, notes — sont dans les tables ci-dessus,
-- qui, elles, sont sous policy.

-- ───────────────────────────────────────────────────────────────────────────
-- `recipe` : globale pour Jow, scopée pour le manuel
-- ───────────────────────────────────────────────────────────────────────────
--
-- Une recette Jow est de la donnée publique, mutualisée entre foyers : son
-- `household_id` est NULL et elle est visible de tous. Une recette saisie à la
-- main porte un titre libre — « Blanquette de mamie Jeanne » — et n'appartient
-- qu'à son foyer.
--
-- L'écriture, elle, n'est jamais libre : `with check` interdit de créer une
-- recette manuelle au nom d'un autre foyer, et la contrainte
-- `recipe_portee_coherente` de la 007 interdit qu'une recette manuelle soit
-- globale.

alter table recipe enable row level security;
alter table recipe force  row level security;

create policy recipe_lecture on recipe for select
  using (household_id is null or household_id = app_current_household());

create policy recipe_ecriture on recipe for all
  using      (household_id is null or household_id = app_current_household())
  with check (household_id is null or household_id = app_current_household());

-- ───────────────────────────────────────────────────────────────────────────
-- Ce qui reste délibérément hors RLS
-- ───────────────────────────────────────────────────────────────────────────
--
-- `food`, `nutrient_reference`, `energy_reference`, `unit_default`,
-- `seasonal_produce` — le référentiel public. Il n'appartient à personne et
-- tout le monde le lit.
--
-- `recipe_ingredient`, `meal_item`, `meal_participant`, `meal_nutrition`,
-- `eater_preference`, `eater_allergen`, `jow_food_link` — ces tables n'ont pas
-- de `household_id` : elles pendent à un parent qui, lui, en a un, et leurs
-- clés étrangères sont en `on delete cascade`.
--
-- ⚠️ **La RLS ne se propage pas à travers une clé étrangère.** Un
-- `select … from meal_item where meal_id = $1` reste donc lisible quel que
-- soit le foyer si l'identifiant du repas est connu. Ce n'est pas un trou
-- béant — ces identifiants sont des UUID v4 qui ne sortent jamais d'une route
-- scopée — mais ce n'est pas non plus la garantie dure qu'on a sur les tables
-- parentes, et il faut le savoir plutôt que de le découvrir.
--
-- Les couvrir demanderait une policy par table avec un `exists` sur le parent,
-- soit un sous-select sur chaque ligne lue. Consigné en dette n° 8 : à faire
-- si une de ces tables devient lisible par un identifiant venu du client.
--
-- Les tables de better-auth (`user`, `session`, `account`, `verification`,
-- `organization`, `member`, `invitation`) sont laissées à better-auth : y
-- poser une policy sur `app.household_id` casserait la connexion elle-même,
-- qui se fait **avant** qu'un foyer soit connu.
