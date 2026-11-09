/**
 * Author boards as ASCII art, then emit the canonical board JSON.
 *
 * Grid: 33 columns (A..GG) × 11 offset rows (k = 0..10). Row k=10 only exists
 * in odd columns. Legend:
 *   .  open ground          T  woods             o  open ground + shellholes
 *   =  open ground + road   y  wheatfield        ~  water
 *   a-z  wooden building (letter groups adjacent hexes into one building)
 *   A-Z  stone building
 *   1-3  open ground on hill level 1..3
 */
import { BOARD_COLS, localId, type BoardDef, type BoardHex, type BoardHexside } from '@squadwar/terrain';

type Cell = { c: number; k: number };
const DIR_NAMES = ['N', 'NE', 'SE', 'S', 'SW', 'NW'] as const;
type DirName = (typeof DIR_NAMES)[number];

function exists(cell: Cell): boolean {
  if (cell.c < 0 || cell.c >= BOARD_COLS) return false;
  const maxK = cell.c % 2 === 0 ? 9 : 10;
  return cell.k >= 0 && cell.k <= maxK;
}

/** Neighbour in offset space (even columns sit half a hex lower). */
export function neighborCell(cell: Cell, d: DirName): Cell {
  const { c, k } = cell;
  const even = c % 2 === 0;
  switch (d) {
    case 'N':
      return { c, k: k - 1 };
    case 'S':
      return { c, k: k + 1 };
    case 'NE':
      return { c: c + 1, k: even ? k : k - 1 };
    case 'SE':
      return { c: c + 1, k: even ? k + 1 : k };
    case 'NW':
      return { c: c - 1, k: even ? k : k - 1 };
    case 'SW':
      return { c: c - 1, k: even ? k + 1 : k };
  }
}

export interface RoadSpec {
  kind: 'paved' | 'dirt';
  /** Consecutive adjacent cells. */
  cells: Cell[];
  /** Continue off the board edge beyond the first/last cell. */
  offStart?: boolean;
  offEnd?: boolean;
}

export interface AsciiBoardSpec {
  id: string;
  name: string;
  kind: 'city' | 'country';
  seed: number;
  rows: string[];
  roadKind?: 'paved' | 'dirt';
  walls?: string[];
  hedges?: string[];
  cliffs?: string[];
  /** Optional elevation grid (11 rows × 33 chars, '0'–'3' or '.'), applied on top of any terrain. */
  levels?: string[];
  sewers?: string[];
  roads?: RoadSpec[];
  styles?: Record<string, 'house' | 'barn' | 'block' | 'factory' | 'church' | 'hall'>;
}

