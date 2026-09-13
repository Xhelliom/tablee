# Tablée — image de service.
#
# ── Ce qui est dans l'image, et ce qui n'y est pas ──────────────────────────
#
# Dedans : le serveur, la PWA compilée, les migrations SQL, les seeds CSV des
# repères ANSES, et `tsx` — qui n'est pas un outil de développement ici, le
# serveur exécutant du TypeScript directement (`npm start`).
#
# Dehors, volontairement : **l'export Ciqual**. C'est 57 Mo de XML publiés par
# l'ANSES, versionnés hors dépôt (`.gitignore`), et qui changent une fois tous
# les quelques années. Les embarquer alourdirait chaque image de chaque
# déploiement pour une donnée qui ne bouge pas. Le seed est un geste
# d'opérateur, fait une fois — voir `deploy/k8s/job-seed.yaml`.
#
# Dehors aussi, et ça ne se négocie pas : aucun secret. `TABLEE_SECRET` et
# `DATABASE_URL` viennent de l'environnement, jamais d'un `ENV` de ce fichier.

# ─────────────────────────────────────────────────────────────────────────────
# 1. Construction du front
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

# Les dépendances d'abord : cette couche ne se reconstruit que si le lockfile
# change, ce qui fait la différence entre un build de 20 secondes et de 3
# minutes à chaque commit.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts ./
COPY web/ ./web/
COPY server/ ./server/

RUN npm run build:web

# ─────────────────────────────────────────────────────────────────────────────
# 2. Dépendances de service
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./

# `--omit=dev` laisse tomber vite, typescript et les types. `tsx` reste : il
# est en `dependencies` parce que `npm start` s'en sert, pas par accident.
RUN npm ci --omit=dev && npm cache clean --force

# ─────────────────────────────────────────────────────────────────────────────
# 3. L'image de service
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

WORKDIR /app

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/web/dist     ./web/dist

COPY package.json ./
COPY server/  ./server/
COPY scripts/ ./scripts/
COPY db/      ./db/

# L'utilisateur `node` existe déjà dans l'image officielle. Rien n'est écrit
# sur le disque en service — tout l'état est en base — donc aucune raison de
# tourner en root.
USER node

EXPOSE 3000

# Node est PID 1, et **pas** `npm start`.
#
# npm ne transmet pas `SIGTERM` de façon fiable à son fils : à l'arrêt d'un pod,
# Kubernetes signale PID 1, npm meurt, et le serveur est tué au bout du
# `terminationGracePeriod` sans avoir fermé ni ses connexions Postgres ni les
# requêtes en cours. Exécuté directement, Node reçoit le signal et son
# gestionnaire ferme proprement (`server/index.ts`).
#
# Le serveur refuse de démarrer si l'étanchéité entre foyers n'est pas
# effective — rôle Postgres superutilisateur, ou RLS absente. C'est voulu :
# voir `server/db/guard.ts` et le §16 de la spec.
CMD ["node", "--import", "tsx", "server/index.ts"]
