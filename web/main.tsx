import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { RouterProvider } from './router.tsx';
import './design/tokens.css';

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
