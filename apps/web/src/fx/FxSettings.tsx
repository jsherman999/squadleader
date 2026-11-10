import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { testSound } from './audio';
import { useFxSettings, type BattleSpeed } from './settings';

/**
 * Top-bar button with the Fire Director settings: battle speed, sound, dice tray, reduced motion.
 * The panel is drawn on the page body, not inside the top bar: on phones the bar's button row
 * scrolls sideways, and a panel inside a scrolling row is cut off by it.
 */
export function FxSettingsButton() {
  const fx = useFxSettings();
  const [open, setOpen] = useState(false);
  const [top, setTop] = useState(50);
  /** Result of the last sound test: undefined before one is run. */
  const [heard, setHeard] = useState<boolean>();
  const touch = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
  const ref = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  /** Just under the top bar, however many rows it has wrapped to. */
  const place = () => {
    const bar = ref.current?.closest('.topbar') ?? ref.current;
    if (bar) setTop(Math.round(bar.getBoundingClientRect().bottom + 6));
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !pop.current?.contains(t)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', key);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', key);
      window.removeEventListener('resize', place);
    };
  }, [open]);
  return (
    <div className="fx-settings" ref={ref}>
      <button
        className={`btn ${open ? 'active' : ''}`}
        onClick={() => {
          if (!open) place();
          setOpen(!open);
        }}
        title="Battle effects: speed, sound, dice"
        aria-expanded={open}
      >
        {fx.sound ? '🔊' : '🔈'} Effects
      </button>
      {open &&
        createPortal(
          <div
            className="fx-pop panel-card"
            role="dialog"
            aria-label="Battle effects"
            ref={pop}
            style={{ top, maxHeight: `calc(100dvh - ${top + 10}px)` }}
          >
            <label className="field">
              Speed
              <select
                value={fx.speed}
                onChange={(e) => fx.set({ speed: e.target.value as BattleSpeed })}
              >
                <option value="cinematic">Cinematic</option>
                <option value="normal">Normal</option>
                <option value="fast">Fast</option>
                <option value="instant">Instant (no animation)</option>
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={fx.sound}
                onChange={(e) => fx.set({ sound: e.target.checked })}
              />{' '}
              Sound
            </label>
            <label className="field">
              Volume
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={fx.volume}
                disabled={!fx.sound}
                onChange={(e) => fx.set({ volume: Number(e.target.value) })}
              />
            </label>
            <button className="btn tiny" disabled={!fx.sound} onClick={() => void testSound().then(setHeard)}>
              Test sound
            </button>
            {heard === false && <p className="small warn">This browser would not start the sound.</p>}
            {fx.sound && (touch || heard) && (
              <p className="small faint">
                {heard ? 'A machine-gun burst should have played. ' : ''}
                Nothing to hear? Turn the device volume up. An iPhone or iPad also keeps games silent while silent mode is on (the switch or Action button on its side).
              </p>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={fx.dice}
                onChange={(e) => fx.set({ dice: e.target.checked })}
              />{' '}
              Dice tray
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={fx.reducedMotion}
                onChange={(e) => fx.set({ reducedMotion: e.target.checked })}
              />{' '}
              Reduced motion
            </label>
            <p className="small faint">
              Reduced motion shows fire as simple lines and labels, with no tumbling dice or camera
              shake.
            </p>
          </div>,
          document.body,
        )}
    </div>
  );
}
