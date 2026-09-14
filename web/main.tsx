import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { RouterProvider } from './router.tsx';
import { applyTheme, readTheme } from './design/theme.ts';
import './design/tokens.css';

// Avant le rendu, et avant tout ce qui pourrait échouer : quelqu'un qui a forcé
// un mode ne doit pas voir l'autre clignoter. Suivre le système, lui, ne passe
// pas par ici du tout — c'est la feuille de style qui s'en charge.
applyTheme(readTheme());

const container = document.getElementById('app');
if (container === null) throw new Error('#app introuvable');

createRoot(container).render(
  <StrictMode>
    <RouterProvider>
      <App />
    </RouterProvider>
  </StrictMode>,
);

/**
 * Le service worker n'est enregistré qu'en production : sans lui, pas
 * d'installation, et sans installation pas de share target Android (§4). En
 * développement il ne ferait que servir des fichiers périmés.
 */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}
