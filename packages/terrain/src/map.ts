import {
  DIRECTIONS,
  DIRECTION_NAMES,
  hexKey,
  hexToPixel,
  hexsideKey,
  neighbor,
  oppositeDir,
  APOTHEM,
  type Direction,
  type Hex,
  type HexKey,
  type HexsideKey,
} from '@squadwar/hex';
import { BOARD_COLS, BOARD_ROWS, boardCells, cellToGlobal, isHalfCell, localId, parseLocalId, rotateCell } from './board';
import type { BoardDef, BoardHexside, BuildingStyle, HexTerrain, MapLayout } from './schema';

export interface MapHex {
  readonly key: HexKey;
  readonly hex: Hex;
  /** Display id, e.g. "A-K5". */
  readonly id: string;
  readonly board: string;
  readonly localId: string;
  readonly terrain: HexTerrain;
  readonly level: number;
  /** Global building id ("A:b3") for building hexes. */
  readonly building?: string;
  readonly shellhole: boolean;
  readonly sewer: boolean;
  readonly stairway: boolean;
  /** True when the hex is cut by the outer edge of the composed map. */
  readonly half: boolean;
}

export interface MapHexside {
  readonly key: HexsideKey;
  readonly wall?: boolean;
  readonly hedge?: boolean;
  readonly cliff?: boolean;
  readonly road?: 'paved' | 'dirt';
}

export interface Building {
  readonly id: string;
  readonly material: 'wood' | 'stone';
  readonly hexes: readonly HexKey[];
  /** Buildings of 3+ hexes are multi-story (§7.4). */
  readonly multiStory: boolean;
  /** Cosmetic style for drawing. */
  readonly style: BuildingStyle;
}

