/**
 * Paints a composed map as a printed board: paper, hills, fields, woods,
 * buildings, roads, hexside features, grid, centre dots and hex ids.
 * Everything is in world pixels (hex circumradius = HEX_PX).
 */
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import {
  DIRECTIONS,
  hashString,
  hexCorners,
  hexKey,
  hexToPixel,
  hexsideEndpoints,
  hexsideHexes,
  hexsideKey,
  hexsideMidpoint,
  inflatePolygon,
  mulberry32,
  neighbor,
  pointInPolygon,
  clipConvex,
  rotatedRect,
  segmentInsideIntervals,
  type HexKey,
  type Polygon,
  type Vec2,
} from '@squadwar/hex';
import { mapGeometry, roadDirections, type GameMap } from '@squadwar/terrain';

import { HEX_PX, MAP } from './palette';

const S = HEX_PX;
const px = (p: Vec2): [number, number] => [p.x * S, p.y * S];
const flat = (poly: Polygon): number[] => poly.flatMap((p) => [p.x * S, p.y * S]);

export interface PaintedBoard {
  /** Terrain art, masked to the board outline. */
  terrain: Container;
  /** Hex ids, faded by the camera at low zoom. */
  labels: Container;
  /** Grid lines and centre dots. */
  grid: Container;
}

export function paintBoard(map: GameMap): PaintedBoard {
  const terrain = new Container();
  const mask = new Graphics();
  for (const r of map.boards) mask.rect(r.x0 * S, r.y0 * S, (r.x1 - r.x0) * S, (r.y1 - r.y0) * S).fill(0xffffff);

  const base = new Graphics();
  for (const r of map.boards) base.rect(r.x0 * S, r.y0 * S, (r.x1 - r.x0) * S, (r.y1 - r.y0) * S).fill(MAP.paper);
  terrain.addChild(base);
  terrain.addChild(paperGrain(map));

  const hexes = Object.values(map.hexes);

  // Hills, fields, water: whole-hex fills.
  const fills = new Graphics();
  for (const h of hexes) {
    const poly = flat(hexCorners(h.hex));
    if (h.level > 0) fills.poly(poly).fill(MAP.hill[h.level]!);
    if (h.terrain === 'wheat') fills.poly(poly).fill(MAP.wheat);
    if (h.terrain === 'water') fills.poly(poly).fill(MAP.water);
  }
  // Wheat stipple and water ripples.
  for (const h of hexes) {
    const c = hexToPixel(h.hex);
    if (h.terrain === 'wheat') {
      for (let i = -3; i <= 3; i++) {
        fills
          .moveTo((c.x - 0.55) * S, (c.y + i * 0.2) * S)
          .lineTo((c.x + 0.55) * S, (c.y + i * 0.2 - 0.08) * S)
          .stroke({ width: 1, color: MAP.wheatLine, alpha: 0.6 });
      }
    }
    if (h.terrain === 'water') {
      for (let i = -1; i <= 1; i++) {
        fills
          .moveTo((c.x - 0.4) * S, (c.y + i * 0.35) * S)
          .bezierCurveTo((c.x - 0.15) * S, (c.y + i * 0.35 - 0.1) * S, (c.x + 0.15) * S, (c.y + i * 0.35 + 0.1) * S, (c.x + 0.4) * S, (c.y + i * 0.35) * S)
          .stroke({ width: 1.5, color: MAP.waterDark, alpha: 0.7 });
      }
    }
  }
  terrain.addChild(fills);

  // Crest lines between different elevation levels.
  const crests = new Graphics();
  for (const h of hexes) {
    for (const d of DIRECTIONS) {
      const n = map.hexes[hexKey(neighbor(h.hex, d))];
      if (!n || n.level >= h.level) continue;
      const [a, b] = hexsideEndpoints(h.hex, d);
      crests.moveTo(...px(a)).lineTo(...px(b)).stroke({ width: 2.5, color: MAP.crest, alpha: 0.85 });
    }
  }
  terrain.addChild(crests);

  // Roads under buildings and woods edges.
  terrain.addChild(paintRoads(map));
  terrain.addChild(paintShellholes(map));

  const geo = mapGeometry(map);

  // Woods: dark underlay outline, fill, then tree crowns.
  const woods = new Graphics();
  const woodsSymbols = geo.symbols.filter((s) => s.kind === 'woods');
  for (const s of woodsSymbols) woods.poly(flat(inflatePolygon(s.polygon, 0.035))).fill(MAP.woodsDark);
  for (const s of woodsSymbols) woods.poly(flat(s.polygon)).fill(MAP.woods);
  for (const s of woodsSymbols) {
    const rnd = mulberry32(hashString(`crowns:${s.hex}`));
    const c = hexToPixel(map.hexes[s.hex]!.hex);
    for (let i = 0; i < 16; i++) {
      const p = { x: c.x + (rnd() - 0.5) * 1.6, y: c.y + (rnd() - 0.5) * 1.5 };
      if (!pointInPolygon(p, inflatePolygon(s.polygon, -0.14))) continue;
      const r = (0.1 + rnd() * 0.08) * S;
      woods.circle(p.x * S + 1.5, p.y * S + 1.5, r).fill({ color: MAP.woodsDark, alpha: 0.55 });
      woods.circle(p.x * S, p.y * S, r).fill(rnd() > 0.5 ? MAP.woodsLight : MAP.woods);
    }
  }
  terrain.addChild(woods);

  terrain.addChild(paintBuildings(map));

  terrain.addChild(paintHexsides(map));
  terrain.addChild(paintSewers(map));

  terrain.addChild(mask);
  terrain.mask = mask;

  // Grid and centre dots (in a container so the mask can be a child).
  const gridBox = new Container();
  const grid = new Graphics();
  gridBox.addChild(grid);
  for (const h of hexes) grid.poly(flat(hexCorners(h.hex))).stroke({ width: 1, color: MAP.grid, alpha: MAP.gridAlpha });
  for (const h of hexes) {
    const [x, y] = px(hexToPixel(h.hex));
    grid.circle(x, y, 2.6).fill(MAP.dot).stroke({ width: 0.8, color: MAP.dotEdge, alpha: 0.7 });
  }
  const gridMask = new Graphics();
  for (const r of map.boards) gridMask.rect(r.x0 * S, r.y0 * S, (r.x1 - r.x0) * S, (r.y1 - r.y0) * S).fill(0xffffff);
  gridBox.addChild(gridMask);
  gridBox.mask = gridMask;

  // Hex ids along the top of each hex.
  const labels = new Container();
  const style = new TextStyle({ fontFamily: 'Roboto Condensed, Arial Narrow, sans-serif', fontSize: 9, fill: MAP.label, fontWeight: '600' });
  for (const h of hexes) {
    const c = hexToPixel(h.hex);
    const t = new Text({ text: h.localId, style, resolution: 4 });
    t.anchor.set(0.5, 0);
    t.position.set(c.x * S, (c.y - 0.82) * S);
    if (h.half) {
      // Keep half-hex labels inside the board edge.
      const r = map.boards.find((b) => b.board === h.board);
      if (r && c.y - 0.82 < r.y0) t.position.y = (r.y0 + 0.02) * S;
      if (r && Math.abs(c.x - r.x0) < 0.01) {
        t.anchor.set(0, 0);
        t.position.x = c.x * S + 6;
      }
      if (r && Math.abs(c.x - r.x1) < 0.01) {
        t.anchor.set(1, 0);
        t.position.x = c.x * S - 6;
      }
    }
    labels.addChild(t);
  }

  return { terrain, labels, grid: gridBox };
}

