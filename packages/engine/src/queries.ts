import { DIRECTIONS, directionTo, hexDistance, hexKey, hexsideKey, neighbor, parseHexKey, type HexKey } from '@squadwar/hex';
import type { Ctx } from './ctx';
import type { LeaderType, SquadType, UnitType, WeaponType } from './data';
import type { GameState, SideId, Unit, Weapon } from './types';

export function unitType(ctx: Ctx, u: Unit): UnitType {
  const t = ctx.data.units[u.type];
  if (!t) throw new Error(`unknown unit type ${u.type}`);
  return t;
}

export function weaponType(ctx: Ctx, w: Weapon): WeaponType {
  const t = ctx.data.weapons[w.type];
  if (!t) throw new Error(`unknown weapon type ${w.type}`);
  return t;
}

export function isLeader(ctx: Ctx, u: Unit): boolean {
  return unitType(ctx, u).kind === 'leader';
}

export function squadType(ctx: Ctx, u: Unit): SquadType | undefined {
  const t = unitType(ctx, u);
  return t.kind === 'leader' ? undefined : t;
}

export function leaderType(ctx: Ctx, u: Unit): LeaderType | undefined {
  const t = unitType(ctx, u);
  return t.kind === 'leader' ? t : undefined;
}

export function otherSide(s: GameState, side: SideId): SideId {
  return s.sides[0].id === side ? s.sides[1].id : s.sides[0].id;
}

export function unitsIn(s: GameState, hex: HexKey): Unit[] {
  return Object.values(s.units).filter((u) => u.hex === hex);
}

export function sideUnitsIn(s: GameState, hex: HexKey, side: SideId): Unit[] {
  return unitsIn(s, hex).filter((u) => u.side === side);
}

export function enemiesIn(s: GameState, hex: HexKey, side: SideId): Unit[] {
  return unitsIn(s, hex).filter((u) => u.side !== side);
}

export function weaponsIn(s: GameState, hex: HexKey): Weapon[] {
  return Object.values(s.weapons).filter((w) => w.hex === hex);
}

export function carried(s: GameState, u: Unit): Weapon[] {
  return u.weapons.map((id) => s.weapons[id]!).filter(Boolean);
}

/** A hex holding units of both sides is in melee (§20.8). */
export function inMelee(s: GameState, hex: HexKey): boolean {
  const sides = new Set(unitsIn(s, hex).map((u) => u.side));
  return sides.size > 1;
}

export function adjacentEnemy(s: GameState, hex: HexKey, side: SideId): boolean {
  const h = parseHexKey(hex);
  for (const d of DIRECTIONS) {
    const n = hexKey(neighbor(h, d));
    if (enemiesIn(s, n, side).length) return true;
  }
  return false;
}

export function range(a: HexKey, b: HexKey): number {
  return hexDistance(parseHexKey(a), parseHexKey(b));
}

/** Portage points a unit carries (squad or leader values, §5.7). */
export function portageOf(ctx: Ctx, s: GameState, u: Unit): number {
  const leader = isLeader(ctx, u);
  let pp = 0;
  for (const w of carried(s, u)) {
    const t = weaponType(ctx, w);
    pp += leader ? (t.leaderPortage ?? 99) : t.portage;
  }
  return pp;
}

/** Best (lowest) leadership DRM among unbroken friendly leaders in the hex, excluding one unit (§15.6, §15.7). */
export function leaderDrmFor(ctx: Ctx, s: GameState, hex: HexKey, side: SideId, exclude?: string): { drm: number; leader?: Unit } {
  let best: { drm: number; leader?: Unit } = { drm: 0 };
  for (const u of sideUnitsIn(s, hex, side)) {
    if (u.id === exclude || u.broken) continue;
    const lt = leaderType(ctx, u);
    if (!lt) continue;
    if (best.leader === undefined || lt.leadership < best.drm) best = { drm: lt.leadership, leader: u };
  }
  return best;
}

export function stackingProblem(ctx: Ctx, s: GameState, hex: HexKey, side: SideId): string | undefined {
  // Riders count against the vehicle, not the hex (§29.2, §31.1).
  const units = sideUnitsIn(s, hex, side).filter((u) => !u.riding);
  const t = ctx.data.tables.stacking;
  const squads = units.filter((u) => !isLeader(ctx, u)).length;
  if (units.length > t.units) return `more than ${t.units} units`;
  if (squads > t.squads) return `more than ${t.squads} squads`;
  // Only weapons the side carries count; abandoned weapons belong to nobody.
  const pp = weaponsIn(s, hex)
    .filter((w) => w.owner !== null && s.units[w.owner]?.side === side)
    .reduce((a, w) => a + weaponType(ctx, w).portage, 0);
  if (pp > t.portage) return `more than ${t.portage} portage points of weapons`;
  return undefined;
}

