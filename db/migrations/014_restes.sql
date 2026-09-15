-- Ce qui reste dans le plat (15/09/2026, §6bis).
--
-- `servings` dit ce qui a été mangé à ce repas ; rien ne disait ce qui restait,
-- et « Restes de… » proposait donc aussi les plats finis. La colonne est
-- **déclarée** à table (« Il en reste ? »), jamais déduite de `base_servings` :
-- personne ne cuisine la recette au gramme près, et la somme des parts d'un
-- plat n'est pas contrainte (§6bis).
--
-- `NULL` : rien n'a été dit — les repas d'avant cette migration, ceux sans
-- recette. Ce n'est pas « il n'en reste rien », qui s'écrit 0.
alter table meal
  add column remaining_servings numeric(4,2) check (remaining_servings >= 0);

-- Le frigo cherche, à chaque ouverture de l'accueil, si un service a suivi un
-- repas : sans index, c'est un parcours de `meal`, tous foyers confondus.
create index on meal (leftover_of) where leftover_of is not null;
