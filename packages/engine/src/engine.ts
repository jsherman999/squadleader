import type { Ctx } from './ctx';
import { hexLabel, otherSide, unitLabel } from './queries';
import { RuleError, type Action, type GameEvent, type GameOptions, type GameState, type Unit, type Vehicle, type Weapon } from './types';
import { endPhase, sideName } from './phases';
import { advance } from './rules/advance';
import { designate } from './rules/closeCombat';
import { detonate, resolveFire } from './rules/fire';
import { placeCharge, placeSmoke, sewerMove } from './rules/special';
import { fireStarshell } from './rules/night';
import { artilleryOrder, radioContact, setupBatteries } from './rules/artillery';
import { board, pushGun, unload } from './rules/transport';
import { dig, edgeHexes, enterMap, setupFortifications, setupLanding } from './rules/western';
import { antiTank, discharge, faceVehicle, facingIndex, newVehicle, resolveVehicleFire, vehicleLabel, vehicleMove, vehicleRepair, vehicleStop } from './rules/armor';
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
export function createGame(ctx: Ctx, seed: number, options?: GameOptions): Step {
  const sc = ctx.scenario;
  const units: Record<string, Unit> = {};
  const weapons: Record<string, Weapon> = {};
  const vehicles: Record<string, Vehicle> = {};
  let un = 0;
  let wn = 0;
  let vn = 0;
  for (const side of sc.sides) {
    for (const entry of side.units) {
      const count = entry.count ?? 1;
      const firstIds: string[] = [];
      if (ctx.data.vehicles[entry.type]) {
        for (let i = 0; i < count; i++) {
          const id = `v${++vn}`;
          const hex = entry.hex ? ctx.map.byId[entry.hex] : [...ctx.zones[side.id]!][0];
          if (!hex) throw new Error(`${sc.id}: bad start hex ${entry.hex}`);
          vehicles[id] = { ...newVehicle(id, entry.type, side.id, hex, facingIndex(entry.facing ?? 'N-NE'), entry.names?.[i]), ...(entry.hidden ? { hidden: true } : {}) };
        }
        continue;
      }
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
          ...(entry.hidden ? { hidden: true } : {}),
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
  // Riders who start aboard a named vehicle (§31.9); reinforcements set aside.
  let uid = 0;
  const reserves: GameState['reserves'] & object = [];
  for (const side of sc.sides) {
    for (const entry of side.units) {
      if (ctx.data.vehicles[entry.type]) continue;
      const count = entry.count ?? 1;
      for (let i = 0; i < count; i++) {
        const u = units[`u${++uid}`];
        if (u && entry.enters) {
          // Reinforcements wait off the map (§60).
          const ws = Object.values(weapons).filter((w) => w.owner === u.id);
          delete units[u.id];
          for (const w of ws) delete weapons[w.id];
          const hexes = edgeHexes(ctx, entry.enters.board, entry.enters.edge);
          reserves.push({ units: [u], weapons: ws, side: side.id, turn: entry.enters.turn, hexes, endsMove: ctx.scenario.landing?.side === side.id });
          continue;
        }
        if (!u || !entry.rides) continue;
        const v = Object.values(vehicles).find((x) => x.side === side.id && x.name === entry.rides);
        if (!v) throw new Error(`${sc.id}: no vehicle named ${entry.rides}`);
        u.riding = v.id;
        u.hex = v.hex;
        for (const w of Object.values(weapons)) if (w.owner === u.id) w.hex = v.hex;
      }
    }
  }
  const sides = sc.sides.map((x) => ({ id: x.id, nation: x.nation, name: x.name })) as unknown as GameState['sides'];
  const state: GameState = {
    v: 1,
    scenario: sc.id,
    seed,
    ...(options && Object.values(options).some(Boolean) ? { options } : {}),
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
    vehicles,
    wrecks: [],
    vtracks: {},
    afvAssaults: [],
    ...(reserves.length ? { reserves: mergeReserves(reserves) } : {}),
    ...(sc.night ? { nightVis: 2, starshells: [], starshellsLeft: Object.fromEntries(sc.sides.map((x) => [x.id, sc.starshells?.[x.id] ?? 0])), flashes: { now: [], prev: [] } } : {}),
  };
  setupBatteries(ctx, state);
  setupFortifications(ctx, state);
  setupLanding(ctx, state);
  const arty = (state.batteries ?? []).map((b) => `${sideName(state, b.side)} artillery: ${b.mm}mm, ${b.missions} fire mission${b.missions > 1 ? 's' : ''} (§45.2)`);
  return {
    state,
    events: [{ kind: 'phase', text: `${sc.title} — ${sc.location}, ${sc.date}. ${sideName(state, sc.setupFirst)} sets up first.` }, ...arty.map((text) => ({ kind: 'info' as const, text }))],
  };
}

/** One reserve group per side and turn. */
function mergeReserves(list: NonNullable<GameState['reserves']>): NonNullable<GameState['reserves']> {
  const out: NonNullable<GameState['reserves']> = [];
  for (const r of list) {
    const same = out.find((o) => o.side === r.side && o.turn === r.turn && o.hexes.join() === r.hexes.join());
    if (same) out[out.indexOf(same)] = { ...same, units: [...same.units, ...r.units], weapons: [...same.weapons, ...r.weapons] };
    else out.push(r);
  }
  return out;
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
    case 'face':
      faceVehicle(ctx, s, action.vehicle, action.facing, emit);
      break;
    case 'vmove':
      vehicleMove(ctx, s, action.vehicle, action.to, emit);
      break;
    case 'vstop':
      vehicleStop(ctx, s, action.vehicle);
      break;
    case 'vfire':
      resolveVehicleFire(ctx, s, action, emit);
      break;
    case 'antiTank':
      antiTank(ctx, s, action.units, action.vehicle, action.weapon, emit);
      break;
    case 'discharge':
      discharge(ctx, s, action.vehicle, emit);
      break;
    case 'vrepair':
      vehicleRepair(ctx, s, action.vehicle, emit);
      break;
    case 'radio':
      radioContact(ctx, s, action.battery, action.unit, emit);
      break;
    case 'arty':
      artilleryOrder(ctx, s, action.battery, action.op, action.hex, !!action.smoke, emit);
      break;
    case 'board':
      board(ctx, s, action.units, action.vehicle, emit);
      break;
    case 'unload':
      unload(ctx, s, action.units, action.vehicle, emit);
      break;
    case 'push':
      pushGun(ctx, s, action.unit, action.gun, action.to, emit);
      break;
    case 'enter':
      enterMap(ctx, s, action.units, action.hex, emit);
      break;
    case 'dig':
      dig(ctx, s, action.unit, action.work, action.hex, emit);
      break;
    case 'starshell':
      fireStarshell(ctx, s, action.unit, action.hex, emit);
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
  const v = s.vehicles[unitId];
  if (v) {
    if (v.side !== s.awaiting) throw new RuleError('Not your vehicle');
    if (!ctx.zones[v.side]!.has(hex)) throw new RuleError(`${hexLabel(ctx, hex)} is outside your setup area`, '§21');
    const t = ctx.map.hexes[hex]!.terrain;
    if (t === 'stoneBuilding' || t === 'water') throw new RuleError('Vehicles cannot be there', '§30.1');
    if (Object.values(s.vehicles).some((o) => o.hex === hex && o.id !== v.id)) throw new RuleError('One vehicle per hex', '§29.1');
    if (Object.values(s.units).some((o) => o.hex === hex && o.side !== v.side)) throw new RuleError('Enemy units are there');
    const from = v.hex;
    v.hex = hex;
    emit({ kind: 'info', text: `${vehicleLabel(ctx, v)} placed in ${hexLabel(ctx, hex)}`, side: v.side, from, to: hex, fx: { vehicles: [v.id] } });
    return;
  }
  const u = s.units[unitId];
  if (!u || u.side !== s.awaiting) throw new RuleError('Not your unit');
  if (!ctx.zones[u.side]!.has(hex)) throw new RuleError(`${hexLabel(ctx, hex)} is outside your setup area`, '§21');
  const t = ctx.map.hexes[hex]!.terrain;
  if (u.hidden && t !== 'woods' && t !== 'woodBuilding' && t !== 'stoneBuilding') throw new RuleError('Hidden units set up only in woods or buildings', '§42.1');
  if (Object.values(s.units).some((o) => o.hex === hex && o.side === otherSide(s, u.side))) throw new RuleError('Enemy units are there');
  const from = u.hex;
  u.hex = hex;
  for (const w of Object.values(s.weapons)) if (w.owner === u.id) w.hex = hex;
  emit({ kind: 'info', text: `${unitLabel(ctx, u)} placed in ${hexLabel(ctx, hex)}`, side: u.side, from, to: hex, units: [u.id] });
}
