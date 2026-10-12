-- 027 — « on n'en mange pas » : le foyer écarte les repères de poisson.
--
-- Les repères de fréquence (026) comptent pour le foyer. Un foyer qui ne mange
-- pas de poisson ne peut pas l'atteindre, et un repère toujours « non atteint »
-- finit par ressembler à un reproche. Ce réglage retire les lignes poisson de
-- l'écran ; il ne remplace aucune valeur et n'en écrit aucune (I1).
alter table household add column no_fish boolean not null default false;
