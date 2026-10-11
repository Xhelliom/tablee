-- Un repas dans le repas : le fromage de l'un, le fruit de l'autre, l'entrée
-- pour tout le monde (10/2026).
--
-- `parent_meal_id` fait d'un repas un **sous-plat** : mêmes créneau et journée
-- que son parent (recopiés à l'écriture, pas modifiables après), mais ses
-- propres convives et ses propres parts — Σ des `share` = 1 **par repas**, y
-- compris chacun des sous-plats. Le bilan journalier n'a rien à apprendre :
-- il somme déjà les lignes par convive, quel que soit le repas qui les porte.
--
-- Un seul niveau : un sous-plat ne peut pas avoir d'enfant. Supprimer le plat
-- principal emporte ses sous-plats — un dessert sans dîner n'a rien à resservir.
alter table meal
  add column parent_meal_id uuid references meal(id) on delete cascade;

-- L'accueil attache les sous-plats à leur parent à chaque lecture.
create index on meal (parent_meal_id) where parent_meal_id is not null;
