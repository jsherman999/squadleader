import { useCallback, useEffect, useMemo, useState } from 'react';
import { DIRECTIONS, hexKey, neighbor, parseHexKey, type HexKey } from '@squadwar/hex';
import {
  PHASE_NAMES,
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
import { drawHexOutline } from '../board/overlays';
import { drawLos } from '../board/losOverlay';
import { ActionPanel } from '../battle/ActionPanel';
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
  const s = session.states[session.states.length - 1]!;
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
    if (human || s.phase === 'gameOver') return;
    const t = setTimeout(() => session.stepBot(), 280);
    return () => clearTimeout(t);
  }, [s, human, session]);

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
    const lg = renderer.overlay('battle-los', 'top');
    if (losMode && los) drawLos(lg, map, los);
    else if (losMode && losA) drawHexOutline(lg, map.hexes[losA]!.hex, 0xf0c66b, 1, 4);
  }, [renderer, ctx, s, selUnits, sel.hex, session.target, session.events, session.actions.length, groupHexes, movePreview, firers.length, losMode, los, losA, map, human]);

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
  const canUndo = human && session.actions.length > 0 && !session.rolled[session.rolled.length - 1];
  const endPhase = useCallback(() => {
    if (!human) return;
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
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [endPhase, canUndo, session]);

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
        <button className={`btn ${losMode ? 'active' : ''}`} onClick={() => (setLosMode(!losMode), setLosA(undefined))} title="Check line of sight (L)">
          LOS <kbd>L</kbd>
        </button>
        <button className="btn" disabled={!canUndo} onClick={() => session.undo()} title="Undo the last action (only before dice are rolled)">
          Undo <kbd>Z</kbd>
        </button>
        <button className="btn" onClick={exportSave} title="Download a save file">
          Save
        </button>
        <button className="btn primary" disabled={!human || s.phase === 'gameOver'} onClick={endPhase} title={blockers.join('\n') || 'End this phase (Space)'}>
          End phase <kbd>Space</kbd>
        </button>
      </TopBar>
      <div className="battle">
        <PhaseRibbon ctx={ctx} s={s} />
        <div className="board-wrap">
          <BoardView map={map} onReady={setRenderer} onHover={onHover} onClick={onClick} />
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
            <ActionPanel ctx={ctx} s={s} firers={firers} {...(leader ? { leader } : {})} {...(session.target ? { target: session.target } : {})} {...(sel.hex ? { selectedHex: sel.hex } : {})} dispatch={session.dispatch} />
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
