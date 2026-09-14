# Déploiement sur Kubernetes — passation

Ce document suffit à mettre Tablée en service sans relire le code. Il est
ordonné : chaque étape échoue pour une raison différente, et les enchaîner dans
le désordre fait perdre le bénéfice du diagnostic.

Il complète `docs/mise-en-service.md`, qui reste **la** référence pour la
vérification sur téléphone — le chemin critique du produit, et la seule chose
qu'aucun manifeste ne remplace.

---

## Les trois choses qui font échouer un déploiement

Dans l'ordre où elles mordent. Si vous ne lisez qu'un paragraphe, lisez
celui-ci.

### 1. Le rôle Postgres ne doit pas être superutilisateur

L'étanchéité entre foyers (§16 de la spec) repose sur la Row-Level Security de
la migration 008. **Un superutilisateur la contourne, et en silence** : les
policies existent, `\d` les affiche, les requêtes passent, et rien ne filtre.
Ce n'est pas théorique — 178 tests sont passés au vert dans cet état pendant
l'écriture de la 008 avant qu'on s'en aperçoive.

Le serveur **refuse de démarrer** dans cet état et dit quoi corriger. Ce n'est
pas un avertissement : un avertissement dans un journal que personne ne lit
n'aurait rien changé au cas ci-dessus.

Le `20-postgres.yaml` fourni crée le bon rôle tout seul. Avec une base externe,
c'est à vous :

```sql
create role tablee login password '…' nosuperuser;
create database tablee owner tablee;
-- si le rôle existe déjà :
alter role tablee nosuperuser;   -- il reste propriétaire, les migrations passent
```

### 2. `TABLEE_BASE_URL` doit être l'origine publique exacte

C'est ce que le **navigateur** voit : `https://tablee.example.net`, jamais
`localhost` ni un nom de service interne. better-auth valide l'origine des
requêtes avec, et les liens d'invitation en sortent.

Une valeur fausse donne une app qui refuse les connexions sans expliquer
pourquoi, et des liens d'invitation qui ne mènent nulle part. Elle doit être
identique à l'hôte de l'Ingress.

### 3. HTTPS n'est pas optionnel

Android n'expose un share target que sur une origine sécurisée, et Chrome
refuse d'installer une PWA sans certificat valide. Sans HTTPS, **Tablée
n'apparaît pas dans le menu de partage de Jow** — c'est-à-dire qu'il n'y a pas
d'ingestion, donc pas d'app (§4). Un certificat auto-signé ne suffit pas.

---

## L'image

Publiée par GitHub Actions sur `ghcr.io/xhelliom/tablee` à chaque poussée, et
**seulement si les tests passent** : publier une image non testée déplace le
moment où l'on découvre le problème, ça ne l'évite pas.

| Tag | Quand |
|---|---|
| `latest` | dernier commit de la branche par défaut |
| `sha-<40 hex>` | un commit précis — **à préférer en production** |
| `<branche>` | dernier commit d'une branche |
| `v1.2.3`, `1.2` | sur un tag git `v*` |

Elle est construite pour `linux/amd64` et `linux/arm64`. Plus aucun module
natif dans l'arbre de dépendances depuis que `@node-rs/argon2` en est sorti,
donc les deux architectures sont équivalentes — si votre cluster est en x86
seulement, retirer `linux/arm64` du workflow divise le temps de build par
trois.

### Rendre le paquet visible

Un paquet GHCR est **privé par défaut**, y compris sur un dépôt public. Sans
`imagePullSecrets`, le cluster ne pourra pas le tirer. Deux voies :

- le passer en public : page du paquet → *Package settings* → *Change
  visibility* ;
- ou créer un secret de tirage :

```sh
kubectl -n tablee create secret docker-registry ghcr \
  --docker-server=ghcr.io \
  --docker-username=Xhelliom \
  --docker-password='<PAT avec read:packages>'
```
puis ajouter `imagePullSecrets: [{ name: ghcr }]` au `spec` du Deployment et du
Job de seed.

### Ce qui n'est pas dans l'image, volontairement

