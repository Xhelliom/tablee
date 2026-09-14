/**
 * L'envoi de mail, le choix de qui le porte, et ce à quoi il ressemble.
 *
 *   TABLEE_MAIL=resend   RESEND_API_KEY=re_…
 *   TABLEE_MAIL=smtp     SMTP_URL=smtps://utilisateur:motdepasse@smtp.example.net:465
 *   TABLEE_MAIL_FROM='Tablée <tablee@example.net>'
 *
 * Sans `TABLEE_MAIL`, rien ne part, et l'app se comporte comme avant : les
 * invitations sont des liens à copier, et un mot de passe oublié se règle en
 * base (dette n° 7).
 *
 * ── Deux transports, et pas un de plus ──────────────────────────────────────
 *
 * Resend passe par HTTPS, ce qui compte sur un cluster : beaucoup ferment la
 * sortie sur les ports SMTP. Un simple `fetch`, sans son SDK — un appel ne
 * justifie pas une dépendance. SMTP couvre tout le reste, relais du
 * fournisseur d'accès compris ; là, nodemailer, parce que STARTTLS et AUTH
 * écrits à la main sont exactement ce qu'on écrit mal.
 *
 * Une configuration incomplète **refuse de démarrer**, comme `TABLEE_SECRET` :
 * une instance qui croit envoyer et n'envoie rien laisse les gens attendre un
 * lien qui ne vient pas.
 *
 * ── Une mise en page, sans moteur de gabarits ───────────────────────────────
 *
 * Trois mails qui ont la même forme — un titre, un ou deux paragraphes, un
 * bouton, une mise en garde — ne justifient ni MJML ni React Email. Le texte et
 * le HTML sortent du **même** contenu : le lien du bouton ne peut pas diverger
 * de celui du texte, qui reste envoyé pour les clients qui n'affichent pas le
 * HTML.
 *
 * Ce que le HTML refuse : les images distantes, bloquées par défaut par la
 * plupart des clients et qui servent surtout à savoir qui a ouvert ; les
 * polices web, que Gmail ignore — d'où Georgia sous Fraunces ; le mode sombre,
 * que chaque client inverse à sa façon. Et **tout ce qu'un compte a saisi est
 * échappé** : un nom de foyer n'écrit pas dans le HTML d'un autre.
 */
import nodemailer from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type SendMail = (mail: Mail) => Promise<void>;

export class MailConfigError extends Error {}

const exiger = (env: NodeJS.ProcessEnv, name: string, pourquoi: string): string => {
  const value = env[name] ?? '';
  if (value === '') throw new MailConfigError(`${name} manquant : ${pourquoi}.`);
  return value;
};

export function buildMailer(env: NodeJS.ProcessEnv): SendMail | null {
  const transport = env['TABLEE_MAIL'] ?? '';
  if (transport === '') return null;

  const from = exiger(env, 'TABLEE_MAIL_FROM', 'l’expéditeur, par exemple « Tablée <tablee@example.net> »');

  if (transport === 'resend') {
    const key = exiger(env, 'RESEND_API_KEY', 'la clé API Resend, requise avec TABLEE_MAIL=resend');
    return async ({ to, subject, text, html }) => {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to, subject, text, html }),
      });
      // Le corps d'une erreur Resend dit ce qui cloche (domaine non vérifié,
      // clé révoquée) et ne reprend pas le message envoyé.
      if (!response.ok) throw new Error(`Resend a refusé l’envoi (${response.status}) : ${await response.text()}`);
    };
  }

  if (transport === 'smtp') {
    const url = exiger(env, 'SMTP_URL', 'smtps://utilisateur:motdepasse@hôte:465, requis avec TABLEE_MAIL=smtp');
    const transporter = nodemailer.createTransport(url);
    return async (mail) => {
      await transporter.sendMail({ from, ...mail });
    };
  }

  throw new MailConfigError(`TABLEE_MAIL=${transport} inconnu : « resend » ou « smtp », ou rien.`);
}

// ── La mise en page ─────────────────────────────────────────────────────────

/** Ce que dit un mail de Tablée. Le texte et le HTML en sortent tous les deux. */
export interface MailContent {
  to: string;
  subject: string;
  /** Une phrase courte, affichée en serif. */
  title: string;
  paragraphs: string[];
  action: { label: string; url: string };
  /** Ce qui prévient : la durée du lien, « ignorez ce message ». */
  footer: string;
}

// Les valeurs claires de `web/design/tokens.css`, recopiées : un client mail
// ne lit ni variables CSS ni `light-dark()`.
const CORAL = '#D85A30';
const ON_CORAL = '#FAECE7';
const FOND = '#F4F2ED';
const CARTE = '#FFFFFF';
const TEXTE = '#1B1B19';
const SECONDAIRE = '#5F5E5A';
const FILET = '#DEDEDE';
const VOIX = "Georgia, 'Times New Roman', serif";
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * Propriétés séparées plutôt que le raccourci `font:`, qu'Outlook lit mal.
 */
const police = (famille: string, taille: number, hauteur: number, graisse = 400): string =>
  `font-family:${famille};font-size:${taille}px;line-height:${hauteur};font-weight:${graisse};`;

const ENTITÉS: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const échapper = (s: string): string => s.replace(/[&<>"']/g, (c) => ENTITÉS[c] ?? c);

/**
 * Les espaces insécables de la ponctuation française. Sans elles, un titre
 * étroit renvoie le « » » seul à la ligne — vu sur un rendu à 400 px.
 */
const typographier = (s: string): string =>
  s.replace(/« /g, '«\u00A0').replace(/ (»|:)/g, '\u00A0$1');

export function composeMail(content: MailContent): Mail {
  const to = content.to;
  const subject = typographier(content.subject);
  const title = typographier(content.title);
  const paragraphs = content.paragraphs.map(typographier);
  const action = { label: typographier(content.action.label), url: content.action.url };
  const footer = typographier(content.footer);

  const text = [...paragraphs, `${action.label}\u00A0:\n${action.url}`, footer].join('\n\n');

  const lien = échapper(action.url);
  const corps = paragraphs
    .map((p) => `<p style="margin:0 0 14px;${police(SANS, 15, 1.6)}color:${TEXTE};">${échapper(p)}</p>`)
    .join('\n');

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${échapper(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${FOND};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${échapper(paragraphs[0] ?? '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${FOND};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:${CARTE};border-radius:12px;overflow:hidden;">
<tr><td style="background:${CORAL};padding:14px 24px;${police(SANS, 15, 1.2, 600)}color:${ON_CORAL};">Tablée</td></tr>
<tr><td style="padding:28px 24px 4px;">
<h1 style="margin:0 0 16px;${police(VOIX, 28, 1.15)}color:${TEXTE};">${échapper(title)}</h1>
${corps}
</td></tr>
<tr><td style="padding:8px 24px 24px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td bgcolor="${CORAL}" style="border-radius:8px;"><a href="${lien}" style="display:inline-block;padding:13px 22px;${police(SANS, 15, 1, 600)}color:${ON_CORAL};text-decoration:none;border-radius:8px;">${échapper(action.label)}</a></td>
</tr></table>
<p style="margin:18px 0 0;${police(SANS, 12, 1.5)}color:${SECONDAIRE};">Si le bouton ne répond pas, copiez ce lien\u00A0:<br><a href="${lien}" style="color:${SECONDAIRE};word-break:break-all;">${lien}</a></p>
</td></tr>
<tr><td style="padding:16px 24px 22px;border-top:1px solid ${FILET};${police(SANS, 12, 1.5)}color:${SECONDAIRE};">${échapper(footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { to, subject, text, html };
}
