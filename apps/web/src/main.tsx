import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/app.css';
import '@fontsource/courier-prime/latin-400.css';
import '@fontsource/courier-prime/latin-700.css';
import './styles/teletype.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-800-italic.css';
import '@fontsource/vt323/latin-400.css';
import './styles/hardware.css';
import { useSession } from './game/session';
import { ctxFor } from './game/scenarios';
import { fxPlayer } from './fx/player';

// Development hook for end-to-end checks; not present in production builds.
if (import.meta.env.DEV) Object.assign(window, { __sw: { useSession, ctxFor, fxPlayer } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