**L'export Ciqual** — 57 Mo de XML publiés par l'ANSES, inchangés depuis 2020.
Les embarquer alourdirait chaque image de chaque déploiement pour une donnée
qui ne bouge pas.

Ce qui est dans l'image, en revanche, c'est son **empreinte** :
`db/seeds/ciqual-source.json`. Le seed va chercher l'archive au premier
démarrage qui en a besoin et refuse de l'importer si elle ne correspond pas.
C'est donc l'image qui décide quelle table Ciqual tourne, et un déploiement
suffit à en changer — voir « Le référentiel alimentaire » plus bas.

**Aucun secret.** `TABLEE_SECRET` et `DATABASE_URL` viennent de
l'environnement. Rien dans l'image, rien dans le dépôt.

---

## La séquence

### 1. Le secret

```sh
kubectl create namespace tablee

kubectl -n tablee create secret generic tablee \
  --from-literal=TABLEE_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")" \
  --from-literal=POSTGRES_PASSWORD="$(node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))")" \
  --from-literal=DATABASE_URL='postgres://tablee:LE_MEME_MOT_DE_PASSE@tablee-postgres:5432/tablee'
```

⚠️ Le mot de passe apparaît deux fois et doit correspondre : `POSTGRES_PASSWORD`
sert au script d'initialisation à créer le rôle, `DATABASE_URL` à s'y
connecter. S'il contient des caractères réservés d'URL (`@`, `/`, `:`, `#`),
les encoder dans `DATABASE_URL` — ou n'en pas mettre.

`10-secret.example.yaml` est un gabarit de lecture ; il n'est **pas** dans le
`kustomization`, parce qu'un secret appliqué depuis un dépôt finit toujours par
y être committé.

### 2. Les manifestes

Avant d'appliquer, remplacer dans `30-deployment.yaml` et `50-ingress.yaml` :

- `tablee.example.net` → votre nom de domaine, aux **trois** endroits ;
- `letsencrypt-prod` → le nom de votre `ClusterIssuer` ;
- `ingressClassName: nginx` → votre classe d'Ingress.

Puis :

```sh
kubectl apply -k deploy/k8s/
kubectl -n tablee rollout status deploy/tablee
```

Le pod ne démarre pas tant que les migrations n'ont pas tourné : elles sont
dans un `initContainer`. Deux pods qui migreraient en même temps ne se marchent
pas dessus — `scripts/migrate.ts` prend un verrou consultatif Postgres, et le
second attend.

### 3. Le référentiel alimentaire — rien à faire

**⚠️ Changé le 14/09/2026.** Il fallait ici jouer `job-seed.yaml` à la main
après le premier déploiement. Ce n'est plus le cas : le seed est un second
`initContainer`, après les migrations, et il tourne à **chaque** déploiement.
Un cluster neuf a donc ses 3 185 aliments et ses repères ANSES sans qu'on
touche à quoi que ce soit, et une image qui épingle une nouvelle table Ciqual
la réimporte d'elle-même.

Le geste d'avant se faisait mal : rien, dans l'app, ne distinguait « ce mot ne
donne rien » de « le seed n'a jamais été joué ». Les deux ressemblaient à une
recherche d'aliments cassée.

Ce que ça coûte, et ce que ça ne coûte pas :

- Quand il n'y a rien à faire — le cas de presque tous les redémarrages — le
  seed lit une ligne de `referential_import` et s'arrête. **Moins d'une
  seconde, aucun accès réseau.**
- Il ne télécharge les 3,5 Mo et ne relit les 57 Mo de XML que si
  `db/seeds/ciqual-source.json` a changé dans l'image.
- Il **ne peut pas empêcher le pod de démarrer**. ANSES injoignable, cluster
  sans sortie réseau, archive qui ne correspond pas à l'empreinte épinglée :
  le message part dans le journal et l'app sert quand même. Elle affichera
  « indisponible » là où elle ne sait pas — elle n'invente pas (I1).

```sh
kubectl -n tablee logs deploy/tablee -c seed     # ce que le seed a fait
```

