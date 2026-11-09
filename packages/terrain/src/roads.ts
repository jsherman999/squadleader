/**
 * Road centre-lines as smooth polylines, shared by the 2D and 3D painters.
 * Roads run through hexside midpoints (with a little seeded jitter) and are
 * smoothed with a Catmull-Rom spline, so a road along a hex row is straight
 * rather than zig-zag, and bends read naturally.
 */
import { hexKey, hexToPixel, hexsideKey, hexsideMidpoint, mulberry32, neighbor, type HexKey, type Vec2 } from '@squadwar/hex';
import { roadDirections, type GameMap } from './map';

export interface RoadChain {
  readonly pts: readonly Vec2[];
  readonly dirt: boolean;
}

const cache = new WeakMap<GameMap, RoadChain[]>();

export function roadChains(map: GameMap): RoadChain[] {
  let c = cache.get(map);
  if (!c) {
    c = build(map);
    cache.set(map, c);
  }
  return c;
}

function build(map: GameMap): RoadChain[] {
  const rnd = mulberry32(map.seed + 5);
  type Edge = { key: string; a: HexKey; b: HexKey | null; mid: Vec2; dirt: boolean };
  const edges = new Map<string, Edge>();
  const adj = new Map<HexKey, Edge[]>();
  for (const h of Object.values(map.hexes)) {
    for (const d of roadDirections(map, h.hex)) {
      const key = hexsideKey(h.hex, d);
      const nk = hexKey(neighbor(h.hex, d));
      const nb = map.hexes[nk] ? nk : null;
      let e = edges.get(key);
      if (!e) {
        const m = hexsideMidpoint(h.hex, d);
        const c = hexToPixel(h.hex);
        const px = { x: -(m.y - c.y), y: m.x - c.x };
        const len = Math.hypot(px.x, px.y) || 1;
        const j = (rnd() - 0.5) * 0.12;
        e = { key, a: h.key, b: nb, mid: { x: m.x + (px.x / len) * j, y: m.y + (px.y / len) * j }, dirt: map.hexsides[key]?.road === 'dirt' };
        edges.set(key, e);
      }
      (adj.get(h.key) ?? adj.set(h.key, []).get(h.key)!).push(e);
    }
  }
  const deg = (k: HexKey) => adj.get(k)?.length ?? 0;
  const seen = new Set<string>();
  const centre = (k: HexKey) => hexToPixel(map.hexes[k]!.hex);
  const offEnd = (e: Edge): Vec2 => {
    const c = centre(e.a);
    return { x: e.mid.x + (e.mid.x - c.x) * 0.8, y: e.mid.y + (e.mid.y - c.y) * 0.8 };
  };
  const walk = (start: HexKey, first: Edge): { pts: Vec2[]; dirt: boolean } => {
    const pts: Vec2[] = [centre(start), first.mid];
    seen.add(first.key);
    let cur: HexKey | null = first.a === start ? first.b : first.a;
    let dirt = first.dirt;
    if (cur === null) {
      pts.push(offEnd(first));
      return { pts, dirt };
    }
    for (;;) {
      if (deg(cur) !== 2) {
        pts.push(centre(cur));
        break;
      }
      const next: Edge | undefined = adj.get(cur)!.find((e) => !seen.has(e.key));
      if (!next) {
        pts.push(centre(cur));
        break;
      }
      seen.add(next.key);
      dirt = dirt && next.dirt;
      pts.push(next.mid);
      const nxt: HexKey | null = next.a === cur ? next.b : next.a;
      if (nxt === null) {
        pts.push(offEnd(next));
        break;
      }
      cur = nxt;
    }
    return { pts, dirt };
  };
  const chains: { pts: Vec2[]; dirt: boolean }[] = [];
  for (const [k, es] of adj) {
    if (es.length === 2) continue;
    for (const e of es) if (!seen.has(e.key)) chains.push(walk(k, e));
  }
  for (const [k, es] of adj) for (const e of es) if (!seen.has(e.key)) chains.push(walk(k, e));
  return chains.map((ch) => ({ dirt: ch.dirt, pts: catmullRom(ch.pts, 6) }));
}

/** Catmull-Rom spline through points, sampled `n` times per segment. */
export function catmullRom(p: readonly Vec2[], n: number): Vec2[] {
  if (p.length < 3) return [...p];
  const out: Vec2[] = [p[0]!];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(0, i - 1)]!;
    const p1 = p[i]!;
    const p2 = p[i + 1]!;
    const p3 = p[Math.min(p.length - 1, i + 2)]!;
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return out;
}
