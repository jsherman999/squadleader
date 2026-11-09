/**
 * Orders the LLM submits, turned into engine actions. Every order carries
 * the model's stated goal and reason; they become the tutor notes stored
 * with the actions, so LLM games can be reviewed like bot games.
 */
import type { HexKey } from '@squadwar/hex';
import type { Rationale } from '@squadwar/bot';
import { carried, squadType, weaponType, type Action, type Ctx, type FireUnit, type GameEvent, type GameState } from '@squadwar/engine';
import { hexId, hexKeyOf } from './serialize';

export type OrderType = 'fire' | 'move' | 'advance' | 'rally' | 'repair' | 'transfer' | 'end_move';

export interface Order {
  readonly type: OrderType;
  readonly units?: readonly string[];
  readonly path?: readonly string[];
  readonly target?: string;
  readonly leader?: string;
  readonly to?: string;
  readonly unit?: string;
  readonly weapon?: string;
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

const ORDER_TYPES: readonly OrderType[] = ['fire', 'move', 'advance', 'rally', 'repair', 'transfer', 'end_move'];

export function orderSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ORDER_TYPES, description: 'What to do.' },
      units: { type: 'array', items: { type: 'string' }, description: 'Unit ids (fire: the firing units; move/advance/end_move: the group).' },
      path: { type: 'array', items: { type: 'string' }, description: 'move: hexes to enter in order, adjacent steps, e.g. ["A-BB2","A-AA2"].' },
      target: { type: 'string', description: 'fire: the target hex id.' },
      leader: { type: 'string', description: 'fire: optional leader id to direct the fire (same hex, not firing).' },
      to: { type: 'string', description: 'advance: the adjacent hex. transfer: receiving unit id, or "drop".' },
      unit: { type: 'string', description: 'rally: the broken unit id.' },
      weapon: { type: 'string', description: 'repair/transfer: weapon id.' },
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
    const ws = carried(s, u).filter((w) => !w.malfunctioned && !w.usedThisTurn);
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
      const firers = fireUnitsFor(ctx, s, o.units!);
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
    default:
      return fail(`unknown order type "${String((o as { type?: unknown }).type)}"`);
  }
}

/** Describe a bot action as an order (for list_options and the mock opponent). */
export function actionToOrder(ctx: Ctx, a: Action): Order | undefined {
  switch (a.type) {
    case 'fire':
      return { type: 'fire', units: a.firers.map((f) => f.unit), target: hexId(ctx, a.target), ...(a.leader ? { leader: a.leader } : {}) };
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