L'archive est vérifiée contre la SHA-256 de `db/seeds/ciqual-source.json`
avant d'être lue : un miroir qui rendrait autre chose n'écrit rien. Mettre à
jour la table de l'ANSES est donc un commit qui se relit, pas un
téléchargement qui change la base en silence.

Deux cas gardent un geste :

```sh
# forcer une réimportation (mapping corrigé, seed en échec la veille)
kubectl -n tablee create -f deploy/k8s/job-seed.yaml
kubectl -n tablee logs -f job/<le nom généré>
```

Un cluster sans sortie réseau monte, dans le job comme dans le déploiement, un
volume contenant `alim_*.xml` et `compo_*.xml` à la place de l'`emptyDir` : le
seed les prend tels quels, sans rien télécharger.

**Le rapport final compte les valeurs manquantes, colonne par colonne. Elles
doivent se voir** : une teneur absente, à l'état de traces ou sous le seuil de
quantification est écrite `NULL`, jamais `0` (I1).

### 3bis. Ce que le cluster doit permettre

Le seed tourne dans le pod, à chaque déploiement. Quatre points à vérifier une
fois, dans l'ordre de ce qui fait échouer pour de bon.

**Une sortie HTTPS vers `ciqual.anses.fr`.** Elle s'ajoute à celle vers
`jow.fr`, que l'app utilise déjà pour lire une recette partagée : un cluster
qui laisse passer la seconde laisse passer la première. La différence est la
fréquence — le seed ne sort que lorsque `referential_import` ne correspond pas
à l'empreinte de l'image, donc une fois par version de la table Ciqual, là où
`jow.fr` est appelé à chaque recette inconnue.

Sur un cluster en `default-deny` en egress, les deux s'autorisent de la même
façon — avec le DNS, qu'on oublie une fois sur deux :

```yaml
# NetworkPolicy ne connaît pas les noms de domaine (sauf CNI qui le gère —
# Cilium a `toFQDNs`). À défaut : le 443 sortant, plages privées exclues.
egress:
  # Le DNS d'abord : sans lui, jow.fr et anses.fr ne se résolvent pas, et
  # l'erreur ressemble à une panne réseau du site d'en face.
  - to: [{ namespaceSelector: {}, podSelector: { matchLabels: { k8s-app: kube-dns } } }]
    ports: [{ protocol: UDP, port: 53 }]
  # ⚠️ Postgres est dans une plage privée, que la règle suivante exclut : sans
  # cette ligne-ci, l'app ne démarre pas du tout — et le message parlera de la
  # base, pas de la politique réseau.
  - to: [{ podSelector: { matchLabels: { app: tablee-postgres } } }]
    ports: [{ protocol: TCP, port: 5432 }]
  - to:
      - ipBlock:
          cidr: 0.0.0.0/0
          except: [10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16]
    ports: [{ protocol: TCP, port: 443 }]
```

Si cette sortie n'est pas possible, **rien ne casse** : le pod démarre, le
journal dit pourquoi, et l'app sert sans référentiel. Monter alors un volume
contenant `alim_*.xml` et `compo_*.xml` à la place de l'`emptyDir` `ciqual` :
le seed les prend tels quels.

**De la place pour le quota, s'il y en a un.** Les `initContainers` ne
s'additionnent pas aux conteneurs, mais le pod retient le **maximum** : la
limite mémoire effective du pod passe donc à 1 Gi, contre 512 Mi avant.
Un `ResourceQuota` serré refusera le pod entier, et le message ne parlera pas
du seed. L'`emptyDir` demande 256 Mi de stockage éphémère sur le nœud.

**Le `PodSecurity` du namespace.** Les deux `initContainers` — `migrate` comme
`seed` — ne posent pas `runAsNonRoot` ni `seccompProfile` : sous un namespace
étiqueté `restricted`, le pod est refusé. Ce n'est pas nouveau (`migrate` est
là depuis la 007) et `seed` n'ajoute aucune contrainte, mais si le namespace
est durci un jour, les deux sont à durcir ensemble. Le pod porte en revanche
`fsGroup: 1000` : le seed écrit l'export dans l'`emptyDir` et l'image tourne
en `node`.

