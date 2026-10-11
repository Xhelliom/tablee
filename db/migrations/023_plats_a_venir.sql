-- 023 — le stock de plats à venir (10/2026).
--
-- Une commande Jow, c'est 3 à 10 plats qu'on mangera dans les jours qui
-- viennent, dans l'ordre que le jour décidera. Ce n'est donc **pas** un
-- planning : aucune date, aucun créneau. Un plat est là, ou il n'y est plus.
-- Un plat mangé sort du stock en y étant retiré.
--
-- Une ligne par plat, pas par recette : la même recette commandée deux fois
-- fait deux lignes. Elle ne peut venir que d'une recette que le foyer connaît
-- déjà (`household_recipe`, 011) — c'est la route qui le vérifie, pas la base.
create table upcoming_dish (
  id           uuid        primary key default gen_random_uuid(),
  household_id uuid        not null references household(id) on delete cascade,
  recipe_id    uuid        not null references recipe(id)    on delete cascade,
  added_at     timestamptz not null default now()
);

create index on upcoming_dish (household_id, added_at);

-- Scopée au foyer comme les autres (008) ; `force` compris, sans quoi le rôle
-- propriétaire — l'application — contournerait la policy.
alter table upcoming_dish enable row level security;
alter table upcoming_dish force  row level security;

create policy upcoming_dish_foyer on upcoming_dish
  using      (household_id = app_current_household())
  with check (household_id = app_current_household());
