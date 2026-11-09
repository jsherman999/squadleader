import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { DIRECTIONS, hexDistance, hexKey, hexToPixel, neighbor, parseHexKey, type HexKey } from '@squadwar/hex';
import {
  FACING_NAMES,
  PHASE_NAMES,
  vehicleLabel,
  exposureAt,
  exposureMap,
  enemiesIn,
  hexTem,
  weaponType,
  inMelee,
  moveCost,
  phaseBlockers,
  sideUnitsIn,
  type GameState,
} from '@squadwar/engine';
import { bestLos, canBeUpper, viewshed, type LosResult } from '@squadwar/los';
import type { BoardRenderer, PointerInfo } from '../board/renderer';
import { drawLos, drawLosMarks } from '../board/losOverlay';
import { hexFill, hexOutline } from '../draw/pen';
import { ActionPanel, type MapPick } from '../battle/ActionPanel';
import { autoSkipReason } from '../battle/automation';
import { defaultFirers, defaultLeader, flameFirers } from '../battle/firers';
import { fogOfWar, viewerOf } from '../game/fog';
import { loadCampaign } from '../game/campaign';
import { LogPanel } from '../battle/LogPanel';
import { drawArc, drawArtillery, drawNight, drawFireLines, drawFocus, drawLastFire, drawObjectives, drawPath, drawSelection, drawSetupZone, drawSpecial, drawTracks, drawWestern } from '../battle/overlays';
import { groupPath, vehiclePath } from '../battle/pathing';
import { VehiclePanel } from '../battle/VehiclePanel';
import { facingAngle } from '../board/counters';
import { PhaseRibbon } from '../battle/PhaseRibbon';
import { StackPanel } from '../battle/StackPanel';
import { ctxFor } from '../game/scenarios';
import { downloadSave } from '../game/library';
import { useReview } from '../game/review';
import { useSession } from '../game/session';
import { WhyCard } from '../tutor/WhyCard';
import { FxSettingsButton } from '../fx/FxSettings';
import { fxPlayer } from '../fx/player';
import { SPEED_SCALE, useFxSettings } from '../fx/settings';
import { buildTimeline } from '../fx/timeline';
import { cancelLlm, llmBusy, runLlmPhase, useLlm } from '../game/llm';
import { STANDING_PRESETS, standingFire } from '@squadwar/agent';
import { go } from '../router';
import { describeHex } from '../ui/describe';
import { HexCard } from '../ui/HexCard';
import { LosPanel } from '../ui/LosPanel';
import { TopBar } from '../ui/TopBar';
import { loadViewMode, MapViews, nextViewMode, setViewMode, type OverlayLayers, type ViewMode } from '../views/MapViews';
import { ViewToggle } from '../views/ViewToggle';

const FIRE = new Set(['prepFire', 'defensiveFire', 'advancingFire']);

type Speed = 'slow' | 'normal' | 'fast' | 'max';
/** Pause after a key decision in AI vs AI; routine steps go four times faster. */
const SPEED_MS: Record<Speed, number> = { slow: 2400, normal: 900, fast: 200, max: 0 };

function loadSpeed(): Speed {
  try {
    const v = localStorage.getItem('squadwar:speed');
    return v === 'slow' || v === 'fast' || v === 'max' ? v : 'normal';
  } catch {
    return 'normal';
  }
}