**Plusieurs répliques, c'est sûr.** Deux pods qui démarrent ensemble prennent
un verrou consultatif Postgres : le second attend, constate que le premier a
fini, et repart sans rien réimporter.

### 3ter. Avec FluxCD

Rien de particulier à déclarer : le seed est une ligne du **manifeste**, pas
une commande. Une `Kustomization` qui pointe `deploy/k8s/` le fait arriver
comme le reste, et il n'y a aucun `Job` à déclencher après coup.

Quatre points valent quand même d'être dits.

**Le manifeste compte autant que l'image.** Une automatisation d'image qui ne
ferait que bouger le tag ne créerait jamais l'`initContainer` : il vient du
`Deployment`. Si l'image est pilotée par `image-automation` et les manifestes
par une autre `Kustomization`, s'assurer que celle-ci suit bien `deploy/k8s/`.

**Ne pas ajouter `job-seed.yaml` aux ressources.** Il porte un `generateName`,
que le server-side apply de Flux ne sait pas réconcilier — il lui faut un nom
pour tenir son inventaire. Il est hors de `kustomization.yaml` depuis le
début, et il y reste : c'est l'outil d'une réimportation forcée à la main, pas
une étape de déploiement. Même remarque pour `10-secret.example.yaml`, qui est
un gabarit — le vrai secret ne passe pas par le dépôt.

**La santé du `Deployment` reste un signal utile.** Le seed ne peut pas faire
échouer le pod : une panne d'ANSES ne fera donc jamais échouer une
réconciliation ni déclencher un `rollback`. Ce qui ne va pas se lit dans les
logs du conteneur `seed`, pas dans l'état de la `Kustomization`.

**Changer de table Ciqual est un commit.** `db/seeds/ciqual-source.json`
change → l'image change → le pod suivant réimporte. C'est la boucle GitOps
normale, et c'est ce qui fait qu'une donnée nutritionnelle ne peut pas changer
sans relecture.

```sh
kubectl -n tablee logs deploy/tablee -c seed          # ce que le seed a fait
flux -n tablee reconcile kustomization <la-vôtre>     # forcer un passage
```

### 4. Le premier compte

Ouvrir `https://votre-domaine` : l'app demande de créer un compte, puis le
foyer. Vous en êtes **parent**.

Il n'y a pas de commande d'amorçage — l'inscription est ouverte, et c'est
voulu : des amis doivent pouvoir créer leur foyer sans passer par vous (§16).

### 5. Le téléphone

`docs/mise-en-service.md`, à partir de « La séquence, dans l'ordre ». C'est la
seule étape qu'aucun manifeste ne remplace, et c'est le chemin critique.

---

## Ce qui a été vérifié, et comment

Pour que vous sachiez où porter votre attention — et où ne pas la porter.

| Vérifié | Comment |
|---|---|
| L'image se construit et sert | Build réel, puis `GET /` → 200 HTML, `/api/me` → 200, manifeste en `application/manifest+json` |
| Les migrations tournent **depuis l'image** | `npm run migrate` dans le conteneur, 8 migrations appliquées |
| L'arrêt est propre | `docker stop` rend la main en 0 s — donc `SIGTERM` traité, pas un `SIGKILL` après délai de grâce. C'est pourquoi le `CMD` lance Node directement : `npm start` comme PID 1 ne transmet pas le signal de façon fiable |
| Le garde-fou d'étanchéité fonctionne dans le conteneur | Rôle passé superutilisateur → le conteneur refuse de démarrer avec le message de correction |
| Le script d'init Postgres crée le bon rôle | Postgres réel, script monté comme le ferait le ConfigMap, **avec une apostrophe et un dollar dans le mot de passe** : `rolsuper = f`, base possédée par `tablee` |
| L'app accepte ce rôle | Migrations + démarrage + `/api/me` contre cette base exacte |
| Les manifestes sont du YAML valide | Analyse des 8 fichiers |

