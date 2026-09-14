-- Un repas dont un LLM a proposé la composition (V3, §5 voie 2).
--
-- Une source à part plutôt que `texte` : ses grammes sont estimés par un
-- modèle, et R6 veut que ça se voie. `calculerNutrition` plafonne donc sa
-- confiance à « moyenne », comme il met la photo à « basse ». Rangé sous
-- `texte`, un repas découpé par l'IA et entièrement rattaché sortirait en
-- « Valeurs sourcées », ce qu'il n'est pas — même relu, même corrigé : c'est
-- la composition qui vient du modèle, pas seulement les poids.
alter table meal drop constraint meal_source_check;
alter table meal add constraint meal_source_check
  check (source in ('jow', 'texte', 'photo', 'template', 'manuel', 'ia'));
