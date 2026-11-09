/**
 * Generates boards/*.json from the layouts below. Run: pnpm --filter @squadwar/content gen:boards
 * The JSON is the canonical format; these layouts are the authoring source.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mulberry32 } from '@squadwar/hex';
import { parseBoard, lintBoard, localId } from '@squadwar/terrain';
import { buildBoard, neighborCell, type AsciiBoardSpec, type RoadSpec } from './ascii-board';
import { route } from './road-route';

/** Local id of offset cell (c, k). */
const cell = (c: number, k: number) => localId({ c, k });
/** Local hexside id of offset cell (c, k) in direction d. */
const side = (c: number, k: number, d: 'N' | 'NE' | 'SE' | 'S' | 'SW' | 'NW') => `${cell(c, k)}/${d}`;

/** Hex distance between offset cells (even columns sit half a hex lower). */
function cellRange(a: [number, number], b: [number, number]): number {
  const cube = ([c, k]: [number, number]) => {
    const z = k - (c + (c & 1)) / 2;
    return [c, z, -c - z] as const;
  };
  const [ax, az, ay] = cube(a);
  const [bx, bz, by] = cube(b);
  return Math.max(Math.abs(ax - bx), Math.abs(az - bz), Math.abs(ay - by));
}

/**
 * Sewer entrances (§27): the given ones, plus a manhole every few hexes along
 * the paved streets, so a party can always reach another entrance within the
 * three hexes a sewer move allows.
 */
function manholes(roads: RoadSpec[], extra: [number, number][]): string[] {
  const at: [number, number][] = [...extra];
  for (const r of roads) {
    if (r.kind !== 'paved') continue;
    for (const x of r.cells) {
      const p: [number, number] = [x.c, x.k];
      if (at.every((q) => cellRange(p, q) >= 3)) at.push(p);
    }
  }
  // Bridge nearby groups (where streets meet) with one more manhole in a street.
  const streets = roads.flatMap((r) => r.cells.map((x): [number, number] => [x.c, x.k]));
  for (let added = true; added; ) {
    added = false;
    const group = at.map((_, i) => i);
    const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i]!)));
    at.forEach((p, i) => at.forEach((q, j) => j > i && cellRange(p, q) <= 3 && (group[find(i)] = find(j))));
    for (const x of streets) {
      const near = new Set(at.flatMap((q, i) => (cellRange(x, q) <= 3 ? [find(i)] : [])));
      if (near.size >= 2 && at.every((q) => cellRange(x, q) >= 2)) {
        at.push(x);
        added = true;
        break;
      }
    }
  }
  return at.map(([c, k]) => cell(c, k));
}

class Grid {
  rows: string[][] = Array.from({ length: 11 }, () => Array.from({ length: 33 }, () => '.'));
  fill(c0: number, c1: number, k0: number, k1: number, ch: string): this {
    for (let k = k0; k <= k1; k++) for (let c = c0; c <= c1; c++) this.rows[k]![c] = ch;
    return this;
  }
  set(c: number, k: number, ch: string): this {
    this.rows[k]![c] = ch;
    return this;
  }
  done(): string[] {
    return this.rows.map((r) => r.join(''));
  }
}

interface FabricOptions {
  /** Building letters that infill must not grow (landmarks). */
  landmarks: string[];
  minDensity: number;
  falloff: number;
  /** Chance of stone near the centre. */
  stone: number;
  infillRadius: number;
  /** Chance a free hex by a house becomes a garden or orchard. */
  gardens: number;
}

/**
 * Houses along the roads (denser and more often stone near the centre),
 * infill between them in the old core, and gardens with hedges behind.
 * Returns the garden hedges.
 */