/** Phases a helper can play for you (Delegated automation). */
const DELEGABLE: readonly (readonly [string, string])[] = [
  ['rally', 'Rally'],
  ['prepFire', 'Prep Fire'],
  ['movement', 'Movement'],
  ['defensiveFire', 'Defensive Fire'],
  ['advancingFire', 'Advancing Fire'],
  ['rout', 'Rout'],
  ['advance', 'Advance'],
  ['closeCombat', 'Close Combat'],
];

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
  const campaignGame = useMemo(() => loadCampaign()?.entries.some((e) => e.game === session.scenarioId) ?? false, [session.scenarioId]);
  const real = session.states[session.states.length - 1]!;
  const plan = session.plan;
  /** While fire plays out, the board keeps showing the state before the shots land. */
  const [hold, setHold] = useState<number>();
  const held = hold !== undefined ? session.states[hold] : undefined;
  /** What the board shows: the plan's state while planning. */
  const s = plan ? plan.states[plan.states.length - 1]! : (held ?? real);
  /** Log entries shown: the results of the action being animated appear when they land. */
  const shownEvents = useMemo(() => (hold === undefined ? session.events : session.events.filter((e) => e.action < hold)), [session.events, hold]);
  const fxs = useFxSettings();
  const fxBusy = useSyncExternalStore(fxPlayer.subscribe, () => fxPlayer.busy);
  const [threat, setThreat] = useState(false);
  type Automation = 'assisted' | 'streamlined' | 'delegated' | 'manual';
  const [automation, setAutomation] = useState<Automation>(() => {
    const v = localStorage.getItem('squadwar:automation');
    return v === 'manual' || v === 'streamlined' || v === 'delegated' ? v : 'assisted';
  });
  /** Phases the scripted AI plays for you under Delegated automation. */
  const [delegated, setDelegated] = useState<ReadonlySet<string>>(() => {
    try {
      const v = JSON.parse(localStorage.getItem('squadwar:delegate') ?? 'null') as string[] | null;
      return new Set(v ?? ['rally', 'rout', 'defensiveFire', 'closeCombat']);
    } catch {
      return new Set(['rally', 'rout', 'defensiveFire', 'closeCombat']);
    }
  });
  /** Your standing orders for Defensive Fire under Streamlined automation. */
  const [standing, setStanding] = useState<string>(() => localStorage.getItem('squadwar:standing') ?? 'open');
  const [notice, setNotice] = useState<string>();
  const [help, setHelp] = useState(false);
  const map = ctx.map;
  const [renderer, setRenderer] = useState<BoardRenderer>();
  const [hover, setHover] = useState<HexKey>();
  const [losMode, setLosMode] = useState(false);
  const [losA, setLosA] = useState<HexKey>();
  const [view, setView] = useState<ViewMode>(loadViewMode);
  const [povHex, setPovHex] = useState<HexKey>();
  const aiVsAi = Object.values(session.controllers).every((c) => c !== 'human');
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<Speed>(loadSpeed);
  const human = session.controllers[s.awaiting] === 'human';
  const sideName = (id: string) => s.sides.find((x) => x.id === id)?.name ?? id;
  const sel = session.selection;
  const selUnits = sel.units.filter((id) => s.units[id] && s.units[id]!.side === s.awaiting);
  // Flamethrower mode: the selected engineers fire their flamethrower alone (§22).
  const [flameMode, setFlameMode] = useState(false);
  const flame = useMemo(() => (FIRE.has(s.phase) ? flameFirers(ctx, s, selUnits) : []), [ctx, s, selUnits]);
  const flaming = flameMode && flame.length > 0;
  const firers = useMemo(() => (FIRE.has(s.phase) ? (flaming ? flame : defaultFirers(ctx, s, selUnits)) : []), [ctx, s, selUnits, flaming, flame]);
  const leader = useMemo(() => (firers.length && !flaming ? defaultLeader(ctx, s, firers) : undefined), [ctx, s, firers, flaming]);
  // A pending map pick for artillery marks or starshells (§46, §49).
  const [pick, setPick] = useState<MapPick>();
  useEffect(() => setPick(undefined), [s.phase, s.awaiting]);
  // The selected tank or SP gun acts on its own (§28–41).
  const [vsel, setVsel] = useState<string>();
  const [vtarget, setVtarget] = useState<HexKey>();
  const selVehicle = vsel && s.vehicles[vsel]?.side === s.awaiting ? s.vehicles[vsel] : undefined;
  useEffect(() => setVtarget(undefined), [vsel, s.phase]);
  // What the human player may see of concealed enemy units (§25).
  const viewer = viewerOf(session.controllers);
  const fog = useMemo(() => fogOfWar(s, viewer), [s, viewer]);
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

  // Fire Director: animate each new action's fire, close combat and results.
  const seen = useRef(session.actions.length);
  const nActions = session.actions.length;
  useEffect(() => {
    const prev = seen.current;
    seen.current = nActions;
    // New actions (one, or a short run such as a clicked path or a committed plan); not undo or load.
    if (nActions <= prev || nActions - prev > 16) return;
    if (aiVsAi && speed === 'max') return;
    const st = useSession.getState();
    const before = st.states[prev];
    if (!before) return;
    const tl = buildTimeline(ctx, before, st.events.filter((e) => e.action >= prev && e.action < nActions), {
      scale: SPEED_SCALE[fxs.speed],
      reducedMotion: fxs.reducedMotion,
      dice: fxs.dice,
    });
    if (!tl) return;
    if (tl.commitAt > 0) setHold(prev);
    fxPlayer.play(tl, { onCommit: () => setHold(undefined) });
  }, [nActions, ctx, aiVsAi, speed, fxs.speed, fxs.reducedMotion, fxs.dice]);
  useEffect(() => () => fxPlayer.skip(), []);

  // Bot turns. In AI vs AI the pace follows the speed setting and pauses longer after key decisions.
  const lastNote = session.notes[session.notes.length - 1];
  const controller = session.controllers[real.awaiting];
  useEffect(() => {
    if (controller !== 'bot' || real.phase === 'gameOver' || plan || (aiVsAi && paused) || fxBusy) return;
    const base = aiVsAi ? SPEED_MS[speed] : 280;
    const delay = aiVsAi && lastNote?.weight !== 'key' ? base / 4 : base;
    const t = setTimeout(() => session.stepBot(), delay);
    return () => clearTimeout(t);
  }, [real, controller, session, plan, aiVsAi, paused, speed, lastNote, fxBusy]);

  // LLM turns: one model decision per phase; the scripted AI covers routine phases and fallbacks.
  const llm = useLlm();
  const llmRun = llm.runs[real.awaiting];
  const llmThinking = llmRun?.status === 'thinking';
  useEffect(() => {
    if (controller !== 'llm' || real.phase === 'gameOver' || plan || (aiVsAi && paused) || fxBusy || llmBusy(real.awaiting)) return;
    const t = setTimeout(() => void runLlmPhase(real.awaiting), 200);
    return () => clearTimeout(t);
  }, [real, controller, plan, aiVsAi, paused, fxBusy, llmThinking]);
  const llmSides = Object.entries(session.controllers).filter(([, c]) => c === 'llm').map(([id]) => id);
  const llmNotice = llmSides.map((id) => llm.runs[id]?.notice).find(Boolean);
  useEffect(() => {
    if (llmNotice) setNotice(llmNotice);
  }, [llmNotice]);
  const llmSpend = llmSides.reduce((acc, id) => acc + (llm.runs[id]?.spend.usd ?? 0), 0);
  const llmCostKnown = llmSides.every((id) => llm.runs[id]?.spend.usd !== undefined);
  const radio = llmSides.flatMap((id) => (llm.runs[id]?.memory.radio ?? []).map((r) => ({ side: id, text: r })));

  // Finished AI vs AI games go to the library for review.
  useEffect(() => {
    if (!aiVsAi || real.phase !== 'gameOver' || session.libraryId) return;
    session
      .saveToLibrary()
      .then(() => setNotice('Game saved to your library. Review it from here or from the scenario page.'))
      .catch((e: Error) => setNotice(`Could not save to the library: ${e.message}`));
  }, [aiVsAi, real.phase, session]);

  /** The bot decision the tutor shows: the latest one while paused in AI vs AI, else the latest key one. */
  const tutor = useMemo(() => {
    const n = session.actions.length;
    const anyStep = aiVsAi && paused;
    for (let i = n - 1; i >= Math.max(0, n - 80); i--) {
      const note = session.notes[i];
      if (!note || (!anyStep && note.weight !== 'key')) continue;
      return { i, note, action: session.actions[i]!, before: session.states[i]!, events: session.events.filter((e) => e.action === i) };
    }
    return undefined;
  }, [session.actions, session.notes, session.states, session.events, paused, aiVsAi]);

  const openReview = useCallback(() => {
    const save = session.save();
    if (!save) return;
    useReview.getState().open(save, Math.max(0, save.actions.length - 1));
    go('review');
  }, [session]);

  // Streamlined automation: your standing orders fire in Defensive Fire, one attack at a time.
  useEffect(() => {
    if (!human || plan || automation !== 'streamlined' || real.phase !== 'defensiveFire' || fxBusy) return;
    const orders = STANDING_PRESETS[standing]?.orders;
    if (!orders) return;
    const t = setTimeout(() => {
      const d = standingFire(ctx, real, real.awaiting, orders);
      if (d) session.dispatch(d.action, d.why);
      else {
        setNotice('Standing orders carried out: Defensive Fire ends.');
        session.dispatch({ type: 'endPhase' });
      }
    }, 500);
    return () => clearTimeout(t);
  }, [real, human, plan, automation, standing, ctx, session, fxBusy]);

  // Delegated automation: the scripted AI plays the chosen phases for you, one action at a time.
  useEffect(() => {
    if (!human || plan || automation !== 'delegated' || !delegated.has(real.phase) || fxBusy) return;
    const t = setTimeout(() => session.stepHelper(), 350);
    return () => clearTimeout(t);
  }, [real, human, plan, automation, delegated, session, fxBusy]);

  // Assisted automation: end phases with no decision to make.
  useEffect(() => {
    if (!human || plan || automation === 'manual' || real.phase === 'gameOver' || real.phase === 'setup' || fxBusy) return;
    const why = autoSkipReason(ctx, real);
    if (!why) return;
    const t = setTimeout(() => {
      setNotice(`Skipped ${PHASE_NAMES[real.phase]}: ${why}.`);
      session.dispatch({ type: 'endPhase' });
    }, 450);
    return () => clearTimeout(t);
  }, [real, human, plan, automation, ctx, session, fxBusy]);

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

  const lastFire = useMemo(
    () => [...session.events].reverse().find((e) => e.kind === 'fire' && e.action === session.actions.length - 1),
    [session.events, session.actions.length],
  );

  const units = useMemo(() => ({ ctx, s: fog.s, selected: new Set(selUnits), hidden: fog.hidden, vehicle: selVehicle?.id }), [ctx, fog, selUnits, selVehicle?.id]);
  const vehiclePreview = useMemo(() => {
    if (s.phase !== 'movement' || !human || !hover || !selVehicle || hover === selVehicle.hex) return undefined;
    return { from: selVehicle.hex, ...vehiclePath(ctx, s, selVehicle.id, hover) };
  }, [s, human, hover, selVehicle, ctx]);

  // Map-space overlays, shared by the 2D board and the 3D landscape.
  const layers: OverlayLayers = useMemo(
    () => ({
      under: (pen, v) => {
        drawWestern(pen, ctx, fog.s, v !== '3d');
        drawNight(pen, ctx, s);
        drawObjectives(pen, ctx);
        drawSpecial(pen, s);
        drawArtillery(pen, ctx, s, viewer);
        if (s.phase === 'setup' && human) drawSetupZone(pen, ctx.zones[s.awaiting]!);
        if (pick?.kind === 'enter') drawSetupZone(pen, (s.reserves ?? []).find((r) => r.units.some((u) => u.id === pick.units[0]))?.hexes ?? []);
        if (s.phase === 'defensiveFire') drawTracks(pen, s);
        if (dangers) {
          for (const [h, e] of dangers) {
            if (e.pBreak < 0.08 || enemiesIn(s, h, s.awaiting).length) continue;
            hexFill(pen, map.hexes[h]!.hex, e.pBreak > 0.5 ? 0xd0402e : e.pBreak > 0.25 ? 0xe08a3a : 0xe0c070, Math.min(0.38, 0.1 + e.pBreak * 0.3));
          }
        }
      },
      over: (pen) => {
        drawLastFire(pen, lastFire);
        if (!plan) return;
        const base = plan.states[0]!;
        for (const [id, u] of Object.entries(s.units)) {
          const b0 = base.units[id];
          if (b0 && b0.hex !== u.hex) hexOutline(pen, map.hexes[b0.hex]!.hex, 0xffffff, 0.55, 2, 0.18);
        }
        const seen = new Set<string>();
        for (const [id, steps] of Object.entries(s.tracks)) {
          if (s.units[id]?.side !== s.awaiting) continue;
          for (const st of steps) {
            if (seen.has(st.hex)) continue;
            seen.add(st.hex);
            const e = exposureAt(ctx, base, s.awaiting, st.hex);
            const c = hexToPixel(map.hexes[st.hex]!.hex);
            const p = { x: c.x, y: c.y + 1 / 3 };
            const color = e.pBreak > 0.5 ? 0xd0402e : e.pBreak > 0.25 ? 0xe08a3a : e.pBreak > 0.05 ? 0xe0c070 : 0x7fd06a;
            pen.circle(p, 9, { color, alpha: 0.9 }, { width: 1.5, color: 0x101410 });
            pen.text(p, `${Math.round(e.pBreak * 100)}`, { size: 10 });
          }
        }
      },
      top: (pen, v) => {
        if (tutor && (aiVsAi || !human)) drawFocus(pen, tutor.note, tutor.action);
        drawSelection(pen, sel.hex, session.target ?? vtarget, groupHexes);
        if (selVehicle) drawArc(pen, ctx, selVehicle);
        if (selVehicle && vtarget) drawFireLines(pen, ctx, [selVehicle.hex], vtarget);
        if (vehiclePreview?.path.length) drawPath(pen, vehiclePreview.from, vehiclePreview.path, vehiclePreview.reachable);
        if (movePreview) drawPath(pen, movePreview.from, movePreview.path, movePreview.reachable);
        if (session.target && firers.length) drawFireLines(pen, ctx, groupHexes, session.target);
        if (losMode && los) (v === '3d' ? drawLosMarks : drawLos)(pen, map, los);
        else if (losMode && losA) hexOutline(pen, map.hexes[losA]!.hex, 0xf0c66b, 1, 4);
      },
    }),
    [ctx, s, human, dangers, lastFire, plan, map, sel.hex, session.target, groupHexes, movePreview, firers.length, losMode, los, losA, tutor, aiVsAi, selVehicle, vtarget, vehiclePreview, viewer, fog.s, pick],
  );

  // Eyes (POV): a unit's view at eye height. Enemy units show only where the rules give LOS.
  const pov = useMemo(() => {
    if (!povHex || !map.hexes[povHex]) return undefined;
    const here = Object.values(s.units).filter((u) => u.hex === povHex);
    // From a tank or SP gun: the commander's view along the gun (§29.4).
    const veh = Object.values(s.vehicles).find((v) => v.hex === povHex && (!selVehicle || v.id === selVehicle.id));
    if (veh && (!here.length || selVehicle?.id === veh.id)) {
      const c = hexToPixel(parseHexKey(povHex));
      const ang = facingAngle(veh.facing);
      const visible = viewshed(map, povHex);
      visible.add(povHex);
      const foes = [...Object.values(s.units), ...Object.values(s.vehicles)].filter((x) => x.side !== veh.side && visible.has(x.hex));
      return {
        hex: povHex,
        upper: false,
        visible,
        side: veh.side,
        lookAt: { x: c.x + Math.cos(ang) * 6, y: c.y + Math.sin(ang) * 6 },
        title: `${vehicleLabel(ctx, veh)} · commander’s view · ${map.hexes[povHex]!.id}`,
        detail: `Looking along the gun (arc ${FACING_NAMES[veh.facing]}) · ${new Set(foes.map((x) => x.hex)).size} enemy-held hexes in sight`,
      };
    }
    if (!here.length) return undefined;
    const side = here[0]!.side;
    const ldr = here.find((u) => ctx.data.units[u.type]!.kind === 'leader');
    const t = ctx.data.units[(ldr ?? here[0]!).type]!;
    const who = ldr ? (ldr.name ?? t.name) : t.name;
    const enemies = Object.values(s.units).filter((u) => u.side !== side);
    const from = parseHexKey(povHex);
    const nearest = enemies.sort((x, y) => hexDistance(from, parseHexKey(x.hex)) - hexDistance(from, parseHexKey(y.hex)))[0];
    const visible = viewshed(map, povHex);
    visible.add(povHex);
    const seen = new Set(enemies.filter((u) => visible.has(u.hex)).map((u) => u.hex)).size;
    const upper = canBeUpper(map, povHex);
    return {
      hex: povHex,
      upper,
      visible,
      side,
      ...(nearest ? { lookAt: hexToPixel(parseHexKey(nearest.hex)) } : {}),
      title: `Eyes of ${who} · ${map.hexes[povHex]!.id}`,
      detail: `${upper ? 'Upper level' : 'Ground level'} · ${seen} enemy-held ${seen === 1 ? 'hex' : 'hexes'} in sight`,
    };
  }, [povHex, map, ctx, s.units, s.vehicles, selVehicle]);

  const ownIn = useCallback((h: HexKey) => selectable(s, sideUnitsIn(s, h, s.awaiting).map((u) => u.id)), [s]);

  const onClick = useCallback(
    (p: PointerInfo) => {
      if (!p.hex) return;
      // On your own turn, a click during an animation jumps to its end first.
      if (fxPlayer.busy && session.controllers[real.awaiting] === 'human') fxPlayer.skip();
      const h = p.hex;
      if (losMode) {
        setLosA(h);
        return;
      }
      if (!human) {
        session.select(h, []);
        return;
      }
      if (pick) {
        if (pick.kind === 'arty') session.dispatch({ type: 'arty', battery: pick.battery, op: pick.op, hex: h, ...(pick.smoke ? { smoke: true } : {}) });
        else if (pick.kind === 'enter') session.dispatch({ type: 'enter', units: pick.units, hex: h });
        else session.dispatch({ type: 'starshell', unit: pick.unit, hex: h });
        setPick(undefined);
        return;
      }
      const mine = ownIn(h);
      const enemy = enemiesIn(s, h, s.awaiting).length > 0;
      const tracked = s.phase === 'defensiveFire' && Object.values(s.tracks).some((st) => st.some((x) => x.hex === h));
      const myVehicle = Object.values(s.vehicles).find((v) => v.hex === h && v.side === s.awaiting);
      const enemyVehicle = Object.values(s.vehicles).some((v) => v.hex === h && v.side !== s.awaiting);
      if (selVehicle) {
        if (s.phase === 'setup' && h !== selVehicle.hex && ctx.zones[s.awaiting]!.has(h) && !myVehicle) {
          session.dispatch({ type: 'place', unit: selVehicle.id, hex: h });
          return;
        }
        if (s.phase === 'movement' && h !== selVehicle.hex && !myVehicle) {
          const { path } = vehiclePath(ctx, s, selVehicle.id, h);
          let ok = true;
          for (const st of path) {
            if (!session.dispatch({ type: 'vmove', vehicle: selVehicle.id, to: st.hex })) {
              ok = false;
              break;
            }
          }
          if (ok) useSession.getState().clearError();
          return;
        }
        if (FIRE.has(s.phase) && (enemy || enemyVehicle || tracked)) {
          setVtarget(h);
          return;
        }
      }
      if (myVehicle && !mine.length) {
        setVsel(myVehicle.id);
        session.select(h, []);
        return;
      }
      setVsel(undefined);
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
    [losMode, human, session, s, ctx, selUnits, sel.hex, firers.length, ownIn, real.awaiting, selVehicle, pick],
  );

  const onHover = useCallback((p: PointerInfo) => setHover(p.hex), []);
  /** Keyboard cursor: Shift+arrows move it hex by hex, Enter acts on it like a click. */
  const cursor = useRef<HexKey | undefined>(undefined);

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
      if (e.shiftKey && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const st = useSession.getState();
        const start = cursor.current ?? st.selection.hex ?? Object.keys(map.hexes).sort()[Math.floor(Object.keys(map.hexes).length / 2)]!;
        const h = map.hexes[start]!;
        // Columns alternate up and down, so a sideways step keeps to the printed row.
        const col = /^([A-Z]+)/.exec(h.localId)![1]!;
        const odd = (col.length === 1 ? col.charCodeAt(0) - 65 : 26 + col.charCodeAt(0) - 65) % 2 === 1;
        const dir = { ArrowUp: 0, ArrowDown: 3, ArrowRight: odd ? 1 : 2, ArrowLeft: odd ? 5 : 4 }[e.key];
        if (dir === undefined) return;
        const next = hexKey(neighbor(h.hex, DIRECTIONS[dir]!));
        if (!map.hexes[next]) return;
        cursor.current = next;
        setHover(next);
        return;
      }
      if (e.key === 'Enter' && !fxPlayer.busy && cursor.current) {
        e.preventDefault();
        onClick({ hex: cursor.current, world: hexToPixel(map.hexes[cursor.current]!.hex), shift: e.shiftKey, alt: false, ctrl: false } as PointerInfo);
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        if (aiVsAi) setPaused((p) => !p);
        else endPhase();
      } else if ((e.key === 'n' || e.key === 'N') && aiVsAi) {
        session.stepBot();
      } else if (e.key === 'z' || e.key === 'Z') {
        if (canUndo) session.undo();
      } else if (e.key === 'Enter' && fxPlayer.busy) {
        fxPlayer.skip();
      } else if (e.key === '3') {
        setView(nextViewMode);
      } else if (e.key === 'e' || e.key === 'E') {
        const h = useSession.getState().selection.hex;
        setPovHex((cur) => (cur ? undefined : h));
      } else if (e.key === 'Escape') {
        if (povHex) {
          setPovHex(undefined);
          return;
        }
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
  }, [endPhase, canUndo, session, human, povHex, aiVsAi, map, onClick]);


  const exportSave = () => {
    const save = session.save();
    if (save) downloadSave(save, `squadwar-${save.scenario}-t${s.turn}.json`);
  };
  const saveToLibrary = () => {
    session
      .saveToLibrary()
      .then(() => setNotice('Saved to your library (scenario page → Saved games).'))
      .catch((e: Error) => setNotice(`Could not save: ${e.message}`));
  };

  const hoverInfo = hover ? describeHex(map, hover) : undefined;
  const tem = hover ? hexTem(ctx, hover) : undefined;
  const loose = hover ? Object.values(fog.s.weapons).filter((w) => !w.owner && w.hex === hover && !s.charges.some((c) => c.weapon === w.id)) : [];
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
        {s.phase !== 'gameOver' && (
          <span className={`awaiting ${human ? 'you' : 'bot'}`}>
            {human
              ? `${sideName(s.awaiting)} to act`
              : aiVsAi && paused
                ? 'Paused'
                : controller === 'llm'
                  ? `${sideName(real.awaiting)} (LLM): ${llmRun?.progress ?? 'waiting'}…`
                  : `${sideName(s.awaiting)} (bot) thinking…`}
          </span>
        )}
        {llmSides.length > 0 && (
          <span className="status small" title="Estimated LLM cost this game">
            LLM {llmCostKnown ? `$${llmSpend.toFixed(2)}` : `${llmSides.reduce((a, id) => a + (llm.runs[id]?.spend.calls ?? 0), 0)} calls`}
          </span>
        )}
        {controller === 'llm' && llmThinking && (
          <button className="btn" onClick={() => cancelLlm(real.awaiting)} title="Stop the model; the scripted AI finishes this phase">
            Cancel
          </button>
        )}
        {aiVsAi && (
          <>
            <button className={`btn ${paused ? 'active' : ''}`} onClick={() => setPaused(!paused)} disabled={real.phase === 'gameOver'} title="Pause or resume (Space)">
              {paused ? '▶ Resume' : '❚❚ Pause'}
            </button>
            <button className="btn" onClick={() => session.stepBot()} disabled={!paused || real.phase === 'gameOver'} title="One decision (N)">
              Step <kbd>N</kbd>
            </button>
            <select
              className="auto-select"
              value={speed}
              onChange={(e) => {
                const v = e.target.value as Speed;
                setSpeed(v);
                try {
                  localStorage.setItem('squadwar:speed', v);
                } catch {
                  // ignore
                }
              }}
              title="Game speed"
              aria-label="Game speed"
            >
              <option value="slow">Slow</option>
              <option value="normal">Normal</option>
              <option value="fast">Fast</option>
              <option value="max">Max</option>
            </select>
          </>
        )}
        <button className="btn" onClick={openReview} disabled={!session.actions.length} title="Step through this game with the reasoning behind each move">
          Review
        </button>
        {!aiVsAi && (
        <button
          className={`btn ${plan ? 'active' : ''}`}
          disabled={!human && !plan}
          onClick={() => (plan ? session.revertPlan() : session.startPlan())}
          title="Plan moves without committing them (P)"
        >
          Plan <kbd>P</kbd>
        </button>
        )}
        <button className={`btn ${threat ? 'active' : ''}`} onClick={() => setThreat(!threat)} title="Shade hexes by defensive-fire danger (T)">
          Danger <kbd>T</kbd>
        </button>
        <button className={`btn ${losMode ? 'active' : ''}`} onClick={() => (setLosMode(!losMode), setLosA(undefined))} title="Check line of sight (L)">
          LOS <kbd>L</kbd>
        </button>
        {!aiVsAi && (
          <button className="btn" disabled={!canUndo} onClick={() => session.undo()} title="Undo the last action (only before dice are rolled)">
            Undo <kbd>Z</kbd>
          </button>
        )}
        <button
          className={`btn ${povHex ? 'active' : ''}`}
          disabled={!povHex && !(sel.hex && Object.values(s.units).some((u) => u.hex === sel.hex)) && !selVehicle}
          onClick={() => setPovHex(povHex ? undefined : (selVehicle?.hex ?? sel.hex))}
          title="Look from the selected unit's eyes (E)"
        >
          Eyes <kbd>E</kbd>
        </button>
        <ViewToggle mode={view} onChange={(m) => setView(setViewMode(m))} />
        <FxSettingsButton />
        <button className="btn" onClick={() => setHelp(!help)} title="Help and keyboard shortcuts (?)">
          ?
        </button>
        <button className="btn" onClick={saveToLibrary} title="Save this game to your library">
          Save
        </button>
        {!aiVsAi && (
        <select
          className="auto-select"
          value={automation}
          onChange={(e) => {
            const v = e.target.value as Automation;
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
          <option value="streamlined">Streamlined</option>
          <option value="delegated">Delegated</option>
          <option value="manual">Manual</option>
        </select>
        )}
        {!aiVsAi && (
          <button className="btn primary" disabled={!human || s.phase === 'gameOver' || !!plan} onClick={endPhase} title={blockers.join('\n') || 'End this phase (Space)'}>
            End phase <kbd>Space</kbd>
          </button>
        )}
      </TopBar>
      <div className="battle">
        <PhaseRibbon ctx={ctx} s={s} />
        <div className="board-wrap">
          <MapViews
            map={map}
            mode={view}
            layers={layers}
            units={units}
            los={losMode ? los : undefined}
            hover={hover}
            pov={pov}
            onPovExit={() => setPovHex(undefined)}
            onHover={onHover}
            onClick={onClick}
            onReady2d={setRenderer}
          />
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
                    ['Space', 'End the phase (in AI vs AI: pause or resume)'],
                    ['N', 'AI vs AI, paused: play one decision'],
                    ['Enter', 'Skip the fire animation (Effects sets speed, sound, dice and reduced motion)'],
                    ['P', 'Plan moves without committing (rehearsal before your Movement Phase)'],
                    ['T', 'Danger map: chance a moving squad breaks under defensive fire'],
                    ['L', 'Line-of-sight check between two hexes'],
                    ['3', 'Switch between the 2D map, the 3D landscape and both side by side'],
                    ['E', "Eyes: look from the selected unit's position (watch only)"],
                    ['Z', 'Undo the last action (only before dice are rolled)'],
                    ['Esc', 'Clear selection and tools'],
                    ['Shift + arrows', 'Move the keyboard cursor hex by hex; Enter acts on it like a click (Shift+Enter adds to the selection)'],
                    ['Wheel / drag', 'Zoom and pan; 0 fits the board, arrows pan. In 3D, drag orbits, right-drag pans, double-click focuses a hex'],
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
          {fxBusy && (
            <button className="btn tiny fx-skip" onClick={() => fxPlayer.skip()} title="Skip the animation (Enter)">
              Skip ▸▸
            </button>
          )}
          {notice && (
            <div className="notice" role="status" aria-live="polite" onAnimationEnd={() => setNotice(undefined)}>
              {notice}
            </div>
          )}
          <div className="hud-bottom-left">
            <HexCard
              d={hoverInfo}
              extra={
                tem && (
                  <>
                    <div className="hex-card-line dim">
                      Fire DRM {tem.drm > 0 ? `+${tem.drm}` : tem.drm}
                      {mf && Number.isFinite(mf.mf) && sel.hex && mf.parts.length && hover && isAdj(sel.hex, hover) ? ` · enter for ${mf.mf} MF` : ''}
                    </div>
                    {loose.length > 0 && (
                      <div className="hex-card-line">
                        On the ground: {loose.map((w) => `${sideName(w.side)} ${weaponType(ctx, w).kind}${w.malfunctioned ? ' (malfunctioned)' : ''}`).join(', ')}. Any unit here can pick it up in its Movement Phase.
                      </div>
                    )}
                  </>
                )
              }
            />
          </div>
          {s.phase === 'gameOver' && (
            <div className="game-over">
              <h2 className="stencil">{s.winner ? `${sideName(s.winner)} victory` : 'Game over'}</h2>
              <p>{s.result}</p>
              <div className="play-actions">
                {campaignGame && (
                  <button className="btn primary" onClick={() => go('campaign')}>
                    Back to the campaign
                  </button>
                )}
                <button className={`btn ${campaignGame ? '' : 'primary'}`} onClick={() => go('play')}>
                  New game
                </button>
                <button className="btn primary" onClick={openReview}>
                  Review the game
                </button>
                <button className="btn" onClick={exportSave}>
                  Download
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
          {human && s.phase !== 'gameOver' && selVehicle && <VehiclePanel ctx={ctx} s={s} vehicle={selVehicle.id} target={vtarget} hidden={fog.hidden} dispatch={session.dispatch} />}
          {human && s.phase !== 'gameOver' && !selVehicle && (
            <ActionPanel
              ctx={ctx}
              s={s}
              firers={firers}
              selected={selUnits}
              hidden={fog.hidden}
              flame={flame.length ? { on: flaming, toggle: () => setFlameMode(!flaming) } : undefined}
              {...(leader ? { leader } : {})}
              {...(session.target ? { target: session.target } : {})}
              {...(sel.hex ? { selectedHex: sel.hex } : {})}
              dispatch={session.dispatch}
              setTarget={session.setTarget}
              pick={pick}
              setPick={setPick}
            />
          )}
          {sel.hex && (
            <>
              <h3 className="panel-h">{map.hexes[sel.hex]?.id}</h3>
              <StackPanel
                ctx={ctx}
                s={fog.s}
                hidden={fog.hidden}
                hex={sel.hex}
                selected={selUnits}
                onToggle={(id) => {
                  setVsel(undefined);
                  session.toggleUnit(id);
                }}
                vehicle={selVehicle?.id}
                onVehicle={(id) => {
                  setVsel(id);
                  if (id) session.select(sel.hex, []);
                }}
                {...(human && (s.phase === 'movement' || s.phase === 'setup') ? { onTransfer: (w: string, to: string | null) => session.dispatch({ type: 'transfer', weapon: w, to }) } : {})}
              />
            </>
          )}
          {!aiVsAi && automation === 'delegated' && (
            <div className="panel-card small delegate">
              <div className="panel-h">Delegated phases</div>
              {DELEGABLE.map(([ph, label]) => (
                <label key={ph} className="check">
                  <input
                    type="checkbox"
                    checked={delegated.has(ph)}
                    onChange={(e) => {
                      const next = new Set(delegated);
                      if (e.target.checked) next.add(ph);
                      else next.delete(ph);
                      setDelegated(next);
                      try {
                        localStorage.setItem('squadwar:delegate', JSON.stringify([...next]));
                      } catch {
                        // ignore
                      }
                    }}
                  />
                  {label}
                </label>
              ))}
              <p className="small faint">The computer plays these phases for your side, with its reasons in the log; Undo takes back what has no dice in it.</p>
            </div>
          )}
          {human && automation === 'streamlined' && (
            <div className="panel-card small">
              <label className="field compact">
                Standing orders
                <select
                  value={standing}
                  onChange={(e) => {
                    setStanding(e.target.value);
                    try {
                      localStorage.setItem('squadwar:standing', e.target.value);
                    } catch {
                      // ignore
                    }
                  }}
                >
                  {Object.entries(STANDING_PRESETS).map(([k, p]) => (
                    <option key={k} value={k}>
                      {p.label}
                    </option>
                  ))}
                  <option value="none">None (ask me)</option>
                </select>
              </label>
              <p className="small faint">Streamlined: these fire for you in Defensive Fire during the opponent’s turn.</p>
            </div>
          )}
          {radio.length > 0 && (
            <>
              <h3 className="panel-h">Radio</h3>
              <div className="radio-log" aria-label="Opponent radio">
                {radio.slice(-8).map((r, i) => (
                  <div key={i}>
                    <span className="dim">{sideName(r.side)}:</span> {r.text}
                  </div>
                ))}
              </div>
            </>
          )}
          {llmSides.length > 0 && (
            <label className="check small">
              <input type="checkbox" checked={llm.showThinking} onChange={(e) => llm.setShowThinking(e.target.checked)} /> Show AI thinking
            </label>
          )}
          {llm.showThinking &&
            llmSides.map((id) =>
              llm.runs[id]?.thoughts ? (
                <div key={id} className="panel-card">
                  <div className="panel-h">{sideName(id)} commander’s thinking</div>
                  <div className="thoughts">{llm.runs[id]!.thoughts}</div>
                </div>
              ) : null,
            )}
          {tutor && (
            <WhyCard
              ctx={ctx}
              s={tutor.before}
              note={tutor.note}
              actor="bot"
              events={tutor.i === hold ? [] : tutor.events}
              title={aiVsAi ? (paused ? 'Why this move' : 'Latest key decision') : 'Opponent’s last decision'}
            />
          )}
          <h3 className="panel-h">Combat log</h3>
          <LogPanel events={shownEvents} />
        </aside>
      </div>
    </div>
  );
}

function isAdj(a: HexKey, b: HexKey): boolean {
  return DIRECTIONS.some((d) => hexKey(neighbor(parseHexKey(a), d)) === b);
}
