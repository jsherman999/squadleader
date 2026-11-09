import { describe, expect, it } from 'vitest';
import { hexDistance, hexKey, neighbor, parseHexKey } from '@squadwar/hex';
import { BOARD_COLS, boardCells, cellFromPrinted, cellToGlobal, localId, parseLocalId, rotateCell } from './board';
import { composeMap } from './map';
import { mapGeometry } from './geometry';
import type { BoardDef } from './schema';
import { parseBoard } from './validate';

const empty = (id: string): BoardDef => ({ format: 'squadwar-board@1', id, name: id, kind: 'city', hexes: {}, hexsides: {} });

describe('board coordinates', () => {
  it('has 33 columns with 10 or 11 cells each', () => {
    const cells = boardCells();
    expect(cells).toHaveLength(17 * 10 + 16 * 11);
    expect(localId({ c: 0, k: 0 })).toBe('A1');
    expect(localId({ c: 1, k: 0 })).toBe('B0');
    expect(localId({ c: 32, k: 9 })).toBe('GG10');
    expect(parseLocalId('K5')).toEqual(cellFromPrinted(10, 5));
  });

  it('rotating twice is the identity', () => {
    for (const cell of boardCells()) expect(rotateCell(rotateCell(cell))).toEqual(cell);
  });

  it('rows of one column are adjacent north–south', () => {
    const a = cellToGlobal(parseLocalId('K5'), 0, 0);
    const b = cellToGlobal(parseLocalId('K6'), 0, 0);
    expect(hexDistance(a, b)).toBe(1);
  });
});

describe('map composition', () => {
  it('merges the shared half-hex column of side-by-side boards', () => {
    const map = composeMap(
      [
        { board: 'A', x: 0, y: 0 },
        { board: 'B', x: 1, y: 0 },
      ],
      { A: empty('A'), B: empty('B') },
    );
    const perBoard = boardCells().length;
    expect(Object.keys(map.hexes)).toHaveLength(perBoard * 2 - 10);
    // Column GG of A is the same hexes as column A of B; A was listed first.
    const shared = cellToGlobal(parseLocalId('GG5'), 0, 0);
    expect(map.hexes[hexKey(shared)]!.id).toBe('A-GG5');
    expect(map.hexes[hexKey(shared)]!.half).toBe(false);
    expect(map.bounds.x1 - map.bounds.x0).toBeCloseTo(1.5 * (BOARD_COLS - 1) * 2);
  });

  it('merges half hexes of boards stacked vertically', () => {
    const map = composeMap(
      [
        { board: 'A', x: 0, y: 0 },
        { board: 'B', x: 0, y: 1 },
      ],
      { A: empty('A'), B: empty('B') },
    );
    expect(Object.keys(map.hexes)).toHaveLength(boardCells().length * 2 - 16);
  });

  it('applies terrain, buildings and rotated hexsides', () => {
    const a = parseBoard({
      ...empty('A'),
      hexes: { K5: { t: 'stoneBuilding', b: 'x' }, K6: { t: 'stoneBuilding', b: 'x' }, L5: { t: 'stoneBuilding', b: 'x' } },
      hexsides: { 'K5/N': { wall: true } },
    });
    const map = composeMap([{ board: 'A', x: 0, y: 0, rot: 180 }], { A: a });
    const k5 = map.hexes[map.byId['A-K5']!]!;
    expect(k5.terrain).toBe('stoneBuilding');
    expect(map.buildings['A:x']!.multiStory).toBe(true);
    // After rotation the wall is on the hexside towards the rotated K4.
    const k4 = map.hexes[map.byId['A-K4']!]!;
    const sides = Object.keys(map.hexsides);
    expect(sides).toHaveLength(1);
    const touches = (key: string) => {
      const [hk, d] = key.split(':') as [string, string];
      const h = parseHexKey(hk);
      const n = neighbor(h, Number(d) as 0 | 1 | 2);
      return [hexKey(h), hexKey(n)];
    };
    expect(touches(sides[0]!).sort()).toEqual([k4.key, k5.key].sort());
  });

  it('rejects building hexes without a building id', () => {
    expect(() => parseBoard({ ...empty('A'), hexes: { K5: { t: 'woodBuilding' } } })).toThrow(/building id/);
  });
});

describe('symbol geometry', () => {
  it('woods symbols reach shared hexsides only between woods hexes', () => {
    const a = parseBoard({ ...empty('A'), hexes: { K5: { t: 'woods' }, K6: { t: 'woods' } } });
    const map = composeMap([{ board: 'A', x: 0, y: 0 }], { A: a });
    const geo = mapGeometry(map);
    expect(geo.symbols).toHaveLength(2);
    const k5 = map.hexes[map.byId['A-K5']!]!;
    const poly = geo.byHex[k5.key]![0]!.polygon;
    // All points stay inside the hex circumcircle.
    const c = { x: 1.5 * k5.hex.q, y: Math.sqrt(3) * (k5.hex.r + k5.hex.q / 2) };
    for (const p of poly) expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeLessThanOrEqual(1 + 1e-9);
  });
});
