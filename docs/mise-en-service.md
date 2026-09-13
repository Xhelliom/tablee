# Mise en service — la soirée téléphone

Le share target Android est le **chemin critique du produit** : sans lui,
Tablée n'apparaît pas dans le menu de partage de Jow, donc pas d'ingestion,
donc pas d'app. Il n'a jamais tourné ailleurs que dans un Chromium de test
(dette n° 4).

Ce document sert à ce que cette vérification prenne vingt minutes et pas trois
heures. Il est ordonné : **chaque étape échoue pour une raison différente**, et
les enchaîner dans le désordre fait perdre le bénéfice du diagnostic.

---

## Ce qui a déjà été vérifié à froid

Inutile de le refaire sur le téléphone — c'est vert au 13/09/2026 :

| Vérification | Pourquoi elle compte | État |
|---|---|---|
| `npm run build:web` produit `manifest.webmanifest`, `sw.js` et les trois PNG dans `web/dist/` | Un asset PWA oublié par Vite ne se voit qu'à l'installation | ✅ |
| Le manifeste est servi en `application/manifest+json` | **Le piège n° 1.** Servi en `text/plain`, Chrome ignore le manifeste et l'app n'est pas installable — donc pas de share target, sans message d'erreur | ✅ |
| `sw.js` en `application/javascript`, les PNG en `image/png`, les woff2 en `font/woff2` | Même famille de panne, plus discrète | ✅ |
| `GET /share?title=…&text=…&url=…` renvoie 200 et la coquille | Android ouvre une **navigation**, pas une API | ✅ |
| Icônes 192, 512 et une `maskable` 512 présentes | Chrome exige un PNG ≥ 192 **et** un ≥ 512 pour l'installabilité | ✅ |
| `scope: "/"` couvre `action: "/share"` | Une action hors scope est refusée en silence | ✅ |
| Session absente sur `/share` → l'écran de connexion s'affiche **sans changer l'URL** | La session dure 30 jours : un jour elle expirera pile au moment d'un partage. Les paramètres survivent, et l'écran de partage reprend après connexion | ✅ (lu dans le code, à confirmer en vrai) |

Ce qui **ne peut pas** être vérifié sans téléphone, et qui est donc tout
l'objet de la soirée :

1. Chrome accepte-t-il d'installer l'app ?
2. Tablée apparaît-elle dans la feuille de partage de Jow ?
3. Jow met-il bien dans `text` ce que le contrat prévoit (`docs/jow-contract.md` §2) ?

---

## Avant de commencer : la question qui décide de tout

**Est-ce que le téléphone joint le serveur quand il n'est pas sur le Wi-Fi de
la maison ?**

C'est une question de déploiement, pas de code, et elle change ce que
« ça marche » veut dire :