export interface BoardRect {
  readonly board: string;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface GameMap {
  readonly hexes: Readonly<Record<HexKey, MapHex>>;
  readonly hexsides: Readonly<Record<HexsideKey, MapHexside>>;
  readonly buildings: Readonly<Record<string, Building>>;
  /** Display id → hex key. */
  readonly byId: Readonly<Record<string, HexKey>>;
  readonly boards: readonly BoardRect[];
  readonly bounds: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
  readonly seed: number;
}

const DIR_BY_NAME: Record<string, Direction> = Object.fromEntries(
  DIRECTION_NAMES.map((n, i) => [n, i as Direction]),
);

/** Direction as seen after rotating the board 180°. */
function rotDir(d: Direction, rot: 0 | 180): Direction {
  return rot === 180 ? oppositeDir(d) : d;
}

/**
 * Compose boards into one map. Where edge half hexes of two boards meet, the
 * board listed first supplies the terrain and the display id.
 */
export function composeMap(layout: MapLayout, boards: Readonly<Record<string, BoardDef>>): GameMap {
  const hexes: Record<HexKey, MapHex> = {};
  const hexsides: Record<HexsideKey, MapHexside> = {};
  const buildingHexes: Record<string, { material: 'wood' | 'stone'; hexes: HexKey[]; style?: BuildingStyle }> = {};
  const byId: Record<string, HexKey> = {};
  const rects: BoardRect[] = [];
  let seed = 0;

  for (const place of layout) {
    const def = boards[place.board];
    if (!def) throw new Error(`unknown board ${place.board}`);
    const rot = place.rot ?? 0;
    seed = (seed * 31 + (def.seed ?? 1)) >>> 0;

    const x0 = 1.5 * place.x * (BOARD_COLS - 1);
    const y0 = -APOTHEM + place.y * BOARD_ROWS * 2 * APOTHEM;
    rects.push({ board: def.id, x0, y0, x1: x0 + 1.5 * (BOARD_COLS - 1), y1: y0 + BOARD_ROWS * 2 * APOTHEM });

    for (const cell of boardCells()) {
      const g = cellToGlobal(cell, place.x, place.y, rot);
      const k = hexKey(g);
      if (hexes[k]) continue; // earlier board wins on shared half hexes
      const lid = localId(cell);
      const src = def.hexes[lid] ?? {};
      const building = src.b ? `${def.id}:${src.b}` : undefined;
      const terrain = src.t ?? 'open';
      const id = `${def.id}-${lid}`;
      hexes[k] = {
        key: k,
        hex: g,
        id,
        board: def.id,
        localId: lid,
        terrain,
        level: src.lv ?? 0,
        ...(building ? { building } : {}),
        shellhole: !!src.sh,
        sewer: !!src.sw,
        stairway: !!src.st,
        half: isHalfCell(cell),
      };
      byId[id] = k;
      if (building) {
        const material = terrain === 'stoneBuilding' ? 'stone' : 'wood';
        const style = def.styles?.[src.b!];
        (buildingHexes[building] ??= { material, hexes: [], ...(style ? { style } : {}) }).hexes.push(k);
      }
    }

    for (const [sideId, side] of Object.entries(def.hexsides)) {
      const [lid, dname] = sideId.split('/') as [string, string];
      const cell = parseLocalId(lid);
      const g = cellToGlobal(cell, place.x, place.y, rot);
      const d = rotDir(DIR_BY_NAME[dname]!, rot);
      const key = hexsideKey(g, d);
      if (hexsides[key]) continue;
      hexsides[key] = { key, ...cleanSide(side) };
    }
  }

  // A hex is a half hex only if it lies on the outer edge of the composed map.
  for (const h of Object.values(hexes)) {
    if (!h.half) continue;
    const onEdge = DIRECTIONS.some((d) => !hexes[hexKey(neighbor(h.hex, d))]);
    if (!onEdge) (hexes as Record<HexKey, MapHex>)[h.key] = { ...h, half: false };
  }

  const buildings: Record<string, Building> = {};
  for (const [id, b] of Object.entries(buildingHexes)) {
    const style: BuildingStyle = b.style ?? (b.hexes.length <= 2 ? 'house' : b.material === 'wood' ? 'barn' : 'block');
    buildings[id] = { id, material: b.material, hexes: b.hexes, multiStory: b.hexes.length >= 3, style };
  }

  const bounds = {
    x0: Math.min(...rects.map((r) => r.x0)),
    y0: Math.min(...rects.map((r) => r.y0)),
    x1: Math.max(...rects.map((r) => r.x1)),
    y1: Math.max(...rects.map((r) => r.y1)),
  };
  return { hexes, hexsides, buildings, byId, boards: rects, bounds, seed };
}

function cleanSide(s: BoardHexside): Omit<MapHexside, 'key'> {
  const out: { wall?: boolean; hedge?: boolean; cliff?: boolean; road?: 'paved' | 'dirt' } = {};
  if (s.wall) out.wall = true;
  if (s.hedge) out.hedge = true;
  if (s.cliff) out.cliff = true;
  if (s.road) out.road = s.road;
  return out;
}

// ---- Queries --------------------------------------------------------------

export function mapHex(map: GameMap, h: Hex | HexKey): MapHex | undefined {
  return map.hexes[typeof h === 'string' ? h : hexKey(h)];
}

export function hexside(map: GameMap, h: Hex, d: Direction): MapHexside | undefined {
  return map.hexsides[hexsideKey(h, d)];
}

export function isBuilding(t: HexTerrain): boolean {
  return t === 'woodBuilding' || t === 'stoneBuilding';
}

/** Directions from h whose hexside carries a road. */
export function roadDirections(map: GameMap, h: Hex): Direction[] {
  return DIRECTIONS.filter((d) => !!map.hexsides[hexsideKey(h, d)]?.road);
}

export function hexCenter(h: Hex): { x: number; y: number } {
  return hexToPixel(h);
}

/** Parse a display id such as "A-K5" into a hex key. */
export function hexKeyFromId(map: GameMap, id: string): HexKey | undefined {
  return map.byId[id.toUpperCase()];
}

/** Local cell helpers re-exported for the editor. */
export { rotateCell };
