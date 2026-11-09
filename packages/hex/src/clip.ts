/** Convex clipping helpers (Sutherland–Hodgman against half-planes). */
import type { Vec2 } from './hex';
import { polygonArea } from './geom';

/** Keep the part of a polygon where dot(p − point, normal) ≥ 0. */
export function clipHalfPlane(poly: readonly Vec2[], point: Vec2, normal: Vec2): Vec2[] {
  const out: Vec2[] = [];
  const side = (p: Vec2) => (p.x - point.x) * normal.x + (p.y - point.y) * normal.y;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const sa = side(a);
    const sb = side(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

/** Intersection of two convex polygons. */
export function clipConvex(subject: readonly Vec2[], clipper: readonly Vec2[]): Vec2[] {
  const sign = polygonArea(clipper) >= 0 ? 1 : -1;
  let out: Vec2[] = [...subject];
  for (let i = 0; i < clipper.length && out.length; i++) {
    const a = clipper[i]!;
    const b = clipper[(i + 1) % clipper.length]!;
    // Inward normal for the clipper's winding.
    const n = { x: -(b.y - a.y) * sign, y: (b.x - a.x) * sign };
    out = clipHalfPlane(out, a, n);
  }
  return out;
}

/** Rectangle centred at c, long axis at angle theta, half-sizes a (along) and b (across). */
export function rotatedRect(c: Vec2, theta: number, a: number, b: number): Vec2[] {
  const u = { x: Math.cos(theta), y: Math.sin(theta) };
  const v = { x: -u.y, y: u.x };
  return [
    { x: c.x - u.x * a - v.x * b, y: c.y - u.y * a - v.y * b },
    { x: c.x + u.x * a - v.x * b, y: c.y + u.y * a - v.y * b },
    { x: c.x + u.x * a + v.x * b, y: c.y + u.y * a + v.y * b },
    { x: c.x - u.x * a + v.x * b, y: c.y - u.y * a + v.y * b },
  ];
}
