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
| Le parcours complet compte → foyer → invitation → acceptation | Vérifié contre un serveur réel, en HTTP | ✅ |
| Le parcours compte → foyer → « Bienvenue » → fiche réservée → inscription → rattachement | Piloté de bout en bout dans un Chromium, contre un serveur et une base réels | ✅ |

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

### Le rôle Postgres — à lire avant tout le reste

L'étanchéité entre foyers (§16) repose sur la Row-Level Security de la
migration 008. **Un superutilisateur Postgres la contourne, et en silence** :
les policies existent, `\d` les affiche, les requêtes passent, et rien ne
filtre. C'est exactement ce qui s'est produit pendant l'écriture — 178 tests au
vert avec une isolation entièrement décorative.

Le rôle de connexion doit donc **posséder ses tables sans être
superutilisateur** :

```sql
create role tablee login password '…';
create database tablee owner tablee;
-- surtout pas :  alter role tablee superuser;
```

Si le rôle existe déjà en superutilisateur :

```sql
alter role tablee nosuperuser;   -- il reste propriétaire, les migrations passent
```

Inutile de s'en souvenir : **le serveur refuse de démarrer** si l'isolation
n'est pas effective, et dit quoi corriger. C'est délibérément un refus et non
un avertissement — un avertissement dans un journal que personne ne lit
n'aurait rien changé au cas ci-dessus.

### La séquence

```bash
npm ci
npm run build:web                       # produit web/dist/
npm run migrate                         # applique db/migrations/
npm run seed                            # Ciqual + repères ANSES
npm start                               # écoute sur $PORT (3000 par défaut)
```

Il n'y a plus de commande pour créer le foyer : **le premier compte se crée
depuis l'app**, et crée son foyer dans la foulée.

`npm run seed` charge le référentiel et les repères. Il ne remplit **pas**
`unit_default` ni `seasonal_produce`, qui attendent leurs collectes (§17) :
c'est nominal, pas un échec.

### Les variables

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | La base. Rôle non superutilisateur, voir ci-dessus. |
| `TABLEE_SECRET` | Signe les jetons de session, 32 caractères au moins. **Pas de valeur par défaut** : une clé codée en dur et partagée par toutes les installations ne protège rien, donc le serveur refuse de démarrer sans.<br>`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `TABLEE_BASE_URL` | L'origine publique telle que le navigateur la voit — `https://tablee.example.net`, pas `localhost`. better-auth valide l'origine des requêtes avec, et les liens d'invitation en sortent. |
| `TABLEE_INSECURE_COOKIE` | `1` retire l'attribut `Secure` du cookie. Développement sur `http://localhost` uniquement. |
| `TABLEE_LOG` | `1` rallume le journal de requêtes, expurgé des jetons Jow (I6). |
| `TABLEE_MAIL` | `resend` ou `smtp` ; absent, aucun mail ne part. Allume d'un coup la confirmation d'adresse, le mot de passe oublié et l'invitation par mail. Une configuration incomplète refuse de démarrer. |
| `TABLEE_MAIL_FROM` | L'expéditeur, `Tablée <tablee@example.net>`. Requis avec `TABLEE_MAIL`. Chez Resend, le domaine doit y être vérifié. |
| `RESEND_API_KEY` | Avec `TABLEE_MAIL=resend`. Passe par HTTPS : utile quand la sortie SMTP est fermée. |
| `SMTP_URL` | Avec `TABLEE_MAIL=smtp` : `smtps://utilisateur:motdepasse@hôte:465`, ou `smtp://…:587` pour STARTTLS. Encoder `@`, `/`, `:`, `#` dans le mot de passe. |
| `ANTHROPIC_API_KEY` | Facultatif. Allume « Découper avec l'IA » dans la saisie libre et l'onglet « Conseils » (V3) ; absent, ni l'un ni l'autre. Poser une limite de dépense sur la clé côté console Anthropic : l'inscription étant ouverte, n'importe quel compte peut s'en servir (dette n° 17). |