function townFabric(
  g: Grid,
  isRoad: Set<string>,
  reserved: Set<string>,
  reserve: (cells: [number, number][]) => void,
  rnd: () => number,
  centre: { c: number; k: number },
  opts: FabricOptions,
  hedges: string[] = [],
): string[] {
  const { landmarks } = opts;
  // Street-front houses: denser and more often stone near the centre.
  // Letters free of legend meanings (T woods, o shellholes, y wheat).
  const letters = 'adeghjklmnruvwxz';
  let li = 0;
  const pickLetter = (cellAt: { c: number; k: number }): string => {
    const near = new Set(
      (['N', 'NE', 'SE', 'S', 'SW', 'NW'] as const).map((d) => {
        const n = neighborCell(cellAt, d);
        return (g.rows[n.k]?.[n.c] ?? '.').toLowerCase();
      }),
    );
    for (let i = 0; i < letters.length; i++) {
      const l = letters[(li + i) % letters.length]!;
      if (!near.has(l)) {
        li += i + 1;
        return l;
      }
    }
    return letters[li++ % letters.length]!;
  };
  const free = (c: number, k: number) =>
    c >= 0 && c < 33 && k >= 0 && k <= (c % 2 === 0 ? 9 : 10) && !reserved.has(`${c},${k}`) && g.rows[k]![c] === '.';
  const roadCells = [...isRoad].map((s) => s.split(',').map(Number) as [number, number]);
  roadCells.sort(() => rnd() - 0.5);
  for (const [rc, rk] of roadCells) {
    for (const d of ['N', 'NE', 'SE', 'S', 'SW', 'NW'] as const) {
      const n = neighborCell({ c: rc, k: rk }, d);
      if (!free(n.c, n.k)) continue;
      const dist = Math.hypot(n.c - centre.c, (n.k - centre.k) * 1.15);
      const density = Math.max(opts.minDensity, 0.98 - dist * opts.falloff);
      if (rnd() > density) continue;
      const stone = rnd() < Math.max(0.12, opts.stone - dist * 0.06);
      const letter = pickLetter(n);
      const ch = stone ? letter.toUpperCase() : letter;
      g.set(n.c, n.k, ch);
      reserve([[n.c, n.k]]);
      // Sometimes a terrace: a second hex along the same street.
      if (rnd() < 0.5) {
        for (const d2 of ['N', 'NE', 'SE', 'S', 'SW', 'NW'] as const) {
          const m = neighborCell(n, d2);
          const touchesRoad = (['N', 'NE', 'SE', 'S', 'SW', 'NW'] as const).some((d3) => {
            const r = neighborCell(m, d3);
            return isRoad.has(`${r.c},${r.k}`);
          });
          if (free(m.c, m.k) && touchesRoad) {
            g.set(m.c, m.k, ch);
            reserve([[m.c, m.k]]);
            break;
          }
        }
      }
    }
  }
  // Infill in the old town: a free hex wedged between buildings becomes part of a block.
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k <= 10; k++) {
      for (let c = 0; c < 33; c++) {
        if (!free(c, k)) continue;
        const dist = Math.hypot(c - centre.c, (k - centre.k) * 1.15);
        if (dist > opts.infillRadius) continue;
        const near = (['N', 'NE', 'SE', 'S', 'SW', 'NW'] as const)
          .map((d) => neighborCell({ c, k }, d))
          .map((n) => g.rows[n.k]?.[n.c] ?? '.')
          .filter((x) => /[a-zA-Z]/.test(x) && !['T', 'o', 'y', ...landmarks].includes(x));
        if (near.length >= 2 && rnd() < 0.55) {
          g.set(c, k, near[0]!);
          reserve([[c, k]]);
        }
      }
    }
  }
  // Gardens behind some houses: orchards with hedges.
  for (let k = 0; k <= 10; k++) {
    for (let c = 0; c < 33; c++) {
      if (!free(c, k)) continue;
      const nearHouse = (['N', 'NE', 'SE', 'S', 'SW', 'NW'] as const).some((d) => {
        const n = neighborCell({ c, k }, d);
        return /[a-z]/i.test(g.rows[n.k]?.[n.c] ?? '') && !['T', 'o'].includes(g.rows[n.k]?.[n.c] ?? '');
      });
      if (nearHouse && rnd() < opts.gardens) {
        g.set(c, k, 'T');
        reserve([[c, k]]);
      } else if (nearHouse && rnd() < 0.22) {
        const d = (['N', 'NE', 'SE', 'S', 'SW', 'NW'] as const)[Math.floor(rnd() * 6)]!;
        const n = neighborCell({ c, k }, d);
        if (!isRoad.has(`${n.c},${n.k}`)) hedges.push(side(c, k, d));
      }
    }
  }
  return hedges;
}

