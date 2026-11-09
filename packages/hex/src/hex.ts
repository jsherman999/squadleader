/**
 * Flat-top hexagon math in axial coordinates (q, r).
 *
 * Pixel space uses the hex circumradius as the unit: a hex is 2 units wide
 * and √3 units tall; columns are 1.5 apart. y grows downwards (screen space).
 *
 * Directions run clockwise from north:
 *   0 N, 1 NE, 2 SE, 3 S, 4 SW, 5 NW
 * Hexside d of a hex is the edge shared with its neighbour in direction d.
 */

export interface Hex {
  readonly q: number;
  readonly r: number;
}

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** String form of a hex, usable as an object key: "q,r". */
export type HexKey = string;

/** Canonical key of a hexside shared by two hexes: "q,r:d" with d in 0..2. */
export type HexsideKey = string;

export type Direction = 0 | 1 | 2 | 3 | 4 | 5;

export const DIRECTIONS: readonly Direction[] = [0, 1, 2, 3, 4, 5];
export const DIRECTION_NAMES = ['N', 'NE', 'SE', 'S', 'SW', 'NW'] as const;

const DIR_VECTORS: readonly Hex[] = [
  { q: 0, r: -1 },
  { q: 1, r: -1 },
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
];

export const SQRT3 = Math.sqrt(3);
/** Distance from a hex centre to the middle of a hexside (unit circumradius). */
export const APOTHEM = SQRT3 / 2;

export function hex(q: number, r: number): Hex {
  return { q, r };
}

export function hexKey(h: Hex): HexKey {
  return `${h.q},${h.r}`;
}

export function parseHexKey(k: HexKey): Hex {
  const i = k.indexOf(',');
  return { q: Number(k.slice(0, i)), r: Number(k.slice(i + 1)) };
}

export function hexEquals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

export function hexAdd(a: Hex, b: Hex): Hex {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function hexSub(a: Hex, b: Hex): Hex {
  return { q: a.q - b.q, r: a.r - b.r };
}

export function dirVector(d: Direction): Hex {
  return DIR_VECTORS[d]!;
}

export function oppositeDir(d: Direction): Direction {
  return ((d + 3) % 6) as Direction;
}

export function neighbor(h: Hex, d: Direction): Hex {
  const v = DIR_VECTORS[d]!;
  return { q: h.q + v.q, r: h.r + v.r };
}

export function neighbors(h: Hex): Hex[] {
  return DIRECTIONS.map((d) => neighbor(h, d));
}

/** Direction from a to an adjacent hex b, or undefined if not adjacent. */
export function directionTo(a: Hex, b: Hex): Direction | undefined {
  const dq = b.q - a.q;
  const dr = b.r - a.r;
  for (const d of DIRECTIONS) {
    const v = DIR_VECTORS[d]!;
    if (v.q === dq && v.r === dr) return d;
  }
  return undefined;
}

/** Range in hexes (§2.3: least number of hexes, counting the target hex). */
export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

export function isAdjacent(a: Hex, b: Hex): boolean {
  return hexDistance(a, b) === 1;
}

/** All hexes within `radius` of `center` (inclusive). */
export function hexesInRange(center: Hex, radius: number): Hex[] {
  const out: Hex[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    const lo = Math.max(-radius, -dq - radius);
    const hi = Math.min(radius, -dq + radius);
    for (let dr = lo; dr <= hi; dr++) out.push({ q: center.q + dq, r: center.r + dr });
  }
  return out;
}

// ---- Pixel space --------------------------------------------------------

export function hexToPixel(h: Hex): Vec2 {
  return { x: 1.5 * h.q, y: SQRT3 * (h.r + h.q / 2) };
}

export function hexRound(fq: number, fr: number): Hex {
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q: q + 0, r: r + 0 };
}

export function pixelToHex(p: Vec2): Hex {
  const q = (2 / 3) * p.x;
  const r = (-1 / 3) * p.x + (SQRT3 / 3) * p.y;
  return hexRound(q, r);
}

/** Corner i of a hex, i in 0..5, starting east and going clockwise (y down). */
export function hexCorner(h: Hex, i: number): Vec2 {
  const c = hexToPixel(h);
  const a = (Math.PI / 3) * i;
  return { x: c.x + Math.cos(a), y: c.y + Math.sin(a) };
}

export function hexCorners(h: Hex): Vec2[] {
  return [0, 1, 2, 3, 4, 5].map((i) => hexCorner(h, i));
}

/** Endpoints of hexside d (corners (d+4)%6 and (d+5)%6). */
export function hexsideEndpoints(h: Hex, d: Direction): [Vec2, Vec2] {
  return [hexCorner(h, (d + 4) % 6), hexCorner(h, (d + 5) % 6)];
}

export function hexsideMidpoint(h: Hex, d: Direction): Vec2 {
  const [a, b] = hexsideEndpoints(h, d);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Canonical key for the hexside shared by h and its neighbour in direction d. */
export function hexsideKey(h: Hex, d: Direction): HexsideKey {
  if (d < 3) return `${h.q},${h.r}:${d}`;
  const n = neighbor(h, d);
  return `${n.q},${n.r}:${d - 3}`;
}

/** Both hexes adjoining a hexside, with the direction from each to the other. */
export function hexsideHexes(k: HexsideKey): { a: Hex; da: Direction; b: Hex; db: Direction } {
  const [hk, ds] = k.split(':') as [string, string];
  const a = parseHexKey(hk);
  const da = Number(ds) as Direction;
  return { a, da, b: neighbor(a, da), db: oppositeDir(da) };
}

// ---- Offset coordinates (even-q: even columns sit half a hex lower) ----

export interface Offset {
  readonly col: number;
  readonly row: number;
}

export function hexToOffset(h: Hex): Offset {
  return { col: h.q, row: h.r + (h.q + (h.q & 1)) / 2 };
}

export function offsetToHex(o: Offset): Hex {
  return { q: o.col, r: o.row - (o.col + (o.col & 1)) / 2 };
}
