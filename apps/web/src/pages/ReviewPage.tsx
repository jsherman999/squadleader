import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HexKey } from '@squadwar/hex';
import { PHASE_NAMES, type SideId } from '@squadwar/engine';
import type { PointerInfo } from '../board/renderer';
import { drawFocus, drawLastFire, drawObjectives } from '../battle/overlays';
import { downloadSave } from '../game/library';
import { useReview } from '../game/review';
import { ctxFor } from '../game/scenarios';
import { useSession, type Controller } from '../game/session';
import { go } from '../router';
import { ACTION_ICON, actionSummary, actionUnits } from '../tutor/actions';
import { WhyCard } from '../tutor/WhyCard';
import { describeHex } from '../ui/describe';
import { HexCard } from '../ui/HexCard';
import { TopBar } from '../ui/TopBar';
import { loadViewMode, MapViews, nextViewMode, setViewMode, type OverlayLayers, type ViewMode } from '../views/MapViews';
import { ViewToggle } from '../views/ViewToggle';

type Speed = 'slow' | 'normal' | 'fast';
const STEP_MS: Record<Speed, number> = { slow: 2600, normal: 1200, fast: 350 };

export function ReviewPage() {
  const save = useReview((r) => r.save);
  useEffect(() => {
    if (!save) go('play');
  }, [save]);
  if (!save) return null;
  return <Review key={`${save.id ?? ''}${save.seed}${save.actions.length}`} />;
}

