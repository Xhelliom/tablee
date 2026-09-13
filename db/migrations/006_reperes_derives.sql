-- 006_reperes_derives.sql
--
-- La migration 005 a appris à `nutrient_reference` à porter deux natures de
-- repère : `absolu` (des grammes) et `pct_aet` (un pourcentage de l'apport
-- énergétique). Il manquait le pont entre les deux.
--
-- Une part énergétique est un **ratio**, pas un compteur : elle ne progresse
-- pas au fil de la journée, elle converge. « 8 % de protéines » à 10 h et à
-- 20 h, c'est le même chiffre et deux situations sans rapport. Pour dire ce
-- qui manque et ce qui est dépassé, il faut une cible en grammes.
--
-- Elle se calcule à partir de trois sources publiées :
--
--   cible_g = intervalle (% AET) × besoin énergétique (kcal) / facteur (kcal/g)
--
-- Les trois termes sont sourcés (ANSES 2016 et 2019, EFSA 2017 via l'avis
-- ANSES, Règlement UE 1169/2011 Annexe XIV). Le produit, lui, n'est publié
-- nulle part tel quel : c'est un **repère dérivé**, et la colonne `derived`
-- l'affiche pour qu'on ne le confonde jamais avec une valeur recopiée.
--
-- Les lignes `pct_aet` restent en base à côté : ce sont elles l'original.

alter table nutrient_reference
  -- true = valeur calculée à partir d'autres lignes sourcées, pas recopiée
  -- d'un tableau. `source` porte alors la chaîne de dérivation complète.
  add column derived boolean not null default false;

-- Un même (sexe, âge, nutriment, nature) peut désormais exister sous les deux
-- bases : l'intervalle en % publié, et sa traduction en grammes.
alter table nutrient_reference
  drop constraint nutrient_reference_unique;

alter table nutrient_reference
  add constraint nutrient_reference_unique
    unique (sex, age_min, age_max, nutrient, kind, basis);

-- ═══════════════════════════════════════════════════════════
-- BESOIN ÉNERGÉTIQUE DE RÉFÉRENCE
-- ═══════════════════════════════════════════════════════════
--
-- Séparé de `nutrient_reference` : ce n'est pas un repère à afficher, c'est un
-- terme de calcul. I5 interdit d'afficher un objectif chiffré de calories sur
-- un profil mineur — cette table sert à dériver des grammes, et rien de ce
-- qu'elle contient n'est destiné à l'écran.

create table energy_reference (
  sex       text not null check (sex in ('F', 'M')),
  age_min   int not null,
  age_max   int not null,
  kcal      numeric(6,1) not null check (kcal > 0),
  -- Le besoin énergétique dépend du niveau d'activité physique. Les valeurs
  -- retenues supposent un NAP de 1,6 (enfants, EFSA 2013) ou 1,63 (adultes,
  -- SACN 2011, NAP médian). Le noter ici évite de comparer des chiffres
  -- calculés sous des hypothèses différentes.
  pal       numeric(3,2),
  source    text not null,
  primary key (sex, age_min, age_max)
);

comment on table energy_reference is
  'Terme de calcul des repères dérivés (§9). Jamais affiché : I5 interdit un objectif chiffré de calories sur un profil mineur.';
