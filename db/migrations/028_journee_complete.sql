-- 028 — « j'ai tout saisi aujourd'hui », par convive et par jour (10/2026).
--
-- Dette n° 20 : une journée dont seul le dîner est saisi comptait comme
-- entière dans toute moyenne sur 7 jours. Une ligne ici dit qu'un convive a
-- tout ce qu'il a mangé ce jour-là dans l'app ; les moyennes peuvent alors ne
-- porter que sur ces journées, et dire sur combien.
--
-- C'est une information sur la **saisie**, pas sur la personne : rien ne
-- s'en déduit d'elle, et aucun compte, série ni score n'en sort à l'écran (I5).
-- Démarquer, c'est supprimer la ligne : aucun historique n'est gardé.
--
-- `eater_id` est vérifié dans le foyer par la route (`insert … select from
-- eater`) : la RLS ne traverse pas la clé étrangère (dette n° 8).
create table day_complete (
  household_id uuid not null references household(id) on delete cascade,
  eater_id     uuid not null references eater(id)     on delete cascade,
  day          date not null,
  primary key (eater_id, day)
);
create index on day_complete (household_id, day);

alter table day_complete enable row level security;
alter table day_complete force  row level security;
create policy day_complete_foyer on day_complete
  using      (household_id = app_current_household())
  with check (household_id = app_current_household());
