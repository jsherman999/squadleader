/**
 * Terrain symbol geometry, generated deterministically from hex attributes.
 *
 * Line of sight in the rules is blocked by the woods or building *symbol*,
 * not the whole hex (§7.2). Symbols are therefore real shapes:
 *  - Woods fill most of the hex with an irregular outline, and run right up to
 *    any hexside shared with another woods hex so forests are continuous.
 *  - Buildings get styled footprints (houses facing their street, wings,
 *    factory halls, churches) clipped into their hexes, inset from hexsides
 *    that face other terrain.
 * Symbols never touch a hexside unless the same obstacle continues across it,
 * so an LOS traced along a hexside is blocked only when the obstacle lies on
 * both sides of it (§7.1).
 */
import {
  APOTHEM,
  DIRECTIONS,
  clipConvex,
  clipHalfPlane,
  hashString,
  hexCorner,
  hexKey,
  hexToPixel,
  hexsideMidpoint,
  mulberry32,
  neighbor,
  polygonArea,
  rotatedRect,
  vLerp,
  type Direction,
  type HexKey,
  type Polygon,
  type Vec2,
} from '@squadwar/hex';
import { roadDirections, type Building, type GameMap, type MapHex } from './map';
import type { BuildingStyle } from './schema';

export type SymbolKind = 'woods' | 'building';

export interface TerrainSymbol {
  readonly kind: SymbolKind;
  /** Hex the symbol belongs to (symbols never extend past their own hex). */
  readonly hex: HexKey;
  readonly building?: string;
  readonly polygon: Polygon;
}

/** A rectangle of a building's footprint, kept for drawing roofs. */
export interface BuildingRect {
  readonly kind: 'main' | 'annex' | 'hall' | 'tower' | 'nave' | 'transept';
  readonly c: Vec2;
  readonly theta: number;
  readonly a: number;
  readonly b: number;
}

export interface BuildingShape {
  readonly id: string;
  readonly style: BuildingStyle;
  readonly rects: readonly BuildingRect[];
  /** Footprint pieces (convex), each inside one hex. */
  readonly pieces: readonly TerrainSymbol[];
  /** Small colour variation, -1..1. */
  readonly tint: number;
  /** Chimney position for factories. */
  readonly chimney?: Vec2;
}

export interface MapGeometry {
  readonly symbols: readonly TerrainSymbol[];
  readonly byHex: Readonly<Record<HexKey, readonly TerrainSymbol[]>>;
  readonly buildings: Readonly<Record<string, BuildingShape>>;
}

const cache = new WeakMap<GameMap, MapGeometry>();

export function mapGeometry(map: GameMap): MapGeometry {
  let g = cache.get(map);
  if (!g) {
    g = buildGeometry(map);
    cache.set(map, g);
  }
  return g;
}

function buildGeometry(map: GameMap): MapGeometry {
  const symbols: TerrainSymbol[] = [];
  const byHex: Record<HexKey, TerrainSymbol[]> = {};
  const push = (s: TerrainSymbol) => {
    symbols.push(s);
    (byHex[s.hex] ??= []).push(s);
  };
  for (const h of Object.values(map.hexes)) {
    if (h.terrain === 'woods') push({ kind: 'woods', hex: h.key, polygon: woodsPolygon(map, h) });
  }
  const buildings: Record<string, BuildingShape> = {};
  for (const b of Object.values(map.buildings)) {
    const shape = buildingShape(map, b);
    buildings[b.id] = shape;
    shape.pieces.forEach(push);
  }
  return { symbols, byHex, buildings };
}

/** Smooth, seamless noise in map space (sum of sines), roughly -1..1. */
function noise(seed: number, x: number, y: number): number {
  const r = mulberry32(seed);
  const p1 = r() * 6.28;
  const p2 = r() * 6.28;
  const p3 = r() * 6.28;
  return 0.5 * Math.sin(1.7 * x + 0.9 * y + p1) + 0.3 * Math.sin(-1.3 * x + 2.3 * y + p2) + 0.2 * Math.sin(3.7 * x - 1.1 * y + p3);
}

/** Woods outline: full along woods–woods hexsides, organic and inset elsewhere. */
export function woodsPolygon(map: GameMap, h: MapHex): Vec2[] {
  const seed = map.seed * 7919 + 17;
  const c = hexToPixel(h.hex);
  const full = DIRECTIONS.map((d) => map.hexes[hexKey(neighbor(h.hex, d))]?.terrain === 'woods');
  const pull = (p: Vec2, f: number) => vLerp(c, p, f);
  const pts: Vec2[] = [];
  for (const d of DIRECTIONS) {
    const prev = ((d + 5) % 6) as Direction;
    const start = hexCorner(h.hex, (d + 4) % 6);
    const end = hexCorner(h.hex, (d + 5) % 6);
    const cornerFull = full[d] || full[prev];
    pts.push(cornerFull ? start : pull(start, 0.74 + 0.1 * noise(seed, start.x, start.y)));
    if (!full[d]) {
      const nextFull = full[(d + 1) % 6];
      const steps = [1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6];
      for (const t of steps) {
        const p = vLerp(start, end, t);
        const n = noise(seed, p.x * 1.6, p.y * 1.6);
        let f = 0.8 + 0.11 * n;
        // Blend towards the hexside where the forest continues round a corner.
        if (cornerFull && t < 0.5) f = f + (1 - f) * (1 - t * 2) ** 2;
        if (nextFull && t > 0.5) f = f + (1 - f) * ((t - 0.5) * 2) ** 2;
        pts.push(pull(p, Math.min(0.97, f)));
      }
    }
  }
  return pts;
}

