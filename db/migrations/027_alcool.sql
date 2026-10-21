-- 027 — l'alcool de la semaine, pour les majeurs.
--
-- Décidé par le propriétaire le 21/10/2026 : le foyer saisira ses verres. Sans
-- cette décision, un compte à 0 « parce que rien n'est saisi » aurait été faux,
-- comme l'hydratation (docs/indicateurs-possibles.md §2, Eau).
--
-- Deux choses, et aucune valeur écrite ici (I1) :
--   — `food.alcohol_100g` : la teneur en alcool publiée par Ciqual (constituant
--     60000, « Alcool (g/100 g) »), lue par le seed comme les autres colonnes.
--     Inconnue = NULL, jamais 0.
--   — `max_drinks` : un plafond en **verres standard** (10 g d'alcool pur) par
--     adulte sur la période. La ligne vient de `db/seeds/frequency-reference.csv`,
--     citée ; `age_min = 18` reste la seule valeur permise.
--
-- Ce qui ne s'affiche pas : sans aucune boisson alcoolisée saisie sur la
-- fenêtre, le repère n'est **pas mentionné** — ni 0, ni « rien de saisi »
-- (`server/routes/dashboard.ts`). Et rien sur la fiche d'un convive, majeur ou
-- non : le compte reste celui du foyer (I5).

alter table food
  add column alcohol_100g     numeric(8,2),
  add column alcohol_100g_max numeric(8,2);

alter table frequency_reference drop constraint frequency_reference_kind_check;
alter table frequency_reference add constraint frequency_reference_kind_check
  check (kind in ('min_times', 'min_days', 'max_grams', 'max_drinks'));