function Review() {
  const { save, states, events, index, seek } = useReview();
  const sv = save!;
  const ctx = ctxFor(sv.scenario);
  const map = ctx.map;
  const n = sv.actions.length;
  const s = states[index]!;
  const action = index < n ? sv.actions[index] : undefined;
  const note = index < n ? (sv.notes?.[index] ?? undefined) : undefined;
  const actor: 'bot' | 'human' = sv.controllers[s.awaiting] === 'bot' ? 'bot' : 'human';
  const [keyOnly, setKeyOnly] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>('normal');
  const [view, setView] = useState<ViewMode>(loadViewMode);
  const [hover, setHover] = useState<HexKey>();
  const sideName = (id: SideId) => s.sides.find((x) => x.id === id)?.name ?? id;

  /** Decisions shown in the list and visited by stepping. */
  const isKey = useCallback(
    (i: number) => {
      const st = states[i]!;
      if (sv.controllers[st.awaiting] !== 'bot') return sv.actions[i]!.type !== 'endPhase';
      return sv.notes?.[i]?.weight === 'key';
    },
    [states, sv],
  );
  const visible = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) if (!keyOnly || isKey(i)) out.push(i);
    out.push(n);
    return out;
  }, [n, keyOnly, isKey]);

  const step = useCallback(
    (dir: 1 | -1) => {
      if (dir > 0) seek(visible.find((i) => i > index) ?? n);
      else seek([...visible].reverse().find((i) => i < index) ?? 0);
    },
    [visible, index, n, seek],
  );
  const jumpTurn = useCallback(
    (dir: 1 | -1) => {
      const t = s.turn;
      if (dir > 0) {
        const i = states.findIndex((x, k) => k > index && (x.turn > t || x.phase === 'gameOver'));
        seek(i < 0 ? n : i);
      } else {
        // Start of this turn, or of the previous one if already there.
        const startOf = (turn: number) => states.findIndex((x) => x.turn === turn && x.phase !== 'setup');
        const here = startOf(t);
        seek(here >= 0 && here < index ? here : Math.max(0, startOf(t - 1)));
      }
    },
    [s.turn, states, index, n, seek],
  );

  // Playback.
  useEffect(() => {
    if (!playing) return;
    if (index >= n) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => step(1), STEP_MS[speed]);
    return () => clearTimeout(t);
  }, [playing, index, n, speed, step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest('select, textarea') || (el?.closest('input') && (el as HTMLInputElement).type !== 'range' && (el as HTMLInputElement).type !== 'checkbox')) return;
      const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (dir) {
        if (e.shiftKey) jumpTurn(dir);
        else step(dir);
      } else if (e.key === ' ') setPlaying((p) => !p);
      else if (e.key === 'Home') seek(0);
      else if (e.key === 'End') seek(n);
      else if (e.key === 'k' || e.key === 'K') setKeyOnly((k) => !k);
      else if (e.key === '3') setView(nextViewMode);
      else return;
      // Arrows step through the game here instead of panning the board.
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [step, jumpTurn, seek, n]);

  const selected = useMemo(() => new Set(actionUnits(action)), [action]);
  const units = useMemo(() => ({ ctx, s, selected }), [ctx, s, selected]);
  const prevFire = useMemo(() => [...events].reverse().find((e) => e.kind === 'fire' && e.action === index - 1), [events, index]);
  const layers: OverlayLayers = useMemo(
    () => ({
      under: (pen) => drawObjectives(pen, ctx),
      over: (pen) => drawLastFire(pen, prevFire),
      top: (pen) => drawFocus(pen, note, action),
    }),
    [ctx, prevFire, note, action],
  );
  const result = useMemo(() => events.filter((e) => e.action === index), [events, index]);

  // Keep the active decision in view in the list.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('.dl-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [index, keyOnly]);

  const takeOver = (side: SideId) => {
    const controllers: Record<SideId, Controller> = Object.fromEntries(Object.keys(sv.controllers).map((k) => [k, k === side ? 'human' : 'bot']));
    const { id: _id, result: _r, winner: _w, ...rest } = sv;
    useSession.getState().load({ ...rest, controllers, actions: sv.actions.slice(0, index), ...(sv.notes ? { notes: sv.notes.slice(0, index) } : {}) });
    go('battle');
  };

  const final = states[n]!;
  const onHover = useCallback((p: PointerInfo) => setHover(p.hex), []);

  return (
    <div className="page">
      <TopBar title={`Review · ${ctx.scenario.title}`}>
        <span className="segmented" role="group" aria-label="Playback">
          <button className="btn" onClick={() => jumpTurn(-1)} title="Previous turn (Shift+←)">
            ⏮
          </button>
          <button className="btn" onClick={() => step(-1)} disabled={index === 0} title="Previous decision (←)">
            ◀
          </button>
          <button className={`btn ${playing ? 'active' : ''}`} onClick={() => setPlaying(!playing)} title="Play or pause (Space)">
            {playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          <button className="btn" onClick={() => step(1)} disabled={index >= n} title="Next decision (→)">
            ▶
          </button>
          <button className="btn" onClick={() => jumpTurn(1)} title="Next turn (Shift+→)">
            ⏭
          </button>
        </span>
        <select className="auto-select" value={speed} onChange={(e) => setSpeed(e.target.value as Speed)} aria-label="Playback speed" title="Playback speed">
          <option value="slow">Slow</option>
          <option value="normal">Normal</option>
          <option value="fast">Fast</option>
        </select>
        <label className="check" title="Show only decisions that shape the game (K)">
          <input type="checkbox" checked={keyOnly} onChange={(e) => setKeyOnly(e.target.checked)} /> Key decisions
        </label>
        <ViewToggle mode={view} onChange={(m) => setView(setViewMode(m))} />
        <button className="btn" onClick={() => downloadSave(sv, `squadwar-${sv.scenario}-review.json`)} title="Download this game as a save file">
          Download
        </button>
      </TopBar>
      <div className="review">
        <aside className="dl" ref={listRef} aria-label="Decisions">
          {visible.map((i, k) => {
            const st = states[i]!;
            const prev = k > 0 ? states[visible[k - 1]!]! : undefined;
            const header = !prev || prev.turn !== st.turn || prev.phase !== st.phase || prev.awaiting !== st.awaiting;
            const a = i < n ? sv.actions[i]! : undefined;
            const nt = i < n ? sv.notes?.[i] : undefined;
            return (
              <div key={i}>
                {header && i < n && (
                  <div className="dl-head">
                    Turn {st.turn} · {sideName(st.awaiting)} {PHASE_NAMES[st.phase]}
                  </div>
                )}
                <button className={`dl-item ${i === index ? 'active' : ''} ${nt?.weight === 'key' ? 'key' : ''}`} onClick={() => seek(i)}>
                  <span className="dl-icon">{a ? (ACTION_ICON[a.type] ?? '·') : '★'}</span>
                  <span className="dl-text">{a ? (nt?.goal ?? actionSummary(ctx, st, a)) : 'End of game'}</span>
                </button>
              </div>
            );
          })}
        </aside>
        <div className="board-wrap">
          <MapViews map={map} mode={view} layers={layers} units={units} hover={hover} onHover={onHover} />
          <div className="timeline">
            <input
              type="range"
              min={0}
              max={n}
              value={index}
              onChange={(e) => seek(Number(e.target.value))}
              aria-label="Position in the game"
            />
            <span className="small mono" title="Decision number">
              {index < n ? `${index + 1}/${n}` : 'end'}
            </span>
          </div>
          <div className="hud-bottom-left review-hex">
            <HexCard d={hover ? describeHex(map, hover) : undefined} />
          </div>
        </div>
        <aside className="side-right review-side">
          {action ? (
            <WhyCard ctx={ctx} s={s} note={note} actor={actor} position={{ index, total: n }} events={result} />
          ) : (
            <div className="why-card">
              <h4 className="why-goal">{final.winner && final.winner !== 'draw' ? `${sideName(final.winner)} victory` : 'End of the record'}</h4>
              <p className="small">{final.result ?? 'The save ends here; the game was not finished.'}</p>
            </div>
          )}
          <div className="panel-card small">
            <strong>Play from here</strong>
            <p className="small dim">Take over one side at this point; the computer plays the other.</p>
            <div className="toolbar">
              {s.phase !== 'gameOver' &&
                s.sides.map((side) => (
                  <button key={side.id} className="btn tiny" onClick={() => takeOver(side.id)}>
                    Play {side.name}
                  </button>
                ))}
            </div>
          </div>
          <p className="small faint">← → step · Shift+← → turn · Space play · K key decisions · 3 view</p>
        </aside>
      </div>
    </div>
  );
}
