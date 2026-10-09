-- 022 — les repères de fréquence du PNNS (Santé publique France).
--
-- Les repères de `nutrient_reference` sont des grammes de nutriments ; ceux-ci
-- sont des **aliments et des fréquences** (« légumes secs au moins 2 fois par
-- semaine »), le vocabulaire que Santé publique France emploie pour les
-- adultes. Ils se comptent sur `food.category`, pas sur des teneurs : rien
-- ici n'est une valeur nutritionnelle, et rien n'est écrit par cette
-- migration (I1) — `scripts/seed-refs.ts` charge `db/seeds/frequency-reference.csv`,
-- où chaque ligne porte sa source et la phrase du document.
--
-- Référentiel public, hors RLS, comme `nutrient_reference`.
--
-- Deux garde-fous qui tiennent à la forme de la table :
--   — `age_min` vaut 18 et seul 18 : la source est un document **adulte**, et
--     elle n'en donne pas pour les enfants (valider le 09/10/2026). Il n'y a
--     donc aucune ligne à lire pour un mineur.
--   — un plafond (`max_grams`) ne se lit qu'au niveau du foyer ; l'API ne
--     l'expose sur aucune fiche de convive.

create table frequency_reference (
  code         text primary key,
  label        text not null,
  -- min_times : au moins N repas sur la période ; min_days : au moins N jours ;
  -- max_grams : au plus N grammes par adulte sur la période.
  kind         text not null check (kind in ('min_times', 'min_days', 'max_grams')),
  value        numeric not null check (value > 0),
  period_days  int not null default 7 check (period_days > 0),
  -- `food.category` retenues, et un motif de nom facultatif quand la catégorie
  -- ne suffit pas (poisson gras, viande hors volaille).
  categories   text[] not null check (cardinality(categories) > 0),
  name_pattern text,
  age_min      int not null default 18 check (age_min = 18),
  source       text not null check (length(trim(source)) > 0),
  citation     text not null check (length(trim(citation)) > 0)
);

comment on table frequency_reference is
  'Repères alimentaires en fréquences (SPF, adultes). Source et citation '
  'obligatoires (I1). Aucun repère pour les mineurs : la source n''en donne pas.';
