# Étude — GPT-Live-1 pour le chat de l'assistant

Rédigée le 28/10/2026, à partir de la documentation officielle consultée ce
jour-là. L'API est sortie le 10/09/2026 : rien ici ne vient de souvenirs.

## Le nom exact, et où le lire

La note dictée disait « GPT Live 1 ». C'est **GPT-Live-1**, identifiant de
modèle `gpt-live-1`, chez **OpenAI** (une 1.1 est en déploiement depuis le
22/10/2026 : nouvelles voix, meilleurs accents). Annoncé le 10/09/2026.

| Document | Lien |
|---|---|
| Guide officiel | https://developers.openai.com/api/docs/guides/live |
| Fiche du modèle (prix, limites) | https://developers.openai.com/api/docs/models/gpt-live-1 |
| Annonce | https://openai.com/index/introducing-gpt-live-1-in-the-api/ |
| Annonce, forum développeurs | https://community.openai.com/t/introducing-gpt-live-1-in-the-api/1396471 |
| Référence complète des événements (Microsoft Foundry, même API sous `/openai/v1/live`) | https://learn.microsoft.com/en-us/azure/foundry/openai/gpt-live-reference |

La référence événement par événement la plus complète trouvée est celle de
Microsoft Foundry, qui expose la même API ; le guide d'OpenAI renvoie à des
sous-pages par transport. Les noms d'événements ci-dessous en viennent.

## Ce qu'est une session live

GPT-Live est un **modèle vocal full duplex** : il écoute pendant qu'il parle,
et se laisse interrompre. Il ne réfléchit pas lui-même aux questions de fond :
il **délègue** à un backend — un modèle, des outils, un agent — et parle
pendant que le backend travaille. C'est une **façade vocale**, pas un modèle de
chat.

- **Modalités** : audio et texte en entrée comme en sortie selon la fiche ; en
  pratique, l'entrée est l'audio du micro, la sortie est l'audio plus des
  **transcriptions** (`session.input_transcript.delta`,
  `session.output_transcript.delta`). Pas d'image ni de vidéo.
- **Transports** : WebRTC (recommandé pour un navigateur : l'audio sur les
  pistes média, les événements JSON sur un data channel), WebSocket (côté
  serveur, PCM16 mono 24 kHz en base64), téléphonie/SIP. Une connexion
  **sideband** permet au serveur de surveiller et piloter une session ouverte
  par le navigateur, l'audio restant sur la connexion principale.
- **Délégation**, choisie à la création, non modifiable ensuite :
  - `responses` : OpenAI fait tourner le modèle backend (un GPT, via
    l'API Responses) avec ses outils ; nos fonctions restent exécutées chez
    nous ;
  - `client` : on branche **notre propre** backend. GPT-Live émet
    `session.delegation.created`, et on lui renvoie la matière à dire par
    `session.commentary.append` (500 tokens maximum par envoi) ou du contexte
    silencieux par `session.thinking.append`.

### Déroulement d'une session

1. Le serveur, seul détenteur de la clé, crée la session — en WebRTC par
   `POST /v1/live/sessions` en échangeant l'offre SDP du navigateur contre une
   réponse ; en WebSocket en se connectant à `/v1/live/sessions` et en envoyant
   `session.start`. La configuration est stricte : `model`, `instructions`,
   `audio.output.voice`, `delegation` — **figés au démarrage**, seule la
   délégation se change ensuite (`session.update`).
2. `session.started` arrive, avec un `expires_at`.
3. La conversation : audio entrant, transcriptions et audio sortant
   entrelacés, délégations au fil des questions.
   `session.usage.updated` donne la durée cumulée, à peu près chaque minute.
4. `session.close`, puis `session.closed` avec l'usage final et une raison
   (`close_requested`, `expired`, `content`, `remote_hangup`,
   `connection_lost`).

### Comment Tablée s'y brancherait

Le seul montage compatible avec ce qui existe : **WebRTC depuis la PWA,
session créée par le serveur, délégation `client` vers l'assistant actuel**
(`advise`, Claude, `server/llm/conseil.ts`), le serveur tenant la sideband.
Concrètement : une route qui crée la session avec la consigne de Conseils,
une sideband qui écoute `session.delegation.created`, appelle `advise` sur le
résumé du foyer et la transcription, et renvoie la réponse par
`session.commentary.append`. Le chat texte actuel ne disparaît pas : GPT-Live
n'accepte pas de message texte de l'utilisateur hors délégation `responses`
(`response.item.create`), qui ferait de GPT le backend à la place de Claude.

## Coût et prérequis

- **Prix** : **0,05 $ par minute de session**, facturée à la seconde, sans
  arrondi. Le backend (ici Claude) est facturé à part, comme aujourd'hui.
  Ordre de grandeur : une conversation de 5 minutes, 0,25 $ de voix en plus.
- **Compte et clé** : un compte OpenAI avec une **clé API de projet**, gardée
  côté serveur — un fournisseur de plus à côté d'Anthropic et Google. Le
  **palier gratuit n'y a pas accès**.
- **Limites** : en **sessions simultanées** — 50 au palier Build, 300 en
  Launch, 500 en Grow. Durée maximale d'une session : non publiée, elle se lit
  dans `expires_at`.
- **Navigateur** : micro, et une page en HTTPS — Tablée l'est déjà (share
  target).
- **Endpoint unique** : `gpt-live-1` ne répond que sur Live, pas sur Chat
  Completions, Responses ni Realtime.

## Recommandation

**Ne pas adopter GPT-Live pour le chat de l'assistant.** Trois raisons, la
première suffit :

1. **I3 ne tient plus.** Tout ce qui part vers un modèle passe aujourd'hui par
   `anonymize`, qui retire les prénoms du foyer. Une voix ne se filtre pas :
   le parent qui demande « est-ce que Léa mange assez de légumes ? » envoie le
   prénom chez OpenAI dans l'audio, et sa voix avec. Même la délégation
   `client` n'y change rien : c'est GPT-Live qui entend. Ce n'est pas un réglage
   à trouver, c'est la forme même du produit.
2. **Ce n'est pas un chat.** C'est une interface vocale temps réel ; le chat
   des Conseils est une question écrite sur un résumé de semaine, lue à son
   rythme. GPT-Live ne remplacerait pas le texte, il s'y ajouterait — un
   second canal, un troisième fournisseur, une facturation à la minute.
3. **Rien ne le demande encore.** La V3 attend des semaines de repas réels
   ; une voix sur l'assistant n'améliore pas ce qu'il sait.

Si une saisie vocale devenait souhaitable un jour, la question à poser n'est
pas GPT-Live mais « une dictée **sur l'appareil** » (l'API Web Speech du
navigateur), qui garderait la voix dans le téléphone et laisserait `anonymize`
faire son travail sur le texte. C'est une autre carte, et elle relève du point
5 de « Ne pas décider seul » si elle touche à ce qui part au LLM.

### Ce que devient la carte « Diffuser les réponses en streaming SSE »

**Elle est déjà faite et fusionnée** : PR #18 (`a131398`,
`board/streaming-sse-chat-assistant`). `POST /api/assistant` rend des
événements `texte`, puis `fin` ou `erreur`, en `text/event-stream`, avec
`x-accel-buffering: no` pour l'ingress (`server/routes/assistant.ts`), et le
flux vient de `client.beta.messages.stream` (`server/llm/index.ts`). GPT-Live
ne la rend pas caduque : elle reste le chemin du chat, et la carte peut être
close comme livrée.
