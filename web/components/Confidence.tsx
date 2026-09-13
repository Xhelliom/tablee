/**
 * R6 — « Toute estimation porte un `confidence` affiché dans l'UI. »
 *
 * Le badge n'est pas décoratif : il dit d'où vient le chiffre à côté. Une
 * valeur `basse` signale qu'il faut la reprendre ; une valeur absente est dite
 * en toutes lettres, pas laissée à l'imagination.
 *
 * Les couleurs employées sont celles des états (ambre, bleu), jamais celles
 * des nutriments — qui ne codent pas un jugement de qualité (§8ter).
 */
import type { Confidence } from '../api.ts';
import { IconAlert, IconCheck } from '../icons.tsx';

const STYLES: Record<Confidence, { className: string; label: string; icon: boolean }> = {
  haute: { className: 'chip chip--success', label: 'Valeurs sourcées', icon: true },
  moyenne: { className: 'chip chip--accent', label: 'Estimation', icon: false },
  basse: { className: 'chip chip--warning', label: 'À vérifier', icon: false },
};

export function ConfidenceBadge({
  confidence,
  label,
}: {
  confidence: Confidence;
  label?: string | undefined;
}): React.ReactElement {
  const style = STYLES[confidence];
  return (
    <span className={style.className}>
      {style.icon ? <IconCheck size={13} /> : <IconAlert size={13} />}
      {label ?? style.label}
    </span>
  );
}

/**
 * Les avertissements du parseur et du calcul, **affichés** et pas seulement
 * loggués : « une donnée manquante doit se voir » (§6 du contrat Jow).
 */
export function Warnings({ warnings }: { warnings: string[] }): React.ReactElement | null {
  if (warnings.length === 0) return null;
  return (
    <ul
      style={{
        margin: '10px 0 0', padding: '10px 12px', listStyle: 'none',
        background: 'var(--bg-warning)', color: 'var(--text-warning)',
        borderRadius: 'var(--radius)', fontSize: 12, lineHeight: 1.5,
        display: 'flex', flexDirection: 'column', gap: 4,
      }}
    >
      {warnings.map((warning) => (
        <li key={warning} style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
          <IconAlert size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{warning}</span>
        </li>
      ))}
    </ul>
  );
}
