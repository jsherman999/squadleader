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
  floorsOn,
  hasUpper,
  isUpper,
  observes,
  tryAction,
  unitLabel,
  type Exposure,
  type GameState,
  type Threat,
} from '@squadwar/engine';
import { bestLos, canBeUpper, viewshed, type LosResult } from '@squadwar/los';
import type { BoardRenderer, PointerInfo } from '../board/renderer';
import { drawLos, drawLosMarks } from '../board/losOverlay';
import { hexOutline } from '../draw/pen';
import { ActionPanel, type MapPick, type Shot } from '../battle/ActionPanel';
import { autoSkipReason } from '../battle/automation';
import { defaultFirers, defaultLeader, flameFirers } from '../battle/firers';
import { fogOfWar, viewerOf } from '../game/fog';
import { loadCampaign } from '../game/campaign';
import { LogPanel } from '../battle/LogPanel';
import { InfoDock } from '../battle/InfoDock';
import {
  drawArc,
  drawArtillery,
  drawDanger,
  drawDangerTags,
  drawEntryHexes,
  drawNight,
  drawFireLines,
  drawFocus,
  drawLastFire,
  drawObjectives,
  drawPath,
  drawSelection,
  drawSetupZone,
  drawSpecial,
  drawTracks,
  drawWestern,
} from '../battle/overlays';
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
import { fireOptions } from '@squadwar/bot';
import { go } from '../router';
import { describeHex } from '../ui/describe';
import { HexCard } from '../ui/HexCard';
import { LosPanel } from '../ui/LosPanel';
import { TopBar } from '../ui/TopBar';
import { loadViewMode, MapViews, nextViewMode, setViewMode, type OverlayLayers, type ViewMode } from '../views/MapViews';
import { ViewToggle } from '../views/ViewToggle';

