-- 003_bornes_de_quantification.sql
--
-- Ciqual publie trois formes d'absence, et la documentation officielle de la
-- table (« Table Ciqual 2020_doc_Excel_FR », §1.2.1) les distingue :
--
--   « -- »      « Lorsqu'une teneur n'est pas connue, un tiret figure à la
--               place de la valeur. Il est impératif pour les utilisateurs
--               [...] de ne pas les assimiler à des zéro. »
--   « traces »  « un constituant donné est détecté analytiquement, sans
--               pouvoir être précisément quantifié [...] très faible, mais ne
--               peut être considérée nulle. »
--   « <10 »     « une valeur maximale ».
--
-- Les trois valaient NULL jusqu'ici. C'était juste pour les deux premières, et
-- inutilement pauvre pour la troisième : « < 0,5 g » n'est pas une valeur
-- inconnue, c'est un majorant publié par la source. Les lipides d'une banane
-- sont entre 0 et 0,5 g — le dire vaut mieux que se taire.
--
-- Le modèle devient donc un **encadrement** plutôt qu'un point :
--
--   colonne          borne basse — ce qui est garanti atteint
--   colonne_max      borne haute — NULL signifie « non bornée »
--
-- Une valeur exacte a ses deux bornes égales. Les lignes existantes sont
-- exactes par construction (le calcul écrivait NULL dès qu'un contributeur
-- manquait), d'où le backfill.

-- ═══════════════════════════════════════════════════════════
-- RÉFÉRENTIEL
-- ═══════════════════════════════════════════════════════════

alter table food
  add column kcal_100g_max    numeric(8,2),
  add column protein_100g_max numeric(8,2),
  add column carb_100g_max    numeric(8,2),
  add column fat_100g_max     numeric(8,2),
  add column fiber_100g_max   numeric(8,2);

comment on column food.fat_100g is
  'Borne basse pour 100 g. NULL = non publiée. Vaut 0 quand la source ne donne qu''un majorant.';
comment on column food.fat_100g_max is
  'Borne haute pour 100 g : la valeur elle-même si elle est exacte, le seuil si la source écrit « < X », NULL si rien n''est borné.';

-- Les valeurs déjà chargées sont exactes : leurs deux bornes coïncident. Le
-- seed les réécrira de toute façon, mais la base doit rester cohérente entre
-- la migration et le prochain passage du seed.
update food set
  kcal_100g_max    = kcal_100g,
  protein_100g_max = protein_100g,
  carb_100g_max    = carb_100g,
  fat_100g_max     = fat_100g,
  fiber_100g_max   = fiber_100g;

-- ═══════════════════════════════════════════════════════════
-- REPAS
-- ═══════════════════════════════════════════════════════════

alter table meal_nutrition
  add column kcal_max      numeric(10,2),
  add column protein_g_max numeric(10,2),
  add column carb_g_max    numeric(10,2),
  add column fat_g_max     numeric(10,2),
  add column fiber_g_max   numeric(10,2);

comment on column meal_nutrition.protein_g is
  'Borne basse du total : ce qui est garanti atteint. NULL = rien de connu.';
comment on column meal_nutrition.protein_g_max is
  'Borne haute du total. NULL = non bornée, typiquement un aliment du repas dont la teneur est inconnue.';

-- Idem : tout total non NULL écrit jusqu'ici était exact.
update meal_nutrition set
  kcal_max      = kcal,
  protein_g_max = protein_g,
  carb_g_max    = carb_g,
  fat_g_max     = fat_g,
  fiber_g_max   = fiber_g;
