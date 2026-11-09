/**
 * The LLM's tools (PLAN.md §7.7). They read the game only through the
 * serializer's visibility gate and change it only through engine actions.
 */
import { DIRECTIONS, hexKey, hexToPixel, neighbor, parseHexKey, type HexKey } from '@squadwar/hex';
import { decide, fireOptions } from '@squadwar/bot';
import { analyzeFire, exposureAt, fireOdds, losFrom, mfLeft, moveCost, range, type Ctx, type GameState } from '@squadwar/engine';
import { actionToOrder, executeOrder, fireUnitsFor, orderSchema, type GameEnv, type Order } from './orders';
import { describeHexes, hexId, hexKeyOf, situation } from './serialize';
import { normaliseOrder, standingOrderSchema, type StandingOrder } from './standing';
import type { ToolCall, ToolDef } from './types';

/** What an agent remembers across decisions in one game. */
export interface AgentMemory {
  notebook: string[];
  standing: StandingOrder[];
  /** In-character radio lines, newest last. */
  radio: string[];
}

export function newMemory(): AgentMemory {
  return { notebook: [], standing: [], radio: [] };
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });
const str = (description: string) => ({ type: 'string', description });
const strs = (description: string) => ({ type: 'array', items: { type: 'string' }, description });

export const TOOLS: readonly ToolDef[] = [
  { name: 'get_situation', description: 'The current turn, phase, your units, known enemy units, objectives and losses.', parameters: obj({}) },
  {
    name: 'describe_hexes',
    description: 'Terrain of hexes: type, level, terrain effects modifier (TEM), walls/hedges and who is there. Give hex ids, or "around" with a radius (max 2).',
    parameters: obj({ hexes: strs('Hex ids, up to 20.'), around: str('Centre hex id.'), radius: { type: 'number', description: '1 or 2.' } }),
  },
  { name: 'check_los', description: 'Line of sight between two hexes, with the obstruction if blocked.', parameters: obj({ from: str('Hex id.'), to: str('Hex id.') }, ['from', 'to']) },
  {
    name: 'preview_fire',
    description: 'Odds of an attack before making it: firepower, IFT column, modifiers, and the chance of each result per target unit. Does not fire.',
    parameters: obj({ firers: strs('Your firing unit ids.'), target: str('Target hex id.'), leader: str('Optional directing leader id.') }, ['firers', 'target']),
  },
  {
    name: 'preview_move',
    description: 'Movement cost of a path for a group, MF left after each step, and the chance a squad breaks under defensive fire at each hex. Does not move.',
    parameters: obj({ units: strs('Unit ids moving together.'), path: strs('Hexes to enter in order.') }, ['units', 'path']),
  },
  { name: 'list_options', description: "The scripted AI's suggestions for this phase: ranked attacks with expected results, and its recommended next order with reasons.", parameters: obj({}) },
  {
    name: 'submit_orders',
    description: 'Carry out orders in sequence. Each result comes back (dice and effects), or an error with the rule that refused it.',
    parameters: obj({ orders: { type: 'array', items: orderSchema(), description: 'Orders to carry out in order.' } }, ['orders']),
  },
  {
    name: 'set_standing_orders',
    description: "Rules for your Defensive Fire during the opponent's next Movement Phase. They replace earlier standing orders. The game fires for you when they apply.",
    parameters: obj({ orders: { type: 'array', items: standingOrderSchema() } }, ['orders']),
  },
  { name: 'notebook_write', description: 'Save a note (plans, enemy habits) to read in later turns. Keep it short.', parameters: obj({ text: str('The note.') }, ['text']) },
  { name: 'notebook_read', description: 'Read your notes from earlier turns.', parameters: obj({}) },
  {
    name: 'end_phase',
    description: 'Finish your part of this phase.',
    parameters: obj({ summary: str('One line: what you did this phase and why.'), radio: str('Optional short in-character radio message.') }, ['summary']),
  },
];

export interface ToolOutcome {
  readonly content: string;
  readonly isError?: boolean;
  /** end_phase was called and the phase ended. */
  readonly ended?: boolean;
  /** Orders that were carried out (ok) and refused, for repair counting. */
  readonly ordersOk?: number;
  readonly ordersFailed?: number;
}

function asStrings(x: unknown): string[] {
  return Array.isArray(x) ? x.map(String) : typeof x === 'string' && x ? [x] : [];
}

