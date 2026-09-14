/**
 * L'envoi de mail, et le choix de qui le porte.
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
 */
import nodemailer from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
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
    return async ({ to, subject, text }) => {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to, subject, text }),
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
