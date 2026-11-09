import { hexDistance, hexRound, hexToOffset, offsetToHex } from '@squadwar/hex';

export type Cell = { c: number; k: number };

/** Hex line between two cells (inclusive), in board offset cells. */
export function line(a: Cell, b: Cell): Cell[] {
  const A = offsetToHex({ col: a.c, row: a.k });
  const B = offsetToHex({ col: b.c, row: b.k });
  const n = hexDistance(A, B);
  const out: Cell[] = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    const h = hexRound(A.q + (B.q - A.q) * t + 1e-6, A.r + (B.r - A.r) * t + 1e-6);
    const o = hexToOffset(h);
    out.push({ c: o.col, k: o.row });
  }
  return out;
}

/** A road through waypoints given as [c, k] pairs. */
export function route(...pts: [number, number][]): Cell[] {
  const out: Cell[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = line({ c: pts[i]![0], k: pts[i]![1] }, { c: pts[i + 1]![0], k: pts[i + 1]![1] });
    out.push(...(i === 0 ? seg : seg.slice(1)));
  }
  return out;
}
