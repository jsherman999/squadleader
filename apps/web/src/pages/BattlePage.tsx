import { useCallback, useEffect, useMemo, useState } from 'react';
import { DIRECTIONS, hexKey, hexToPixel, neighbor, parseHexKey, type HexKey } from '@squadwar/hex';
import { Text, TextStyle } from 'pixi.js';
import { HEX_PX } from '../board/palette';
import {
  PHASE_NAMES,
  exposureAt,
  exposureMap,
  enemiesIn,
  hexTem,
  inMelee,
  moveCost,
  phaseBlockers,
  sideUnitsIn,
  type GameState,
} from '@squadwar/engine';
import { bestLos, type LosResult } from '@squadwar/los';
import { BoardView } from '../board/BoardView';
import type { BoardRenderer, PointerInfo } from '../board/renderer';
import { drawUnits } from '../board/counters';
import { drawHexOutline, fillHex } from '../board/overlays';
import { drawLos } from '../board/losOverlay';
import { ActionPanel } from '../battle/ActionPanel';
import { autoSkipReason } from '../battle/automation';
import { defaultFirers, defaultLeader } from '../battle/firers';
import { LogPanel } from '../battle/LogPanel';
import { drawFireLines, drawLastFire, drawObjectives, drawPath, drawSelection, drawSetupZone, drawTracks } from '../battle/overlays';
import { groupPath } from '../battle/pathing';
import { PhaseRibbon } from '../battle/PhaseRibbon';
import { StackPanel } from '../battle/StackPanel';
import { ctxFor } from '../game/scenarios';
import { useSession } from '../game/session';
import { go } from '../router';
import { describeHex } from '../ui/describe';
import { HexCard } from '../ui/HexCard';
import { LosPanel } from '../ui/LosPanel';
import { TopBar } from '../ui/TopBar';

const FIRE = new Set(['prepFire', 'defensiveFire', 'advancingFire']);

export function BattlePage() {
  const session = useSession();
  const { scenarioId } = session;
  useEffect(() => {
    if (!scenarioId) go('play');
  }, [scenarioId]);
  if (!scenarioId) return null;
  return <Battle key={scenarioId + session.seed} />;
}

function selectable(s: GameState, ids: string[]): string[] {
  return ids.filter((id) => {
    const u = s.units[id]!;
    if (u.side !== s.awaiting) return false;
    switch (s.phase) {
      case 'movement':
        return !u.broken && !u.berserk && !u.moveDone && u.firedPhase !== 'prepFire';
      case 'prepFire':
      case 'defensiveFire':
      case 'advancingFire':
        return !u.broken && (!u.firedPhase || u.firedPhase === s.phase);
      case 'advance':
        return !u.broken && !u.advanced;
      default:
        return true;
    }
  });
}

