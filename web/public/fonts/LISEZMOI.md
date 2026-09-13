# Polices embarquées

Fraunces et Inter, servies depuis ce dossier plutôt que depuis Google Fonts.

**Pourquoi.** Tablée est auto-hébergée sur le réseau d'une maison. Dépendre
d'un CDN pour sa typographie, c'est accepter que l'app change d'allure quand la
box tousse — et l'écart entre le serif d'affichage et le sans-serif du reste
porte la moitié de l'identité visuelle (§8ter de la spec). Accessoirement, plus
aucune requête ne part vers un tiers au chargement d'une app familiale.

**Ce qui est embarqué.** Le sous-ensemble `latin` seul, et rien d'autre.

Vérifié plutôt que supposé : sur les 3 185 noms d'aliments de Ciqual et sur
tous les textes de l'interface, **aucun caractère** ne sort de `latin` — le
`œ` de « Œufs » y est (U+0152-0153), contrairement à ce qu'on croit souvent.
`latin-ext` n'était nécessaire que pour un unique exposant « ᵉ » dans la
phrase « 2ᵉ service », et pesait 116 Ko. La phrase a été reformulée.

Inter est un fichier **variable** : les graisses 400 et 500 sont le même
fichier, déclaré sur une plage. Le séparer en deux doublait son poids pour
rien.

Total : 84 Ko pour deux fichiers, chargés une fois puis mis en cache par le
service worker.

⚠️ Si un texte de l'interface se met à sortir de `latin` — un exposant, une
flèche, un nom polonais —, le caractère s'affichera dans la police de repli.
Ça se voit. Soit on reformule, soit on rajoute `latin-ext`.

**Mise à jour.** Récupérer les `.woff2` depuis
`https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400&family=Inter:wght@400;500`
avec un User-Agent de navigateur récent (sinon Google sert du `.ttf`), ne
garder que `latin`, et vérifier que les plages `unicode-range` de
`web/design/tokens.css` correspondent toujours.

**Licence.** Les deux familles sont sous SIL Open Font License 1.1. Les textes
sont dans `OFL-Inter.txt` et `OFL-Fraunces.txt`, tels que publiés par leurs
auteurs.
