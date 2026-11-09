/**
 * Standing orders for Defensive Fire (PLAN.md §7.7, §7.8 Streamlined):
 * rules like "fire at enemies moving in the open within 6 hexes" that the
 * game carries out without asking anyone. Used by the LLM (to save calls)
 * and by human players (presets).
 */
import { fireOptions, type Decision } from '@squadwar/bot';
import { carried, range, squadType, weaponType, type Ctx, type GameState } from '@squadwar/engine';
import { hexId } from './serialize';

export interface StandingOrder {
  /** Which of your units: "all", or unit ids. */
  readonly units: 'all' | readonly string[];
  /** Only fire at hexes a unit crossed in the open. */
  readonly openOnly: boolean;
  /** Longest range to fire at, in hexes. */
  readonly maxRange: number;
  /** Fire only if the attack expects at least this many enemy units broken or worse. */
  readonly minExpected: number;
  /** Never fire at long range (beyond the normal range, where firepower halves). */
  readonly normalRangeOnly: boolean;
  /** Free text shown in the log, e.g. "MG nest covers the square". */
  readonly note?: string;
}

export const STANDING_PRESETS: Record<string, { label: string; orders: StandingOrder[] }> = {
  open: {
    label: 'Fire at units moving in the open within 8 hexes',
    orders: [{ units: 'all', openOnly: true, maxRange: 8, minExpected: 0.15, normalRangeOnly: false }],
  },
  everything: {
    label: 'Fire at anything worth shooting',
    orders: [{ units: 'all', openOnly: false, maxRange: 16, minExpected: 0.12, normalRangeOnly: false }],
  },
  close: {
    label: 'Only fire at normal range, good odds',
    orders: [{ units: 'all', openOnly: false, maxRange: 16, minExpected: 0.3, normalRangeOnly: true }],
  },
};

export function standingOrderSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      units: { type: 'array', items: { type: 'string' }, description: 'Your unit ids this order covers; empty means all units.' },
      openOnly: { type: 'boolean', description: 'Only fire at hexes enemies crossed in the open.' },
      maxRange: { type: 'number', description: 'Longest range in hexes.' },
      minExpected: { type: 'number', description: 'Minimum expected enemy units broken or worse (0.1 = 10%), e.g. 0.15.' },
      normalRangeOnly: { type: 'boolean', description: 'Never fire beyond normal range.' },
      note: { type: 'string', description: 'What the order is for.' },
    },
    required: ['openOnly', 'maxRange', 'minExpected', 'normalRangeOnly'],
  };
}

/** Clean up an order from a model or a form. */
export function normaliseOrder(o: Partial<StandingOrder> & { units?: unknown }): StandingOrder {
  const ids = Array.isArray(o.units) ? (o.units as unknown[]).map(String).filter(Boolean) : [];
  return {
    units: ids.length ? ids : 'all',
    openOnly: !!o.openOnly,
    maxRange: Math.max(1, Math.min(32, Number(o.maxRange) || 8)),
    minExpected: Math.max(0, Math.min(3, Number(o.minExpected) || 0.15)),
    normalRangeOnly: !!o.normalRangeOnly,
    ...(o.note ? { note: String(o.note).slice(0, 200) } : {}),
  };
}

function normalRange(ctx: Ctx, s: GameState, unitIds: readonly string[]): number {
  let r = Infinity;
  for (const id of unitIds) {
    const u = s.units[id];
    if (!u) continue;
    const st = squadType(ctx, u);
    if (st) r = Math.min(r, st.range);
    for (const w of carried(s, u)) r = Math.min(r, weaponType(ctx, w).range);
  }
  return r;
}

/** The next Defensive Fire attack the orders call for, if any. */
export function standingFire(ctx: Ctx, s: GameState, side: string, orders: readonly StandingOrder[]): Decision | undefined {
  if (s.phase !== 'defensiveFire' || s.awaiting !== side || !orders.length) return undefined;
  const openHexes = new Set<string>();
  for (const steps of Object.values(s.tracks)) for (const st of steps) if (st.open) openHexes.add(st.hex);
  const { options } = fireOptions(ctx, s, side, false);
  for (const o of options) {
    const firers = o.a.firers.map((f) => f.unit);
    const order = orders.find((so) => {
      if (so.units !== 'all' && !firers.every((id) => (so.units as readonly string[]).includes(id))) return false;
      if (so.openOnly && !openHexes.has(o.target)) return false;
      if (range(o.from, o.target) > so.maxRange) return false;
      if (so.normalRangeOnly && range(o.from, o.target) > normalRange(ctx, s, firers)) return false;
      return o.score >= so.minExpected;
    });
    if (!order) continue;
    return {
      action: o.a,
      why: {
        goal: `Standing order: fire on ${hexId(ctx, o.target)}`,
        reasons: [
          `Order: ${order.openOnly ? 'units moving in the open' : 'targets'} within ${order.maxRange} hexes${order.normalRangeOnly ? ', normal range only' : ''}, at least ${order.minExpected} expected breaks.`,
          `${hexId(ctx, o.from)} → ${hexId(ctx, o.target)}: ${o.an.totalFp} FP, expected ${o.score.toFixed(2)} units broken or worse.`,
          ...(order.note ? [order.note] : []),
        ],
        weight: 'key',
        focus: { from: o.from, to: o.target },
      },
    };
  }
  return undefined;
}
