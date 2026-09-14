-- unit_default : un repli par unité **et par forme** (14/09/2026).
--
-- La 001 prévoyait une valeur par unité, pour tous les aliments. Aucune source
-- publiée n'en justifie une : une cuillère à soupe pèse de 13,5 à 21 g d'un
-- liquide, d'une pâte ou de grains, et 6 à 7 g d'une épice en poudre (USDA). Le
-- repli dégradé distingue donc la forme — déduite de `food.category` par le
-- code (`resolveUnit`), jamais du nom de l'aliment.
--
-- `tout` vaut pour toutes les formes ; `poudre` le précise pour les épices. La
-- table était vide : rien à reprendre.
alter table unit_default
  add column forme text not null default 'tout' check (forme in ('tout', 'poudre'));
alter table unit_default drop constraint unit_default_pkey;
alter table unit_default add primary key (unit, forme);
