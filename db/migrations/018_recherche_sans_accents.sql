-- 018 — la recherche d'aliments ne tient plus compte des accents (18/09/2026).
--
-- `to_tsvector('french', …)` travaillait sur le texte accentué : « pates » ne
-- rendait que des patates, et « pate » ne trouvait jamais « pâtes ». Le clavier
-- d'un téléphone met les accents, celui d'un ordinateur pressé non (dette n° 5).
--
-- Une configuration à part, `french_unaccent`, retire les accents avant la
-- racinisation, pour les mots qui en portent (`word`, `hword`, `hword_part`) ;
-- les mots tout ASCII n'ont rien à retirer. `french` reste telle quelle : la
-- modifier changerait en silence tout ce qui s'en sert, ici ou ailleurs.
--
-- `unaccent` est une extension « trusted » depuis Postgres 13 : le rôle
-- applicatif, propriétaire de sa base sans être superutilisateur, peut la
-- créer. L'image officielle `postgres` l'embarque, comme toutes les contrib.
create extension if not exists unaccent;

-- Les mots vides d'abord, accents compris : la liste de `french_stem` est
-- écrite avec eux, et une fois « à » devenu « a » elle ne le reconnaît plus.
-- « Poulet à la moutarde » exigeait alors un « a », et ne trouvait plus
-- « Poulet, moutarde ». `accept = false` : un mot qui n'est pas vide passe au
-- dictionnaire suivant au lieu de s'arrêter ici.
create text search dictionary french_mots_vides (
  template = simple, stopwords = french, accept = false
);

create text search configuration french_unaccent (copy = french);
alter text search configuration french_unaccent
  alter mapping for word, hword, hword_part with french_mots_vides, unaccent, french_stem;

-- L'index de la 001 porte sur `french` : la recherche ne s'en servirait plus.
drop index food_to_tsvector_idx;
create index on food using gin (to_tsvector('french_unaccent', name));
