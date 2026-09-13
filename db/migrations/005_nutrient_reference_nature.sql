-- 005_nutrient_reference_nature.sql
--
-- Le §10 suppose qu'un repère est un nombre de grammes par âge et par sexe.
-- La lecture des sources montre que ce n'est vrai que d'un des quatre
-- macronutriments de la V1 :
--
--   Fibres      ANSES, avis 2012-SA-0103 (12/12/2016), Tableau 4 : AS = 30 g/j
--               pour l'adulte. Valeur absolue, identique hommes et femmes.
--               ANSES, avis 2017-SA-0142 (08/02/2019, révisé 05/2019),
--               Tableaux 1 et 2 : RN de 14, 16, 19 et 21 g/j pour les 4-6,
--               7-10, 11-14 et 15-17 ans. Absolues elles aussi.
--
--   Protéines   publiées en **pourcentage de l'apport énergétique total**
--   Lipides     (% AET), sous forme d'intervalle de référence — pas en
--   Glucides    grammes. Et sans distinction de sexe.
--
-- Convertir un % AET en grammes demanderait un apport énergétique de
-- référence par âge, donc une cible calorique — ce que l'app refuse
-- d'installer (R7, I5). Et la RNP des protéines de l'ANSES s'exprime par
-- kilogramme de poids corporel, une donnée que le §10 ne stocke volontairement
-- pas.
--
-- La table apprend donc à porter les deux natures de repère. Elle reste vide
-- de tout ce qui n'est pas sourcé ; ce qui change, c'est qu'une valeur sourcée
-- n'a plus besoin d'être un gramme pour y entrer.

alter table nutrient_reference
  -- Nature de la référence, au vocabulaire de l'ANSES :
  --   AS      apport satisfaisant
  --   RNP     référence nutritionnelle pour la population
  --   RN      référence nutritionnelle (terme générique des avis récents)
  --   IR_MIN  borne inférieure d'un intervalle de référence
  --   IR_MAX  borne supérieure d'un intervalle de référence
  add column kind text not null default 'RNP'
    check (kind in ('AS', 'RNP', 'RN', 'IR_MIN', 'IR_MAX')),
  -- Ce à quoi la valeur se rapporte :
  --   absolu   une quantité par jour, dans l'unité de la colonne `unit`
  --   pct_aet  un pourcentage de l'apport énergétique total de la journée
  add column basis text not null default 'absolu'
    check (basis in ('absolu', 'pct_aet'));

-- Un même nutriment peut désormais porter deux lignes pour la même tranche
-- (les deux bornes d'un intervalle) : l'unicité doit en tenir compte.
alter table nutrient_reference
  drop constraint nutrient_reference_sex_age_min_age_max_nutrient_key;

alter table nutrient_reference
  add constraint nutrient_reference_unique
    unique (sex, age_min, age_max, nutrient, kind);

comment on column nutrient_reference.source is
  'Obligatoire (I1). Doit permettre de retrouver la valeur : organisme, avis, date, tableau.';
