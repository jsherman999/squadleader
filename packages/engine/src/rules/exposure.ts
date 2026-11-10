/**
 * Defensive-fire exposure for planning (PLAN.md §7.3): how likely is a
 * squad that moves through a hex to break, if every enemy that can see it
 * fires? Counts infantry stacks (squads and their support weapons, with
 * their leader) and vehicles, guns and mortars (main gun HE and MGs). It
 * assumes the enemy's fire is fresh next phase. Off-board artillery, mines
 * and anything not in the state passed in (pass the viewer's fogged state
 * to leave out hidden units) are not counted.
 */
import { hexDistance, parseHexKey, type HexKey } from '@squadwar/hex';
import type { Ctx } from '../ctx';
import { carried, hexTem, isOpenGround, leaderType, squadType, weaponType } from '../queries';
import type { GameState, SideId } from '../types';
import { heEquivalent, hitChance, iftColumn, inArc, vehicleType } from './armor';
import { DICE2, iftLookup } from './fire';
import { smokeOnLine } from './special';
import { gunCrew } from './transport';
import { fireOnLine } from './western';

/** One attack the enemy could make on the hex. */
export interface Threat {
  /** Where the fire comes from. */
  readonly from: HexKey;
  /** The vehicle, gun or mortar firing; absent for an infantry stack. */
  readonly vehicle?: string;
  readonly weapon: 'smallArms' | 'gun' | 'mg';
  readonly fp: number;
  /** Main guns: the chance to hit before the firepower counts (§33.3). */
  readonly hit?: number;
  /** Chance this attack alone leaves a 7-morale squad broken or worse. */
  readonly p: number;
  /** The line of fire crosses smoke (§24.6). */
  readonly smoke?: boolean;
}

export interface Exposure {
  /** Chance a 7-morale squad there ends up broken or worse. */
  readonly pBreak: number;
  /** Enemy stacks and vehicles that can fire on the hex. */
  readonly shooters: number;
  /** Strongest single attack, in firepower. */
  readonly bestFp: number;
  /** Every attack counted, the most dangerous first. */
  readonly threats: readonly Threat[];
}

/** Chance one attack on an IFT column breaks or kills a 7-morale squad; smoke adds a die to the roll. */
function breakChance(ctx: Ctx, col: number, drm: number, smoke: boolean): number {
  if (col < 0) return 0;
  let p = 0;
  for (const extra of smoke ? [1, 2, 3, 4, 5, 6] : [0]) {
    for (const d of DICE2) {
      const res = iftLookup(ctx, col, d.total + drm + extra);
      if (res === 'KIA') p += d.p;
      else if (res !== '-') {
        const mc = res === 'M' ? 0 : (res as number);
        p += d.p * DICE2.filter((x) => x.total + mc > 7).reduce((a, x) => a + x.p, 0);
      }
    }
  }
  return smoke ? p / 6 : p;
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
  const tem = hexTem(ctx, hex).drm + (moving && isOpenGround(ctx, hex) ? ctx.data.tables.tem.movingInOpen : 0);
  const threats: Threat[] = [];
  const sees = (from: HexKey) => ctx.los(from, hex).clear && !fireOnLine(ctx, s, from, hex);
  for (const h of byHex.keys()) {
    const r = hexDistance(parseHexKey(h), target);
    if (r === 0 || !sees(h)) continue;
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
    const col = fp > 0 ? iftColumn(ctx, fp) : -1;
    if (col < 0) continue;
    const smoke = smokeOnLine(ctx, s, h, hex);
    threats.push({ from: h, weapon: 'smallArms', fp, p: breakChance(ctx, col, tem + (leaderOf.get(h) ?? 0), smoke), ...(smoke ? { smoke } : {}) });
  }
  // Vehicles, guns and mortars: main gun HE after a To Hit roll, and MGs (§33–34, §48, §63.2).
  const hitData = ctx.data.armor.toHit;
  const h0 = ctx.map.hexes[hex];
  for (const v of Object.values(s.vehicles)) {
    if (v.side === side || v.hidden) continue;
    const t = vehicleType(ctx, v);
    const r = hexDistance(parseHexKey(v.hex), target);
    if (r === 0 || !sees(v.hex)) continue;
    if (t.kind === 'gun' && !gunCrew(ctx, s, v)) continue;
    const smoke = smokeOnLine(ctx, s, v.hex, hex);
    const arc = t.kind === 'mortar' || inArc(v.hex, v.facing, hex);
    // Out of its arc a turret turns, and an SP gun or AT gun pivots unless it is immobilized (cases D, I).
    const canTurn = t.turret || !v.immobilized;
    let gunBears = false;
    if (t.gun && v.gun === 'ok' && (arc || canTurn) && h0) {
      const inRange = t.kind !== 'mortar' || (r >= (t.minRange ?? 10) && r <= (t.maxRange ?? 60));
      if (inRange) {
        const D = hitData.drm;
        let drm = moving ? D.moving! : 0;
        if (!arc) drm += t.turret ? D.outsideArc! : D.spgDefensivePivot!;
        if (t.lowVelocity && r > 12) drm += D.lowVelocity12!;
        else if (t.lowVelocity && r > 6) drm += D.lowVelocity6!;
        if (r === 1) drm += D.adjacent!;
        const row = h0.terrain === 'woodBuilding' || h0.terrain === 'stoneBuilding' || h0.shellhole ? 'infantryBuilding' : h0.terrain === 'woods' ? 'infantryWoods' : 'infantryOther';
        let band = hitData.bands.findIndex((b) => r <= b);
        if (band < 0) band = hitData.bands.length;
        const hitNumber = hitData.rows[row]![band]![t.nation === 'russian' ? 1 : 0]!;
        // Smoke adds a die to the To Hit roll: take the average over it.
        const hit = smoke ? [1, 2, 3, 4, 5, 6].reduce((a, x) => a + hitChance(hitNumber, drm + x), 0) / 6 : hitChance(hitNumber, drm);
        const fp = heEquivalent(ctx, t.gun) * (r <= 1 ? 2 : 1);
        const p = hit * breakChance(ctx, iftColumn(ctx, fp), tem, false);
        if (p > 0) {
          gunBears = true;
          threats.push({ from: v.hex, vehicle: v.id, weapon: 'gun', fp, hit, p, ...(smoke ? { smoke } : {}) });
        }
      }
    }
    if (v.mg === 'ok') {
      const mr = ctx.data.armor.mgRange;
      let fp = (arc || gunBears ? t.mgCA : 0) + t.mg360;
      if (r > mr * 2) fp = 0;
      else if (r > mr) fp /= 2;
      if (r <= 1) fp *= 2;
      const col = fp > 0 ? iftColumn(ctx, fp) : -1;
      if (col >= 0) threats.push({ from: v.hex, vehicle: v.id, weapon: 'mg', fp, p: breakChance(ctx, col, tem, smoke), ...(smoke ? { smoke } : {}) });
    }
  }
  threats.sort((a, b) => b.p - a.p);
  let survive = 1;
  for (const t of threats) survive *= 1 - t.p;
  return { pBreak: 1 - survive, shooters: new Set(threats.map((t) => t.vehicle ?? t.from)).size, bestFp: threats.reduce((a, t) => Math.max(a, t.fp), 0), threats };
}

/** Exposure for every hex on the map (danger map overlay). */
export function exposureMap(ctx: Ctx, s: GameState, side: SideId, moving = true): Map<HexKey, Exposure> {
  const out = new Map<HexKey, Exposure>();
  for (const k of Object.keys(ctx.map.hexes)) out.set(k, exposureAt(ctx, s, side, k, moving));
  return out;
}
