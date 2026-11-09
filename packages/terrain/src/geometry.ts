/**
 * Terrain symbol geometry, generated deterministically from hex attributes.
 *
 * Line of sight in the rules is blocked by the woods or building *symbol*,
 * not the whole hex (§7.2). Symbols are therefore real shapes:
 *  - Woods fill most of the hex with an irregular outline, and run right up to
 *    any hexside shared with another woods hex so forests are continuous.
 *  - Buildings are a rectangle in the hex centre plus a "bridge" towards each
 *    neighbouring hex of the same building.
 * Symbols never touch a hexside unless the same obstacle continues across it,
 * so an LOS traced along a hexside is blocked only when the obstacle lies on
 * both sides of it (§7.1).
 */
import {
  APOTHEM,
  DIRECTIONS,
  hashString,
  hexCorner,
  hexKey,
  hexToPixel,
  mulberry32,
  neighbor,
  vLerp,
  type Direction,
  type HexKey,
  type Polygon,
  type Vec2,
} from '@squadwar/hex';
import type { GameMap, MapHex } from './map';

export type SymbolKind = 'woods' | 'building';

export interface TerrainSymbol {
  readonly kind: SymbolKind;
  /** Hex the symbol belongs to (symbols never extend past their own hex). */
  readonly hex: HexKey;
  readonly building?: string;
  readonly polygon: Polygon;
}

export interface MapGeometry {
  readonly symbols: readonly TerrainSymbol[];
  readonly byHex: Readonly<Record<HexKey, readonly TerrainSymbol[]>>;
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
    else if (h.terrain === 'woodBuilding' || h.terrain === 'stoneBuilding') {
      for (const polygon of buildingPolygons(map, h)) {
        push({ kind: 'building', hex: h.key, building: h.building!, polygon });
      }
    }
  }
  return { symbols, byHex };
}

/** Woods outline: full along woods–woods hexsides, wavy and inset elsewhere. */
export function woodsPolygon(map: GameMap, h: MapHex): Vec2[] {
  const rnd = mulberry32(hashString(`${map.seed}:${h.key}:woods`));
  const c = hexToPixel(h.hex);
  const full = DIRECTIONS.map((d) => map.hexes[hexKey(neighbor(h.hex, d))]?.terrain === 'woods');
  const pull = (p: Vec2, f: number) => vLerp(c, p, f);
  const pts: Vec2[] = [];
  for (const d of DIRECTIONS) {
    const prev = ((d + 5) % 6) as Direction;
    const start = hexCorner(h.hex, (d + 4) % 6);
    const end = hexCorner(h.hex, (d + 5) % 6);
    const cornerFull = full[d] || full[prev];
    pts.push(cornerFull ? start : pull(start, 0.7 + rnd() * 0.08));
    if (!full[d]) {
      const nextFull = full[d] || full[(d + 1) % 6];
      for (const t of [0.25, 0.5, 0.75]) {
        const nearFullCorner = (t < 0.5 && cornerFull) || (t > 0.5 && nextFull);
        const f = nearFullCorner ? 0.86 + rnd() * 0.06 : 0.72 + rnd() * 0.12;
        pts.push(pull(vLerp(start, end, t), f));
      }
    }
  }
  return pts;
}

const CORE_W = 1.15;
const CORE_H = 0.95;
const BRIDGE_W = 0.95;

/** Building footprint: a centre rectangle plus bridges to same-building neighbours. */
export function buildingPolygons(map: GameMap, h: MapHex): Vec2[][] {
  const c = hexToPixel(h.hex);
  const out: Vec2[][] = [
    [
      { x: c.x - CORE_W / 2, y: c.y - CORE_H / 2 },
      { x: c.x + CORE_W / 2, y: c.y - CORE_H / 2 },
      { x: c.x + CORE_W / 2, y: c.y + CORE_H / 2 },
      { x: c.x - CORE_W / 2, y: c.y + CORE_H / 2 },
    ],
  ];
  for (const d of DIRECTIONS) {
    const n = map.hexes[hexKey(neighbor(h.hex, d))];
    if (!n || !h.building || n.building !== h.building) continue;
    const nc = hexToPixel(n.hex);
    const dir = { x: (nc.x - c.x) / (2 * APOTHEM), y: (nc.y - c.y) / (2 * APOTHEM) };
    const perp = { x: -dir.y * (BRIDGE_W / 2), y: dir.x * (BRIDGE_W / 2) };
    const mid = { x: (c.x + nc.x) / 2, y: (c.y + nc.y) / 2 };
    out.push([
      { x: c.x + perp.x, y: c.y + perp.y },
      { x: mid.x + perp.x, y: mid.y + perp.y },
      { x: mid.x - perp.x, y: mid.y - perp.y },
      { x: c.x - perp.x, y: c.y - perp.y },
    ]);
  }
  return out;
}
