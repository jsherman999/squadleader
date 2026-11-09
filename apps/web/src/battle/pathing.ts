import { DIRECTIONS, hexKey, neighbor, parseHexKey, type HexKey } from '@squadwar/hex';
import { enemiesIn, mfLeft, moveCost, vehicleStepCost, vehicleType, type Ctx, type GameState } from '@squadwar/engine';

export interface PathStep {
  readonly hex: HexKey;
  readonly mf: number;
  /** Cumulative MF after entering this hex. */
  readonly total: number;
}

/** Cheapest MF path for a group from its hex to `to`, within the group's MF left. */
export function groupPath(ctx: Ctx, s: GameState, units: readonly string[], to: HexKey): { path: PathStep[]; reachable: boolean } {
  const us = units.map((id) => s.units[id]).filter((u) => !!u);
  if (!us.length) return { path: [], reachable: false };
  const from = us[0]!.hex;
  const left = Math.min(...us.map((u) => mfLeft(ctx, s, u)));
  const side = us[0]!.side;
  const dist = new Map<HexKey, number>([[from, 0]]);
  const prev = new Map<HexKey, HexKey>();
  const open = [from];
  const done = new Set<HexKey>();
  while (open.length) {
    open.sort((a, b) => dist.get(a)! - dist.get(b)!);
    const cur = open.shift()!;
    if (done.has(cur)) continue;
    done.add(cur);
    if (cur === to) break;
    for (const d of DIRECTIONS) {
      const nk = hexKey(neighbor(parseHexKey(cur), d));
      if (!ctx.map.hexes[nk] || done.has(nk) || enemiesIn(s, nk, side).length) continue;
      const c = moveCost(ctx, cur, nk).mf;
      if (!Number.isFinite(c)) continue;
      const nd = dist.get(cur)! + c;
      if (nd < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nd);
        prev.set(nk, cur);
        open.push(nk);
      }
    }
  }
  if (!dist.has(to)) return { path: [], reachable: false };
  const hexes: HexKey[] = [];
  for (let h: HexKey | undefined = to; h && h !== from; h = prev.get(h)) hexes.unshift(h);
  let total = 0;
  let at = from;
  const path = hexes.map((h) => {
    const mf = moveCost(ctx, at, h).mf;
    total += mf;
    at = h;
    return { hex: h, mf, total };
  });
  return { path, reachable: total <= left + 1e-9 };
}

/** Cheapest MP path for a vehicle to `to` (facing changes on the way are free once it moves, §30.5). */
export function vehiclePath(ctx: Ctx, s: GameState, id: string, to: HexKey): { path: PathStep[]; reachable: boolean } {
  const v = s.vehicles[id];
  if (!v) return { path: [], reachable: false };
  const dist = new Map<HexKey, number>([[v.hex, 0]]);
  const prev = new Map<HexKey, HexKey>();
  const open = [v.hex];
  const done = new Set<HexKey>();
  const at = (h: HexKey, first: boolean) => ({ ...v, hex: h, moved: v.moved || !first });
  while (open.length) {
    open.sort((a, b) => dist.get(a)! - dist.get(b)!);
    const cur = open.shift()!;
    if (done.has(cur)) continue;
    done.add(cur);
    if (cur === to) break;
    for (const d of DIRECTIONS) {
      const nk = hexKey(neighbor(parseHexKey(cur), d));
      if (!ctx.map.hexes[nk] || done.has(nk)) continue;
      const c = vehicleStepCost(ctx, s, at(cur, cur === v.hex), nk).mp;
      if (!Number.isFinite(c)) continue;
      const nd = dist.get(cur)! + c;
      if (nd < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nd);
        prev.set(nk, cur);
        open.push(nk);
      }
    }
  }
  if (!dist.has(to) || to === v.hex) return { path: [], reachable: false };
  const hexes: HexKey[] = [];
  for (let h: HexKey | undefined = to; h && h !== v.hex; h = prev.get(h)) hexes.unshift(h);
  let total = v.mpSpent;
  let cur = v.hex;
  const path = hexes.map((h, i) => {
    const mf = vehicleStepCost(ctx, s, at(cur, i === 0), h).mp;
    total += mf;
    cur = h;
    return { hex: h, mf, total };
  });
  const allowance = vehicleType(ctx, v).mp;
  // One hex is always allowed (§30.3).
  return { path, reachable: total <= allowance + 1e-9 || (!v.moved && path.length === 1) };
}