- **Box exposée sur Internet** (nom de domaine public, Caddy + Let's Encrypt) —
  le partage marche partout, y compris au supermarché. C'est ce que suppose
  le choix « plusieurs foyers » du §16 : des amis ne sont pas sur ton Wi-Fi.
- **Box en réseau local seulement** — le partage ne marche **que** à la maison.
  Ailleurs, Jow partage dans le vide. Ce n'est pas un bug, c'est le
  déploiement ; mais mieux vaut le savoir avant de conclure que l'app est
  cassée.

HTTPS est obligatoire dans les deux cas : **Android n'expose un share target
que sur une origine sécurisée.** Un certificat auto-signé ne suffit pas —
Chrome refuse d'installer la PWA.

---

## Déploiement

```bash
npm ci
npm run build:web                       # produit web/dist/
npm run migrate                         # applique db/migrations/
npm run seed                            # Ciqual + repères ANSES
npm run household -- --login=maison --name="Chez nous"
npm start                               # écoute sur $PORT (3000 par défaut)
```

`npm run seed` charge le référentiel et les repères. Il ne remplit **pas**
`unit_default` ni `seasonal_produce`, qui attendent leurs collectes (§17) :
c'est nominal, pas un échec.

### Caddy

```caddyfile
tablee.example.net {
    reverse_proxy localhost:3000
}
```

Caddy obtient le certificat tout seul. C'est la seule ligne qui compte : le
reste du §16 (Proxmox, réseau) ne change rien à la PWA.

⚠️ Ne pas mettre `TABLEE_INSECURE_COOKIE=1` en production. Cette variable
existe pour `http://localhost` en développement, et nulle part ailleurs — elle
retire l'attribut `Secure` du cookie de session.

---

## La séquence, dans l'ordre

### 1. L'app s'ouvre

Ouvrir `https://tablee.example.net` dans **Chrome** (pas Firefox : le share
target n'y est pas implémenté).

- **Échec possible** : erreur de certificat → Caddy n'a pas obtenu le
  certificat. Regarder ses logs, pas ceux de l'app.

### 2. L'app s'installe

Menu ⋮ → « Installer l'application » / « Ajouter à l'écran d'accueil ».
L'entrée doit dire **installer**, pas seulement « ajouter un raccourci ».

- **« Ajouter un raccourci » seulement** = le manifeste n'a pas été accepté.
  Ouvrir `chrome://inspect` depuis un PC relié en USB, onglet Application →
  Manifest : Chrome y dit précisément ce qui manque.
- C'est l'étape où l'on perd le plus de temps si on l'escamote : **sans
  installation, pas de share target**, et l'étape 3 échouera sans expliquer
  pourquoi.

### 3. Tablée apparaît dans la feuille de partage

Ouvrir **Jow**, une recette, « Partager ».

- **Tablée absente de la liste** → l'installation de l'étape 2 n'a pas
  vraiment eu lieu, ou Android n'a pas encore réindexé : redémarrer le
  téléphone une fois avant de conclure.
- **Tablée présente** → c'est gagné, le reste est du logiciel.

### 4. Le partage donne un repas

Choisir Tablée. L'app doit s'ouvrir sur l'écran de partage, afficher le titre
de la recette, et proposer le créneau selon l'heure.

Puis : **choisir le créneau, cocher qui était là, valider.** Trois taps, c'est
le critère du §13.

- **« La recette n'a pas pu être lue »** → le serveur a bien reçu le partage
  mais n'a pas su résoudre la recette. Regarder les logs du serveur : soit Jow
  a changé sa page (alors `npm run jow:capture` et relire le contrat), soit la
  box n'a pas d'accès sortant vers `jow.fr`.
- **L'app s'ouvre sur l'accueil au lieu de l'écran de partage** → les
  paramètres n'ont pas été transmis. C'est le cas à remonter en priorité :
  c'est le seul scénario que le code ne prévoit pas.

### 5. Hors ligne

Couper le Wi-Fi et les données, rouvrir l'app depuis l'écran d'accueil.

- Attendu : l'app s'ouvre, dans ses vraies polices, et les écrans qui
  demandent des données affichent une erreur franche.
- **Page blanche** → le service worker n'a pas mis la coquille en cache.
- ⚠️ Connue : après un redéploiement du front **sans** modification de
  `sw.js`, le navigateur ne réinstalle pas le worker et la coquille en cache
  continue de pointer vers des bundles qui n'existent plus. Hors ligne
  seulement — en ligne la navigation passe par le réseau d'abord. À reprendre
  quand ça gênera.

---

## Ce qu'il faut noter pendant l'essai

Trois choses valent la peine d'être relevées, parce qu'elles ne se déduisent
d'aucun code :

1. **Le contenu exact de `text`** tel que Jow le partage. Le contrat
   (`docs/jow-contract.md` §2) dit que le titre **et** l'URL y sont, et c'est
   ce que le parseur suppose. Le vérifier une fois vaut tous les tests.
   ⚠️ **Ne pas coller ce texte dans le dépôt ni dans un ticket** : il porte
   `key` et `userId`, qui sont des jetons de compte (I6).
2. **Le nombre de taps réel**, et où la main hésite. Le §13 dit trois ; si
   c'est cinq, c'est le sujet suivant, avant l'auth.
3. **Ce qui manque au moment de valider.** C'est le seul moment où l'on voit
   l'app comme un utilisateur, et ça ne se retrouve pas ensuite.

---

## Après, et seulement après

L'auth multi-comptes et multi-foyers (§7 et §16 amendés le 13/09/2026) attend
que cette séquence soit passée. Refondre l'identité par-dessus une ingestion
jamais vérifiée, c'est empiler deux inconnues et ne plus savoir laquelle
répond quand quelque chose casse.
