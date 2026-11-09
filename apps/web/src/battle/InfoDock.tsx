import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { LoggedEvent } from '../game/session';
import { LogPanel } from './LogPanel';

const KEY_H = 'squadwar:dockHeight';
const KEY_OPEN = 'squadwar:dockOpen';
const MIN_H = 150;

function load(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The information dock under the map on wide screens: the latest decision
 * explained in two boxes and the combat log beside them, all at a glance.
 * Drag the top edge to resize; collapse it to a one-line ticker.
 */
export function InfoDock({ why, ticker, events, onSidebar }: { why: ReactNode; ticker?: string | undefined; events: readonly LoggedEvent[]; onSidebar: () => void }) {
  const [height, setHeight] = useState(() => load(KEY_H, 260));
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(KEY_OPEN) !== '0';
    } catch {
      return true;
    }
  });
  const drag = useRef<{ y: number; h: number } | undefined>(undefined);
  const save = useCallback((k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // ignore
    }
  }, []);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!drag.current) return;
      const max = Math.round(window.innerHeight * 0.6);
      setHeight(Math.max(MIN_H, Math.min(max, drag.current.h + drag.current.y - e.clientY)));
    };
    const up = () => {
      if (!drag.current) return;
      drag.current = undefined;
      document.body.classList.remove('resizing');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);
  useEffect(() => save(KEY_H, String(height)), [height, save]);
  const last = events[events.length - 1];
  return (
    <section className={`info-dock ${open ? '' : 'collapsed'}`} style={open ? { height } : undefined} aria-label="Decisions and combat log">
      {open && (
        <div
          className="dock-grip"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the panel"
          onPointerDown={(e) => {
            drag.current = { y: e.clientY, h: height };
            document.body.classList.add('resizing');
          }}
        />
      )}
      <div className="dock-bar">
        <button
          className="btn tiny ghost"
          onClick={() => {
            setOpen(!open);
            save(KEY_OPEN, open ? '0' : '1');
          }}
          aria-expanded={open}
          title={open ? 'Collapse to one line' : 'Show the decision and the combat log'}
        >
          {open ? '▾' : '▸'}
        </button>
        {open ? (
          <span className="dock-bar-title">Decisions and combat log</span>
        ) : (
          <span className="dock-ticker">
            {ticker && <strong>{ticker}</strong>}
            {last && <span className="dim"> · {last.text}</span>}
          </span>
        )}
        <button className="btn tiny ghost dock-side" onClick={onSidebar} title="Show this in the right-hand panel instead">
          Move to sidebar
        </button>
      </div>
      {open && (
        <div className="dock-grid">
          {why}
          <div className="dock-box dock-log">
            <div className="dock-h">Combat log</div>
            <LogPanel events={events} />
          </div>
        </div>
      )}
    </section>
  );
}
