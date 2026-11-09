/**
 * Generates boards/*.json from the layouts below. Run: pnpm --filter @squadwar/content gen:boards
 * The JSON is the canonical format; these layouts are the authoring source.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseBoard, lintBoard, localId } from '@squadwar/terrain';
import { buildBoard, type AsciiBoardSpec } from './ascii-board';

/** Local id of offset cell (c, k). */
const cell = (c: number, k: number) => localId({ c, k });
/** Local hexside id of offset cell (c, k) in direction d. */
const side = (c: number, k: number, d: 'N' | 'NE' | 'SE' | 'S' | 'SW' | 'NW') => `${cell(c, k)}/${d}`;

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

/** City A: a dense district of streets, a factory, a park and a town square. */
function cityA(): AsciiBoardSpec {
  const g = new Grid();
  // Streets and the avenue.
  for (const c of [6, 13, 20, 27]) g.fill(c, c, 0, 10, '=');
  g.fill(0, 32, 5, 5, '=');

  // North-west block.
  g.fill(1, 2, 0, 1, 'a');
  g.fill(4, 5, 1, 2, 'B');
  g.fill(0, 1, 3, 4, 'c');
  g.fill(3, 3, 3, 4, 'T');
  g.set(2, 3, 'o');
  // North block 2: large stone tenement, houses.
  g.fill(8, 10, 1, 2, 'D');
  g.fill(12, 12, 0, 1, 'e');
  g.set(7, 4, 'f');
  g.set(11, 3, 'o');
  g.set(9, 4, 'g');
  // North block 3: park with a chapel.
  g.fill(15, 18, 0, 3, 'T');
  g.set(16, 1, '.');
  g.fill(19, 19, 2, 3, 'H');
  g.set(14, 1, 'i');
  // North block 4: factory and walled yard.
  g.fill(21, 25, 0, 2, 'F');
  g.set(26, 3, 'j');
  g.set(23, 4, 'o');
  // North block 5: houses.
  g.fill(28, 29, 0, 1, 'k');
  g.fill(31, 32, 1, 2, 'L');
  g.fill(29, 30, 3, 4, 'm');
  g.set(32, 4, 'T');

  // South-west block.
  g.fill(1, 2, 7, 8, 'n');
  g.fill(4, 5, 6, 7, 'P');
  g.fill(0, 3, 9, 10, 'T');
  g.set(3, 7, 'o');
  // South block 2: the town square.
  g.fill(7, 7, 6, 7, 'Q');
  g.fill(11, 12, 6, 7, 'r');
  g.set(8, 7, 'o');
  g.set(10, 8, 'o');
  g.set(9, 9, 'o');
  g.set(12, 9, 's');
  // South block 3: town hall and houses.
  g.fill(15, 17, 7, 8, 'R');
  g.set(14, 6, 'u');
  g.fill(19, 19, 6, 7, 'v');
  g.fill(18, 19, 9, 10, 'T');
  // South block 4: houses and a bombed lot.
  g.fill(21, 22, 6, 7, 'w');
  g.set(24, 6, 'x');
  g.fill(25, 26, 8, 9, 'S');
  g.set(23, 8, 'o');
  g.set(22, 9, 'o');
  // South block 5: garden woods and houses.
  g.fill(29, 31, 7, 9, 'T');
  g.fill(28, 28, 6, 7, 'z');
  g.fill(32, 32, 6, 7, 'U');

  return {
    id: 'A',
    name: 'City A',
    kind: 'city',
    seed: 7,
    rows: g.done(),
    roadKind: 'paved',
    // Factory yard wall along the avenue and the yard's west side.
    walls: [
      ...[21, 22, 23, 24, 25, 26].map((c) => side(c, 4, 'S')),
      side(21, 3, 'NW'),
      side(21, 3, 'SW'),
      side(21, 4, 'SW'),
    ],
    // Garden hedge north of the south-east woods.
    hedges: [side(29, 7, 'N'), side(30, 7, 'N'), side(31, 7, 'N'), side(28, 7, 'SE')],
    sewers: [cell(6, 2), cell(13, 7), cell(20, 1), cell(27, 8)],
  };
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'boards');
for (const spec of [cityA()]) {
  const board = parseBoard(buildBoard(spec));
  for (const issue of lintBoard(board)) console.warn(`${board.id} ${issue.where}: ${issue.message}`);
  writeFileSync(join(outDir, `${board.id}.json`), JSON.stringify(board, null, 1) + '\n');
  console.log(`wrote ${board.id}.json (${Object.keys(board.hexes).length} hexes, ${Object.keys(board.hexsides).length} hexsides)`);
  console.log(spec.rows.join('\n'));
}