function paperGrain(map: GameMap): Graphics {
  const g = new Graphics();
  const rnd = mulberry32(map.seed + 99);
  for (const r of map.boards) {
    const n = Math.floor((r.x1 - r.x0) * (r.y1 - r.y0) * 6);
    for (let i = 0; i < n; i++) {
      const x = r.x0 + rnd() * (r.x1 - r.x0);
      const y = r.y0 + rnd() * (r.y1 - r.y0);
      g.circle(x * S, y * S, 0.6 + rnd() * 1.4).fill({ color: rnd() > 0.5 ? MAP.paperDark : 0xffffff, alpha: 0.35 });
    }
  }
  return g;
}

function paintRoads(map: GameMap): Graphics {
  const g = new Graphics();
  const rnd = mulberry32(map.seed + 5);
  // Road graph: nodes are road hexes, edges are road hexsides.
  type Edge = { key: string; a: HexKey; b: HexKey | null; mid: Vec2; dirt: boolean; d: number };
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
        // Small sideways jitter so straight runs are not ruler-straight.
        const px2 = { x: -(m.y - c.y), y: m.x - c.x };
        const len = Math.hypot(px2.x, px2.y) || 1;
        const j = (rnd() - 0.5) * 0.12;
        e = { key, a: h.key, b: nb, mid: { x: m.x + (px2.x / len) * j, y: m.y + (px2.y / len) * j }, dirt: map.hexsides[key]?.road === 'dirt', d };
        edges.set(key, e);
      }
      (adj.get(h.key) ?? adj.set(h.key, []).get(h.key)!).push(e);
    }
  }
  const deg = (k: HexKey) => adj.get(k)?.length ?? 0;
  const seen = new Set<string>();
  const chains: { pts: Vec2[]; dirt: boolean }[] = [];
  const centre = (k: HexKey) => hexToPixel(map.hexes[k]!.hex);
  const offEnd = (e: Edge): Vec2 => {
    const c = centre(e.a);
    return { x: e.mid.x + (e.mid.x - c.x) * 0.8, y: e.mid.y + (e.mid.y - c.y) * 0.8 };
  };
  const walk = (start: HexKey, first: Edge) => {
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
  for (const [k, es] of adj) {
    if (es.length === 2) continue;
    for (const e of es) if (!seen.has(e.key)) chains.push(walk(k, e));
  }
  for (const [k, es] of adj) for (const e of es) if (!seen.has(e.key)) chains.push(walk(k, e));

  const sampled = chains.map((ch) => ({ dirt: ch.dirt, pts: catmullRom(ch.pts, 6) }));
  const stroke = (pts: Vec2[], width: number, color: number) => {
    g.moveTo(pts[0]!.x * S, pts[0]!.y * S);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x * S, pts[i]!.y * S);
    g.stroke({ width, color, cap: 'round', join: 'round' });
  };
  for (const c of sampled) stroke(c.pts, (c.dirt ? 0.34 : 0.46) * S, c.dirt ? 0xa58f62 : MAP.roadEdge);
  for (const c of sampled) stroke(c.pts, (c.dirt ? 0.27 : 0.38) * S, c.dirt ? MAP.dirtRoad : MAP.road);
  return g;
}