export function buildBoard(spec: AsciiBoardSpec): BoardDef {
  if (spec.rows.length !== 11) throw new Error(`${spec.id}: need 11 rows, got ${spec.rows.length}`);
  spec.rows.forEach((r, k) => {
    if (r.length !== BOARD_COLS) throw new Error(`${spec.id}: row ${k} has ${r.length} chars, need 33`);
  });
  const ch = (cell: Cell) => (exists(cell) ? spec.rows[cell.k]![cell.c]! : undefined);

  const hexes: Record<string, BoardHex> = {};
  const hexsides: Record<string, BoardHexside> = {};
  const buildingIds = new Map<string, string>();
  let nextBuilding = 1;

  // Flood-fill building letters into building ids.
  const assign = (start: Cell, letter: string) => {
    const id = `b${nextBuilding++}`;
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop()!;
      const key = `${cur.c},${cur.k}`;
      if (buildingIds.has(key) || ch(cur) !== letter) continue;
      buildingIds.set(key, id);
      for (const d of DIR_NAMES) stack.push(neighborCell(cur, d));
    }
  };

  for (let k = 0; k <= 10; k++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const cell = { c, k };
      if (!exists(cell)) continue;
      const x = ch(cell)!;
      const id = localId(cell);
      const h: BoardHex = {};
      if (x === 'T') h.t = 'woods';
      else if (x === 'y') h.t = 'wheat';
      else if (x === '~') h.t = 'water';
      else if (x === 'o') h.sh = true;
      else if (x >= '1' && x <= '3') h.lv = Number(x);
      else if (/[a-z]/.test(x) && x !== 'o' && x !== 'y') {
        if (!buildingIds.has(`${c},${k}`)) assign(cell, x);
        h.t = 'woodBuilding';
        h.b = buildingIds.get(`${c},${k}`)!;
      } else if (/[A-Z]/.test(x) && x !== 'T') {
        if (!buildingIds.has(`${c},${k}`)) assign(cell, x);
        h.t = 'stoneBuilding';
        h.b = buildingIds.get(`${c},${k}`)!;
      } else if (x !== '.' && x !== '=') throw new Error(`${spec.id}: unknown char '${x}' at ${id}`);
      const lv = spec.levels?.[k]?.[c];
      if (lv && lv >= '1' && lv <= '3') h.lv = Number(lv);
      if (Object.keys(h).length) hexes[id] = h;
    }
  }

  // Roads join '=' hexes in the same column or the same offset row, and run
  // off the board edge where a road hex sits on it.
  const isRoad = (cell: Cell) => ch(cell) === '=';
  const roadKind = spec.roadKind ?? 'paved';
  for (let k = 0; k <= 10; k++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const cell = { c, k };
      if (!exists(cell) || !isRoad(cell)) continue;
      for (const d of DIR_NAMES) {
        const n = neighborCell(cell, d);
        const sameLine = n.c === c || n.k === k;
        if (!sameLine) continue;
        if (exists(n) ? isRoad(n) : continuesOffBoard(cell, d)) {
          hexsides[`${localId(cell)}/${d}`] = { road: roadKind };
        }
      }
    }
  }
  function continuesOffBoard(cell: Cell, d: DirName): boolean {
    // A road on an edge hex runs straight through it off the map.
    const opp: Record<DirName, DirName> = { N: 'S', S: 'N', NE: 'SW', SW: 'NE', SE: 'NW', NW: 'SE' };
    const back = neighborCell(cell, opp[d]);
    if (exists(back) && isRoad(back)) return true;
    // Row roads: the zig-zag partner direction.
    const partner: Partial<Record<DirName, DirName[]>> = { NE: ['NW', 'SW'], SE: ['NW', 'SW'], NW: ['NE', 'SE'], SW: ['NE', 'SE'] };
    return (partner[d] ?? []).some((p) => {
      const b = neighborCell(cell, p);
      return exists(b) && isRoad(b) && b.k === cell.k;
    });
  }

  // Explicit road paths.
  for (const road of spec.roads ?? []) {
    const cells = road.cells;
    for (let i = 0; i < cells.length - 1; i++) {
      const a = cells[i]!;
      const b = cells[i + 1]!;
      const d = DIR_NAMES.find((dn) => {
        const n = neighborCell(a, dn);
        return n.c === b.c && n.k === b.k;
      });
      if (!d) throw new Error(`${spec.id}: road cells ${a.c},${a.k} and ${b.c},${b.k} are not adjacent`);
      if (ch(b) !== '.' && ch(b) !== 'o' && ch(b) !== '=') throw new Error(`${spec.id}: road runs into '${ch(b)}' at ${localId(b)}`);
      hexsides[`${localId(a)}/${d}`] = { road: road.kind };
    }
    const offDir = (from: Cell, to: Cell): DirName | undefined => {
      // Direction from `from` to `to`, continued once more.
      return DIR_NAMES.find((dn) => {
        const n = neighborCell(from, dn);
        return n.c === to.c && n.k === to.k;
      });
    };
    if (road.offEnd && cells.length > 1) {
      const d = offDir(cells[cells.length - 2]!, cells[cells.length - 1]!)!;
      const last = cells[cells.length - 1]!;
      const pick = [d, ...DIR_NAMES].find((dn) => !exists(neighborCell(last, dn)));
      if (pick) hexsides[`${localId(last)}/${pick}`] = { road: road.kind };
    }
    if (road.offStart && cells.length > 1) {
      const d = offDir(cells[1]!, cells[0]!)!;
      const first = cells[0]!;
      const pick = [d, ...DIR_NAMES].find((dn) => !exists(neighborCell(first, dn)));
      if (pick) hexsides[`${localId(first)}/${pick}`] = { road: road.kind };
    }
  }

  const addSides = (list: string[] | undefined, prop: 'wall' | 'hedge' | 'cliff') => {
    for (const s of list ?? []) {
      hexsides[s] = { ...(hexsides[s] ?? {}), [prop]: true };
    }
  };
  addSides(spec.walls, 'wall');
  addSides(spec.hedges, 'hedge');
  addSides(spec.cliffs, 'cliff');
  for (const s of spec.sewers ?? []) hexes[s] = { ...(hexes[s] ?? {}), sw: true };

  return {
    format: 'squadwar-board@1',
    id: spec.id,
    name: spec.name,
    kind: spec.kind,
    seed: spec.seed,
    hexes,
    hexsides,
    ...(spec.styles ? { styles: Object.fromEntries(Object.entries(spec.styles).map(([letterAt, st]) => [buildingAt(letterAt), st])) } : {}),
  };

  /** Resolve a style key "c,k" (any cell of the building) to its building id. */
  function buildingAt(key: string): string {
    const id = buildingIds.get(key);
    if (!id) throw new Error(`${spec.id}: no building at ${key}`);
    return id;
  }
}
