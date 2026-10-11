-- 022 — densité énergétique d'un plat : kcal pour 100 g de ce qui a été mangé.
--
-- Propriété du plat, pas d'une personne : aucun repère, aucune barre, aucun
-- seuil. Décidée le 09/10/2026 par le propriétaire, qui l'affiche à tous, mineurs
-- compris, sur la fiche d'un repas (voir CLAUDE.md et le §8 de la spec).
--
-- `null` quand l'énergie et les grammes ne portent pas sur le même périmètre
-- (ingrédient non converti, énergie d'un aliment inconnue) : la colonne ne vaut
-- jamais 0 par défaut. Les repas déjà calculés restent à `null` jusqu'à leur
-- prochain recalcul — impossible de savoir après coup si leur périmètre était
-- le même.

alter table meal_nutrition add column if not exists energy_density numeric;