/**
 * City A: a district grown along old roads. Main street bends through a
 * market square with the church and town hall; lanes run out to a farm and
 * allotments; a walled factory sits at the north-east edge. Houses front the
 * streets with gardens behind, denser towards the centre.
 */
function cityA(): AsciiBoardSpec {
  const rnd = mulberry32(1942);
  const g = new Grid();
  const roads: RoadSpec[] = [
    { kind: 'paved', cells: route([0, 6], [5, 5], [9, 4], [12, 4], [17, 4], [21, 5], [25, 6], [32, 6]), offStart: true, offEnd: true },
    { kind: 'paved', cells: route([11, 0], [11, 2], [12, 4]), offStart: true },
    { kind: 'paved', cells: route([12, 4], [13, 6], [12, 8], [12, 9]), offEnd: true },
    { kind: 'paved', cells: route([17, 4], [20, 2], [22, 1], [22, 0]), offEnd: true },
    { kind: 'dirt', cells: route([25, 6], [26, 8], [27, 10]), offEnd: true },
    { kind: 'dirt', cells: route([5, 5], [4, 3], [3, 1], [3, 0]), offEnd: true },
    { kind: 'dirt', cells: route([12, 8], [8, 8], [6, 9]) },
  ];
  const isRoad = new Set(roads.flatMap((r) => r.cells.map((x) => `${x.c},${x.k}`)));
  const reserved = new Set<string>(isRoad);
  const reserve = (cells: [number, number][]) => cells.forEach(([c, k]) => reserved.add(`${c},${k}`));
  const put = (cells: [number, number][], ch: string) => {
    for (const [c, k] of cells) {
      if (isRoad.has(`${c},${k}`)) throw new Error(`City A: ${ch} on road at ${c},${k}`);
      g.set(c, k, ch);
    }
    reserve(cells);
  };

  // Market square (open), church with walled churchyard, town hall.
  reserve([[13, 2], [13, 3], [14, 2], [14, 3], [15, 2], [15, 3], [16, 3]]);
  put([[16, 1], [16, 2], [17, 2]], 'C');
  put([[17, 1], [18, 1], [18, 2]], 'T');
  put([[14, 5], [15, 5], [14, 6], [15, 6]], 'H');
  // Factory, its warehouse and the walled yard.
  put([[23, 0], [24, 0], [25, 0], [26, 0], [23, 1], [24, 1], [25, 1], [26, 1], [24, 2], [25, 2]], 'F');
  put([[28, 1], [28, 2]], 'W');
  reserve([[23, 2], [26, 2], [23, 3], [24, 3], [25, 3], [26, 3], [27, 1], [27, 2]]);
  // Woods: town edge north-west, park south-east, copse south-west.
  put([[0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [0, 2], [2, 1]], 'T');
  put([[28, 8], [29, 8], [29, 9], [30, 8], [30, 9], [31, 9], [29, 10], [31, 8]], 'T');
  put([[0, 8], [1, 9], [0, 9], [1, 10]], 'T');
  // Farm at the end of the lane: farmhouse, barn and orchard.
  put([[5, 9]], 'p');
  put([[6, 8], [7, 8]], 'b');
  put([[7, 10], [8, 9]], 'T');
  // Allotment sheds and the bombed lot.
  reserve([[18, 7], [19, 8], [20, 7], [21, 8], [18, 8], [20, 8], [19, 9], [21, 9]]);
  put([[19, 7]], 's');
  put([[21, 7]], 'q');
  for (const [c, k] of [[9, 6], [17, 6], [22, 3], [4, 7], [10, 2], [20, 5]] as [number, number][]) {
    if (!reserved.has(`${c},${k}`)) {
      g.set(c, k, 'o');
      reserve([[c, k]]);
    }
  }

  const hedges = townFabric(g, isRoad, reserved, reserve, rnd, { c: 14, k: 4 }, {
    landmarks: ['H', 'C', 'F', 'W', 'b', 'p', 's', 'q'],
    minDensity: 0.2,
    falloff: 0.05,
    stone: 0.7,
    infillRadius: 9,
    gardens: 0.16,
  });
  // Allotment hedges.
  hedges.push(side(18, 7, 'S'), side(19, 8, 'SE'), side(20, 7, 'S'), side(21, 8, 'N'), side(19, 9, 'N'));

  return {
    id: 'A',
    name: 'City A',
    kind: 'city',
    seed: 7,
    rows: g.done(),
    roads,
    walls: [
      // Churchyard.
      side(17, 1, 'N'),
      side(18, 1, 'N'),
      side(18, 1, 'NE'),
      side(18, 2, 'SE'),
      side(18, 2, 'S'),
      // Factory yard.
      side(23, 3, 'S'),
      side(24, 3, 'S'),
      side(25, 3, 'S'),
      side(26, 3, 'S'),
      side(26, 3, 'SE'),
      side(26, 2, 'NE'),
      side(23, 3, 'SW'),
    ],
    hedges,
    sewers: manholes(roads, [[11, 1], [13, 3], [17, 4], [25, 6]]),
    styles: { '16,1': 'church', '23,0': 'factory', '28,1': 'hall', '14,5': 'block', '6,8': 'barn' },
  };
}


/**
 * City B: an industrial district. A walled ironworks with a great hall,
 * a rolling mill, a boiler house and an office by the gate; a canal basin
 * with a dock lane; a workers' settlement of timber houses along crooked
 * lanes, with a stone school; a cemetery copse on the east edge. Five
 * sewer entrances (§27).
 */
function cityB(): AsciiBoardSpec {
  const rnd = mulberry32(1943);
  const g = new Grid();
  const roads: RoadSpec[] = [
    // Factory Street, bending along the works wall.
    { kind: 'paved', cells: route([0, 6], [6, 5], [12, 6], [17, 7], [24, 8], [32, 8]), offStart: true, offEnd: true },
    // Works road through the gate.
    { kind: 'paved', cells: route([16, 0], [16, 3], [17, 7]), offStart: true },
    // Settlement lanes.
    { kind: 'dirt', cells: route([6, 5], [5, 8], [3, 10]), offEnd: true },
    { kind: 'dirt', cells: route([6, 5], [9, 3], [10, 2], [11, 0]), offEnd: true },
    // Dock lane along the basin.
    { kind: 'dirt', cells: route([1, 2], [6, 2], [10, 2]) },
    // Lane past the cemetery.
    { kind: 'dirt', cells: route([24, 8], [28, 6], [32, 5]), offEnd: true },
  ];
  const isRoad = new Set(roads.flatMap((r) => r.cells.map((x) => `${x.c},${x.k}`)));
  const reserved = new Set<string>(isRoad);
  const reserve = (cells: [number, number][]) => cells.forEach(([c, k]) => reserved.add(`${c},${k}`));
  const put = (cells: [number, number][], ch: string) => {
    for (const [c, k] of cells) {
      if (isRoad.has(`${c},${k}`)) throw new Error(`City B: ${ch} on road at ${c},${k}`);
      g.set(c, k, ch);
    }
    reserve(cells);
  };

  // Canal basin.
  put([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [0, 1], [1, 1], [2, 1], [3, 1]], '~');
  // The ironworks: great hall, rolling mill, boiler house, office by the gate.
  put([[19, 2], [20, 2], [21, 2], [22, 2], [19, 3], [20, 3], [21, 3], [22, 3]], 'F');
  put([[24, 1], [25, 1], [24, 2], [25, 2], [24, 3], [25, 3], [26, 2]], 'I');
  put([[20, 5], [21, 5]], 'B');
  put([[18, 3], [18, 4]], 'P');
  // The works yard stays open, scarred by shelling.
  reserve([[18, 1], [18, 2], [19, 1], [20, 1], [21, 1], [22, 1], [23, 1], [23, 2], [23, 3], [19, 4], [20, 4], [21, 4], [22, 4], [23, 4], [24, 4], [25, 4], [26, 3], [26, 4], [27, 1], [27, 2], [27, 3], [27, 4], [19, 5], [22, 5], [23, 5], [24, 5], [25, 5], [26, 5], [27, 5], [19, 6], [20, 6], [21, 6], [22, 6], [23, 6], [24, 6], [25, 6], [26, 6], [27, 6], [26, 1]]);
  for (const [c, k] of [[23, 5], [26, 4], [19, 1], [22, 6]] as [number, number][]) g.set(c, k, 'o');
  // School on the settlement's main lane.
  put([[8, 7], [9, 7]], 'S');
  // Cemetery copse on the east edge, a birch strip by the north road.
  put([[29, 7], [30, 7], [31, 7], [29, 8], [31, 8], [28, 9], [30, 9], [32, 9], [29, 10], [31, 10]], 'T');
  put([[13, 0], [14, 0], [13, 1]], 'T');
  for (const [c, k] of [[11, 4], [3, 8], [14, 8], [26, 9]] as [number, number][]) {
    if (!reserved.has(`${c},${k}`)) {
      g.set(c, k, 'o');
      reserve([[c, k]]);
    }
  }

  // The settlement: timber houses along the lanes, a few stone ones near the school.
  const hedges = townFabric(g, isRoad, reserved, reserve, rnd, { c: 7, k: 5 }, {
    landmarks: ['F', 'I', 'B', 'P', 'S'],
    minDensity: 0.25,
    falloff: 0.06,
    stone: 0.25,
    infillRadius: 6,
    gardens: 0.2,
  });

  const wall = (cells: [number, number, 'N' | 'NE' | 'SE' | 'S' | 'SW' | 'NW'][]) => cells.map(([c, k, d]) => side(c, k, d));
  return {
    id: 'B',
    name: 'City B',
    kind: 'city',
    seed: 11,
    rows: g.done(),
    roads,
    walls: wall([
      // South wall of the works yard, with the gate at the works road.
      [19, 6, 'S'],
      [20, 6, 'S'],
      [21, 6, 'S'],
      [22, 6, 'S'],
      [23, 6, 'S'],
      [24, 6, 'S'],
      [25, 6, 'S'],
      [26, 6, 'S'],
      [27, 6, 'S'],
      // East wall.
      [27, 1, 'NE'],
      [27, 2, 'SE'],
      [27, 3, 'SE'],
      [27, 4, 'SE'],
      [27, 5, 'SE'],
      [27, 6, 'SE'],
      // North wall along the canal side.
      [19, 1, 'N'],
      [20, 1, 'N'],
      [21, 1, 'N'],
      [22, 1, 'N'],
      [23, 1, 'N'],
      [27, 1, 'N'],
    ]),
    hedges,
    // M9 and V10 link up with City A's manholes when B lies north of A.
    sewers: manholes(roads, [[5, 7], [12, 6], [16, 2], [23, 4], [26, 3], [28, 4], [12, 8], [21, 10]]),
    styles: { '19,2': 'factory', '24,1': 'factory', '20,5': 'block', '18,3': 'hall', '8,7': 'hall' },
  };
}


// ---- Countryside boards ---------------------------------------------------------------------

interface Blob {
  c: number;
  k: number;
  /** Radius in hexes; edges are roughened. */
  r: number;
}

interface Hill {
  c: number;
  k: number;
  /** Radius of level 1, 2, 3 ... around the summit. */
  radii: number[];
}

interface Village {
  c: number;
  k: number;
  landmarks: { cells: [number, number][]; ch: string; style?: 'house' | 'barn' | 'block' | 'factory' | 'church' | 'hall' }[];
  opts: FabricOptions;
}

interface CountrySpec {
  id: string;
  name: string;
  seed: number;
  roads: RoadSpec[];
  hills: Hill[];
  woods: Blob[];
  wheat: Blob[];
  villages: Village[];
  /** Hexsides that must be cliffs, besides every drop of two levels. */
  cliffs?: string[];
  walls?: string[];
  shellholes?: [number, number][];
  /** Chance a wheatfield edge gets a hedge. */
  fieldHedges: number;
}

const cellExists = (c: number, k: number) => c >= 0 && c < 33 && k >= 0 && k <= (c % 2 === 0 ? 9 : 10);

function countryBoard(spec: CountrySpec): AsciiBoardSpec {
  const rnd = mulberry32(spec.seed);
  const g = new Grid();
  const noise = (c: number, k: number, salt: number) => mulberry32(spec.seed * 7919 + c * 131 + k * 17 + salt * 1009)();
  const isRoad = new Set(spec.roads.flatMap((r) => r.cells.map((x) => `${x.c},${x.k}`)));
  const reserved = new Set<string>(isRoad);
  const reserve = (cells: [number, number][]) => cells.forEach(([c, k]) => reserved.add(`${c},${k}`));
  const styles: Record<string, 'house' | 'barn' | 'block' | 'factory' | 'church' | 'hall'> = {};
  const hedges: string[] = [];

  // Village landmarks first, then their houses along the roads.
  for (const v of spec.villages) {
    for (const l of v.landmarks) {
      // Roads win: a landmark loses any cell a road runs through.
      const cells = l.cells.filter(([c, k]) => !isRoad.has(`${c},${k}`));
      if (!cells.length) continue;
      for (const [c, k] of cells) g.set(c, k, l.ch);
      reserve(cells);
      if (l.style) styles[`${cells[0]![0]},${cells[0]![1]}`] = l.style;
    }
  }
  for (const v of spec.villages) hedges.push(...townFabric(g, isRoad, reserved, reserve, rnd, { c: v.c, k: v.k }, v.opts));

  const inBlob = (b: Blob, c: number, k: number, salt: number) => cellRange([b.c, b.k], [c, k]) <= b.r + (noise(c, k, salt) - 0.5) * 1.6;
  for (let k = 0; k <= 10; k++)
    for (let c = 0; c < 33; c++) {
      if (!cellExists(c, k) || reserved.has(`${c},${k}`)) continue;
      if (spec.woods.some((b) => inBlob(b, c, k, 1))) g.set(c, k, 'T');
      else if (spec.wheat.some((b) => inBlob(b, c, k, 2))) g.set(c, k, 'y');
    }
  for (const [c, k] of spec.shellholes ?? []) if (!reserved.has(`${c},${k}`) && g.rows[k]![c] === '.') g.set(c, k, 'o');

  // Elevation: nested, roughened rings around each summit.
  const levels = Array.from({ length: 11 }, () => Array.from({ length: 33 }, () => 0));
  for (let k = 0; k <= 10; k++)
    for (let c = 0; c < 33; c++) {
      if (!cellExists(c, k)) continue;
      for (const h of spec.hills) {
        const d = cellRange([h.c, h.k], [c, k]) + (noise(c, k, 3) - 0.5) * 1.2;
        const lv = h.radii.filter((r) => d <= r).length;
        levels[k]![c] = Math.max(levels[k]![c]!, lv);
      }
    }
  // A drop of two or more levels between neighbours is a cliff (§44.1).
  const cliffs = [...(spec.cliffs ?? [])];
  const dirs = ['N', 'NE', 'SE', 'S', 'SW', 'NW'] as const;
  for (let k = 0; k <= 10; k++)
    for (let c = 0; c < 33; c++) {
      if (!cellExists(c, k)) continue;
      for (const d of dirs) {
        const n = neighborCell({ c, k }, d);
        if (!cellExists(n.c, n.k)) continue;
        if (levels[k]![c]! - levels[n.k]![n.c]! >= 2) cliffs.push(side(c, k, d));
      }
    }
  // Hedges along some field edges.
  for (let k = 0; k <= 10; k++)
    for (let c = 0; c < 33; c++) {
      if (!cellExists(c, k) || g.rows[k]![c] !== 'y') continue;
      for (const d of ['N', 'NE', 'SE'] as const) {
        const n = neighborCell({ c, k }, d);
        if (!cellExists(n.c, n.k) || g.rows[n.k]![n.c] === 'y' || isRoad.has(`${n.c},${n.k}`)) continue;
        if (noise(c, k, 10 + dirs.indexOf(d)) < spec.fieldHedges) hedges.push(side(c, k, d));
      }
    }
  return {
    id: spec.id,
    name: spec.name,
    kind: 'country',
    seed: spec.seed,
    rows: g.done(),
    levels: levels.map((r) => r.join('')),
    roads: spec.roads,
    hedges: [...new Set(hedges)],
    ...(spec.walls ? { walls: spec.walls } : {}),
    cliffs: [...new Set(cliffs)],
    styles,
  };
}

const VILLAGE: FabricOptions = { landmarks: [], minDensity: 0, falloff: 0.2, stone: 0.15, infillRadius: 2, gardens: 0.12 };

/** Country 1: a kolkhoz on the slope of a long ridge, wheat in the valleys, a highway across. */
function country1(): AsciiBoardSpec {
  return countryBoard({
    id: 'C',
    name: 'Kolkhoz Ridge',
    seed: 4301,
    roads: [
      { kind: 'paved', cells: route([0, 6], [9, 6], [16, 5], [24, 6], [32, 6]), offStart: true, offEnd: true },
      { kind: 'dirt', cells: route([16, 5], [16, 8], [15, 10]), offEnd: true },
      { kind: 'dirt', cells: route([16, 5], [17, 2], [19, 0]), offEnd: true },
      { kind: 'dirt', cells: route([24, 6], [28, 9], [29, 10]), offEnd: true },
    ],
    hills: [
      { c: 7, k: 2, radii: [5, 2.6] },
      { c: 19, k: 1, radii: [5.5, 3, 1.2] },
      { c: 28, k: 2, radii: [3] },
    ],
    woods: [
      { c: 30, k: 1, r: 2 },
      { c: 2, k: 9, r: 1.8 },
      { c: 11, k: 1, r: 1.2 },
      { c: 23, k: 9, r: 1.3 },
    ],
    wheat: [
      { c: 5, k: 7, r: 2.6 },
      { c: 27, k: 4, r: 1.6 },
      { c: 10, k: 9, r: 1.6 },
      { c: 21, k: 8, r: 1.8 },
    ],
    villages: [
      {
        c: 16,
        k: 6,
        landmarks: [
          { cells: [[13, 6], [14, 6], [13, 7]], ch: 'K', style: 'barn' },
          { cells: [[18, 6], [18, 7]], ch: 'S', style: 'hall' },
          { cells: [[14, 4], [15, 4]], ch: 'M', style: 'factory' },
        ],
        opts: { ...VILLAGE, landmarks: ['K', 'S', 'M'] },
      },
    ],
    shellholes: [[9, 4], [20, 4], [25, 3], [12, 8], [4, 4], [29, 7]],
    fieldHedges: 0.45,
  });
}

/** Country 2: a rail halt at the foot of a three-level hill, fields and a wooded flank. */
function country2(): AsciiBoardSpec {
  return countryBoard({
    id: 'D',
    name: 'Station Hill',
    seed: 4307,
    roads: [
      { kind: 'paved', cells: route([0, 5], [7, 4], [12, 5], [18, 7], [32, 7]), offStart: true, offEnd: true },
      { kind: 'dirt', cells: route([12, 5], [12, 0]), offEnd: true },
      { kind: 'dirt', cells: route([18, 7], [22, 4], [24, 2], [26, 0]), offEnd: true },
      { kind: 'dirt', cells: route([7, 4], [6, 8], [5, 10]), offEnd: true },
    ],
    hills: [{ c: 24, k: 3, radii: [6.2, 4, 2] }],
    woods: [
      { c: 30, k: 3, r: 2.2 },
      { c: 1, k: 1, r: 1.6 },
      { c: 16, k: 1, r: 1.3 },
    ],
    wheat: [
      { c: 4, k: 7, r: 2.4 },
      { c: 15, k: 9, r: 2.4 },
      { c: 8, k: 1, r: 1.8 },
      { c: 27, k: 9, r: 1.8 },
    ],
    villages: [
      {
        c: 11,
        k: 5,
        landmarks: [
          { cells: [[9, 6], [10, 6], [11, 7]], ch: 'R', style: 'hall' },
          { cells: [[13, 4]], ch: 'W', style: 'block' },
          { cells: [[8, 3], [9, 3]], ch: 'G', style: 'factory' },
        ],
        opts: { ...VILLAGE, landmarks: ['R', 'W', 'G'], stone: 0.3 },
      },
      {
        c: 24,
        k: 3,
        landmarks: [{ cells: [[24, 3], [25, 3]], ch: 'F', style: 'house' }],
        opts: { ...VILLAGE, landmarks: ['F'], minDensity: 0, infillRadius: 0, gardens: 0.5 },
      },
    ],
    shellholes: [[20, 4], [22, 6], [26, 5], [19, 2], [17, 5], [28, 6], [23, 1]],
    fieldHedges: 0.3,
  });
}

/** Country 3: forest and a cliff-edged plateau in the west, a church village in the east. */
function country3(): AsciiBoardSpec {
  return countryBoard({
    id: 'E',
    name: 'Forest Edge',
    seed: 4313,
    roads: [
      { kind: 'dirt', cells: route([0, 7], [8, 7], [14, 5], [22, 5], [32, 4]), offStart: true, offEnd: true },
      { kind: 'dirt', cells: route([22, 5], [23, 10]), offEnd: true },
      { kind: 'dirt', cells: route([14, 5], [13, 0]), offEnd: true },
    ],
    hills: [
      { c: 5, k: 2, radii: [4.2, 3.6] },
      { c: 18, k: 9, radii: [3] },
    ],
    woods: [
      { c: 3, k: 3, r: 2.4 },
      { c: 9, k: 1, r: 2 },
      { c: 2, k: 9, r: 2 },
      { c: 30, k: 9, r: 1.5 },
    ],
    wheat: [
      { c: 16, k: 2, r: 2.2 },
      { c: 11, k: 9, r: 1.8 },
      { c: 29, k: 1, r: 2 },
    ],
    villages: [
      {
        c: 25,
        k: 5,
        landmarks: [
          { cells: [[25, 6], [26, 6], [26, 7]], ch: 'C', style: 'church' },
          { cells: [[27, 4]], ch: 'P', style: 'hall' },
        ],
        opts: { ...VILLAGE, landmarks: ['C', 'P'], stone: 0.3, falloff: 0.16 },
      },
    ],
    shellholes: [[12, 6], [16, 6], [19, 4]],
    fieldHedges: 0.5,
  });
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'boards');
for (const spec of [cityA(), cityB(), country1(), country2(), country3()]) {
  const board = parseBoard(buildBoard(spec));
  for (const issue of lintBoard(board)) console.warn(`${board.id} ${issue.where}: ${issue.message}`);
  writeFileSync(join(outDir, `${board.id}.json`), JSON.stringify(board, null, 1) + '\n');
  console.log(`wrote ${board.id}.json (${Object.keys(board.hexes).length} hexes, ${Object.keys(board.hexsides).length} hexsides)`);
  console.log(spec.rows.join('\n'));
}
