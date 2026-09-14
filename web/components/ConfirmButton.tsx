/**
 * Un geste qu'on regrette : deux taps, le second sur un bouton passé au rouge.
 *
 * Plutôt que `window.confirm`, qui sort de l'app — une boîte grise du
 * navigateur au milieu d'une PWA installée — et qui se valide par réflexe. Un
 * bouton qui change sous le doigt se lit, lui.
 *
 * Il se désarme seul au bout de quelques secondes : une confirmation armée puis
 * oubliée ne doit pas attendre le tap suivant, qui visait peut-être autre chose.
 */
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';

export function ConfirmButton({
  label, onConfirm, disabled, style,
}: {
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
  style?: CSSProperties;
}): ReactElement {
  const [armé, setArmé] = useState(false);

  useEffect(() => {
    if (!armé) return;
    const délai = window.setTimeout(() => setArmé(false), 4000);
    return () => window.clearTimeout(délai);
  }, [armé]);

  return (
    <button
      type="button" className={armé ? 'btn btn--danger' : 'btn btn--quiet'}
      style={style} disabled={disabled}
      onClick={() => {
        setArmé(!armé);
        if (armé) onConfirm();
      }}
    >
      {armé ? 'Êtes-vous sûr ?' : label}
    </button>
  );
}
