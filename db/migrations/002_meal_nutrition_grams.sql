-- 002_meal_nutrition_grams.sql
--
-- La barre « Végétal » du §8 est un rapport de grammes. `meal_nutrition` n'en
-- stocke que le résultat (`plant_ratio`), ce qui suffit pour un repas mais pas
-- pour une journée : agréger des pourcentages donnerait la moyenne de deux
-- ratios au lieu du ratio de la journée, c'est-à-dire un chiffre que rien ne
-- mesure. Un repas de 100 g et un repas de 1 kg ne pèsent pas pareil dans une
-- assiette.
--
-- On stocke donc les deux termes du rapport, calculés en même temps que
-- `plant_ratio` et par le même code (§11, en applicatif). `plant_ratio` reste :
-- les requêtes d'observation du §14 s'appuient dessus.

alter table meal_nutrition
  -- Grammes du repas dont la quantité est connue — dénominateur du §8.
  add column grams_total      numeric(10,2),
  -- Grammes issus d'aliments `food.plant_based = true` — numérateur.
  add column grams_plant      numeric(10,2),
  -- Grammes dont l'origine est connue, végétale **ou** animale. Sert à dire
  -- sur quelle fraction du repas la part végétale est calculée : le §11 laisse
  -- les grammes non classés au dénominateur, une part végétale peut donc être
  -- sous-estimée et l'interface doit pouvoir le montrer.
  add column grams_classified numeric(10,2);

-- Les trois colonnes sont volontairement nullables : un repas dont aucune
-- quantité n'est connue n'a pas 0 g, il n'a pas de grammes connus (I1).
