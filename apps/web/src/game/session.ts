/**
 * Game session store: the action log is the source of truth; states are
 * derived by replaying it (ADR 0002). Handles hot-seat, bot sides, undo
 * before dice, saves and selection.
 */
import { create } from 'zustand';
import type { HexKey } from '@squadwar/hex';
import { createGame, tryAction, type Action, type Ctx, type GameEvent, type GameState, type SideId } from '@squadwar/engine';
import { chooseAction } from '@squadwar/bot';
import { ctxFor } from './scenarios';

export type Controller = 'human' | 'bot';

export interface LoggedEvent extends GameEvent {
  readonly n: number;
  /** Index of the action that produced it (-1 for game start). */
  readonly action: number;
}

export interface SaveFile {
  readonly format: 'squadwar-save@1';
  readonly scenario: string;
  readonly seed: number;
  readonly controllers: Record<SideId, Controller>;
  readonly actions: Action[];
  readonly savedAt: string;
}

/** Dice-free actions the planner allows (no peeking at future rolls). */
const PLANNABLE = new Set(['move', 'endMove', 'transfer', 'advance', 'place']);

export interface PlanSlot {
  readonly name: string;
  readonly actions: Action[];
}

export interface Plan {
  /** Index into states where the plan forks. */
  readonly base: number;
  readonly slots: PlanSlot[];
  readonly active: number;
  /** States of the active slot: [0] is the fork point. */
  readonly states: GameState[];
  /** Planning ahead of the Movement Phase: can be tried, not committed yet. */
  readonly rehearsal: boolean;
}

interface SessionState {
  scenarioId?: string;
  seed: number;
  controllers: Record<SideId, Controller>;
  actions: Action[];
  /** states[i] is the state after i actions. */
  states: GameState[];
  events: LoggedEvent[];
  /** Whether each action rolled dice (undo is allowed only before dice). */
  rolled: boolean[];
  error?: string;
  selection: { hex?: HexKey; units: string[] };
  target?: HexKey;
  botBusy: boolean;
  plan?: Plan;
  startPlan(): void;
  revertPlan(): void;
  commitPlan(): void;
  newPlanSlot(): void;
  switchPlan(i: number): void;
  start(scenarioId: string, controllers: Record<SideId, Controller>, seed?: number): void;
  load(save: SaveFile): void;
  dispatch(a: Action): boolean;
  undo(): void;
  clearError(): void;
  select(hex: HexKey | undefined, units?: string[]): void;
  toggleUnit(id: string): void;
  setTarget(hex: HexKey | undefined): void;
  stepBot(): boolean;
  save(): SaveFile | undefined;
}

let eventN = 0;

function hasDice(events: readonly GameEvent[]): boolean {
  return events.some((e) => e.dice && e.dice.length > 0);
}

