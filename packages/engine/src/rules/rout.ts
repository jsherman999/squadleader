/**
 * Rout (§13.2–13.47). Broken units not in woods or buildings, or adjacent to
 * an enemy, must rout to cover by the shortest legal route in MF:
 *  - never closer to an enemy unit that had LOS to them (§13.41, Q&A 13.41);
 *  - never into open ground in the LOS and normal range of an unbroken enemy,
 *    unless a wall or hedge on that hex shields it (§13.42);
 *  - ending in a woods or building hex not adjacent to an enemy, within
 *    stacking limits (§13.43–13.44, Q&A 13.44).
 * A unit that cannot reach any such hex is eliminated (§13.47).
 */
import { DIRECTIONS, hexKey, neighbor, parseHexKey, type HexKey } from '@squadwar/hex';
import type { Ctx } from '../ctx';
import { losFrom } from '../ctx';
import {
  adjacentEnemy,
  allUnits,
  carried,
  enemiesIn,
  hexLabel,
  isCover,
  isLeader,
  isOpenGround,
  moveCost,
  range,
  squadType,
  stackingProblem,
  unitLabel,
  weaponType,
} from '../queries';
import { RuleError, type GameState, type Unit } from '../types';
import { eliminate, type Emit } from './common';

export function mustRout(ctx: Ctx, s: GameState, u: Unit): boolean {
  if (!u.broken || u.routed) return false;
  return !isCover(ctx, u.hex) || adjacentEnemy(s, u.hex, u.side);
}

export interface RoutPlan {
  readonly dest: HexKey;
  readonly path: readonly HexKey[];
  /** Total MF to the destination (may exceed this phase's MF, §13.45). */
  readonly mf: number;
  /** Where the unit stops this phase. */
  readonly stop: HexKey;
  readonly stopPath: readonly HexKey[];
}

function normalRange(ctx: Ctx, s: GameState, e: Unit): number {
  const st = squadType(ctx, e);
  let r = st?.range ?? 0;
  for (const w of carried(s, e)) r = Math.max(r, weaponType(ctx, w).range);
  return r;
}