// ---- Buildings -----------------------------------------------------------------

/** Inset from hexsides that face a different building or open ground. */
const BUILDING_INSET = 0.1;

/** The convex area inside a building hex where its footprint may lie. */
function buildingCell(map: GameMap, h: MapHex, rnd: () => number): Vec2[] {
  const c = hexToPixel(h.hex);
  let poly: Vec2[] = DIRECTIONS.map((_, i) => hexCorner(h.hex, i));
  for (const d of DIRECTIONS) {
    const n = map.hexes[hexKey(neighbor(h.hex, d))];
    if (n && n.building === h.building) continue;
    const mid = hexsideMidpoint(h.hex, d);
    const inward = { x: (c.x - mid.x) / APOTHEM, y: (c.y - mid.y) / APOTHEM };
    const inset = BUILDING_INSET + rnd() * 0.05;
    poly = clipHalfPlane(poly, { x: mid.x + inward.x * inset, y: mid.y + inward.y * inset }, inward);
  }
  return poly;
}

function isRoadHex(map: GameMap, h: MapHex): boolean {
  return roadDirections(map, h.hex).length > 0;
}

/** Long-axis angle: parallel to the street the building fronts, else its own long axis. */
function orientation(map: GameMap, b: Building, rnd: () => number): { theta: number; front?: Vec2 } {
  for (const hk of b.hexes.length === 1 ? b.hexes : []) {
    const h = map.hexes[hk]!;
    for (const d of DIRECTIONS) {
      const n = map.hexes[hexKey(neighbor(h.hex, d))];
      if (n && isRoadHex(map, n)) {
        const c = hexToPixel(h.hex);
        const nc = hexToPixel(n.hex);
        const toRoad = Math.atan2(nc.y - c.y, nc.x - c.x);
        return { theta: toRoad + Math.PI / 2 + (rnd() - 0.5) * 0.12, front: { x: Math.cos(toRoad), y: Math.sin(toRoad) } };
      }
    }
  }
  if (b.hexes.length >= 2) {
    const pts = b.hexes.map((k) => hexToPixel(map.hexes[k]!.hex));
    const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const p of pts) {
      sxx += (p.x - mx) ** 2;
      syy += (p.y - my) ** 2;
      sxy += (p.x - mx) * (p.y - my);
    }
    return { theta: 0.5 * Math.atan2(2 * sxy, sxx - syy) + (rnd() - 0.5) * 0.1 };
  }
  return { theta: rnd() * Math.PI };
}

