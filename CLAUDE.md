# CLAUDE.md — Tablée

Instructions permanentes pour tout agent travaillant sur ce dépôt.
À lire intégralement avant la première action.

---

## Le projet en trois phrases

Tablée est une PWA familiale de suivi alimentaire, auto-hébergée, destinée à un
foyer avec enfants. On y enregistre les repas — principalement en les partageant
depuis l'application Jow — et l'app affiche pour **chaque personne** un bilan
nutritionnel réparti selon son âge et son coefficient de portion.

Le différenciateur est la répartition d'un même plat entre plusieurs convives aux
besoins différents. Aucune app du marché ne modélise ça.

---

## Documents de référence

| Fichier | Rôle |
|---|---|
| `docs/plan-app-nutrition-famille.md` | **La spec.** Fait autorité sur le modèle de données, l'API, la roadmap, les règles. |
| `docs/mockups-tablee.html` | Maquettes de référence. Fait autorité sur la mise en page et l'identité visuelle. À ouvrir dans un navigateur. |
| `docs/jow-contract.md` | À créer en Tâche 0. Contrat de parsing des pages Jow. |

En cas de contradiction entre ce fichier et la spec, **la spec gagne** — sauf sur
les interdits ci-dessous, qui ne se négocient pas.

---

## Règles absolues

### Ne jamais faire

- **Ne jamais inventer une valeur nutritionnelle ou un repère.** Si la source
  manque, laisser `NULL` et le signaler. Les repères par âge servent de base à
  des conseils destinés à des enfants ; une valeur plausible et fausse est pire
  qu'une valeur absente.
- **Ne jamais stocker de jugement sur une personne.** `family_note` accepte
  « Léa a goûté les épinards et a aimé », jamais « Léa mange mal ». Un jugement
  stocké se réinjecte à chaque prompt et devient une étiquette durable.
- **Ne jamais afficher d'objectif chiffré de calories ou de poids sur un profil
  mineur.** Les kcal existent en base ; elles ne sont jamais la métrique mise en
  avant. Ni séries, ni scores par personne, nulle part.
- **Ne jamais envoyer au LLM** : prénoms, dates de naissance, allergènes, poids,
  photos de personnes. Uniquement des libellés d'aliments, des agrégats et des
  tranches d'âge.
- **Ne jamais générer de commentaire automatique par repas.** La synthèse est
  hebdomadaire.
- **Ne jamais logger ni persister** le paramètre `key` ou `userId` d'un lien de
  partage Jow : c'est un token de compte.
- **Ne pas utiliser l'API interne non documentée de Jow.** Pages publiques
  uniquement.

Sur les trois premiers points : en cas de doute, s'arrêter et demander. Ce ne
sont pas des préférences de style.

### Toujours faire

- Les valeurs nutritionnelles viennent d'une source référencée : Jow, Ciqual,
  Open Food Facts. Jamais du modèle.
- `meal_participant.share` est calculé **à l'écriture** puis figé. Modifier un
  `portion_coef` ne doit jamais réécrire l'historique.
- Les barres s'affichent en **% du repère du jour**, jamais en grammes bruts.
- Tout appel LLM part du serveur. La clé API n'apparaît jamais dans le bundle.
- Toute estimation porte un `confidence` visible dans l'UI.
- Le vocabulaire produit parle **qualité et variété**, pas calories et objectifs.
  « Qui était à table ? », pas « participants ».

---

## Ne pas décider seul

Sur ces points, demander plutôt que choisir :

1. **Contenu de `nutrient_reference`** — à sourcer auprès de l'ANSES. Ne pas
   générer les valeurs.
2. **Contenu de `unit_default`** — chaque ligne exige une `source`.
3. **Contenu de `seasonal_produce`** — saisie manuelle, ~40 produits.
4. Toute modification des règles ci-dessus.

Le reste est tranché dans la spec. Les décisions y sont motivées pour pouvoir
être contestées en connaissance de cause, pas pour être réouvertes par défaut.

---

## Ordre de travail

### Tâche 0 — Contrat Jow (BLOQUANT)

Rien ne démarre avant. Voir §3 de la spec.

Objectif : un script qui prend le texte d'un partage Jow et ressort
`{ title, servings, ingredients[], nutrition{} }`, validé sur **5 recettes
différentes**.

Points connus :
- Les pages `jow.fr/fr/recipes/<slug>` sont publiques et contiennent ingrédients
  avec quantités, valeurs par portion, Nutri-Score.
- Le site est en Next.js → chercher `__NEXT_DATA__` ou les payloads RSC dans le
  HTML brut (`curl`, pas un extracteur de texte).
- **Piège** : le `recipeId` du lien de partage (ObjectId Mongo) n'est pas le
  suffixe de l'URL web. Résoudre par le titre slugifié, puis mettre en cache
  dans `recipe.jow_slug`.
- Le parseur doit être tolérant : structure inattendue → `confidence='basse'` et
  bascule en saisie manuelle, jamais un crash.

### Ensuite

V1 → V2 → V3 → V4, dans l'ordre, avec les critères d'acceptation du §15 de la
spec. Ne pas anticiper l'IA : un assistant diététicien branché sur trois repas
mal saisis ne produit que des banalités.

---

## Stack et conventions

| Couche | Choix |
|---|---|
| Front | Vite + React + TypeScript, PWA |
| Back | Node — Fastify ou Hono |
| Base | PostgreSQL 16+ |
| Migrations | Fichiers SQL numérotés dans `db/migrations/`, jamais modifiés après application |
| Proxy | Caddy (HTTPS obligatoire pour le share target) |
| Hébergement | Proxmox local |

```
/
├── CLAUDE.md
├── docs/
│   ├── plan-app-nutrition-famille.md
│   ├── mockups-tablee.html
│   └── jow-contract.md
├── db/migrations/
├── scripts/          seed-food.ts, seed-seasonal.ts
├── server/
│   ├── routes/
│   ├── jow/          parseur + contrat
│   └── nutrition/    calcul, shares, repères
└── web/
    ├── screens/
    └── design/       tokens couleur et typo
```

Conventions :
- Le calcul nutritionnel se fait **en applicatif**, pas en SQL. Voir §11 de la
  spec pour les trois algorithmes (`calculerNutrition`, `calculerShares`,
  `bilanJournalier`).
- Les scripts de seed sont **idempotents** (`on conflict do update`).
- Une valeur inconnue est `NULL`, jamais `0`.

---

## Identité visuelle

- Couleur de marque : terracotta `#D85A30`, en aplat plein sur le chrome.
- Palette nutriments : protéines `#7F77DD`, glucides `#EF9F27`, lipides
  `#378ADD`, fibres `#1D9E75`, végétal `#639922`.
- **Ces cinq couleurs n'apparaissent que sur des données nutritionnelles.**
  Jamais sur un bouton, un onglet, un badge ou un fond.
- Fond crème, pas de blanc pur. Contraste typographique fort : serif 28-34 px
  pour l'affichage, sans-serif 11-17 px pour le reste.
- Les aplats colorés des maquettes sont des placeholders pour les photos Jow
  (`recipe.image_url`).

---

## Définition de « terminé »

Une tâche est terminée quand :

1. Les critères d'acceptation du jalon concerné (§15) passent.
2. Les trois tests structurants passent :
   - Σ des `share` d'un repas sans invité = 1
   - modifier un `portion_coef` ne change aucun repas passé
   - une tranche d'âge sans repère affiche « indisponible », pas 0
3. Aucune valeur nutritionnelle n'a été écrite sans source.

Signaler explicitement tout endroit où une donnée manquait et a été laissée
vide : c'est le comportement attendu, pas un échec.
