-- 029 — Le poids devient une suite de pesées datées, majeurs seulement.
--
-- ⚠️ **Renversé le 18/09/2026, forme validée le 28/10/2026** par le
-- propriétaire : la 009 disait du poids « aucune série », et CLAUDE.md « ni
-- séries, ni scores par personne, nulle part ». Le poids d'un majeur a
-- désormais un historique, parce qu'un seul nombre écrasé à chaque saisie ne
-- dit rien : il bouge d'un matin à l'autre avec l'eau et le sel, et c'est la
-- tendance qui renseigne. Ce qui ne bouge pas :
--
--   1. **Majeurs seulement**, avec les trois filets de la 009, chacun testé
--      seul : l'API refuse l'écriture sur un mineur (422), la lecture rend une
--      courbe vide, et une date de naissance corrigée qui rend le profil
--      mineur **efface toutes les pesées**. Comme pour la 009, la base ne peut
--      pas le dire (l'âge n'est pas immutable) : `routes/weights.ts` pour les
--      deux premiers, `routes/eaters.ts` pour le troisième.
--   2. **Une tendance, pas des pesées.** L'écran ne trace que la moyenne
--      exponentielle (`tendance`, `server/routes/weights.ts`) ; aucune cible, aucun écart
--      chiffré, aucun classement entre personnes.
--   3. **Qui voit quoi ne change pas** : un `adulte` sa seule courbe, un
--      `parent` celles des majeurs du foyer — la règle de `present()`.
--   4. **Jamais au LLM** (I3) : rien dans `server/llm/` ne lit cette table.
--
-- Une pesée par convive et par jour : une nouvelle saisie du même jour
-- remplace la précédente. `day` est choisi par la personne (on se pèse le
-- matin, on le note le soir) ; la route refuse un jour futur.
--
-- `eater.weight_kg` et `weight_recorded_at` disparaissent : deux endroits qui
-- disent « le poids » finiraient par ne plus dire la même chose. La valeur
-- existante devient la première pesée, au jour où elle a été saisie.
--
-- `eater_id` est vérifié dans le foyer par le dépôt (`insert … select from
-- eater`) : la RLS ne traverse pas la clé étrangère (dette n° 8).
create table weight_measure (
  household_id uuid not null references household(id) on delete cascade,
  eater_id     uuid not null references eater(id)     on delete cascade,
  day          date not null,
  weight_kg    numeric(5,2) not null check (weight_kg > 0 and weight_kg <= 400),
  primary key (eater_id, day)
);
create index on weight_measure (household_id);

comment on table weight_measure is
  'Majeurs uniquement (refusé en applicatif). Une mesure datée, jamais une '
  'cible ; l''écran n''en montre que la tendance lissée. Jamais envoyée au LLM.';

alter table weight_measure enable row level security;
alter table weight_measure force  row level security;
create policy weight_measure_foyer on weight_measure
  using      (household_id = app_current_household())
  with check (household_id = app_current_household());

-- Foyer par foyer, comme la 011 : `eater` est en `force row level security`,
-- et un `insert … select` d'un bloc ne reprendrait rien avant le `drop`.
do $$
declare
  foyer uuid;
begin
  for foyer in select id from household loop
    perform set_config('app.household_id', foyer::text, true);
    insert into weight_measure (household_id, eater_id, day, weight_kg)
    select household_id, id, coalesce(weight_recorded_at::date, current_date), weight_kg
    from eater where weight_kg is not null;
  end loop;
end $$;

alter table eater
  drop column weight_kg,
  drop column weight_recorded_at;
