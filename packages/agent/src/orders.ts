/**
 * Orders the LLM submits, turned into engine actions. Every order carries
 * the model's stated goal and reason; they become the tutor notes stored
 * with the actions, so LLM games can be reviewed like bot games.
 */
import type { HexKey } from '@squadwar/hex';
import type { Rationale } from '@squadwar/bot';
import { carried, FACING_NAMES, facingIndex, squadType, weaponType, type Action, type Ctx, type FireUnit, type GameEvent, type GameState } from '@squadwar/engine';
import { hexId, hexKeyOf } from './serialize';

export type OrderType =
  | 'fire'
  | 'move'
  | 'advance'
  | 'rally'
  | 'repair'
  | 'transfer'
  | 'end_move'
  | 'smoke'
  | 'place_charge'
  | 'detonate'
  | 'sewer'
  | 'vehicle_move'
  | 'vehicle_face'
  | 'vehicle_fire'
  | 'anti_tank'
  | 'smoke_dischargers'
  | 'vehicle_repair'
  | 'radio'
  | 'artillery'
  | 'starshell'
  | 'board'
  | 'unload'
  | 'push_gun'
  | 'enter'
  | 'dig'
  | 'floor';

export interface Order {
  readonly type: OrderType;
  readonly units?: readonly string[];
  readonly path?: readonly string[];
  readonly target?: string;
  readonly leader?: string;
  readonly to?: string;
  readonly unit?: string;
  readonly weapon?: string;
  readonly vehicle?: string;
  readonly facing?: string;
  readonly gun?: 'main' | 'mg';
  readonly vs?: string;
  readonly ammo?: 'AP' | 'HE' | 'HEAT';
  readonly battery?: string;
  readonly op?: 'request' | 'correct' | 'ffe' | 'move' | 'cancel';
  readonly smoke?: boolean;
  readonly work?: 'entrench' | 'wire' | 'mines';
  readonly floor?: 'upper' | 'ground';
  readonly goal?: string;
  readonly reason?: string;
}

/** Where actions go: the session (live game) or a plain engine loop (tests). */
export interface GameEnv {
  readonly ctx: Ctx;
  state(): GameState;
  apply(a: Action, note?: Rationale): { ok: true; events: readonly GameEvent[] } | { ok: false; error: string };
}

export interface OrderResult {
  readonly ok: boolean;
  readonly text: string;
}

const ORDER_TYPES: readonly OrderType[] = [
  'fire',
  'move',
  'advance',
  'rally',
  'repair',
  'transfer',
  'end_move',
  'smoke',
  'place_charge',
  'detonate',
  'sewer',
  'vehicle_move',
  'vehicle_face',
  'vehicle_fire',
  'anti_tank',
  'smoke_dischargers',
  'vehicle_repair',
  'radio',
  'artillery',
  'starshell',
  'board',
  'unload',
  'push_gun',
  'enter',
  'dig',
  'floor',
];
const MG = new Set(['LMG', 'MMG', 'HMG']);

