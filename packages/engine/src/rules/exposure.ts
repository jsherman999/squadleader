/**
 * Defensive-fire exposure for planning (PLAN.md §7.3): how likely is a
 * squad that moves through a hex to break, if every enemy stack that can
 * see it fires? Uses only what the moving side can see (no hidden units in
 * §1–21) and assumes the enemy's fire is fresh next phase.
 */
import { hexDistance, parseHexKey, type HexKey } from '@squadwar/hex';
import type { Ctx } from '../ctx';
import { carried, hexTem, isOpenGround, leaderType, squadType, weaponType } from '../queries';
import type { GameState, SideId } from '../types';
import { DICE2, iftLookup } from './fire';

export interface Exposure {
  /** Chance a 7-morale squad there ends up broken or worse. */
  readonly pBreak: number;
  /** Enemy stacks that can fire on the hex. */
  readonly shooters: number;
  /** Strongest single attack, in firepower. */
  readonly bestFp: number;
}

export function exposureAt(ctx: Ctx, s: GameState, side: SideId, hex: HexKey, moving = true): Exposure {
  const target = parseHexKey(hex);
  const byHex = new Map<HexKey, number>();
  const leaderOf = new Map<HexKey, number>();
  for (const u of Object.values(s.units)) {
    if (u.side === side || u.broken) continue;
    const lt = leaderType(ctx, u);
    if (lt) {
      leaderOf.set(u.hex, Math.min(leaderOf.get(u.hex) ?? 0, lt.leadership));
      continue;
    }
    byHex.set(u.hex, 0);
  }
  const cols = ctx.data.tables.ift.columns;
  const tem = hexTem(ctx, hex).drm + (moving && isOpenGround(ctx, hex) ? ctx.data.tables.tem.movingInOpen : 0);
  let survive = 1;
  let shooters = 0;
  let bestFp = 0;
  for (const h of byHex.keys()) {
    const r = hexDistance(parseHexKey(h), target);
    if (r === 0 || !ctx.los(h, hex).clear) continue;
    let fp = 0;
    for (const u of Object.values(s.units)) {
      if (u.hex !== h || u.side === side || u.broken) continue;
      const st = squadType(ctx, u);
      const add = (base: number, rng: number) => {
        if (r > rng * 2) return;
        fp += r === 1 ? base * 2 : r > rng ? base / 2 : base;
      };
      if (st) add(st.fp, st.range);
      for (const w of carried(s, u)) if (!w.malfunctioned) add(weaponType(ctx, w).fp, weaponType(ctx, w).range);
    }
    if (fp <= 0) continue;
    let col = -1;
    for (let i = 0; i < cols.length; i++) if (cols[i]! <= fp + 1e-9) col = i;
    if (col < 0) continue;
    shooters++;
    bestFp = Math.max(bestFp, fp);
    const drm = tem + (leaderOf.get(h) ?? 0);
    let p = 0;
    for (const d of DICE2) {
      const res = iftLookup(ctx, col, d.total + drm);
      if (res === 'KIA') p += d.p;
      else if (res !== '-') {
        const mc = res === 'M' ? 0 : (res as number);
        p += d.p * DICE2.filter((x) => x.total + mc > 7).reduce((a, x) => a + x.p, 0);
      }
    }
    survive *= 1 - p;
  }
  return { pBreak: 1 - survive, shooters, bestFp };
}

/** Exposure for every hex on the map (danger map overlay). */
export function exposureMap(ctx: Ctx, s: GameState, side: SideId, moving = true): Map<HexKey, Exposure> {
  const out = new Map<HexKey, Exposure>();
  for (const k of Object.keys(ctx.map.hexes)) out.set(k, exposureAt(ctx, s, side, k, moving));
  return out;
}
