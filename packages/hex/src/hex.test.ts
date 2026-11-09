import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DIRECTIONS,
  directionTo,
  hexDistance,
  hexToOffset,
  hexToPixel,
  hexesInRange,
  hexsideEndpoints,
  hexsideHexes,
  hexsideKey,
  hexsideMidpoint,
  neighbor,
  offsetToHex,
  oppositeDir,
  pixelToHex,
  APOTHEM,
} from './hex';
import { segmentInsideIntervals, pointInPolygon, inflatePolygon, polygonArea } from './geom';

const arbHex = fc.record({ q: fc.integer({ min: -60, max: 60 }), r: fc.integer({ min: -60, max: 60 }) });

describe('hex math', () => {
  it('neighbours are at distance 1 and round-trip direction', () => {
    fc.assert(
      fc.property(arbHex, (h) => {
        for (const d of DIRECTIONS) {
          const n = neighbor(h, d);
          expect(hexDistance(h, n)).toBe(1);
          expect(directionTo(h, n)).toBe(d);
          expect(neighbor(n, oppositeDir(d))).toEqual(h);
        }
      }),
    );
  });

  it('distance is symmetric and satisfies the triangle inequality', () => {
    fc.assert(
      fc.property(arbHex, arbHex, arbHex, (a, b, c) => {
        expect(hexDistance(a, b)).toBe(hexDistance(b, a));
        expect(hexDistance(a, c)).toBeLessThanOrEqual(hexDistance(a, b) + hexDistance(b, c));
      }),
    );
  });

  it('offset and pixel conversions round-trip', () => {
    fc.assert(
      fc.property(arbHex, (h) => {
        expect(offsetToHex(hexToOffset(h))).toEqual(h);
        expect(pixelToHex(hexToPixel(h))).toEqual(h);
      }),
    );
  });

  it('even-q offset: odd columns sit half a hex higher than even columns', () => {
    const even = hexToPixel(offsetToHex({ col: 0, row: 3 }));
    const odd = hexToPixel(offsetToHex({ col: 1, row: 3 }));
    expect(even.y - odd.y).toBeCloseTo(APOTHEM);
  });

  it('hexside keys are shared by both adjoining hexes', () => {
    fc.assert(
      fc.property(arbHex, (h) => {
        for (const d of DIRECTIONS) {
          const n = neighbor(h, d);
          expect(hexsideKey(h, d)).toBe(hexsideKey(n, oppositeDir(d)));
          const { a, b } = hexsideHexes(hexsideKey(h, d));
          expect([a, b]).toContainEqual(h);
          expect([a, b]).toContainEqual(n);
        }
      }),
    );
  });

  it('hexside midpoint lies halfway to the neighbour centre', () => {
    const h = { q: 2, r: -1 };
    for (const d of DIRECTIONS) {
      const m = hexsideMidpoint(h, d);
      const c = hexToPixel(h);
      const n = hexToPixel(neighbor(h, d));
      expect(m.x).toBeCloseTo((c.x + n.x) / 2);
      expect(m.y).toBeCloseTo((c.y + n.y) / 2);
      const [p, q] = hexsideEndpoints(h, d);
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeCloseTo(1);
    }
  });

  it('hexesInRange returns 1 + 3r(r+1) hexes', () => {
    for (const r of [0, 1, 2, 5]) expect(hexesInRange({ q: 0, r: 0 }, r)).toHaveLength(1 + 3 * r * (r + 1));
  });
});

describe('geometry', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
    { x: 0, y: 2 },
  ];

  it('finds the inside interval of a crossing segment', () => {
    const iv = segmentInsideIntervals({ x: -1, y: 1 }, { x: 3, y: 1 }, square);
    expect(iv).toHaveLength(1);
    expect(iv[0]![0]).toBeCloseTo(0.25);
    expect(iv[0]![1]).toBeCloseTo(0.75);
  });

  it('a segment along an edge is not inside', () => {
    expect(segmentInsideIntervals({ x: -1, y: 0 }, { x: 3, y: 0 }, square)).toHaveLength(0);
  });

  it('a segment touching a corner is not inside', () => {
    expect(segmentInsideIntervals({ x: -1, y: 1 }, { x: 1, y: -1 }, square)).toHaveLength(0);
  });

  it('inflate grows the polygon', () => {
    const big = inflatePolygon(square, 0.1);
    expect(Math.abs(polygonArea(big))).toBeGreaterThan(Math.abs(polygonArea(square)));
    expect(pointInPolygon({ x: -0.05, y: 1 }, big)).toBe(true);
  });
});