export function orderSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ORDER_TYPES, description: 'What to do.' },
      units: { type: 'array', items: { type: 'string' }, description: 'Unit ids (fire: the firing units; move/advance/end_move/sewer: the group; enter: reinforcements coming on together).' },
      path: { type: 'array', items: { type: 'string' }, description: 'move: hexes to enter in order, adjacent steps, e.g. ["A-BB2","A-AA2"].' },
      target: { type: 'string', description: 'fire/smoke/place_charge: the target hex id. enter: the entry hex on the board edge. dig mines: the hex to clear (default its own).' },
      leader: { type: 'string', description: 'fire: optional leader id to direct the fire (same hex, not firing).' },
      to: { type: 'string', description: 'advance: the adjacent hex. sewer: the destination sewer entrance. transfer: receiving unit id, or "drop".' },
      unit: { type: 'string', description: 'rally: the broken unit id. smoke/place_charge: the engineer unit id. dig: the squad doing the work.' },
      weapon: { type: 'string', description: 'repair/transfer/place_charge/detonate: weapon id. fire: a flamethrower id to fire it alone.' },
      vehicle: { type: 'string', description: 'vehicle_*/anti_tank/smoke_dischargers: the vehicle id (yours, or the enemy AFV for anti_tank).' },
      facing: { type: 'string', enum: [...FACING_NAMES], description: 'vehicle_face: the covered arc, as its two front hexsides.' },
      gun: { type: 'string', enum: ['main', 'mg'], description: 'vehicle_fire: main gun or MGs.' },
      vs: { type: 'string', description: 'vehicle_fire with the main gun: the enemy vehicle id to shoot at (omit to fire HE at infantry).' },
      ammo: { type: 'string', enum: ['AP', 'HE', 'HEAT'], description: 'vehicle_fire at a vehicle: ammunition (default AP; HEAT only for guns that carry it).' },
      battery: { type: 'string', description: 'radio/artillery: the battery id.' },
      op: { type: 'string', enum: ['request', 'correct', 'ffe', 'move', 'cancel'], description: 'artillery: request fire, correct the spotting round, fire for effect, move the fire for effect, or call it off.' },
      smoke: { type: 'boolean', description: 'artillery ffe: smoke instead of HE.' },
      work: { type: 'string', enum: ['entrench', 'wire', 'mines'], description: 'dig (Prep Fire, instead of firing): dig in, cut wire in its own hex, or clear mines in or next to its hex (target).' },
      floor: {
        type: 'string',
        enum: ['upper', 'ground'],
        description:
          'floor: send units (same hex, in a building of 3+ hexes) to that floor. Movement Phase: 2 MF, and the enemy may fire on them on that floor in Defensive Fire if he sees it. Advance Phase: it is their advance, with no defensive fire.',
      },
      goal: { type: 'string', description: 'One short line: what this order is trying to achieve.' },
      reason: { type: 'string', description: 'Why this order, with the numbers or rules that decided it.' },
    },
    required: ['type', 'goal'],
  };
}

function note(o: Order): Rationale {
  return { goal: o.goal?.trim() || `${o.type} order`, reasons: o.reason?.trim() ? [o.reason.trim()] : [], weight: 'key' };
}

function texts(events: readonly GameEvent[]): string {
  return events
    .filter((e) => e.kind !== 'phase')
    .map((e) => e.text)
    .join('; ');
}

/** Firing entries for chosen units: a squad's own fire plus one MG (or two LMGs); leaders and crews fire a weapon. */
export function fireUnitsFor(ctx: Ctx, s: GameState, ids: readonly string[]): FireUnit[] {
  const out: FireUnit[] = [];
  for (const id of ids) {
    const u = s.units[id];
    if (!u) continue;
    // Flamethrowers fire alone and charges are placed: only MGs join a fire group.
    const ws = carried(s, u).filter((w) => !w.malfunctioned && !w.usedThisTurn && MG.has(weaponType(ctx, w).kind));
    if (squadType(ctx, u)) {
      const lmgs = ws.filter((w) => weaponType(ctx, w).kind === 'LMG');
      const pick = lmgs.length >= 2 ? lmgs.slice(0, 2) : ws.slice(0, 1);
      const inherent = !u.usedInherent;
      if (inherent || pick.length) out.push({ unit: id, inherent, weapons: pick.map((w) => w.id) });
    } else if (ws.length) out.push({ unit: id, inherent: false, weapons: [ws[0]!.id] });
  }
  return out;
}

function unknownUnits(s: GameState, ids: readonly string[] | undefined, side: string): string | undefined {
  if (!ids?.length) return 'no units given';
  const bad = ids.filter((id) => s.units[id]?.side !== side);
  return bad.length ? `not your units: ${bad.join(', ')}` : undefined;
}