function Battle() {
  const session = useSession();
  const ctx = ctxFor(session.scenarioId!);
  const real = session.states[session.states.length - 1]!;
  const plan = session.plan;
  /** What the board shows: the plan's state while planning. */
  const s = plan ? plan.states[plan.states.length - 1]! : real;
  const [threat, setThreat] = useState(false);
  const [automation, setAutomation] = useState<'assisted' | 'manual'>(() => (localStorage.getItem('squadwar:automation') as 'assisted' | 'manual' | null) ?? 'assisted');
  const [notice, setNotice] = useState<string>();
  const [help, setHelp] = useState(false);
  const map = ctx.map;
  const [renderer, setRenderer] = useState<BoardRenderer>();
  const [hover, setHover] = useState<HexKey>();
  const [losMode, setLosMode] = useState(false);
  const [losA, setLosA] = useState<HexKey>();
  const human = session.controllers[s.awaiting] === 'human';
  const sideName = (id: string) => s.sides.find((x) => x.id === id)?.name ?? id;
  const sel = session.selection;
  const selUnits = sel.units.filter((id) => s.units[id] && s.units[id]!.side === s.awaiting);
  const firers = useMemo(() => (FIRE.has(s.phase) ? defaultFirers(ctx, s, selUnits) : []), [ctx, s, selUnits]);
  const leader = useMemo(() => (firers.length ? defaultLeader(ctx, s, firers) : undefined), [ctx, s, firers]);
  const groupHexes = useMemo(() => [...new Set(selUnits.map((id) => s.units[id]!.hex))], [selUnits, s]);

  // Development hook: lets end-to-end checks find hexes on screen.
  useEffect(() => {
    if (!import.meta.env.DEV || !renderer) return;
    Object.assign((window as unknown as { __sw: object }).__sw, {
      screenOf: (id: string) => {
        const k = map.byId[id];
        if (!k) return undefined;
        const p = renderer.toScreen({ x: 1.5 * map.hexes[k]!.hex.q, y: Math.sqrt(3) * (map.hexes[k]!.hex.r + map.hexes[k]!.hex.q / 2) });
        const r = renderer.app.canvas.getBoundingClientRect();
        return [Math.round(p.x + r.left), Math.round(p.y + r.top)];
      },
    });
  }, [renderer, map]);

  // Bot turns.
  useEffect(() => {
    if (human || real.phase === 'gameOver' || plan) return;
    const t = setTimeout(() => session.stepBot(), 280);
    return () => clearTimeout(t);
  }, [real, human, session, plan]);

  // Assisted automation: end phases with no decision to make.
  useEffect(() => {
    if (!human || plan || automation !== 'assisted' || real.phase === 'gameOver' || real.phase === 'setup') return;
    const why = autoSkipReason(ctx, real);
    if (!why) return;
    const t = setTimeout(() => {
      setNotice(`Skipped ${PHASE_NAMES[real.phase]}: ${why}.`);
      session.dispatch({ type: 'endPhase' });
    }, 450);
    return () => clearTimeout(t);
  }, [real, human, plan, automation, ctx, session]);

  const dangers = useMemo(() => (threat ? exposureMap(ctx, s, s.awaiting) : undefined), [threat, ctx, s]);
  const planScore = useMemo(() => {
    if (!plan) return undefined;
    const end = plan.states[plan.states.length - 1]!;
    let expected = 0;
    for (const [id, steps] of Object.entries(end.tracks)) {
      if (end.units[id]?.side !== end.awaiting) continue;
      let survive = 1;
      for (const st of steps) survive *= 1 - exposureAt(ctx, plan.states[0]!, end.awaiting, st.hex).pBreak;
      expected += 1 - survive;
    }
    return expected;
  }, [plan, ctx]);

  const movePreview = useMemo(() => {
    if (s.phase !== 'movement' || !human || !hover || !selUnits.length) return undefined;
    const from = s.units[selUnits[0]!]!.hex;
    if (hover === from || sideUnitsIn(s, hover, s.awaiting).length) return undefined;
    return { from, ...groupPath(ctx, s, selUnits, hover) };
  }, [s, human, hover, selUnits, ctx]);

  const los: LosResult | undefined = useMemo(
    () => (losMode && losA && hover && hover !== losA ? bestLos(map, losA, hover) : undefined),
    [losMode, losA, hover, map],
  );

  // Draw units and overlays.
  useEffect(() => {
    if (!renderer) return;
    const units = renderer.container('units', 'units');
    drawUnits(units, ctx, s, { selected: new Set(selUnits) });
    const under = renderer.overlay('battle-under', 'under');
    drawObjectives(under, ctx, s);
    if (s.phase === 'setup' && human) drawSetupZone(under, ctx.zones[s.awaiting]!);
    if (s.phase === 'defensiveFire') drawTracks(under, s);
    const over = renderer.overlay('battle-over', 'top');
    drawSelection(over, sel.hex, session.target, groupHexes);
    const labels = renderer.container('battle-labels', 'top');
    if (movePreview) drawPath(over, labels, movePreview.from, movePreview.path, movePreview.reachable);
    if (session.target && firers.length) drawFireLines(over, ctx, groupHexes, session.target);
    const fx = renderer.overlay('battle-fx', 'over');
    const lastFire = [...session.events].reverse().find((e) => e.kind === 'fire' && e.action === session.actions.length - 1);
    drawLastFire(fx, lastFire);
    const dg = renderer.overlay('battle-danger', 'under');
    if (dangers) {
      for (const [h, e] of dangers) {
        if (e.pBreak < 0.08 || enemiesIn(s, h, s.awaiting).length) continue;
        fillHex(dg, map.hexes[h]!.hex, e.pBreak > 0.5 ? 0xd0402e : e.pBreak > 0.25 ? 0xe08a3a : 0xe0c070, Math.min(0.38, 0.1 + e.pBreak * 0.3));
      }
    }
    const pg = renderer.overlay('battle-plan', 'over');
    const plabels = renderer.container('battle-plan-labels', 'top');
    if (plan) {
      const base = plan.states[0]!;
      for (const [id, u] of Object.entries(s.units)) {
        const b = base.units[id];
        if (b && b.hex !== u.hex) drawHexOutline(pg, map.hexes[b.hex]!.hex, 0xffffff, 0.55, 2, 0.18);
      }
      const style = new TextStyle({ fontFamily: 'Roboto Condensed, Arial Narrow, sans-serif', fontSize: 10, fontWeight: '700', fill: 0xffffff, stroke: { color: 0x000000, width: 3 } });
      const seen = new Set<string>();
      for (const [id, steps] of Object.entries(s.tracks)) {
        if (s.units[id]?.side !== s.awaiting) continue;
        for (const st of steps) {
          if (seen.has(st.hex)) continue;
          seen.add(st.hex);
          const e = exposureAt(ctx, base, s.awaiting, st.hex);
          const c = hexToPixel(map.hexes[st.hex]!.hex);
          const color = e.pBreak > 0.5 ? 0xd0402e : e.pBreak > 0.25 ? 0xe08a3a : e.pBreak > 0.05 ? 0xe0c070 : 0x7fd06a;
          pg.circle(c.x * HEX_PX, c.y * HEX_PX + 16, 9).fill({ color, alpha: 0.9 }).stroke({ width: 1.5, color: 0x101410 });
          const t = new Text({ text: `${Math.round(e.pBreak * 100)}`, style, resolution: 3 });
          t.anchor.set(0.5);
          t.position.set(c.x * HEX_PX, c.y * HEX_PX + 16);
          plabels.addChild(t);
        }
      }
    }
    const lg = renderer.overlay('battle-los', 'top');
    if (losMode && los) drawLos(lg, map, los);
    else if (losMode && losA) drawHexOutline(lg, map.hexes[losA]!.hex, 0xf0c66b, 1, 4);
  }, [renderer, ctx, s, selUnits, sel.hex, session.target, session.events, session.actions.length, groupHexes, movePreview, firers.length, losMode, los, losA, map, human, dangers, plan]);

  const ownIn = useCallback((h: HexKey) => selectable(s, sideUnitsIn(s, h, s.awaiting).map((u) => u.id)), [s]);

  const onClick = useCallback(
    (p: PointerInfo) => {
      if (!p.hex) return;
      const h = p.hex;
      if (losMode) {
        setLosA(h);
        return;
      }
      if (!human) {
        session.select(h, []);
        return;
      }
      const mine = ownIn(h);
      const enemy = enemiesIn(s, h, s.awaiting).length > 0;
      const tracked = s.phase === 'defensiveFire' && Object.values(s.tracks).some((st) => st.some((x) => x.hex === h));
      switch (s.phase) {
        case 'setup':
          if (selUnits.length && h !== sel.hex && ctx.zones[s.awaiting]!.has(h) && !p.shift) {
            for (const id of selUnits) if (!session.dispatch({ type: 'place', unit: id, hex: h })) break;
            session.select(h, selUnits);
            return;
          }
          break;
        case 'movement':
          if (selUnits.length && h !== sel.hex && (!mine.length || p.shift)) {
            const { path } = groupPath(ctx, s, selUnits, h);
            let ok = true;
            for (const st of path) {
              if (!session.dispatch({ type: 'move', units: selUnits, to: st.hex })) {
                ok = false;
                break;
              }
            }
            const now = useSession.getState().states.at(-1)!;
            const at = now.units[selUnits[0]!]?.hex ?? h;
            session.select(at, selUnits.filter((id) => now.units[id]));
            if (ok) useSession.getState().clearError();
            return;
          }
          break;
        case 'prepFire':
        case 'defensiveFire':
        case 'advancingFire':
          if (firers.length && (enemy || tracked) && !mine.length) {
            session.setTarget(h);
            return;
          }
          if (enemy && firers.length && inMelee(s, h)) {
            session.setTarget(h);
            return;
          }
          if (p.shift && mine.length && selUnits.length) {
            session.select(sel.hex, [...new Set([...selUnits, ...mine])]);
            return;
          }
          break;
        case 'advance':
          if (selUnits.length && sel.hex && DIRECTIONS.some((d) => hexKey(neighbor(parseHexKey(sel.hex!), d)) === h)) {
            if (session.dispatch({ type: 'advance', units: selUnits, to: h })) session.select(h, selUnits);
            return;
          }
          break;
      }
      session.select(h, mine);
    },
    [losMode, human, session, s, ctx, selUnits, sel.hex, firers.length, ownIn],
  );

  const onHover = useCallback(
    (p: PointerInfo) => {
      setHover(p.hex);
      if (!renderer) return;
      const g = renderer.overlay('hover', 'top');
      if (p.hex) drawHexOutline(g, map.hexes[p.hex]!.hex, 0xffffff, 0.7, 2);
    },
    [renderer, map],
  );

  const blockers = phaseBlockers(ctx, s);
  const canUndo = plan ? (plan.slots[plan.active]?.actions.length ?? 0) > 0 : human && session.actions.length > 0 && !session.rolled[session.rolled.length - 1];
  const endPhase = useCallback(() => {
    if (!human || useSession.getState().plan) return;
    session.dispatch({ type: 'endPhase' });
    session.select(undefined, []);
  }, [human, session]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest('input, select, textarea')) return;
      if (e.key === ' ') {
        e.preventDefault();
        endPhase();
      } else if (e.key === 'z' || e.key === 'Z') {
        if (canUndo) session.undo();
      } else if (e.key === 'Escape') {
        session.select(undefined, []);
        setLosMode(false);
        setLosA(undefined);
      } else if (e.key === 'l' || e.key === 'L') {
        setLosMode((m) => !m);
        setLosA(undefined);
      } else if (e.key === '?' || e.key === 'h' || e.key === 'H') {
        setHelp((x) => !x);
      } else if (e.key === 't' || e.key === 'T') {
        setThreat((x) => !x);
      } else if (e.key === 'p' || e.key === 'P') {
        if (useSession.getState().plan) session.revertPlan();
        else if (human) session.startPlan();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [endPhase, canUndo, session, human]);


  const exportSave = () => {
    const save = session.save();
    if (!save) return;
    const blob = new Blob([JSON.stringify(save, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `squadwar-${save.scenario}-t${s.turn}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const hoverInfo = hover ? describeHex(map, hover) : undefined;
  const tem = hover ? hexTem(ctx, hover) : undefined;
  const mf = hover && sel.hex && hover !== sel.hex ? moveCost(ctx, sel.hex, hover) : undefined;

  return (
    <div className="page">
      <TopBar title={ctx.scenario.title}>
        <span className="status">
          {s.phase === 'setup'
            ? `Setup · ${sideName(s.awaiting)}`
            : s.phase === 'gameOver'
              ? 'Game over'
              : `Turn ${s.turn}/${ctx.scenario.turns} · ${sideName(s.phasing)} ${PHASE_NAMES[s.phase]}`}
        </span>
        <span className={`awaiting ${human ? 'you' : 'bot'}`}>{human ? `${sideName(s.awaiting)} to act` : `${sideName(s.awaiting)} (bot) thinking…`}</span>
        <button
          className={`btn ${plan ? 'active' : ''}`}
          disabled={!human && !plan}
          onClick={() => (plan ? session.revertPlan() : session.startPlan())}
          title="Plan moves without committing them (P)"
        >
          Plan <kbd>P</kbd>
        </button>
        <button className={`btn ${threat ? 'active' : ''}`} onClick={() => setThreat(!threat)} title="Shade hexes by defensive-fire danger (T)">
          Danger <kbd>T</kbd>
        </button>
        <button className={`btn ${losMode ? 'active' : ''}`} onClick={() => (setLosMode(!losMode), setLosA(undefined))} title="Check line of sight (L)">
          LOS <kbd>L</kbd>
        </button>
        <button className="btn" disabled={!canUndo} onClick={() => session.undo()} title="Undo the last action (only before dice are rolled)">
          Undo <kbd>Z</kbd>
        </button>
        <button className="btn" onClick={() => setHelp(!help)} title="Help and keyboard shortcuts (?)">
          ?
        </button>
        <button className="btn" onClick={exportSave} title="Download a save file">
          Save
        </button>
        <select
          className="auto-select"
          value={automation}
          onChange={(e) => {
            const v = e.target.value as 'assisted' | 'manual';
            setAutomation(v);
            try {
              localStorage.setItem('squadwar:automation', v);
            } catch {
              // ignore
            }
          }}
          title="Automation level"
          aria-label="Automation level"
        >
          <option value="assisted">Assisted</option>
          <option value="manual">Manual</option>
        </select>
        <button className="btn primary" disabled={!human || s.phase === 'gameOver' || !!plan} onClick={endPhase} title={blockers.join('\n') || 'End this phase (Space)'}>
          End phase <kbd>Space</kbd>
        </button>
      </TopBar>
      <div className="battle">
        <PhaseRibbon ctx={ctx} s={s} />
        <div className="board-wrap">
          <BoardView map={map} onReady={setRenderer} onHover={onHover} onClick={onClick} />
          {plan && (
            <div className="plan-banner">
              <span className="stencil plan-title">Planning</span>
              <span className="small dim">Nothing here is committed. Hexes on your paths show the chance a squad breaks there under defensive fire.</span>
              <div className="plan-tabs">
                {plan.slots.map((sl, i) => (
                  <button key={sl.name} className={`btn tiny ${i === plan.active ? 'active' : ''}`} onClick={() => session.switchPlan(i)}>
                    Plan {sl.name} · {sl.actions.filter((a) => a.type === 'move').length} moves
                  </button>
                ))}
                <button className="btn tiny" onClick={() => session.newPlanSlot()}>
                  + Alternative
                </button>
              </div>
              <span className="small">
                Expected breaks: <strong>{(planScore ?? 0).toFixed(2)}</strong>
              </span>
              <div className="plan-actions">
                <button className="btn" onClick={() => session.revertPlan()}>
                  Revert
                </button>
                <button
                  className="btn primary"
                  disabled={plan.rehearsal}
                  title={plan.rehearsal ? 'This is a rehearsal before your Movement Phase; plans are committed during the Movement Phase.' : 'Make these moves for real'}
                  onClick={() => session.commitPlan()}
                >
                  {plan.rehearsal ? 'Rehearsal only' : `Commit plan ${plan.slots[plan.active]!.name}`}
                </button>
              </div>
            </div>
          )}
          {help && (
            <div className="help" role="dialog" aria-label="Help">
              <h2 className="stencil">How to play</h2>
              <p className="small dim">Each game turn has two player turns of eight phases (§4). The log on the right explains every result with rule references.</p>
              <table className="keys">
                <tbody>
                  {[
                    ['Click', 'Select a hex and its units; click again elsewhere to move, target or advance'],
                    ['Shift-click', 'Add an adjacent hex to the fire group, or move onto your own stack'],
                    ['Space', 'End the phase'],
                    ['P', 'Plan moves without committing (rehearsal before your Movement Phase)'],
                    ['T', 'Danger map: chance a moving squad breaks under defensive fire'],
                    ['L', 'Line-of-sight check between two hexes'],
                    ['Z', 'Undo the last action (only before dice are rolled)'],
                    ['Esc', 'Clear selection and tools'],
                    ['Wheel / drag', 'Zoom and pan; 0 fits the board, arrows pan'],
                  ].map(([k, v]) => (
                    <tr key={k}>
                      <td>
                        <kbd>{k}</kbd>
                      </td>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="small dim">Assisted automation ends phases with no decision to make. Switch to Manual in the top bar to do every step yourself.</p>
              <button className="btn" onClick={() => setHelp(false)}>
                Close
              </button>
            </div>
          )}
          {threat && (
            <div className="legend">
              <span className="small">Chance a moving squad breaks:</span>
              <span className="swatch" style={{ background: '#e0c070' }} /> &lt;25%
              <span className="swatch" style={{ background: '#e08a3a' }} /> 25–50%
              <span className="swatch" style={{ background: '#d0402e' }} /> &gt;50%
            </div>
          )}
          {notice && (
            <div className="notice" onAnimationEnd={() => setNotice(undefined)}>
              {notice}
            </div>
          )}
          <div className="hud-bottom-left">
            <HexCard
              d={hoverInfo}
              extra={
                tem && (
                  <div className="hex-card-line dim">
                    Fire DRM {tem.drm > 0 ? `+${tem.drm}` : tem.drm}
                    {mf && Number.isFinite(mf.mf) && sel.hex && mf.parts.length && hover && isAdj(sel.hex, hover) ? ` · enter for ${mf.mf} MF` : ''}
                  </div>
                )
              }
            />
          </div>
          {s.phase === 'gameOver' && (
            <div className="game-over">
              <h2 className="stencil">{s.winner ? `${sideName(s.winner)} victory` : 'Game over'}</h2>
              <p>{s.result}</p>
              <div className="play-actions">
                <button className="btn primary" onClick={() => go('play')}>
                  New game
                </button>
                <button className="btn" onClick={exportSave}>
                  Save replay
                </button>
              </div>
            </div>
          )}
        </div>
        <aside className="side-right">
          {losMode && (
            <div className="panel-card small">
              {losA ? 'Hover a hex to check line of sight. Click to start from another hex.' : 'Click a hex to check line of sight from it.'}
              {los && <LosPanel map={map} r={los} />}
            </div>
          )}
          {session.error && (
            <div className="error-box" role="alert" onClick={() => session.clearError()}>
              {session.error}
            </div>
          )}
          {human && s.phase !== 'gameOver' && (
            <ActionPanel ctx={ctx} s={s} firers={firers} {...(leader ? { leader } : {})} {...(session.target ? { target: session.target } : {})} {...(sel.hex ? { selectedHex: sel.hex } : {})} dispatch={session.dispatch} setTarget={session.setTarget} />
          )}
          {sel.hex && (
            <>
              <h3 className="panel-h">{map.hexes[sel.hex]?.id}</h3>
              <StackPanel
                ctx={ctx}
                s={s}
                hex={sel.hex}
                selected={selUnits}
                onToggle={session.toggleUnit}
                {...(human && (s.phase === 'movement' || s.phase === 'setup') ? { onTransfer: (w: string, to: string | null) => session.dispatch({ type: 'transfer', weapon: w, to }) } : {})}
              />
            </>
          )}
          <h3 className="panel-h">Combat log</h3>
          <LogPanel events={session.events} />
        </aside>
      </div>
    </div>
  );
}

function isAdj(a: HexKey, b: HexKey): boolean {
  return DIRECTIONS.some((d) => hexKey(neighbor(parseHexKey(a), d)) === b);
}
