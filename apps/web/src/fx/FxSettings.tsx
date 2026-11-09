import { useEffect, useRef, useState } from 'react';
import { useFxSettings, type BattleSpeed } from './settings';

/** Top-bar button with the Fire Director settings: battle speed, sound, dice tray, reduced motion. */
export function FxSettingsButton() {
  const fx = useFxSettings();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="fx-settings" ref={ref}>
      <button className={`btn ${open ? 'active' : ''}`} onClick={() => setOpen(!open)} title="Battle effects: speed, sound, dice" aria-expanded={open}>
        {fx.sound ? '🔊' : '🔈'} Effects
      </button>
      {open && (
        <div className="fx-pop panel-card" role="dialog" aria-label="Battle effects">
          <label className="field">
            Speed
            <select value={fx.speed} onChange={(e) => fx.set({ speed: e.target.value as BattleSpeed })}>
              <option value="cinematic">Cinematic</option>
              <option value="normal">Normal</option>
              <option value="fast">Fast</option>
              <option value="instant">Instant (no animation)</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={fx.sound} onChange={(e) => fx.set({ sound: e.target.checked })} /> Sound
          </label>
          <label className="field">
            Volume
            <input type="range" min={0} max={1} step={0.05} value={fx.volume} disabled={!fx.sound} onChange={(e) => fx.set({ volume: Number(e.target.value) })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={fx.dice} onChange={(e) => fx.set({ dice: e.target.checked })} /> Dice tray
          </label>
          <label className="check">
            <input type="checkbox" checked={fx.reducedMotion} onChange={(e) => fx.set({ reducedMotion: e.target.checked })} /> Reduced motion
          </label>
          <p className="small faint">Reduced motion shows fire as simple lines and labels, with no tumbling dice or camera shake.</p>
        </div>
      )}
    </div>
  );
}