/** Carry out one order. Moves go hex by hex and stop at the first refusal. */
export function executeOrder(env: GameEnv, side: string, o: Order): OrderResult {
  const ctx = env.ctx;
  const s = env.state();
  const n = note(o);
  const fail = (text: string): OrderResult => ({ ok: false, text });
  const hex = (id: string | undefined, what: string): HexKey | string => {
    if (!id) return `${what} missing`;
    return hexKeyOf(ctx, id) ?? `unknown hex "${id}" (use ids like A-X5)`;
  };
  const isKey = (h: HexKey | string): h is HexKey => !!ctx.map.hexes[h];
  switch (o.type) {
    case 'fire': {
      const bad = unknownUnits(s, o.units, side);
      if (bad) return fail(bad);
      const t = hex(o.target, 'target');
      if (!isKey(t)) return fail(t);
      // A flamethrower fires alone (§22).
      const ft = o.weapon ? s.weapons[o.weapon] : undefined;
      const flame = ft && weaponType(ctx, ft).kind === 'FT' && ft.owner ? [{ unit: ft.owner, inherent: false, weapons: [ft.id] }] : undefined;
      const firers = flame ?? fireUnitsFor(ctx, s, o.units!);
      if (!firers.length) return fail('none of those units can fire now (fired already, broken, or nothing left to fire)');
      const r = env.apply({ type: 'fire', firers, target: t, ...(o.leader ? { leader: o.leader } : {}) }, n);
      return r.ok ? { ok: true, text: texts(r.events) } : fail(r.error);
    }
    case 'move': {
      const bad = unknownUnits(s, o.units, side);
      if (bad) return fail(bad);
      if (!o.path?.length) return fail('path missing');
      const done: string[] = [];
      for (const step of o.path) {
        const h = hex(step, 'path step');
        if (!isKey(h)) return { ok: done.length > 0, text: `${done.join('; ')}${done.length ? '; then ' : ''}${h}` };
        const units = o.units!.filter((id) => env.state().units[id]);
        if (!units.length) break;
        const r = env.apply({ type: 'move', units, to: h }, done.length ? { ...n, weight: 'routine' } : n);
        if (!r.ok) return { ok: done.length > 0, text: `${done.length ? `${done.join('; ')}; then ` : ''}entering ${step} refused: ${r.error}` };
        done.push(texts(r.events) || `moved to ${step}`);
      }
      const still = o.units!.filter((id) => env.state().units[id] && !env.state().units[id]!.moveDone);
      if (still.length) env.apply({ type: 'endMove', units: still }, { goal: `Stop at ${hexId(ctx, env.state().units[still[0]!]!.hex)}`, reasons: [], weight: 'routine' });
      return { ok: true, text: done.join('; ') };
    }
    case 'end_move': {
      const bad = unknownUnits(s, o.units, side);
      if (bad) return fail(bad);
      const r = env.apply({ type: 'endMove', units: o.units! }, n);
      return r.ok ? { ok: true, text: 'stopped' } : fail(r.error);
    }
    case 'advance': {
      const bad = unknownUnits(s, o.units, side);
      if (bad) return fail(bad);
      const t = hex(o.to, 'to');
      if (!isKey(t)) return fail(t);
      const r = env.apply({ type: 'advance', units: o.units!, to: t }, n);
      return r.ok ? { ok: true, text: texts(r.events) } : fail(r.error);
    }
    case 'rally': {
      if (!o.unit || s.units[o.unit]?.side !== side) return fail('rally needs one of your broken units in "unit"');
      const r = env.apply({ type: 'rally', unit: o.unit }, n);
      return r.ok ? { ok: true, text: texts(r.events) } : fail(r.error);
    }
    case 'repair': {
      if (!o.weapon) return fail('repair needs "weapon"');
      const r = env.apply({ type: 'repair', weapon: o.weapon }, n);
      return r.ok ? { ok: true, text: texts(r.events) } : fail(r.error);
    }
    case 'transfer': {
      if (!o.weapon) return fail('transfer needs "weapon"');
      const to = !o.to || o.to === 'drop' ? null : o.to;
      const r = env.apply({ type: 'transfer', weapon: o.weapon, to }, n);
      return r.ok ? { ok: true, text: texts(r.events) || 'done' } : fail(r.error);
    }
    case 'smoke': {
      if (!o.unit) return fail('smoke needs unit');
      const t = hex(o.target, 'target');
      if (!isKey(t)) return fail(t);
      const r = env.apply({ type: 'smoke', unit: o.unit, hex: t }, n);
      return r.ok ? { ok: true, text: texts(r.events) || 'done' } : fail(r.error);
    }
    case 'place_charge': {
      if (!o.unit) return fail('place_charge needs unit');
      const u = s.units[o.unit];
      const dc = o.weapon ?? (u ? carried(s, u).find((w) => weaponType(ctx, w).kind === 'DC')?.id : undefined);
      if (!dc) return fail('that unit carries no demolition charge');
      const t = hex(o.target, 'target');
      if (!isKey(t)) return fail(t);
      const r = env.apply({ type: 'placeCharge', unit: o.unit, weapon: dc, target: t }, n);
      return r.ok ? { ok: true, text: texts(r.events) || 'done' } : fail(r.error);
    }
    case 'detonate': {
      const c = o.weapon ? s.charges.find((x) => x.weapon === o.weapon) : s.charges.find((x) => x.side === side && x.armed);
      if (!c) return fail('no armed charge of yours');
      const r = env.apply({ type: 'detonate', weapon: c.weapon }, n);
      return r.ok ? { ok: true, text: texts(r.events) || 'done' } : fail(r.error);
    }
    case 'sewer': {
      const bad = unknownUnits(s, o.units, side);
      if (bad) return fail(bad);
      const t = hex(o.to, 'to');
      if (!isKey(t)) return fail(t);
      const r = env.apply({ type: 'sewer', units: o.units!, to: t }, n);
      return r.ok ? { ok: true, text: texts(r.events) || 'done' } : fail(r.error);
    }
    case 'vehicle_move': {
      const v = o.vehicle ? s.vehicles[o.vehicle] : undefined;
      if (!v || v.side !== side) return fail('vehicle_move needs one of your vehicle ids');
      if (!o.path?.length) return fail('vehicle_move needs a path of adjacent hex ids');
      const done: string[] = [];
      for (const id of o.path) {
        const h = hex(id, 'path');
        if (!isKey(h)) return fail(`${h}${done.length ? ` (moved ${done.join(' → ')} first)` : ''}`);
        const r = env.apply({ type: 'vmove', vehicle: v.id, to: h }, done.length ? { ...n, weight: 'routine' } : n);
        if (!r.ok) return { ok: done.length > 0, text: `${done.length ? `moved ${done.join(' → ')}, then ` : ''}refused at ${id}: ${r.error}` };
        done.push(id);
      }
      return { ok: true, text: `moved ${done.join(' → ')}` };
    }
    case 'vehicle_face': {
      if (!o.vehicle || !o.facing) return fail('vehicle_face needs vehicle and facing');
      const r = env.apply({ type: 'face', vehicle: o.vehicle, facing: facingIndex(o.facing) }, n);
      return r.ok ? { ok: true, text: texts(r.events) || 'turned' } : fail(r.error);
    }
    case 'vehicle_fire': {
      if (!o.vehicle) return fail('vehicle_fire needs vehicle');
      const t = hex(o.target ?? (o.vs ? hexId(ctx, s.vehicles[o.vs]?.hex ?? '') : undefined), 'target');
      if (!isKey(t)) return fail(t);
      const r = env.apply({ type: 'vfire', vehicle: o.vehicle, target: t, weapon: o.gun ?? 'main', ...(o.vs ? { vs: o.vs } : {}), ...(o.ammo ? { ammo: o.ammo } : {}) }, n);
      return r.ok ? { ok: true, text: texts(r.events) } : fail(r.error);
    }
    case 'anti_tank': {
      const bad = unknownUnits(s, o.units, side);
      if (bad) return fail(bad);
      if (!o.vehicle) return fail('anti_tank needs the enemy vehicle id');
      const r = env.apply({ type: 'antiTank', units: o.units!, vehicle: o.vehicle, ...(o.weapon ? { weapon: o.weapon } : {}) }, n);
      return r.ok ? { ok: true, text: texts(r.events) } : fail(r.error);
    }
    case 'smoke_dischargers': {
      if (!o.vehicle) return fail('smoke_dischargers needs vehicle');
      const r = env.apply({ type: 'discharge', vehicle: o.vehicle }, n);
      return r.ok ? { ok: true, text: texts(r.events) } : fail(r.error);
    }
    case 'radio': {
      if (!o.battery || !o.unit) return fail('radio needs battery and unit (the leader with the radio)');
      const r = env.apply({ type: 'radio', battery: o.battery, unit: o.unit }, n);
      return r.ok ? { ok: true, text: texts(r.events) } : fail(r.error);
    }
    case 'artillery': {
      if (!o.battery || !o.op) return fail('artillery needs battery and op');
      const t = o.op === 'cancel' ? undefined : hex(o.target, 'target');
      if (t !== undefined && !isKey(t)) return fail(t);
      const r = env.apply({ type: 'arty', battery: o.battery, op: o.op, ...(t ? { hex: t } : {}), ...(o.smoke ? { smoke: true } : {}) }, n);
      return r.ok ? { ok: true, text: texts(r.events) } : fail(r.error);
    }
    case 'starshell': {
      if (!o.unit) return fail('starshell needs unit (a leader)');
      const t = hex(o.target, 'target');
      if (!isKey(t)) return fail(t);
      const r = env.apply({ type: 'starshell', unit: o.unit, hex: t }, n);
      return r.ok ? { ok: true, text: texts(r.events) } : fail(r.error);
    }
    case 'board':
    case 'unload': {
      const bad = unknownUnits(s, o.units, side);
      if (bad) return fail(bad);
      if (!o.vehicle) return fail(`${o.type} needs vehicle`);
      const r = env.apply({ type: o.type, units: o.units!, vehicle: o.vehicle }, n);
      return r.ok ? { ok: true, text: texts(r.events) } : fail(r.error);
    }
    case 'push_gun': {
      if (!o.unit || !o.vehicle) return fail('push_gun needs unit and vehicle (the gun)');
      const t = hex(o.to, 'to');
      if (!isKey(t)) return fail(t);
      const r = env.apply({ type: 'push', unit: o.unit, gun: o.vehicle, to: t }, n);
      return r.ok ? { ok: true, text: texts(r.events) } : fail(r.error);
    }
    case 'enter': {
      if (!o.units?.length) return fail('enter needs units (from your reserves)');
      const t = hex(o.target, 'target');
      if (!isKey(t)) return fail(t);
      const r = env.apply({ type: 'enter', units: o.units, hex: t }, n);
      return r.ok ? { ok: true, text: texts(r.events) } : fail(r.error);
    }
    case 'floor': {
      if (!o.units?.length || !o.floor) return fail('floor needs units and floor ("upper" or "ground")');
      const r = env.apply({ type: 'floor', units: o.units, upper: o.floor === 'upper' }, n);
      return r.ok ? { ok: true, text: texts(r.events) } : fail(r.error);
    }
    case 'dig': {
      if (!o.unit || !o.work) return fail('dig needs unit and work');
      let t: HexKey | undefined;
      if (o.target) {
        const k = hex(o.target, 'target');
        if (!isKey(k)) return fail(k);
        t = k;
      }
      const r = env.apply({ type: 'dig', unit: o.unit, work: o.work, ...(t ? { hex: t } : {}) }, n);
      return r.ok ? { ok: true, text: texts(r.events) } : fail(r.error);
    }
    case 'vehicle_repair': {
      if (!o.vehicle) return fail('vehicle_repair needs vehicle');
      const r = env.apply({ type: 'vrepair', vehicle: o.vehicle }, n);
      return r.ok ? { ok: true, text: texts(r.events) } : fail(r.error);
    }
    default:
      return fail(`unknown order type "${String((o as { type?: unknown }).type)}"`);
  }
}