function buildingShape(map: GameMap, b: Building): BuildingShape {
  const rnd = mulberry32(hashString(`${map.seed}:${b.id}`));
  const { theta, front } = orientation(map, b, rnd);
  const u = { x: Math.cos(theta), y: Math.sin(theta) };
  const v = { x: -u.y, y: u.x };
  const centers = b.hexes.map((k) => hexToPixel(map.hexes[k]!.hex));
  const pu = centers.map((p) => p.x * u.x + p.y * u.y);
  const pv = centers.map((p) => p.x * v.x + p.y * v.y);
  const [u0, u1] = [Math.min(...pu), Math.max(...pu)];
  const [v0, v1] = [Math.min(...pv), Math.max(...pv)];
  const at = (su: number, sv: number): Vec2 => ({ x: u.x * su + v.x * sv, y: u.y * su + v.y * sv });
  const rects: BuildingRect[] = [];
  let chimney: Vec2 | undefined;
  const style = b.style;
  const jitter = (k: number) => (rnd() - 0.5) * k;

  if (b.hexes.length === 1) {
    // A house: main block shifted towards the street, sometimes with a rear wing.
    const c0 = centers[0]!;
    const shift = front ? 0.12 : 0;
    const c = { x: c0.x + (front?.x ?? 0) * shift + jitter(0.12), y: c0.y + (front?.y ?? 0) * shift + jitter(0.12) };
    const a = 0.5 + rnd() * 0.2;
    const bb = 0.32 + rnd() * 0.14;
    rects.push({ kind: 'main', c, theta, a, b: bb });
    if (rnd() < 0.55) {
      const side = rnd() < 0.5 ? -1 : 1;
      const back = front ? { x: -front.x, y: -front.y } : v;
      const wa = 0.17 + rnd() * 0.1;
      const wb = 0.13 + rnd() * 0.06;
      rects.push({
        kind: 'annex',
        c: { x: c.x + back.x * (bb + wa * 0.7) + u.x * side * (a - wb - 0.04), y: c.y + back.y * (bb + wa * 0.7) + u.y * side * (a - wb - 0.04) },
        theta: theta + Math.PI / 2,
        a: wa,
        b: wb,
      });
    }
  } else if (style === 'church') {
    const mid = at((u0 + u1) / 2, (v0 + v1) / 2);
    const len = (u1 - u0) / 2 + 0.55;
    rects.push({ kind: 'nave', c: mid, theta, a: len, b: 0.34 + rnd() * 0.06 });
    rects.push({ kind: 'transept', c: { x: mid.x + u.x * len * 0.25, y: mid.y + u.y * len * 0.25 }, theta: theta + Math.PI / 2, a: 0.62, b: 0.26 });
    rects.push({ kind: 'tower', c: { x: mid.x - u.x * (len - 0.22), y: mid.y - u.y * (len - 0.22) }, theta, a: 0.24, b: 0.24 });
  } else if (style === 'factory') {
    // Parallel sheds with saw-tooth roofs.
    const halfU = (u1 - u0) / 2 + 0.6;
    const span = v1 - v0 + 1.1;
    const n = Math.max(2, Math.round(span / 0.85));
    const w = span / n;
    for (let i = 0; i < n; i++) {
      const sv = v0 - 0.55 + w * (i + 0.5);
      const shorten = rnd() * 0.5;
      const su = (u0 + u1) / 2 + (rnd() < 0.5 ? -1 : 1) * shorten * 0.5;
      rects.push({ kind: 'hall', c: at(su, sv), theta, a: halfU - shorten * 0.5, b: w / 2 - 0.03 });
    }
    const corner = centers[Math.floor(rnd() * centers.length)]!;
    chimney = { x: corner.x + jitter(0.4), y: corner.y + jitter(0.4) };
  } else {
    // Rows of houses, barns, halls and blocks. Elongated groups get one long
    // block along their axis; compact or bent groups get a wing along each
    // pair of adjacent hexes, which reads as an L, T or courtyard building.
    const elongation = (u1 - u0 + 0.01) / (v1 - v0 + 0.01);
    const kind: BuildingRect['kind'] = style === 'hall' || style === 'barn' ? 'hall' : 'main';
    if (elongation > 2.2 || b.hexes.length === 2) {
      const mid = at((u0 + u1) / 2, (v0 + v1) / 2);
      rects.push({ kind, c: mid, theta, a: (u1 - u0) / 2 + 0.45 + rnd() * 0.12, b: (v1 - v0) / 2 + 0.38 + rnd() * 0.12 });
    } else {
      // Wings along a spanning tree of the hexes (no closed triangles).
      const set = new Set(b.hexes);
      const inTree = new Set([b.hexes[0]!]);
      const queue = [b.hexes[0]!];
      while (queue.length) {
        const hk = queue.shift()!;
        const h = map.hexes[hk]!;
        const c = hexToPixel(h.hex);
        for (const d of DIRECTIONS) {
          const nk = hexKey(neighbor(h.hex, d));
          if (!set.has(nk) || inTree.has(nk)) continue;
          inTree.add(nk);
          queue.push(nk);
          const nc = hexToPixel(map.hexes[nk]!.hex);
          const ang = Math.atan2(nc.y - c.y, nc.x - c.x);
          rects.push({ kind, c: { x: (c.x + nc.x) / 2, y: (c.y + nc.y) / 2 }, theta: ang, a: APOTHEM + 0.44, b: 0.42 + rnd() * 0.06 });
        }
      }
    }
    if (b.hexes.length <= 3 && rnd() < 0.4) {
      const mid = at((u0 + u1) / 2, (v0 + v1) / 2);
      const side = rnd() < 0.5 ? -1 : 1;
      const end = (u1 - u0) / 2 + 0.2;
      rects.push({
        kind: 'annex',
        c: { x: mid.x + v.x * side * 0.42 + u.x * end * (rnd() < 0.5 ? -1 : 1), y: mid.y + v.y * side * 0.42 + u.y * end * (rnd() < 0.5 ? -1 : 1) },
        theta: theta + Math.PI / 2,
        a: 0.22 + rnd() * 0.08,
        b: 0.17,
      });
    }
  }

  const pieces: TerrainSymbol[] = [];
  for (const hk of b.hexes) {
    const h = map.hexes[hk]!;
    const cell = buildingCell(map, h, rnd);
    for (const r of rects) {
      const piece = clipConvex(rotatedRect(r.c, r.theta, r.a, r.b), cell);
      if (piece.length >= 3 && Math.abs(polygonArea(piece)) > 0.01) pieces.push({ kind: 'building', hex: hk, building: b.id, polygon: piece });
    }
  }
  // Every building hex must hold some of the building (a minimal block at its centre).
  for (const hk of b.hexes) {
    if (pieces.some((p) => p.hex === hk)) continue;
    const h = map.hexes[hk]!;
    const piece = clipConvex(rotatedRect(hexToPixel(h.hex), theta, 0.45, 0.3), buildingCell(map, h, rnd));
    pieces.push({ kind: 'building', hex: hk, building: b.id, polygon: piece });
  }
  return { id: b.id, style, rects, pieces, tint: rnd() * 2 - 1, ...(chimney ? { chimney } : {}) };
}