/** Catmull-Rom spline through points, sampled `n` times per segment. */
function catmullRom(p: Vec2[], n: number): Vec2[] {
  if (p.length < 3) return p;
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

function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

function paintBuildings(map: GameMap): Graphics {
  const g = new Graphics();
  const geo = mapGeometry(map);
  const shapes = Object.values(geo.buildings);
  const material = (id: string) => map.buildings[id]?.material ?? 'wood';
  // Outline underlay for every piece, then fills: pieces of one building merge visually.
  for (const b of shapes) {
    const edge = material(b.id) === 'stone' ? MAP.stoneBldgEdge : MAP.woodBldgEdge;
    for (const p of b.pieces) g.poly(flat(inflatePolygon(p.polygon, 0.04))).fill(edge);
  }
  for (const b of shapes) {
    const stone = material(b.id) === 'stone';
    const base = stone ? mix(MAP.stoneBldg, b.tint > 0 ? 0xa4a39b : 0x7c7b76, Math.abs(b.tint) * 0.6) : mix(MAP.woodBldg, b.tint > 0 ? 0xb07a4c : 0x80522f, Math.abs(b.tint) * 0.6);
    const shade = mix(base, 0x000000, 0.22);
    const light = mix(base, 0xffffff, 0.22);
    for (const p of b.pieces) g.poly(flat(p.polygon)).fill(base);
    for (const r of b.rects) {
      const u = { x: Math.cos(r.theta), y: Math.sin(r.theta) };
      const v = { x: -u.y, y: u.x };
      if (r.kind === 'tower') {
        const sq = rotatedRect(r.c, r.theta, r.a, r.b);
        for (const p of b.pieces) {
          const part = clipConvex(sq, p.polygon);
          if (part.length >= 3) g.poly(flat(part)).fill(shade);
        }
        g.moveTo(sq[0]!.x * S, sq[0]!.y * S).lineTo(sq[2]!.x * S, sq[2]!.y * S).moveTo(sq[1]!.x * S, sq[1]!.y * S).lineTo(sq[3]!.x * S, sq[3]!.y * S).stroke({ width: 1.2, color: light, alpha: 0.8 });
        continue;
      }
      // Pitched roof: darker half on one side of the ridge.
      const half = rotatedRect({ x: r.c.x + v.x * r.b * 0.5, y: r.c.y + v.y * r.b * 0.5 }, r.theta, r.a, r.b * 0.5);
      for (const p of b.pieces) {
        const part = clipConvex(half, p.polygon);
        if (part.length >= 3) g.poly(flat(part)).fill({ color: shade, alpha: 0.85 });
      }
      const lines: [Vec2, Vec2][] = [];
      if (r.kind === 'hall') {
        // Saw-tooth or long-hall roof: lines across the roof.
        const n = Math.max(2, Math.round((r.a * 2) / 0.22));
        for (let i = 1; i < n; i++) {
          const t = -r.a + (2 * r.a * i) / n;
          lines.push([
            { x: r.c.x + u.x * t - v.x * r.b, y: r.c.y + u.y * t - v.y * r.b },
            { x: r.c.x + u.x * t + v.x * r.b, y: r.c.y + u.y * t + v.y * r.b },
          ]);
        }
      }
      lines.push([
        { x: r.c.x - u.x * r.a, y: r.c.y - u.y * r.a },
        { x: r.c.x + u.x * r.a, y: r.c.y + u.y * r.a },
      ]);
      for (const [a, c] of lines) {
        for (const p of b.pieces) {
          for (const [t0, t1] of segmentInsideIntervals(a, c, p.polygon)) {
            g.moveTo((a.x + (c.x - a.x) * t0) * S, (a.y + (c.y - a.y) * t0) * S)
              .lineTo((a.x + (c.x - a.x) * t1) * S, (a.y + (c.y - a.y) * t1) * S)
              .stroke({ width: 1.1, color: r.kind === 'hall' ? shade : light, alpha: 0.85 });
          }
        }
      }
    }
    if (b.chimney) {
      g.circle(b.chimney.x * S, b.chimney.y * S, 6).fill(0x3d3b37).stroke({ width: 2, color: 0x9a978f });
      g.circle(b.chimney.x * S, b.chimney.y * S, 2.5).fill(0x151515);
    }
  }
  return g;
}

function paintShellholes(map: GameMap): Graphics {
  const g = new Graphics();
  for (const h of Object.values(map.hexes)) {
    if (!h.shellhole) continue;
    const rnd = mulberry32(hashString(`shell:${h.key}`));
    const c = hexToPixel(h.hex);
    for (let i = 0; i < 4; i++) {
      const x = (c.x + (rnd() - 0.5) * 0.9) * S;
      const y = (c.y + (rnd() - 0.5) * 0.8) * S;
      const r = (0.1 + rnd() * 0.08) * S;
      g.circle(x, y, r * 1.5).fill({ color: MAP.shell, alpha: 0.55 });
      g.circle(x, y, r * 0.6).fill({ color: MAP.shellCore, alpha: 0.85 });
    }
  }
  return g;
}

function paintHexsides(map: GameMap): Graphics {
  const g = new Graphics();
  for (const side of Object.values(map.hexsides)) {
    if (!side.wall && !side.hedge && !side.cliff) continue;
    const { a, da } = hexsideHexes(side.key);
    const [p, q] = hexsideEndpoints(a, da);
    const shrink = (t: number) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    const p1 = shrink(0.06);
    const q1 = shrink(0.94);
    if (side.cliff) g.moveTo(...px(p)).lineTo(...px(q)).stroke({ width: 5, color: MAP.cliff, cap: 'round' });
    if (side.wall) {
      g.moveTo(...px(p1)).lineTo(...px(q1)).stroke({ width: 6, color: MAP.wallEdge, cap: 'round' });
      g.moveTo(...px(p1)).lineTo(...px(q1)).stroke({ width: 3.5, color: MAP.wall, cap: 'round' });
    }
    if (side.hedge) {
      for (let i = 0; i <= 8; i++) {
        const m = shrink(0.06 + (0.88 * i) / 8);
        g.circle(m.x * S, m.y * S, 4.2).fill(MAP.hedgeDark);
      }
      for (let i = 0; i <= 8; i++) {
        const m = shrink(0.06 + (0.88 * i) / 8);
        g.circle(m.x * S - 0.6, m.y * S - 0.6, 3.1).fill(MAP.hedge);
      }
    }
  }
  return g;
}

function paintSewers(map: GameMap): Graphics {
  const g = new Graphics();
  for (const h of Object.values(map.hexes)) {
    if (!h.sewer) continue;
    const c = hexToPixel(h.hex);
    const x = (c.x + 0.42) * S;
    const y = (c.y + 0.4) * S;
    g.circle(x, y, 6).fill(MAP.sewer).stroke({ width: 1, color: 0xbbbbaa });
    for (const dx of [-2.5, 0, 2.5]) g.moveTo(x + dx, y - 4).lineTo(x + dx, y + 4).stroke({ width: 1, color: 0xbbbbaa });
  }
  return g;
}