/** Describe a bot action as an order (for list_options and the mock opponent). */
export function actionToOrder(ctx: Ctx, a: Action): Order | undefined {
  switch (a.type) {
    case 'fire': {
      const ft = a.firers.length === 1 && a.firers[0]!.weapons.length === 1 && !a.firers[0]!.inherent ? a.firers[0]!.weapons[0] : undefined;
      return { type: 'fire', units: a.firers.map((f) => f.unit), target: hexId(ctx, a.target), ...(a.leader ? { leader: a.leader } : {}), ...(ft ? { weapon: ft } : {}) };
    }
    case 'smoke':
      return { type: 'smoke', unit: a.unit, target: hexId(ctx, a.hex) };
    case 'placeCharge':
      return { type: 'place_charge', unit: a.unit, weapon: a.weapon, target: hexId(ctx, a.target) };
    case 'detonate':
      return { type: 'detonate', weapon: a.weapon };
    case 'sewer':
      return { type: 'sewer', units: a.units, to: hexId(ctx, a.to) };
    case 'vmove':
      return { type: 'vehicle_move', vehicle: a.vehicle, path: [hexId(ctx, a.to)] };
    case 'vstop':
      return undefined;
    case 'face':
      return { type: 'vehicle_face', vehicle: a.vehicle, facing: FACING_NAMES[a.facing] ?? 'N-NE' };
    case 'vfire':
      return { type: 'vehicle_fire', vehicle: a.vehicle, target: hexId(ctx, a.target), gun: a.weapon, ...(a.vs ? { vs: a.vs } : {}), ...(a.ammo ? { ammo: a.ammo } : {}) };
    case 'antiTank':
      return { type: 'anti_tank', units: a.units, vehicle: a.vehicle, ...(a.weapon ? { weapon: a.weapon } : {}) };
    case 'discharge':
      return { type: 'smoke_dischargers', vehicle: a.vehicle };
    case 'vrepair':
      return { type: 'vehicle_repair', vehicle: a.vehicle };
    case 'radio':
      return { type: 'radio', battery: a.battery, unit: a.unit };
    case 'arty':
      return { type: 'artillery', battery: a.battery, op: a.op, ...(a.hex ? { target: hexId(ctx, a.hex) } : {}), ...(a.smoke ? { smoke: true } : {}) };
    case 'starshell':
      return { type: 'starshell', unit: a.unit, target: hexId(ctx, a.hex) };
    case 'board':
    case 'unload':
      return { type: a.type, units: a.units, vehicle: a.vehicle };
    case 'push':
      return { type: 'push_gun', unit: a.unit, vehicle: a.gun, to: hexId(ctx, a.to) };
    case 'enter':
      return { type: 'enter', units: a.units, target: hexId(ctx, a.hex) };
    case 'dig':
      return { type: 'dig', unit: a.unit, work: a.work, ...(a.hex ? { target: hexId(ctx, a.hex) } : {}) };
    case 'floor':
      return { type: 'floor', units: a.units, floor: a.upper ? 'upper' : 'ground' };
    case 'move':
      return { type: 'move', units: a.units, path: [hexId(ctx, a.to)] };
    case 'endMove':
      return { type: 'end_move', units: a.units };
    case 'advance':
      return { type: 'advance', units: a.units, to: hexId(ctx, a.to) };
    case 'rally':
      return { type: 'rally', unit: a.unit };
    case 'repair':
      return { type: 'repair', weapon: a.weapon };
    default:
      return undefined;
  }
}