/** Legal rout plans for a unit, cheapest first. Empty means the unit cannot rout. */
export function routOptions(ctx: Ctx, s: GameState, u: Unit): RoutPlan[] {
  const enemies = allUnits(s).filter((e) => e.side !== u.side);
  const known = enemies.filter((e) => ctx.los(e.hex, u.hex).clear);
  const shooters = enemies.filter((e) => !e.broken && normalRange(ctx, s, e) > 0).map((e) => ({ hex: e.hex, r: normalRange(ctx, s, e) }));
  const mfMax = isLeader(ctx, u) ? ctx.data.tables.movement.leaderMF : ctx.data.tables.movement.squadMF;

  const exposed = new Map<HexKey, boolean>();
  const isExposed = (h: HexKey): boolean => {
    let v = exposed.get(h);
    if (v === undefined) {
      v =
        isOpenGround(ctx, h) &&
        shooters.some((e) => {
          if (range(e.hex, h) > e.r) return false;
          const l = losFrom(ctx, e.hex, h);
          return l.clear && !l.targetHexside;
        });
      exposed.set(h, v);
    }
    return v;
  };
  const goodDest = (h: HexKey) => {
    if (!isCover(ctx, h) || adjacentEnemy(s, h, u.side) || h === u.hex) return false;
    // Stacking with the routing unit added (Q&A 13.44).
    const prev = u.hex;
    u.hex = h;
    const bad = stackingProblem(ctx, s, h, u.side);
    u.hex = prev;
    return !bad;
  };

  const canStop = (h: HexKey) => {
    const prev = u.hex;
    u.hex = h;
    const bad = stackingProblem(ctx, s, h, u.side);
    u.hex = prev;
    return !bad;
  };

  // Dijkstra over MF.
  const dist = new Map<HexKey, number>([[u.hex, 0]]);
  const prevOf = new Map<HexKey, HexKey>();
  const open: HexKey[] = [u.hex];
  const done = new Set<HexKey>();
  while (open.length) {
    open.sort((a, b) => dist.get(a)! - dist.get(b)!);
    const cur = open.shift()!;
    if (done.has(cur)) continue;
    done.add(cur);
    const ch = parseHexKey(cur);
    for (const d of DIRECTIONS) {
      const nk = hexKey(neighbor(ch, d));
      if (!ctx.map.hexes[nk] || done.has(nk)) continue;
      if (enemiesIn(s, nk, u.side).length) continue;
      const cost = moveCost(ctx, cur, nk).mf;
      if (!Number.isFinite(cost)) continue;
      if (known.some((e) => range(nk, e.hex) < range(cur, e.hex))) continue; // §13.41
      if (isExposed(nk)) continue; // §13.42
      const nd = dist.get(cur)! + cost;
      if (nd < (dist.get(nk) ?? Infinity) - 1e-9) {
        dist.set(nk, nd);
        prevOf.set(nk, cur);
        open.push(nk);
      }
    }
  }
  const dests = [...dist.keys()].filter(goodDest).sort((a, b) => dist.get(a)! - dist.get(b)!);
  if (!dests.length) return [];
  const best = dist.get(dests[0]!)!;
  return dests
    .filter((d) => dist.get(d)! <= best + 1e-9)
    .map((dest) => {
      const path: HexKey[] = [];
      for (let h: HexKey | undefined = dest; h && h !== u.hex; h = prevOf.get(h)) path.unshift(h);
      // Stop where this phase's MF runs out (§13.45), at a hex we may stop in.
      let spent = 0;
      let stopIdx = -1;
      let from = u.hex;
      for (let i = 0; i < path.length; i++) {
        spent += moveCost(ctx, from, path[i]!).mf;
        if (spent > mfMax + 1e-9) break;
        // Only stop where stacking allows (Q&A 13.44); otherwise keep the last good hex.
        if (canStop(path[i]!)) stopIdx = i;
        from = path[i]!;
      }
      const stopPath = path.slice(0, stopIdx + 1);
      return { dest, path, mf: dist.get(dest)!, stop: stopPath[stopPath.length - 1] ?? u.hex, stopPath };
    });
}

/** Rout one unit, to a chosen destination or the first cheapest one. */
export function doRout(ctx: Ctx, s: GameState, unitId: string, to: HexKey | undefined, emit: Emit): void {
  const u = s.units[unitId];
  if (!u) throw new RuleError('Unknown unit');
  if (s.phase !== 'rout') throw new RuleError('Units rout only in the Rout Phase', '§4.6');
  if (u.side !== s.awaiting) throw new RuleError('Not your unit');
  if (!u.broken) throw new RuleError('Only broken units rout', '§13.4');
  if (u.routed) throw new RuleError(`${unitLabel(ctx, u)} has already routed this phase`);
  const plans = routOptions(ctx, s, u);
  if (!plans.length) {
    u.routed = true;
    eliminate(ctx, s, u, 'no legal rout route to cover (§13.47)', emit);
    return;
  }
  const plan = to ? plans.find((p) => p.dest === to || p.stop === to) : plans[0];
  if (!plan) throw new RuleError('That is not one of the shortest legal rout routes', '§13.43');
  const from = u.hex;
  u.hex = plan.stop;
  for (const w of carried(s, u)) w.hex = plan.stop;
  u.routed = true;
  emit({
    kind: 'rout',
    text: `${unitLabel(ctx, u)} routs ${hexLabel(ctx, from)} → ${hexLabel(ctx, plan.stop)}${plan.stop !== plan.dest ? ` (heading for ${hexLabel(ctx, plan.dest)}, §13.45)` : ''}`,
    side: u.side,
    units: [u.id],
    from,
    to: plan.stop,
    hexes: [from, ...plan.stopPath],
  });
}

/** Broken units of a side that still have to rout. */
export function pendingRouts(ctx: Ctx, s: GameState, side: string): Unit[] {
  return allUnits(s, side).filter((u) => mustRout(ctx, s, u));
}
