import { useEffect, useRef, useState } from 'react';
import type { LoggedEvent } from '../game/session';

const ICON: Record<string, string> = {
  phase: '▸',
  fire: '✸',
  morale: '◆',
  move: '→',
  rally: '↺',
  repair: '⚙',
  breakdown: '✕',
  rout: '↯',
  advance: '⇢',
  closeCombat: '⚔',
  eliminated: '☠',
  berserk: '!',
  gameOver: '★',
  info: '·',
  dice: '⚄',
  result: '◆',
};

export function LogPanel({ events }: { events: readonly LoggedEvent[] }) {
  const end = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<number | undefined>();
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [events.length]);
  const shown = events.slice(-160);
  return (
    <div className="log" role="log" aria-live="polite">
      {shown.map((e) => (
        <div key={e.n} className={`log-row kind-${e.kind}`}>
          <button className="log-line" onClick={() => setOpen(open === e.n ? undefined : e.n)} aria-expanded={open === e.n}>
            <span className="log-icon">{ICON[e.kind] ?? '·'}</span>
            <span className="log-text">{e.text}</span>
            {e.dice && <span className="log-dice mono">{e.dice.join('+')}</span>}
            {e.trace && <span className="log-more">{open === e.n ? '▾' : '▸'}</span>}
          </button>
          {open === e.n && e.trace && (
            <ul className="log-trace">
              {e.trace.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <div ref={end} />
    </div>
  );
}
