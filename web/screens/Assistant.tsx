/**
 * V3 — l'assistant : une question sur les repas, une réponse.
 *
 * Hors de la roadmap d'origine (14/09/2026). Ce que le serveur lui transmet,
 * et surtout ce qu'il ne lui transmet pas, est dans `server/llm/conseil.ts`.
 * L'écran en dit l'essentiel avant la première question : l'assistant ne
 * connaît ni les prénoms ni les allergies, et ce n'est pas un avis médical.
 *
 * La conversation vit dans cet écran et nulle part ailleurs : changer d'onglet
 * l'efface. Aucune réponse n'est gardée — une réponse relue une semaine plus
 * tard se lirait comme un fait sur la famille (I2).
 */
import { useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { api, ApiError } from '../api.ts';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

const EXEMPLES = [
  'Une idée de dîner pour ce soir ?',
  'Comment varier les légumes cette semaine ?',
  'Des idées de goûter pour les enfants ?',
];

/**
 * Le serveur refuse au-delà de douze messages. On envoie les onze derniers :
 * un nombre impair, qui commence donc par une question comme il finit par une.
 */
const ENVOYÉS = 11;

export function AssistantScreen(): ReactElement {
  const [conversation, setConversation] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const demander = async (texte: string): Promise<void> => {
    const contenu = texte.trim();
    if (contenu === '' || busy) return;
    const suite: Turn[] = [...conversation, { role: 'user', content: contenu }];
    setConversation(suite);
    setQuestion('');
    setBusy(true);
    setError(null);
    try {
      const { reply } = await api.post<{ reply: string }>('/api/assistant', { messages: suite.slice(-ENVOYÉS) });
      setConversation([...suite, { role: 'assistant', content: reply }]);
    } catch (cause) {
      // La question sans réponse est retirée et rendue au champ : deux
      // questions d'affilée casseraient l'alternance que le serveur exige.
      setConversation(conversation);
      setQuestion(contenu);
      setError(cause instanceof ApiError ? cause.message : 'l’assistant n’a pas répondu');
    }
    setBusy(false);
  };

  return (
    <>
      <div className="sec" style={{ paddingTop: 20 }}>
        <p className="eyebrow">Conseils</p>
        <p className="display" style={{ marginTop: 6 }}>Une question<br />sur les repas ?</p>
        <p className="meta" style={{ marginTop: 10, lineHeight: 1.6 }}>
          L’assistant voit un résumé de la semaine : les plats, et les moyennes
          du foyer. Il ne connaît ni les prénoms, ni les allergies — vérifiez ce
          qu’il propose. Ce n’est pas un avis médical, et rien n’est gardé.
        </p>
      </div>

      <div className="sec stack" style={{ paddingTop: 18 }}>
        {conversation.length === 0 ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {EXEMPLES.map((exemple) => (
              <button key={exemple} type="button" className="chip" style={{ cursor: 'pointer' }}
                      disabled={busy} onClick={() => { void demander(exemple); }}>
                {exemple}
              </button>
            ))}
          </div>
        ) : null}

        {conversation.map((turn, index) => (
          turn.role === 'assistant'
            ? <p key={index} className="card" style={bulleRéponse}>{turn.content}</p>
            : <p key={index} style={bulleQuestion}>{turn.content}</p>
        ))}

        {busy ? <p className="meta">L’assistant réfléchit…</p> : null}
        {error !== null ? <p style={{ fontSize: 13, color: 'var(--text-warning)' }}>{error}</p> : null}

        <form className="stack" onSubmit={(e) => { e.preventDefault(); void demander(question); }}>
          <textarea
            className="field" rows={3} maxLength={1000} value={question}
            placeholder="Votre question — sans prénom, c’est mieux"
            aria-label="Votre question"
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button type="submit" className="btn" disabled={busy || question.trim() === ''}>
            {busy ? 'Un instant…' : 'Demander'}
          </button>
        </form>
      </div>
      <div className="fab-space" />
    </>
  );
}

const bulle: CSSProperties = { fontSize: 15, lineHeight: 1.55, whiteSpace: 'pre-wrap' };

const bulleRéponse: CSSProperties = { ...bulle, padding: '12px 14px' };

const bulleQuestion: CSSProperties = {
  ...bulle, alignSelf: 'flex-end', maxWidth: '85%', padding: '10px 13px',
  borderRadius: 'var(--radius)', background: 'var(--coral-50)', color: 'var(--coral-600)',
};
