import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/app.css';
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