export const useSession = create<SessionState>((set, get) => ({
  seed: 1,
  controllers: {},
  actions: [],
  states: [],
  events: [],
  rolled: [],
  selection: { units: [] },
  botBusy: false,

  start(scenarioId, controllers, seed = Math.floor(Math.random() * 2 ** 31)) {
    const ctx = ctxFor(scenarioId);
    const first = createGame(ctx, seed);
    set({
      scenarioId,
      seed,
      controllers,
      actions: [],
      states: [first.state],
      events: first.events.map((e) => ({ ...e, n: eventN++, action: -1 })),
      rolled: [],
      error: undefined,
      selection: { units: [] },
      target: undefined,
      plan: undefined,
    });
    persist(get());
  },

  load(save) {
    const ctx = ctxFor(save.scenario);
    const first = createGame(ctx, save.seed);
    const states = [first.state];
    const events: LoggedEvent[] = first.events.map((e) => ({ ...e, n: eventN++, action: -1 }));
    const rolled: boolean[] = [];
    let s = first.state;
    save.actions.forEach((a, i) => {
      const r = tryAction(ctx, s, a);
      if (!r.ok) throw new Error(`save does not replay at action ${i}: ${r.error}`);
      s = r.state;
      states.push(s);
      events.push(...r.events.map((e) => ({ ...e, n: eventN++, action: i })));
      rolled.push(hasDice(r.events));
    });
    set({
      scenarioId: save.scenario,
      seed: save.seed,
      controllers: save.controllers,
      actions: [...save.actions],
      states,
      events,
      rolled,
      error: undefined,
      selection: { units: [] },
      target: undefined,
      plan: undefined,
    });
  },

  startPlan() {
    const st = get();
    if (!st.scenarioId || st.plan) return;
    const base = st.states.length - 1;
    const cur = st.states[base]!;
    const rehearsal = (cur.phase === 'rally' || cur.phase === 'prepFire') && cur.awaiting === cur.phasing;
    // Rehearsals run on a copy that is already in the Movement Phase.
    const first: GameState = rehearsal ? { ...structuredClone(cur), phase: 'movement', awaiting: cur.phasing, attacks: [] } : cur;
    set({ plan: { base, slots: [{ name: 'A', actions: [] }], active: 0, states: [first], rehearsal }, error: undefined });
  },

  revertPlan() {
    set({ plan: undefined, error: undefined });
  },

  commitPlan() {
    const st = get();
    const plan = st.plan;
    if (!plan || plan.rehearsal) return;
    set({ plan: undefined });
    for (const a of plan.slots[plan.active]!.actions) if (!get().dispatch(a)) break;
  },

  newPlanSlot() {
    const st = get();
    const plan = st.plan;
    if (!plan) return;
    const name = String.fromCharCode(65 + plan.slots.length);
    set({ plan: { ...plan, slots: [...plan.slots, { name, actions: [] }], active: plan.slots.length, states: [plan.states[0]!] } });
  },

  switchPlan(i) {
    const st = get();
    const plan = st.plan;
    if (!plan || !st.scenarioId || !plan.slots[i]) return;
    const ctx = ctxFor(st.scenarioId);
    const states = [plan.states[0]!];
    for (const a of plan.slots[i]!.actions) {
      const r = tryAction(ctx, states[states.length - 1]!, a);
      if (!r.ok) break;
      states.push(r.state);
    }
    set({ plan: { ...plan, active: i, states } });
  },

  dispatch(a) {
    const st = get();
    if (!st.scenarioId) return false;
    const ctx = ctxFor(st.scenarioId);
    if (st.plan) {
      if (!PLANNABLE.has(a.type)) {
        set({ error: 'Plans cover movement only. Commit or revert the plan first.' });
        return false;
      }
      const plan = st.plan;
      const r = tryAction(ctx, plan.states[plan.states.length - 1]!, a);
      if (!r.ok) {
        set({ error: r.error });
        return false;
      }
      const slots = plan.slots.map((sl, i) => (i === plan.active ? { ...sl, actions: [...sl.actions, a] } : sl));
      set({ plan: { ...plan, slots, states: [...plan.states, r.state] }, error: undefined });
      return true;
    }
    const cur = st.states[st.states.length - 1]!;
    const r = tryAction(ctx, cur, a);
    if (!r.ok) {
      set({ error: r.error });
      return false;
    }
    const idx = st.actions.length;
    set({
      actions: [...st.actions, a],
      states: [...st.states, r.state],
      events: [...st.events, ...r.events.map((e) => ({ ...e, n: eventN++, action: idx }))],
      rolled: [...st.rolled, hasDice(r.events)],
      error: undefined,
      // Keep the selection on units that still exist.
      selection: { hex: st.selection.hex, units: st.selection.units.filter((id) => r.state.units[id]) },
    });
    persist(get());
    return true;
  },

  undo() {
    const st = get();
    if (st.plan) {
      const plan = st.plan;
      const slot = plan.slots[plan.active]!;
      if (!slot.actions.length) return;
      const slots = plan.slots.map((sl, i) => (i === plan.active ? { ...sl, actions: sl.actions.slice(0, -1) } : sl));
      set({ plan: { ...plan, slots, states: plan.states.slice(0, -1) } });
      return;
    }
    const n = st.actions.length;
    if (!n || st.rolled[n - 1]) return;
    set({
      actions: st.actions.slice(0, -1),
      states: st.states.slice(0, -1),
      events: st.events.filter((e) => e.action < n - 1),
      rolled: st.rolled.slice(0, -1),
      error: undefined,
    });
    persist(get());
  },

  clearError() {
    set({ error: undefined });
  },

  select(hex, units) {
    set({ selection: { hex, units: units ?? [] }, target: undefined });
  },

  toggleUnit(id) {
    const sel = get().selection;
    set({ selection: { ...sel, units: sel.units.includes(id) ? sel.units.filter((x) => x !== id) : [...sel.units, id] } });
  },

  setTarget(hex) {
    set({ target: hex });
  },

  /** Let the bot take one action if it is the bot's turn. Returns true if it acted. */
  stepBot() {
    const st = get();
    if (!st.scenarioId) return false;
    const cur = st.states[st.states.length - 1]!;
    if (cur.phase === 'gameOver' || st.controllers[cur.awaiting] !== 'bot') return false;
    const ctx = ctxFor(st.scenarioId);
    const a = chooseAction(ctx, cur);
    if (get().dispatch(a)) return true;
    return get().dispatch({ type: 'endPhase' });
  },

  save() {
    const st = get();
    if (!st.scenarioId) return undefined;
    return { format: 'squadwar-save@1', scenario: st.scenarioId, seed: st.seed, controllers: st.controllers, actions: st.actions, savedAt: new Date().toISOString() };
  },
}));

export function currentState(): GameState | undefined {
  const s = useSession.getState().states;
  return s[s.length - 1];
}

export function sessionCtx(): Ctx | undefined {
  const id = useSession.getState().scenarioId;
  return id ? ctxFor(id) : undefined;
}

const AUTOSAVE = 'squadwar:autosave';

function persist(st: SessionState): void {
  const save = st.save();
  if (!save) return;
  try {
    localStorage.setItem(AUTOSAVE, JSON.stringify(save));
  } catch {
    // Storage unavailable (private mode): the game still works.
  }
}

export function loadAutosave(): SaveFile | undefined {
  try {
    const raw = localStorage.getItem(AUTOSAVE);
    if (!raw) return undefined;
    const s = JSON.parse(raw) as SaveFile;
    return s.format === 'squadwar-save@1' ? s : undefined;
  } catch {
    return undefined;
  }
}
