import type { ViewMode } from './MapViews';

const MODES: readonly [ViewMode, string, string][] = [
  ['2d', '2D', 'Top-down map'],
  ['3d', '3D', 'Rotatable 3D landscape'],
  ['split', 'Split', '2D and 3D side by side'],
];

/** Segmented 2D / 3D / Split switch (key 3 cycles). */
export function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <span className="segmented" role="group" aria-label="View">
      {MODES.map(([m, label, title]) => (
        <button key={m} className={`btn ${mode === m ? 'active' : ''}`} aria-pressed={mode === m} onClick={() => onChange(m)} title={`${title} (3 cycles)`}>
          {label}
        </button>
      ))}
    </span>
  );
}
