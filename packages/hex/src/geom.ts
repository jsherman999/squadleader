/** Small 2D geometry kit used by terrain generation and line of sight. */
import type { Vec2 } from './hex';

export type Polygon = readonly Vec2[];

export const EPS = 1e-9;

export function v(x: number, y: number): Vec2 {
  return { x, y };
}
export function vAdd(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}
export function vSub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}
export function vScale(a: Vec2, k: number): Vec2 {
  return { x: a.x * k, y: a.y * k };
}
export function vLerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
export function vDot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}
export function vCross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}
export function vLen(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}
export function vDist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Signed area (positive when clockwise in y-down screen space). */
export function polygonArea(p: Polygon): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function pointInPolygon(pt: Vec2, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Parameter intervals [t0, t1] (0..1 along a→b) where the segment lies strictly
 * inside a simple polygon (convex or not). Touching the boundary does not count.
 */
export function segmentInsideIntervals(a: Vec2, b: Vec2, poly: Polygon): [number, number][] {
  const d = vSub(b, a);
  const ts: number[] = [0, 1];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const e = vSub(q, p);
    const denom = vCross(d, e);
    if (Math.abs(denom) < EPS) continue; // parallel (collinear overlap stays on boundary)
    const ap = vSub(p, a);
    const t = vCross(ap, e) / denom;
    const u = vCross(ap, d) / denom;
    if (t > EPS && t < 1 - EPS && u >= -EPS && u <= 1 + EPS) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let i = 0; i < ts.length - 1; i++) {
    const t0 = ts[i]!;
    const t1 = ts[i + 1]!;
    if (t1 - t0 < 1e-7) continue;
    const mid = vLerp(a, b, (t0 + t1) / 2);
    if (pointInPolygon(mid, poly) && !nearBoundary(mid, poly, 1e-7)) {
      const last = out[out.length - 1];
      if (last && Math.abs(last[1] - t0) < 1e-9) last[1] = t1;
      else out.push([t0, t1]);
    }
  }
  return out;
}

export function distPointSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = vSub(b, a);
  const len2 = vDot(ab, ab);
  if (len2 < EPS) return vDist(p, a);
  const t = Math.max(0, Math.min(1, vDot(vSub(p, a), ab) / len2));
  return vDist(p, vLerp(a, b, t));
}

function nearBoundary(p: Vec2, poly: Polygon, tol: number): boolean {
  for (let i = 0; i < poly.length; i++) {
    if (distPointSegment(p, poly[i]!, poly[(i + 1) % poly.length]!) < tol) return true;
  }
  return false;
}

/** Point on segment a→b at parameter t. */
export function segmentPoint(a: Vec2, b: Vec2, t: number): Vec2 {
  return vLerp(a, b, t);
}

/** Axis-aligned bounds of a set of points. */
export function bounds(points: readonly Vec2[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Grow a polygon outward by `d` (approximate: moves each vertex along the
 * average of its edge normals). Good enough for small offsets on the
 * well-behaved shapes the terrain generator produces.
 */
export function inflatePolygon(poly: Polygon, d: number): Vec2[] {
  const n = poly.length;
  const sign = polygonArea(poly) >= 0 ? 1 : -1;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n]!;
    const cur = poly[i]!;
    const next = poly[(i + 1) % n]!;
    const n1 = edgeNormal(prev, cur, sign);
    const n2 = edgeNormal(cur, next, sign);
    const avg = { x: n1.x + n2.x, y: n1.y + n2.y };
    const len = vLen(avg) || 1;
    const cosHalf = Math.max(0.35, vDot(n1, avg) / len);
    out.push(vAdd(cur, vScale(avg, d / len / cosHalf)));
  }
  return out;
}

function edgeNormal(a: Vec2, b: Vec2, sign: number): Vec2 {
  const e = vSub(b, a);
  const len = vLen(e) || 1;
  // Outward normal for a clockwise (y-down positive area) polygon.
  return { x: (sign * e.y) / len, y: (sign * -e.x) / len };
}