**Non vérifié**, et c'est la limite honnête de cette passation :

- **Rien n'a tourné dans un vrai cluster.** Pas de Kubernetes ici : les
  manifestes sont écrits selon les spécifications et validés syntaxiquement,
  pas appliqués. Les valeurs à ajuster (classe d'Ingress, `ClusterIssuer`,
  `storageClassName`) dépendent du vôtre.
- **Le workflow GitHub Actions n'a jamais été exécuté.** Il le sera à la
  première poussée ; s'il échoue, ce sera visiblement et sans rien casser.
- **Le build multi-architecture n'a pas été essayé** — seul `amd64` a été
  construit localement.

---

## Exploitation

### Voir ce qui tourne

```sh
kubectl -n tablee get pods
kubectl -n tablee logs deploy/tablee
kubectl -n tablee logs deploy/tablee -c migrate     # les migrations
```

Le journal de requêtes est **éteint** par défaut (`TABLEE_LOG=0`). L'allumer
est sans danger pour les jetons Jow — ils sont expurgés de l'URL avant d'entrer
dans le journal (I6) — mais un log par requête ne sert à personne en régime
normal.

### Mettre à jour

```sh
kubectl -n tablee set image deploy/tablee \
  tablee=ghcr.io/xhelliom/tablee:sha-<commit> \
  migrate=ghcr.io/xhelliom/tablee:sha-<commit> \
  seed=ghcr.io/xhelliom/tablee:sha-<commit>
```

Les **trois** conteneurs doivent porter la même version : `migrate` applique
les migrations que le serveur attend, et `seed` porte l'empreinte Ciqual que
le schéma migré sait enregistrer. En oublier un donne un pod qui mélange deux
versions, ce qui est précisément le genre de panne qu'on ne diagnostique pas
en regardant les logs du serveur.

Épingler un SHA plutôt que `latest` — `latest` ne dit pas ce qui tourne, et un
redémarrage de pod peut changer la version sans que rien ne le montre.

### Sauvegarder

```sh
kubectl -n tablee exec statefulset/tablee-postgres -- \
  pg_dump -U postgres -Fc tablee > tablee-$(date +%F).dump
```

⚠️ **Ce fichier contient les enfants des autres familles** : prénoms, dates de
naissance, allergènes. Le §16 rappelle que l'héberger fait de vous un
responsable de traitement. Il ne va ni dans le dépôt — le `.gitignore` couvre
`*.dump` — ni dans un stockage tiers sans y avoir réfléchi.

### Supprimer un foyer à la demande

Depuis l'app : « La famille » → « Gérer le foyer et les accès » → « Supprimer
le foyer ». La cascade efface tout, jusqu'aux tables feuilles — vérifié par un
test. C'est une exigence du §16, pas une commodité.

---

## Ce que ce déploiement ne couvre pas

- **La réinitialisation de mot de passe et la vérification d'adresse** :
  aucun serveur SMTP. C'est la dette n° 7, et la plus gênante — un mot de passe
  oublié se règle en base, ce qui n'est acceptable que pour vous-même. À
  regarder avant d'inviter des familles qui ne sont pas la vôtre.
  *Depuis le 14/09/2026, couvert si vous le voulez :* `TABLEE_MAIL` dans
  `30-deployment.yaml`, et `RESEND_API_KEY` ou `SMTP_URL` dans le secret. Resend
  passe par HTTPS, ce qui évite de demander au cluster une sortie SMTP.
- **La supervision.** Pas de métriques, pas d'alertes. Les sondes de vie
  suffisent à redémarrer un pod mort, pas à savoir que la base se remplit.
- **La haute disponibilité.** Une réplique, un Postgres à un nœud. C'est un
  choix proportionné à l'usage ; monter les répliques de l'app est sûr côté
  migrations, mais Postgres reste le point unique.
- **Le chiffrement par foyer.** Écarté en connaissance de cause (§16) :
  l'app ne montre rien d'un foyer à l'autre, mais vous avez le root de la
  machine. **Ça se dit tel quel aux familles invitées.**