const FIRE = new Set(['prepFire', 'defensiveFire', 'advancingFire']);
/** Danger map: hexes under this chance are left unshaded. */
const DANGER_MIN = 0.03;

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
  /** Where the decision card and the combat log go: a dock under the map (wide screens) or the right-hand panel. */
  const [infoLayout, setInfoLayoutRaw] = useState<'dock' | 'side'>(() => {
    try {
      const v = localStorage.getItem('squadwar:infoLayout');
      if (v === 'dock' || v === 'side') return v;
    } catch {
      // ignore
    }
    return window.innerWidth >= 1200 ? 'dock' : 'side';
  });
  const setInfoLayout = (v: 'dock' | 'side') => {
    setInfoLayoutRaw(v);
    try {
      localStorage.setItem('squadwar:infoLayout', v);
    } catch {
      // ignore
    }
  };
  /** Narrow windows always use the single-column layout. */
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1101px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1101px)');
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const docked = infoLayout === 'dock' && wide;
  /** Your standing orders for Defensive Fire under Streamlined automation. */
  const [standing, setStanding] = useState<string>(() => localStorage.getItem('squadwar:standing') ?? 'open');
  const [notice, setNotice] = useState<string>();
  /** The objective picked in the Objectives list, lit up on the map. */
  const [objFocus, setObjFocus] = useState<string>();
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
      renderer,
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

  /** Watching the computer with the info docked below: the right column only appears when it has something to show. */
  const sideEmpty = docked && aiVsAi && !losMode && !session.error && !sel.hex && radio.length === 0 && llmSides.length === 0;
  const statusText =
    s.phase === 'setup' ? `Setup · ${sideName(s.awaiting)}` : s.phase === 'gameOver' ? 'Game over' : `Turn ${s.turn}/${ctx.scenario.turns} · ${sideName(s.phasing)} ${PHASE_NAMES[s.phase]}`;
  /** The attacks open to the player in a fire phase, the best one for each target hex, best first. */
  const fire = useMemo(() => {
    const none = { shots: [] as Shot[], canHit: new Set<HexKey>() };
    if (!human || plan || !FIRE.has(s.phase)) return none;
    const moved = new Map<HexKey, boolean>();
    if (s.phase === 'defensiveFire') for (const steps of Object.values(s.tracks)) for (const st of steps) moved.set(st.hex, (moved.get(st.hex) ?? false) || st.open);
    const best = new Map<HexKey, Shot>();
    const canHit = new Set<HexKey>();
    // Worked out on what the player can see: enemy units still hidden are not offered as targets.
    for (const o of fireOptions(ctx, fog.s, s.awaiting, false).options) {
      canHit.add(o.target);
      // Flamethrowers fire alone through their own control; shots with nothing to gain are left out of the list.
      const f0 = o.a.firers[0]!;
      const flame = o.a.firers.length === 1 && !f0.inherent && f0.weapons.some((w) => s.weapons[w] && weaponType(ctx, s.weapons[w]!).kind === 'FT');
      if (flame || o.score < 0.02 || best.has(o.target)) continue;
      best.set(o.target, {
        from: o.from,
        target: o.target,
        units: o.a.firers.map((f) => f.unit),
        score: o.score,
        moved: moved.has(o.target),
        open: moved.get(o.target) ?? false,
        occupied: enemiesIn(fog.s, o.target, s.awaiting).length > 0,
        concealed: enemiesIn(fog.s, o.target, s.awaiting).some((u) => fog.hidden.has(u.id)),
      });
    }
    return { shots: [...best.values()], canHit };
  }, [human, plan, ctx, s, fog]);
  const takeShot = useCallback(
    (x: Shot) => {
      setVsel(undefined);
      session.select(x.from, [...x.units]);
      session.setTarget(x.target);
      // Bring the shot into view: on a phone the board is wider than the screen.
      const a = hexToPixel(parseHexKey(x.from));
      const b = hexToPixel(parseHexKey(x.target));
      renderer?.centerOn({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    },
    [session, renderer],
  );
  const eyesReady = !!povHex || !!selVehicle || !!(sel.hex && Object.values(s.units).some((u) => u.hex === sel.hex));
  const whyTitle = aiVsAi ? (paused ? 'Why this move' : 'Latest key decision') : 'Opponent’s last decision';

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

  // Units of the side to act that are due on the map this Movement Phase (reinforcements, boats), and where they come on.
  const entry = useMemo(() => {
    if (!human || s.phase !== 'movement' || s.awaiting !== s.phasing) return undefined;
    const due = (s.reserves ?? []).filter((r) => r.side === s.awaiting && r.turn <= s.turn && r.units.length > 0);
    return due.length ? { hexes: [...new Set(due.flatMap((r) => r.hexes))], boats: due.some((r) => r.endsMove) } : undefined;
  }, [human, s]);
  // Artillery: the hexes the order being given can go to. The spotter (the leader holding radio contact) must see the hex.
  const artyZone = useMemo(() => {
    if (pick?.kind !== 'arty' || !human) return undefined;
    const b = (s.batteries ?? []).find((x) => x.id === pick.battery);
    const spotter = b?.leader ? s.units[b.leader] : undefined;
    if (!b || !spotter) return undefined;
    const hexes = Object.keys(map.hexes).filter(
      (h) => observes(ctx, s, spotter, h) && tryAction(ctx, s, { type: 'arty', battery: b.id, op: pick.op, hex: h, ...(pick.smoke ? { smoke: true } : {}) }).ok,
    );
    return { hexes: new Set(hexes), spotter };
  }, [pick, human, s, ctx, map]);
  useEffect(() => {
    if (!artyZone || artyZone.hexes.size) return;
    const sp = artyZone.spotter;
    setNotice(
      `${unitLabel(ctx, sp)} in ${map.hexes[sp.hex]?.id ?? sp.hex} can observe no hex this order could go to${hasUpper(ctx, s, sp.hex) && !isUpper(ctx, s, sp) ? ' from the ground floor: take him upstairs for a view' : ': he needs a line of sight to the target'}.`,
    );
  }, [artyZone, ctx, map, s]);
  // The danger map is for the side you play (the side to act when both or neither are yours), from the enemy you can see.
  const dangerSide = viewer ?? s.awaiting;
  const dangers = useMemo(() => (threat ? exposureMap(ctx, fog.s, dangerSide) : undefined), [threat, ctx, fog.s, dangerSide]);
  // Your own stacks are not moving: for them the question is what happens if they stay where they are.
  // (A gun finds a still target more easily; small arms lose the bonus against movement in the open.)
  const ownDanger = useMemo(() => {
    if (!threat) return undefined;
    const out = new Map<HexKey, Exposure>();
    // Each stack where it stands, on the floor it is on (§57); with units on both floors of a hex, the worse of the two.
    for (const u of Object.values(fog.s.units)) {
      if (u.side !== dangerSide || u.riding) continue;
      const e = exposureAt(ctx, fog.s, dangerSide, u.hex, false, isUpper(ctx, fog.s, u));
      const had = out.get(u.hex);
      if (!had || e.pBreak > had.pBreak) out.set(u.hex, e);
    }
    return out;
  }, [threat, ctx, fog.s, dangerSide]);
  const planScore = useMemo(() => {
    if (!plan) return undefined;
    const end = plan.states[plan.states.length - 1]!;
    const seen = fogOfWar(plan.states[0]!, viewer).s;
    let expected = 0;
    for (const [id, steps] of Object.entries(end.tracks)) {
      if (end.units[id]?.side !== end.awaiting) continue;
      let survive = 1;
      for (const st of steps) survive *= 1 - exposureAt(ctx, seen, end.awaiting, st.hex).pBreak;
      expected += 1 - survive;
    }
    return expected;
  }, [plan, ctx, viewer]);

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
        drawObjectives(pen, ctx, objFocus, fog.s);
        drawSpecial(pen, s);
        drawArtillery(pen, ctx, s, viewer);
        // The setup area, unless this side has nothing on the map to place in it.
        if (s.phase === 'setup' && human && (Object.values(s.units).some((u) => u.side === s.awaiting) || Object.values(s.vehicles).some((v) => v.side === s.awaiting))) drawSetupZone(pen, ctx.zones[s.awaiting]!);
        if (s.phase === 'defensiveFire') drawTracks(pen, s, human ? fire.canHit : undefined);
        if (dangers) {
          const shade: [HexKey, number][] = [];
          for (const [h, e] of dangers) if (e.pBreak >= DANGER_MIN && !enemiesIn(fog.s, h, dangerSide).length) shade.push([h, e.pBreak]);
          drawDanger(pen, shade);
        }
        if (artyZone) drawEntryHexes(pen, artyZone.hexes, true, 'OBSERVED');
        // Drawn last, over the danger shading: the one place waiting units can come on.
        if (entry) drawEntryHexes(pen, entry.hexes, pick?.kind === 'enter', entry.boats ? 'LAND HERE' : 'ENTER HERE');
      },
      over: (pen) => {
        drawLastFire(pen, lastFire);
        if (ownDanger) drawDangerTags(pen, [...ownDanger].map(([h, e]) => [h, e.pBreak] as const));
        if (!plan) return;
        const base = plan.states[0]!;
        const known = fogOfWar(base, viewer).s;
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
            const e = exposureAt(ctx, known, s.awaiting, st.hex);
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
    [ctx, s, human, dangers, lastFire, plan, map, sel.hex, session.target, groupHexes, movePreview, firers.length, losMode, los, losA, tutor, aiVsAi, selVehicle, vtarget, vehiclePreview, viewer, fog.s, pick, objFocus, fire.canHit, dangerSide, ownDanger, entry, artyZone],
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
      // What it can fire on: with building floors (§57) a vehicle, on the ground, sees each enemy unit on that unit's own floor.
      const floorsV = floorsOn(s);
      const canSee = (hex: HexKey, up: boolean) => hex === povHex || (floorsV ? ctx.losLevel(povHex, false, hex, up).clear : visible.has(hex));
      const foeUnits = Object.values(s.units).filter((u) => u.side !== veh.side && canSee(u.hex, isUpper(ctx, s, u)));
      const foeVehicles = Object.values(s.vehicles).filter((v) => v.side !== veh.side && canSee(v.hex, false));
      const foes = [...foeUnits, ...foeVehicles];
      return {
        hex: povHex,
        upper: false,
        visible,
        seen: new Set(foes.map((x) => x.id)),
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
    // With building floors (§57) the view is from the floor these units are on, of whatever floors of other hexes it reaches.
    const floors = floorsOn(s);
    const upper = floors ? here.some((u) => isUpper(ctx, s, u)) : canBeUpper(map, povHex);
    const visible = floors
      ? new Set(Object.keys(map.hexes).filter((k) => k !== povHex && (ctx.losLevel(povHex, upper, k, false).clear || (hasUpper(ctx, s, k) && ctx.losLevel(povHex, upper, k, true).clear))))
      : viewshed(map, povHex);
    visible.add(povHex);
    // Every enemy unit and vehicle these eyes have a line of sight to: the view shows all of them, and only them.
    const canSee = (hex: HexKey, up: boolean) => hex === povHex || (floors ? ctx.losLevel(povHex, upper, hex, up).clear : visible.has(hex));
    const seenUnits = enemies.filter((u) => canSee(u.hex, isUpper(ctx, s, u)));
    const seenVehicles = Object.values(s.vehicles).filter((v) => v.side !== side && canSee(v.hex, false));
    const seen = new Set([...seenUnits, ...seenVehicles].map((x) => x.hex)).size;
    return {
      hex: povHex,
      upper,
      visible,
      seen: new Set([...seenUnits, ...seenVehicles].map((x) => x.id)),
      side,
      ...(nearest ? { lookAt: hexToPixel(parseHexKey(nearest.hex)) } : {}),
      title: `Eyes of ${who} · ${map.hexes[povHex]!.id}`,
      detail: `${upper ? 'Upper floor' : 'Ground floor'} · ${seen} enemy-held ${seen === 1 ? 'hex' : 'hexes'} in sight`,
    };
  }, [povHex, map, ctx, s, selVehicle]);

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
        if (pick.kind === 'arty') {
          // A click outside the observed hexes keeps the order open, and says who has to see the target.
          if (artyZone && !artyZone.hexes.has(h)) setNotice(`${unitLabel(ctx, artyZone.spotter)} cannot observe that hex: pick one of the blue ones.`);
          else if (session.dispatch({ type: 'arty', battery: pick.battery, op: pick.op, hex: h, ...(pick.smoke ? { smoke: true } : {}) })) setPick(undefined);
          return;
        } else if (pick.kind === 'enter') {
          // A click anywhere else keeps the units picked, so a slip does not undo the choice.
          const res = (s.reserves ?? []).find((r) => r.units.some((u) => u.id === pick.units[0]));
          if (res && !res.hexes.includes(h)) setNotice(`They come on only at the blue hexes along the ${res.endsMove ? 'bank' : 'board edge'}.`);
          else if (session.dispatch({ type: 'enter', units: pick.units, hex: h })) setPick(undefined);
          return;
        } else session.dispatch({ type: 'starshell', unit: pick.unit, hex: h });
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
      // Clicking the selected hex again lets go of it: there is no other way to deselect on a touch screen,
      // where a click anywhere else is an order. (With a gun or vehicle in the hex, that is picked first.)
      if (!p.shift && sel.hex === h && (selVehicle?.hex === h || (selUnits.length > 0 && !myVehicle))) {
        setVsel(undefined);
        session.select(undefined, []);
        return;
      }
      // A gun or vehicle is picked by clicking its hex; where your infantry (a gun's crew) is there too,
      // the first click picks the infantry and a second click on the same hex picks the gun or vehicle.
      if (myVehicle && (!mine.length || (!p.shift && !selVehicle && sel.hex === h && selUnits.length > 0))) {
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
    [losMode, human, session, s, ctx, selUnits, sel.hex, firers.length, ownIn, real.awaiting, selVehicle, pick, artyZone],
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
  const hoverObjectiveIx = hover ? ctx.objectives.findIndex((o) => o.hexes.includes(hover)) : -1;
  const hoverObjective = hoverObjectiveIx >= 0 ? { n: hoverObjectiveIx + 1, name: ctx.objectives[hoverObjectiveIx]!.name } : undefined;
  const loose = hover ? Object.values(fog.s.weapons).filter((w) => !w.owner && w.hex === hover && !s.charges.some((c) => c.weapon === w.id)) : [];
  const mf = hover && sel.hex && hover !== sel.hex ? moveCost(ctx, sel.hex, hover) : undefined;
  // With the danger map on, the hex card says who can fire on the hex and how hard.
  const hoverDanger = threat && hover && !enemiesIn(fog.s, hover, dangerSide).length ? dangers?.get(hover) : undefined;
  const hoverStill = hover ? ownDanger?.get(hover) : undefined;
  const hoverConcealed =
    hoverDanger && hover ? new Set(Object.values(fog.s.units).filter((u) => fog.hidden.has(u.id) && u.hex !== hover && ctx.los(u.hex, hover).clear).map((u) => u.hex)).size : 0;
  const threatText = (x: Threat) => {
    const v = x.vehicle ? fog.s.vehicles[x.vehicle] : undefined;
    const who = v ? vehicleLabel(ctx, v) : 'Infantry';
    const what = x.weapon === 'gun' ? `gun ${x.fp} FP, hits ${Math.round((x.hit ?? 0) * 100)}%` : x.weapon === 'mg' ? `MG ${x.fp} FP` : `${x.fp} FP`;
    return `${who} in ${map.hexes[x.from]?.id ?? x.from}: ${what}${x.smoke ? ', through smoke' : ''} · ${Math.round(x.p * 100)}%`;
  };

  return (
    <div className="page">
      <TopBar title={ctx.scenario.title} narrowTitle={statusText}>
        <span className="status">{statusText}</span>
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
          className={`btn ${povHex ? 'active' : ''} ${eyesReady ? '' : 'idle'}`}
          aria-disabled={!eyesReady}
          onClick={() => {
            // Nothing to look from yet: say how, where a greyed-out button would say nothing (phones have no tooltips).
            if (!eyesReady) setNotice('Eyes shows the battlefield from a unit’s position: select a unit on the map first, then press Eyes.');
            else setPovHex(povHex ? undefined : (selVehicle?.hex ?? sel.hex));
          }}
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
      <div className={`battle ${docked ? 'with-dock' : ''} ${sideEmpty ? 'no-side' : ''} ${aiVsAi && !paused && (speed === 'fast' || speed === 'max') ? 'rapid' : ''}`}>
        <PhaseRibbon ctx={ctx} s={s} focus={objFocus} onObjective={(name) => setObjFocus((cur) => (cur === name ? undefined : name))} />
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
            <div className="legend danger-legend">
              <span className="legend-row">
                <span className="small">Moving squad breaks:</span>
                <span className="swatch dashed" style={{ background: '#f0d24a' }} /> &lt;25%
                <span className="swatch" style={{ background: '#e08a3a' }} /> 25–50%
                <span className="swatch" style={{ background: '#d0402e' }} /> &gt;50%
              </span>
              <span className="legend-note">
                Enemy infantry, tanks and guns in view; not artillery, mines or hidden units. The tag on each of your stacks is its risk if it stays put. Tap or point at a hex to see who can
                hit it.
              </span>
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
                    {hoverObjective && (
                      <div className="hex-card-line objective-line">
                        Objective {hoverObjective.n}: {hoverObjective.name}
                      </div>
                    )}
                    {hoverStill && hoverStill.threats.length > 0 && (
                      <div className="hex-card-danger">
                        <div className="hex-card-line">Your units here, staying put: {Math.max(1, Math.round(hoverStill.pBreak * 100))}% a squad breaks if all of these fire</div>
                        {hoverStill.threats.slice(0, 4).map((x, i) => (
                          <div key={i} className="hex-card-line dim">
                            {threatText(x)}
                          </div>
                        ))}
                        {hoverStill.threats.length > 4 && <div className="hex-card-line dim">and {hoverStill.threats.length - 4} more</div>}
                      </div>
                    )}
                    {hoverDanger && (
                      <div className="hex-card-danger">
                        <div className="hex-card-line">
                          {hoverDanger.threats.length
                            ? `Danger ${Math.round(hoverDanger.pBreak * 100)}%: a squad moving here breaks if all of these fire`
                            : 'No enemy in view can fire here'}
                        </div>
                        {!hoverStill?.threats.length &&
                          hoverDanger.threats.slice(0, 4).map((x, i) => (
                            <div key={i} className="hex-card-line dim">
                              {threatText(x)}
                            </div>
                          ))}
                        {!hoverStill?.threats.length && hoverDanger.threats.length > 4 && <div className="hex-card-line dim">and {hoverDanger.threats.length - 4} more</div>}
                        {hoverConcealed > 0 && (
                          <div className="hex-card-line dim">
                            {hoverConcealed} concealed {hoverConcealed === 1 ? 'stack' : 'stacks'} in sight: strength unknown
                          </div>
                        )}
                      </div>
                    )}
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
        {!sideEmpty && (
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
              addUnits={(ids) => session.select(sel.hex, [...new Set([...selUnits, ...ids])])}
              shots={fire.shots}
              onShot={takeShot}
              pick={pick}
              setPick={setPick}
            />
          )}
          {sel.hex && (
            <>
              <div className="log-head">
                <h3 className="panel-h">{map.hexes[sel.hex]?.id}</h3>
                <button
                  className="btn tiny ghost"
                  title="Let go of the selection (Esc, or click the hex again)"
                  onClick={() => {
                    setVsel(undefined);
                    session.select(undefined, []);
                  }}
                >
                  Deselect
                </button>
              </div>
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
          {!docked && tutor && (
            <WhyCard
              ctx={ctx}
              s={tutor.before}
              note={tutor.note}
              actor="bot"
              events={tutor.i === hold ? [] : tutor.events}
              title={whyTitle}
            />
          )}
          {!docked && (
            <>
              <div className="log-head">
                <h3 className="panel-h">Combat log</h3>
                <button className="btn tiny ghost dock-toggle" onClick={() => setInfoLayout('dock')} title="Show the decision and the log in wide boxes under the map">
                  Dock under the map
                </button>
              </div>
              <LogPanel events={shownEvents} />
            </>
          )}
        </aside>
        )}
        {docked && (
          <InfoDock
            events={shownEvents}
            onSidebar={() => setInfoLayout('side')}
            ticker={tutor?.note ? `${sideName(tutor.before.awaiting)} · ${tutor.note.goal}` : undefined}
            why={
              tutor ? (
                <WhyCard ctx={ctx} s={tutor.before} note={tutor.note} actor="bot" events={tutor.i === hold ? [] : tutor.events} title={whyTitle} variant="wide" />
              ) : (
                <div className="dock-box dock-empty small dim">
                  {aiVsAi ? 'The computer’s reasons for each move appear here.' : 'The computer opponent’s reasons for its moves appear here once it has made one.'}
                </div>
              )
            }
          />
        )}
      </div>
    </div>
  );
}

function isAdj(a: HexKey, b: HexKey): boolean {
  return DIRECTIONS.some((d) => hexKey(neighbor(parseHexKey(a), d)) === b);
}
