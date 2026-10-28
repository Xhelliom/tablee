-- 030_ingredient_plusieurs_aliments.sql
--
-- Un ingrédient Jow n'avait qu'un aliment (`jow_food_link.food_id`). Or une
-- ligne de recette peut en couvrir deux : le citron dont la recette emploie le
-- zeste **et** la pulpe n'est ni « citron jaune pulpe » ni « zeste de citron »,
-- c'est les deux. Obliger à choisir faussait la part végétale et la variété.
--
-- `jow_food_link` garde ce qui est propre à l'ingrédient Jow (libellé, qui a
-- confirmé, verrou) ; les aliments rattachés passent dans `jow_food_link_item`,
-- un par ligne. Le verrou reste donc **un seul** pour tout l'ensemble.
--
-- `grams` est facultatif, et NULL veut dire « non réparti » — jamais 0, et
-- jamais une moitié devinée : la quantité de la ligne n'est partagée que si
-- quelqu'un a dit comment. Ce sont des grammes **par convive**, propres à
-- l'ingrédient Jow et non à une recette : ils valent pour toutes celles qui
-- l'emploient (approximation consignée en dette n° 31).
--
-- `recipe_ingredient.food_id` reste le cache de l'aliment **principal** (le
-- premier rattaché). La vue `recipe_ingredient_food` donne tous les aliments
-- d'une ligne à qui doit les compter (variété, saison, alcool).

create table jow_food_link_item (
  jow_food_id text not null references jow_food_link(jow_food_id) on delete cascade,
  food_id     uuid not null references food(id) on delete cascade,
  grams       numeric(10,2) check (grams is null or grams > 0),
  -- Le premier est l'aliment principal, celui que `recipe_ingredient.food_id` cache.
  position    int not null default 0,
  primary key (jow_food_id, food_id)
);

create index on jow_food_link_item (food_id);

insert into jow_food_link_item (jow_food_id, food_id)
select jow_food_id, food_id from jow_food_link;

alter table jow_food_link drop column food_id;

create view recipe_ingredient_food as
  select ri.id as ingredient_id, ri.recipe_id, i.food_id, i.grams,
         (select count(*) from jow_food_link_item n where n.jow_food_id = ri.jow_food_id) > 1 as multiple
  from recipe_ingredient ri
  join jow_food_link_item i on i.jow_food_id = ri.jow_food_id
  union all
  select ri.id, ri.recipe_id, ri.food_id, null::numeric, false
  from recipe_ingredient ri
  where ri.food_id is not null
    and not exists (select 1 from jow_food_link_item i where i.jow_food_id = ri.jow_food_id);