function hexesAround(ctx: Ctx, center: HexKey, radius: number): HexKey[] {
  const out = new Set<HexKey>([center]);
  let ring = [center];
  for (let r = 0; r < radius; r++) {
    const next: HexKey[] = [];
    for (const h of ring) {
      for (const d of DIRECTIONS) {
        const n = hexKey(neighbor(parseHexKey(h), d));
        if (ctx.map.hexes[n] && !out.has(n)) {
          out.add(n);
          next.push(n);
        }
      }
    }
    ring = next;
  }
  return [...out];
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

function previewFire(ctx: Ctx, s: GameState, side: string, input: Record<string, unknown>): ToolOutcome {
  const target = hexKeyOf(ctx, String(input.target ?? ''));
  if (!target) return { content: `unknown target hex "${String(input.target)}"`, isError: true };
  const ids = asStrings(input.firers).filter((id) => s.units[id]?.side === side);
  const firers = fireUnitsFor(ctx, s, ids);
  if (!firers.length) return { content: 'none of those units can fire now', isError: true };
  try {
    const an = analyzeFire(ctx, s, firers, target, input.leader ? String(input.leader) : undefined);
    const odds = fireOdds(ctx, s, an);
    const lines = [
      `${an.totalFp} FP → ${an.columnFp} column${an.leaderDrm ? `, leader DRM ${an.leaderDrm}` : ''}.`,
      ...odds.units.map((o) => `${o.unit} (${s.units[o.unit]?.side === side ? 'OWN UNIT' : 'enemy'}) in ${hexId(ctx, o.hex)}: DRM ${o.drm >= 0 ? '+' : ''}${o.drm}, KIA ${pct(o.kia)}, any effect ${pct(o.mc)}, broken or worse ${pct(o.breakOrWorse)}`),
      ...(odds.breakdown ? [`MG malfunction risk ${pct(odds.breakdown)}.`] : []),
    ];
    return { content: lines.join('\n') };
  } catch (e) {
    return { content: (e as Error).message, isError: true };
  }
}

function previewMove(ctx: Ctx, s: GameState, side: string, input: Record<string, unknown>): ToolOutcome {
  const ids = asStrings(input.units).filter((id) => s.units[id]?.side === side);
  if (!ids.length) return { content: 'no units of yours given', isError: true };
  const path = asStrings(input.path).map((id) => hexKeyOf(ctx, id));
  if (path.some((h) => !h)) return { content: 'unknown hex in path (use ids like A-X5)', isError: true };
  let at = s.units[ids[0]!]!.hex;
  let left = Math.min(...ids.map((id) => mfLeft(ctx, s, s.units[id]!)));
  const lines = [`Start ${hexId(ctx, at)} with ${left} MF (slowest unit).`];
  for (const h of path as HexKey[]) {
    if (range(at, h) !== 1) {
      lines.push(`${hexId(ctx, h)}: not adjacent to ${hexId(ctx, at)} — path must step hex by hex.`);
      break;
    }
    const c = moveCost(ctx, at, h);
    left -= c.mf;
    const e = exposureAt(ctx, s, side, h);
    lines.push(`${hexId(ctx, h)}: ${Number.isFinite(c.mf) ? `${c.mf} MF (${c.parts.join(', ')})` : 'impassable'}, ${left >= 0 ? `${left} MF left` : 'NOT ENOUGH MF'}; ${e.shooters ? `${e.shooters} enemy stacks see it, ${pct(e.pBreak)} chance a squad breaks there` : 'unseen by the enemy'}`);
    if (left < 0 || !Number.isFinite(c.mf)) break;
    at = h;
  }
  return { content: lines.join('\n') };
}

function listOptions(ctx: Ctx, s: GameState, side: string): ToolOutcome {
  const lines: string[] = [];
  if (s.phase === 'prepFire' || s.phase === 'defensiveFire' || s.phase === 'advancingFire') {
    const { options } = fireOptions(ctx, s, side);
    lines.push(options.length ? 'ATTACKS (best first; expected = enemy units broken or worse):' : 'No attacks possible.');
    for (const o of options.slice(0, 8)) lines.push(`  ${o.a.firers.map((f) => f.unit).join('+')} in ${hexId(ctx, o.from)} at ${hexId(ctx, o.target)}: ${o.an.totalFp} FP, expected ${o.score.toFixed(2)}`);
  }
  const d = decide(ctx, s);
  const order = actionToOrder(ctx, d.action);
  lines.push('', `SCRIPTED AI WOULD: ${order ? JSON.stringify(order) : 'end the phase'} — ${d.why.goal}`);
  for (const r of d.why.reasons.slice(0, 4)) lines.push(`  - ${r}`);
  return { content: lines.join('\n') };
}

/** Run one tool call. */
export function runTool(env: GameEnv, side: string, memory: AgentMemory, call: ToolCall): ToolOutcome {
  const ctx = env.ctx;
  const s = env.state();
  const input = (call.input && typeof call.input === 'object' ? call.input : {}) as Record<string, unknown>;
  switch (call.name) {
    case 'get_situation':
      return { content: situation(ctx, s, side) };
    case 'describe_hexes': {
      let hexes = asStrings(input.hexes)
        .map((id) => hexKeyOf(ctx, id))
        .filter((h): h is HexKey => !!h);
      if (input.around) {
        const c = hexKeyOf(ctx, String(input.around));
        if (!c) return { content: `unknown hex "${String(input.around)}"`, isError: true };
        hexes = [...hexes, ...hexesAround(ctx, c, Math.max(1, Math.min(2, Number(input.radius) || 1)))];
      }
      if (!hexes.length) return { content: 'give "hexes" or "around"', isError: true };
      return { content: describeHexes(ctx, s, [...new Set(hexes)].slice(0, 20), side) };
    }
    case 'check_los': {
      const a = hexKeyOf(ctx, String(input.from ?? ''));
      const b = hexKeyOf(ctx, String(input.to ?? ''));
      if (!a || !b) return { content: 'unknown hex', isError: true };
      const r = losFrom(ctx, a, b);
      const block = r.blockedBy ? `BLOCKED by ${r.blockedBy.kind} in ${hexId(ctx, r.blockedBy.hex)}: ${r.reason}` : 'CLEAR';
      const hind = r.hindrances.length ? `; hindrances: ${r.hindrances.map((h) => `${h.kind} in ${hexId(ctx, h.hex)}`).join(', ')}` : '';
      return { content: `${hexId(ctx, a)} → ${hexId(ctx, b)}, range ${range(a, b)}: ${block}${hind}` };
    }
    case 'preview_fire':
      return previewFire(ctx, s, side, input);
    case 'preview_move':
      return previewMove(ctx, s, side, input);
    case 'list_options':
      return listOptions(ctx, s, side);
    case 'submit_orders': {
      const orders = (Array.isArray(input.orders) ? input.orders : []) as Order[];
      if (!orders.length) return { content: 'no orders given', isError: true };
      const lines: string[] = [];
      let ok = 0;
      let failed = 0;
      orders.forEach((o, i) => {
        const r = executeOrder(env, side, o ?? ({} as Order));
        if (r.ok) ok++;
        else failed++;
        lines.push(`${i + 1}. ${o?.type ?? '?'}: ${r.ok ? 'done' : 'REFUSED'} — ${r.text}`);
      });
      if (env.state().awaiting !== side) lines.push('(The phase has moved on; you have nothing more to do now.)');
      return { content: lines.join('\n'), isError: ok === 0, ordersOk: ok, ordersFailed: failed };
    }
    case 'set_standing_orders': {
      const list = (Array.isArray(input.orders) ? input.orders : []).map((o) => normaliseOrder(o as Partial<StandingOrder>));
      memory.standing = list.slice(0, 6);
      return { content: `${memory.standing.length} standing order(s) set for your next Defensive Fire.` };
    }
    case 'notebook_write': {
      const text = String(input.text ?? '').slice(0, 600);
      if (text) memory.notebook.push(`Turn ${s.turn} ${s.phase}: ${text}`);
      memory.notebook = memory.notebook.slice(-12);
      return { content: 'noted' };
    }
    case 'notebook_read':
      return { content: memory.notebook.length ? memory.notebook.join('\n') : '(empty)' };
    case 'end_phase': {
      if (input.radio) memory.radio.push(String(input.radio).slice(0, 240));
      if (s.awaiting !== side) return { content: 'Phase already over.', ended: true };
      const r = env.apply({ type: 'endPhase' }, { goal: String(input.summary ?? 'End of phase').slice(0, 200) || 'End of phase', reasons: [], weight: 'routine' });
      if (!r.ok) return { content: `Cannot end the phase yet: ${r.error}`, isError: true };
      return { content: 'Phase ended.', ended: true };
    }
    default:
      return { content: `unknown tool ${call.name}`, isError: true };
  }
}

/** Centre of a hex in map units (for previews that need geometry). */
export const hexCentre = (h: HexKey) => hexToPixel(parseHexKey(h));
