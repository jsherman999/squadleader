import { describe, expect, it } from 'vitest';
import { FIGURE_SPOTS, figureParts, poseFor, type FigPart } from './figure';

/** Bounding box of a figure's shapes, strokes included. */
function bounds(parts: readonly FigPart[]): { x0: number; y0: number; x1: number; y1: number } {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const add = (x: number, y: number, r: number) => {
    b.x0 = Math.min(b.x0, x - r);
    b.x1 = Math.max(b.x1, x + r);
    b.y0 = Math.min(b.y0, y - r);
    b.y1 = Math.max(b.y1, y + r);
  };
  for (const p of parts) {
    if (p.kind === 'dot') add(p.x, p.y, p.r);
    else if (p.kind === 'stroke') for (const [x, y] of p.pts) add(x, y, p.width / 2);
    else for (const c of p.d) for (let i = 1; i + 1 < c.length; i += 2) add(c[i] as number, c[i + 1] as number, 0);
  }
  return b;
}

describe('counter figures', () => {
  const kinds = ['squad', 'crew', 'leader'] as const;
  const nations = ['german', 'russian', 'american'] as const;

  it('are about a counter-figure tall and stand on their feet', () => {
    for (const n of nations) {
      for (const k of kinds) {
        const b = bounds(figureParts(poseFor(k), n));
        expect(b.y1, `${k} ${n} feet`).toBeGreaterThan(8);
        expect(b.y1).toBeLessThan(9.8);
        expect(b.y0, `${k} ${n} helmet`).toBeGreaterThan(-10.5);
        // A head clearly smaller than the body: the old figures failed this and looked like aliens.
        expect(b.y1 - b.y0).toBeGreaterThan(k === 'crew' ? 14 : 17);
      }
    }
  });

  it('fit on the counter face above the factors, without the squad figures running into each other', () => {
    for (const n of nations) {
      for (const k of kinds) {
        const b = bounds(figureParts(poseFor(k), n));
        const spots = FIGURE_SPOTS[k];
        spots.forEach(([x, y, s]) => {
          expect(x + b.x0 * s).toBeGreaterThan(2);
          expect(x + b.x1 * s).toBeLessThan(42);
          expect(y + b.y0 * s).toBeGreaterThan(2);
          expect(y + b.y1 * s).toBeLessThan(k === 'leader' ? 31 : 29);
        });
        if (spots.length === 2) expect(spots[0]![0] + b.x1 * spots[0]![2]).toBeLessThan(spots[1]![0] + b.x0 * spots[1]![2]);
      }
    }
  });

  it('German helmets differ from the others', () => {
    expect(figureParts('rifleman', 'german')).not.toEqual(figureParts('rifleman', 'russian'));
    expect(figureParts('rifleman', 'russian')).toEqual(figureParts('rifleman', 'american'));
  });
});
