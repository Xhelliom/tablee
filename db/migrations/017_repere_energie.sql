-- 017 — le besoin énergétique devient un repère affichable.
--
-- ── ⚠️ Renversement du §9, décidé par le propriétaire le 17/09/2026 ─────────
--
-- Le §9 de la spec et l'en-tête de `db/seeds/energy-reference.csv` disent tous
-- deux, en toutes lettres : « CE N'EST PAS UN REPÈRE À AFFICHER. C'est un
-- terme de calcul, et rien de plus. » Le besoin énergétique ne servait qu'à
-- traduire en grammes les intervalles que l'ANSES publie en pourcentage de
-- l'apport énergétique, et ne sortait jamais à l'écran.
--
-- Le propriétaire a demandé une **cinquième barre chiffrée pour l'énergie**,
-- et tranché en connaissance des deux objections qui lui ont été présentées :
--
--   1. le §9 s'interdisait de faire sortir `energy_reference` de la base ;
--   2. R7 dit que le vocabulaire du produit parle qualité et variété, pas
--      calories.
--
-- Ce qui n'est **pas** négociable et ne bouge pas d'un pouce :
--
--   I5 — aucun chiffre de calories sur un profil mineur. La barre n'existe pas
--   sur la fiche d'un mineur : elle n'est pas grisée, elle est absente. Trois
--   filets, comme pour le poids (009) : aucune ligne `kcal` n'est écrite ici
--   pour une tranche qui commence avant 18 ans, `bilanJournalier` ne construit
--   pas la barre sous 18 ans, et la feuille des repères n'a rien à afficher
--   sans elle. Ne pas « harmoniser » les trois en un seul.
--
-- ── Ce que la migration change, concrètement ────────────────────────────────
--
-- Une seule chose : `kind` accepte une nature de plus. L'ANSES n'exprime pas
-- un besoin énergétique comme une RNP — une RNP couvre 97,5 % de la
-- population, et appliquer ça à l'énergie ferait manger la moitié des gens
-- au-delà de leur besoin. C'est un **besoin moyen**, et il porte son nom :
-- `BNM`. Le confondre avec une RNP dirait une chose fausse dans une colonne
-- prévue pour dire la vraie.
--
-- Les lignes elles-mêmes sont écrites par `scripts/seed-refs.ts`, à partir
-- d'`energy_reference` et de personne d'autre : rien de neuf n'est saisi ici,
-- et aucune valeur nutritionnelle n'entre en base par cette migration (I1).

alter table nutrient_reference
  drop constraint if exists nutrient_reference_kind_check;

alter table nutrient_reference
  add constraint nutrient_reference_kind_check
    check (kind in ('AS', 'RNP', 'RN', 'IR_MIN', 'IR_MAX', 'BNM'));

comment on column nutrient_reference.kind is
  'Vocabulaire de l''ANSES. AS apport satisfaisant, RNP référence pour la '
  'population, RN référence nutritionnelle, IR_MIN/IR_MAX bornes d''un '
  'intervalle, BNM besoin moyen — celui de l''énergie, et lui seul (017).';
