import { useCallback, useEffect, useMemo, useState } from 'react';
import { hexToPixel, type HexKey } from '@squadwar/hex';
import { bestLos, canBeUpper, checkLos, viewshed, type LosResult } from '@squadwar/los';
import type { PointerInfo } from '../board/renderer';
import { drawLos, drawLosMarks, drawViewshed } from '../board/losOverlay';
import { mapFor } from '../content';
import { hexOutline } from '../draw/pen';
import { loadViewMode, MapViews, nextViewMode, setViewMode, type OverlayLayers, type ViewMode } from '../views/MapViews';
import { ViewToggle } from '../views/ViewToggle';
import { describeHex } from '../ui/describe';
import { HexCard } from '../ui/HexCard';
import { LosPanel } from '../ui/LosPanel';
import { TopBar } from '../ui/TopBar';

type Mode = 'inspect' | 'los' | 'viewshed';
type Level = 'auto' | 'lower' | 'upper';

export function MapLabPage() {
  const map = useMemo(() => mapFor([{ board: 'A', x: 0, y: 0 }]), []);
  const [view, setView] = useState<ViewMode>(loadViewMode);
  const [povOn, setPovOn] = useState(false);
  const [hover, setHover] = useState<HexKey>();
  const [mode, setMode] = useState<Mode>('los');
  const [losA, setLosA] = useState<HexKey>();
  const [losB, setLosB] = useState<HexKey>();
  const [pinned, setPinned] = useState(false);
  const [fromLevel, setFromLevel] = useState<Level>('auto');
  const [toLevel, setToLevel] = useState<Level>('auto');
  const [vsOrigin, setVsOrigin] = useState<HexKey>();

  const target = pinned ? losB : (hover ?? losB);
  const los: LosResult | undefined = useMemo(() => {
    if (mode !== 'los' || !losA || !target || losA === target) return undefined;
    if (fromLevel === 'auto' && toLevel === 'auto') return bestLos(map, losA, target);
    const pick = (lv: Level, hex: HexKey) => (lv === 'upper' ? canBeUpper(map, hex) : false);
    return checkLos(map, { hex: losA, upper: pick(fromLevel, losA) }, { hex: target, upper: pick(toLevel, target) });
  }, [map, mode, losA, target, fromLevel, toLevel]);

  const visible = useMemo(() => (mode === 'viewshed' && vsOrigin ? viewshed(map, vsOrigin) : undefined), [map, mode, vsOrigin]);

  const layers: OverlayLayers = useMemo(
    () => ({
      over: (pen) => {
        if (visible && vsOrigin) drawViewshed(pen, map, vsOrigin, visible);
      },
      top: (pen, v) => {
        if (los) (v === '3d' ? drawLosMarks : drawLos)(pen, map, los);
        else if (mode === 'los' && losA) hexOutline(pen, map.hexes[losA]!.hex, 0xf0c66b, 1, 4);
      },
    }),
    [map, los, losA, mode, visible, vsOrigin],
  );

  /** Eyes: look from the LOS firer (or viewshed origin) toward the target. */
  const eyeHex = mode === 'viewshed' ? vsOrigin : losA;
  const pov = useMemo(() => {
    if (!povOn || !eyeHex) return undefined;
    // Match the floor the LOS check used, so the view agrees with the verdict.
    const upper = mode === 'los' && los ? (los.from.upper ?? false) : canBeUpper(map, eyeHex) && (mode === 'viewshed' || fromLevel !== 'lower');
    const look = mode === 'los' && losB ? hexToPixel(map.hexes[losB]!.hex) : undefined;
    return {
      hex: eyeHex,
      upper,
      ...(look ? { lookAt: look } : {}),
      title: `Eyes at ${map.hexes[eyeHex]!.id}`,
      detail: upper ? 'Upper level' : 'Ground level',
    };
  }, [povOn, eyeHex, map, mode, fromLevel, losB, los]);

  const onHover = useCallback((p: PointerInfo) => setHover(p.hex), []);

  const onClick = useCallback(
    (p: PointerInfo) => {
      if (!p.hex) return;
      if (mode === 'viewshed') {
        setVsOrigin(p.hex);
      } else if (mode === 'los') {
        if (!losA || pinned) {
          setLosA(p.hex);
          setLosB(undefined);
          setPinned(false);
        } else {
          setLosB(p.hex);
          setPinned(true);
        }
      }
    },
    [mode, losA, pinned],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest('input, select, textarea')) return;
      if (e.key === '3') setView(nextViewMode);
      else if (e.key === 'e' || e.key === 'E') setPovOn((x) => !x);
      else if (e.key === 'l' || e.key === 'L') setMode('los');
      else if (e.key === 'v' || e.key === 'V') setMode('viewshed');
      else if (e.key === 'i' || e.key === 'I') setMode('inspect');
      else if (e.key === 'Escape') {
        if (povOn) {
          setPovOn(false);
          return;
        }
        setLosA(undefined);
        setLosB(undefined);
        setPinned(false);
        setVsOrigin(undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [povOn]);

  const levelSelect = (value: Level, set: (l: Level) => void, label: string) => (
    <label className="field compact">
      {label}
      <select value={value} onChange={(e) => set(e.target.value as Level)}>
        <option value="auto">Best (§7.9)</option>
        <option value="lower">Ground floor</option>
        <option value="upper">Upper level</option>
      </select>
    </label>
  );

  return (
    <div className="page">
      <TopBar title="Map & line-of-sight lab">
        <div className="toolbar">
          <button className={`btn ${mode === 'los' ? 'active' : ''}`} onClick={() => setMode('los')}>
            LOS <kbd>L</kbd>
          </button>
          <button className={`btn ${mode === 'viewshed' ? 'active' : ''}`} onClick={() => setMode('viewshed')}>
            Viewshed <kbd>V</kbd>
          </button>
          <button className={`btn ${mode === 'inspect' ? 'active' : ''}`} onClick={() => setMode('inspect')}>
            Inspect <kbd>I</kbd>
          </button>
          <button
            className={`btn ${povOn ? 'active' : ''}`}
            disabled={!eyeHex}
            onClick={() => setPovOn(!povOn)}
            title={eyeHex ? 'Look from the firer hex at eye height (E)' : 'Pick a firer or viewshed hex first'}
          >
            Eyes <kbd>E</kbd>
          </button>
          <ViewToggle mode={view} onChange={(m) => setView(setViewMode(m))} />
        </div>
      </TopBar>
      <div className="board-wrap">
        <MapViews map={map} mode={view} layers={layers} los={los} hover={hover} pov={pov} onPovExit={() => setPovOn(false)} onHover={onHover} onClick={onClick} />
        <div className="hud-right">
          {mode === 'los' && (
            <div className="panel-card">
              <div className="dim small" style={{ marginTop: 0 }}>
                {!losA
                  ? 'Click a hex to set the firer.'
                  : pinned
                    ? 'Click another hex to start a new line. Esc clears.'
                    : 'Move over a target hex, click to pin it.'}
              </div>
              <div className="level-row">
                {levelSelect(fromLevel, setFromLevel, 'Firer')}
                {levelSelect(toLevel, setToLevel, 'Target')}
              </div>
            </div>
          )}
          {mode === 'viewshed' && (
            <div className="panel-card dim small">
              {vsOrigin ? `Showing every hex visible from ${map.hexes[vsOrigin]!.id}. Dark hexes are hidden.` : 'Click a hex to see everything visible from it.'}
            </div>
          )}
          {los && <LosPanel map={map} r={los} />}
        </div>
        <div className="hud-bottom-left">
          <HexCard d={hover ? describeHex(map, hover) : undefined} />
        </div>
      </div>
    </div>
  );
}