export function isOpenGround(ctx: Ctx, hex: HexKey): boolean {
  const h = ctx.map.hexes[hex];
  return !!h && h.terrain === 'open';
}

export function isCover(ctx: Ctx, hex: HexKey): boolean {
  const t = ctx.map.hexes[hex]?.terrain;
  return t === 'woods' || t === 'woodBuilding' || t === 'stoneBuilding';
}

export interface MfCost {
  readonly mf: number;
  readonly parts: readonly string[];
}

/** MF to move an infantry unit from `from` into adjacent `to` (§5.5, chart 5.5). Infinity if impassable. */
export function moveCost(ctx: Ctx, from: HexKey, to: HexKey): MfCost {
  const a = ctx.map.hexes[from];
  const b = ctx.map.hexes[to];
  if (!a || !b) return { mf: Infinity, parts: ['off the map'] };
  const d = directionTo(a.hex, b.hex);
  if (d === undefined) return { mf: Infinity, parts: ['not adjacent'] };
  const side = ctx.map.hexsides[hexsideKey(a.hex, d)];
  const m = ctx.data.tables.movement;
  if (side?.cliff) return { mf: Infinity, parts: ['cliff hexside (§44.1)'] };
  if (b.terrain === 'water') return { mf: Infinity, parts: ['water'] };
  const parts: string[] = [];
  let cot: number;
  const roadSide = !!side?.road;
  if (b.terrain === 'woods') {
    cot = m.woods;
    parts.push(`woods ${m.woods}`);
  } else if (b.terrain === 'woodBuilding' || b.terrain === 'stoneBuilding') {
    cot = m.building;
    parts.push(`building ${m.building}`);
  } else if (b.terrain === 'wheat') {
    cot = m.wheat;
    parts.push(`wheatfield ${m.wheat}`);
  } else if (roadSide) {
    cot = m.road;
    parts.push(`road ½ (entered along the road, §5.52)`);
  } else {
    cot = m.open;
    parts.push(`open ground ${m.open}`);
  }
  if (b.level > a.level) {
    cot *= 2;
    parts.push('×2 uphill (§5.53)');
  }
  let mf = cot;
  if (side?.wall || side?.hedge) {
    mf += m.hexsideWallHedge;
    parts.push(`+${m.hexsideWallHedge} ${side.wall ? 'wall' : 'hedge'} hexside (§5.51)`);
  }
  return { mf, parts };
}

/** Terrain effects modifier of a hex for fire against its occupants (§11.1). */
export function hexTem(ctx: Ctx, hex: HexKey): { drm: number; label: string } {
  const h = ctx.map.hexes[hex];
  const t = ctx.data.tables.tem;
  if (!h) return { drm: 0, label: 'open' };
  switch (h.terrain) {
    case 'woods':
      return { drm: t.woods, label: 'woods' };
    case 'woodBuilding':
      return { drm: t.woodBuilding, label: 'wooden building' };
    case 'stoneBuilding':
      return { drm: t.stoneBuilding, label: 'stone building' };
    case 'wheat':
      return { drm: t.wheat, label: 'wheatfield' };
    default:
      return h.shellhole ? { drm: t.shellhole, label: 'shellholes' } : { drm: t.open, label: 'open ground' };
  }
}

export function unitLabel(ctx: Ctx, u: Unit): string {
  const t = unitType(ctx, u);
  if (t.kind === 'leader') return `${u.name ?? 'Leader'} ${leaderRating(t.morale, t.leadership)}${u.broken ? ' (broken)' : ''}`;
  return `${t.fp}-${t.range}-${t.morale}${u.broken ? ' (broken)' : ''}`;
}

export function hexLabel(ctx: Ctx, hex: HexKey): string {
  return ctx.map.hexes[hex]?.id ?? hex;
}

export function allUnits(s: GameState, side?: SideId): Unit[] {
  const all = Object.values(s.units);
  return side ? all.filter((u) => u.side === side) : all;
}

/** Leader rating as printed: morale then leadership with its sign, e.g. 8-1, 9-2, 7+1. */
export function leaderRating(morale: number, leadership: number): string {
  return leadership > 0 ? `${morale}+${leadership}` : `${morale}-${-leadership}`;
}
