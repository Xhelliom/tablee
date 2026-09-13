-- 004_jow_food_link.sql
--
-- Rattacher un ingrédient Jow au référentiel coûtait un geste **par recette**.
-- C'était du gaspillage : `recipe_ingredient.jow_food_id` est un ObjectId
-- stable chez Jow, donc « Purée de carotte (surgelée) » est le même ingrédient
-- dans toutes les recettes qui l'emploient.
--
-- Mesuré sur les 8 recettes figées du contrat : 44 lignes d'ingrédients pour
-- 38 ingrédients distincts, et déjà Beurre ×3, Pommes de terre ×2, Œuf ×2,
-- Ail ×2. La réutilisation démarre tout de suite ; le catalogue courant d'un
-- foyer plafonne à quelques centaines d'entrées.
--
-- Le rattachement se fait donc une fois pour toutes, et se propage aux
-- recettes passées comme futures. `recipe_ingredient.food_id` reste, comme
-- cache résolu et comme point d'exception : on peut toujours rattacher
-- autrement un ingrédient dans une recette précise.

create table jow_food_link (
  jow_food_id  text primary key,
  food_id      uuid not null references food(id) on delete cascade,
  -- Libellé Jow au moment du rattachement. Purement informatif : il sert à
  -- relire la liste des correspondances sans refaire un tour chez Jow, et à
  -- repérer un ingrédient que Jow aurait renommé sous le même identifiant.
  label        text not null,
  -- Qui a confirmé. Ces liens ne sont jamais posés automatiquement : Jow
  -- publie des libellés, pas des codes Ciqual, et les rapprocher par
  -- ressemblance de chaîne produirait des rattachements faux — donc des parts
  -- végétales fausses, affichées sans avertissement (I1).
  confirmed_by uuid references member(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index on jow_food_link (food_id);

-- Les ingrédients sont retrouvés par leur ObjectId à chaque capture de
-- recette : sans cet index, la propagation balaye toute la table.
create index on recipe_ingredient (jow_food_id) where jow_food_id is not null;
