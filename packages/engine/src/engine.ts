import type { Ctx } from './ctx';
import { hexLabel, otherSide, unitLabel } from './queries';
import { RuleError, type Action, type GameEvent, type GameState, type Unit, type Weapon } from './types';
import { endPhase, sideName } from './phases';
import { advance } from './rules/advance';
import { designate } from './rules/closeCombat';
import { detonate, resolveFire } from './rules/fire';
import { placeCharge, placeSmoke, sewerMove } from './rules/special';
import { endMove, moveStep, transferWeapon } from './rules/movement';
import { rallyAttempt, repairAttempt } from './rules/rally';
import { doRout } from './rules/rout';
import { suddenDeath } from './rules/victory';
import type { Emit } from './rules/common';

export interface Step {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

/** Build the initial state from the scenario's order of battle. */
export function createGame(ctx: Ctx, seed: number): Step {
  const sc = ctx.scenario;
  const units: Record<string, Unit> = {};
  const weapons: Record<string, Weapon> = {};
  let un = 0;
  let wn = 0;
  for (const side of sc.sides) {
    for (const entry of side.units) {
      const count = entry.count ?? 1;
      const firstIds: string[] = [];
      for (let i = 0; i < count; i++) {
        const id = `u${++un}`;
        const hex = entry.hex ? ctx.map.byId[entry.hex] : [...ctx.zones[side.id]!][0];
        if (!hex) throw new Error(`${sc.id}: bad start hex ${entry.hex}`);
        const name = entry.names?.[i];
        units[id] = {
          id,
          type: entry.type,
          side: side.id,
          ...(name ? { name } : {}),
          hex,
          broken: false,
          berserk: false,
          weapons: [],
          firedPhase: null,
          usedInherent: false,
          moved: false,
          mfSpent: 0,
          ppUsed: 0,
          withLeader: null,
          moveDone: false,
          directed: false,
          dm: false,
          rallyTried: false,
          routed: false,
          advanced: false,
          concealed: false,
          noConceal: false,
          smokeMade: false,
          sewerAssault: false,
        };
        firstIds.push(id);
      }
      for (const wt of entry.weapons ?? []) {
        const id = `w${++wn}`;
        const owner = units[firstIds[0]!]!;
        weapons[id] = { id, type: wt, side: side.id, hex: owner.hex, owner: owner.id, malfunctioned: false, usedThisTurn: false, repairTried: false };
        owner.weapons.push(id);
      }
    }
  }
  const sides = sc.sides.map((x) => ({ id: x.id, nation: x.nation, name: x.name })) as unknown as GameState['sides'];
  const state: GameState = {
    v: 1,
    scenario: sc.id,
    seed,
    rng: seed >>> 0,
    sides,
    turn: 0,
    half: 0,
    phase: 'setup',
    phasing: sc.moveFirst,
    awaiting: sc.setupFirst,
    units,
    weapons,
    tracks: {},
    moving: [],
    attacks: [],
    ccPlans: {},
    setupDone: [],
    losses: Object.fromEntries(sc.sides.map((x) => [x.id, { squads: 0, leaders: 0 }])),
    smoke: [],
    smokeLeft: Object.fromEntries(sc.sides.map((x) => [x.id, sc.smoke?.[x.id] ?? 0])),
    charges: [],
    closedSewers: [],
    lostInSewers: [],
  };
  return {
    state,
    events: [{ kind: 'phase', text: `${sc.title} — ${sc.location}, ${sc.date}. ${sideName(state, sc.setupFirst)} sets up first.` }],
  };
}

/** Apply one action. Returns a new state; the input is not modified. Throws RuleError if illegal. */
export function applyAction(ctx: Ctx, state: GameState, action: Action): Step {
  if (state.phase === 'gameOver') throw new RuleError('The game is over');
  const s: GameState = structuredClone(state);
  const events: GameEvent[] = [];
  const emit: Emit = (e) => events.push(e);
  switch (action.type) {
    case 'place':
      place(ctx, s, action.unit, action.hex, emit);
      break;
    case 'rally':
      rallyAttempt(ctx, s, action.unit, emit);
      break;
    case 'repair':
      repairAttempt(ctx, s, action.weapon, emit);
      break;
    case 'fire':
      resolveFire(ctx, s, action.firers, action.target, action.leader, emit);
      break;
    case 'move':
      moveStep(ctx, s, action.units, action.to, emit);
      break;
    case 'endMove':
      endMove(s, action.units);
      break;
    case 'transfer':
      transferWeapon(ctx, s, action.weapon, action.to, emit);
      break;
    case 'rout':
      doRout(ctx, s, action.unit, action.to, emit);
      break;
    case 'advance':
      advance(ctx, s, action.units, action.to, emit);
      break;
    case 'closeCombat':
      designate(ctx, s, action.hex, action.attacks);
      break;
    case 'smoke':
      placeSmoke(ctx, s, action.unit, action.hex, emit);
      break;
    case 'placeCharge':
      placeCharge(ctx, s, action.unit, action.weapon, action.target, emit);
      break;
    case 'detonate':
      detonate(ctx, s, action.weapon, emit);
      break;
    case 'sewer':
      sewerMove(ctx, s, action.units, action.to, emit);
      break;
    case 'endPhase':
      endPhase(ctx, s, emit);
      break;
  }
  suddenDeath(ctx, s, emit);
  return { state: s, events };
}

export type TryResult = ({ ok: true } & Step) | { ok: false; error: string };

export function tryAction(ctx: Ctx, state: GameState, action: Action): TryResult {
  try {
    return { ok: true, ...applyAction(ctx, state, action) };
  } catch (e) {
    if (e instanceof RuleError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Re-create a game from its seed and action log (saves, replays, undo). */
export function replay(ctx: Ctx, seed: number, actions: readonly Action[]): { state: GameState; events: GameEvent[]; steps: Step[] } {
  let step = createGame(ctx, seed);
  const events: GameEvent[] = [...step.events];
  const steps: Step[] = [step];
  for (const a of actions) {
    step = applyAction(ctx, step.state, a);
    events.push(...step.events);
    steps.push(step);
  }
  return { state: step.state, events, steps };
}

function place(ctx: Ctx, s: GameState, unitId: string, hex: string, emit: Emit): void {
  if (s.phase !== 'setup') throw new RuleError('Units are placed during setup', '§21');
  const u = s.units[unitId];
  if (!u || u.side !== s.awaiting) throw new RuleError('Not your unit');
  if (!ctx.zones[u.side]!.has(hex)) throw new RuleError(`${hexLabel(ctx, hex)} is outside your setup area`, '§21');
  if (Object.values(s.units).some((o) => o.hex === hex && o.side === otherSide(s, u.side))) throw new RuleError('Enemy units are there');
  const from = u.hex;
  u.hex = hex;
  for (const w of Object.values(s.weapons)) if (w.owner === u.id) w.hex = hex;
  emit({ kind: 'info', text: `${unitLabel(ctx, u)} placed in ${hexLabel(ctx, hex)}`, side: u.side, from, to: hex, units: [u.id] });
}