⚠️ L'inscription est **ouverte**, et c'est voulu : des amis doivent pouvoir
créer leur foyer sans passer par vous. Ça veut dire que quiconque trouve l'URL
peut créer un compte. Un compte seul ne donne accès à **aucun** foyer — il faut
une invitation acceptée — mais les adresses ne sont pas vérifiées faute de SMTP
(dette n° 7).

> **Précisé le 14/09/2026.** Avec `TABLEE_MAIL`, elles le sont : on n'entre
> qu'après avoir suivi le lien reçu. L'allumer sur une instance qui a déjà des
> comptes leur demande de confirmer leur adresse à la prochaine connexion — le
> lien part tout seul, mais prévenez-les. Le transporteur (Resend, ou votre
> relais) voit les adresses, le prénom de qui invite et le nom du foyer.

### Caddy

```caddyfile
tablee.example.net {
    reverse_proxy localhost:3000

    # HSTS. La seule ligne de sécurité que l'app ne peut pas poser elle-même :
    # elle ne sert qu'en HTTP derrière ce proxy, et un en-tête HSTS n'a de sens
    # que sur la connexion chiffrée. Tout le reste — CSP, `nosniff`,
    # `referrer-policy` et les autres — est posé par le serveur lui-même
    # (`server/http/headers.ts`), pour suivre l'image quel que soit le proxy.
    #
    # ⚠️ À poser une fois le domaine servi en HTTPS et pas avant : le
    # navigateur retient la consigne pendant un an, y compris si vous
    # redescendez en HTTP.
    header Strict-Transport-Security "max-age=31536000"
}
```

Caddy obtient le certificat tout seul. C'est la seule ligne qui compte : le
reste du §16 (Proxmox, réseau) ne change rien à la PWA.

⚠️ Ne pas mettre `TABLEE_INSECURE_COOKIE=1` en production. Cette variable
existe pour `http://localhost` en développement, et nulle part ailleurs — elle
retire l'attribut `Secure` du cookie de session.

---

## La séquence, dans l'ordre

### 1. L'app s'ouvre, et vous créez votre compte

Ouvrir `https://tablee.example.net` dans **Chrome** (pas Firefox : le share
target n'y est pas implémenté).

L'app demande de créer un compte, puis le foyer. Vous en êtes **parent**.

Elle enchaîne ensuite sur **« Bienvenue »**, en deux temps (14/09/2026) : votre
propre assiette — prénom, date de naissance, sexe, portion, régimes, et
facultativement poids et taille puisque vous êtes majeur —, puis les autres
convives. Pour un adulte, cocher « cette personne aura son propre compte » et
saisir son adresse fait trois choses d'un coup : la fiche est créée, elle lui
est **réservée**, et l'invitation est prête. Le lien se copie et se transmet
comme vous voulez : il n'y a pas d'envoi automatique.

Le jour où cette personne s'inscrit avec cette adresse et rejoint le foyer, sa
fiche devient la sienne, avec ce que vous aurez saisi entre-temps. Rien à
ressaisir, rien à refaire — **c'est le point à vérifier en vrai** : créer la
fiche de votre conjointe, lui envoyer le lien, et regarder si sa fiche porte
bien « · vous » de son côté.

- **Sur un enfant, aucun champ de poids n'apparaît**, et c'est voulu (I5). Si
  vous en voyez un, c'est un bug, pas un réglage.
- **Sa fiche reste « réservée à … »** après qu'elle a accepté → elle s'est
  inscrite avec une autre adresse. « La famille » → sa fiche → « Rattacher à un
  compte… », avec la bonne adresse cette fois.

- **Échec possible** : erreur de certificat → Caddy n'a pas obtenu le
  certificat. Regarder ses logs, pas ceux de l'app.
- **Le serveur refuse de démarrer** en parlant d'étanchéité → le rôle Postgres
  est superutilisateur. Voir plus haut ; c'est une ligne de SQL.

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
