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

  // Buildings: outline underlay, fill, roof details.
  const bld = new Graphics();
  const bSyms = geo.symbols.filter((s) => s.kind === 'building');
  for (const s of bSyms) {
    const stone = map.buildings[s.building!]?.material === 'stone';
    bld.poly(flat(inflatePolygon(s.polygon, 0.045))).fill(stone ? MAP.stoneBldgEdge : MAP.woodBldgEdge);
  }
  for (const s of bSyms) {
    const stone = map.buildings[s.building!]?.material === 'stone';
    bld.poly(flat(s.polygon)).fill(stone ? MAP.stoneBldg : MAP.woodBldg);
  }
  for (const b of Object.values(map.buildings)) {
    const stone = b.material === 'stone';
    for (const hk of b.hexes) {
      const c = hexToPixel(map.hexes[hk]!.hex);
      // Roof ridge and a lighter roof panel.
      bld
        .rect((c.x - 0.42) * S, (c.y - 0.3) * S, 0.84 * S, 0.6 * S)
        .fill({ color: stone ? MAP.stoneRoof : MAP.woodRoof, alpha: 0.55 });
      bld
        .moveTo((c.x - 0.42) * S, c.y * S)
        .lineTo((c.x + 0.42) * S, c.y * S)
        .stroke({ width: 1.5, color: stone ? MAP.stoneBldgEdge : MAP.woodBldgEdge, alpha: 0.6 });
      if (b.multiStory) {
        // Multi-story buildings get hatching so they read as tall.
        for (let i = -2; i <= 2; i++) {
          bld
            .moveTo((c.x + i * 0.16 - 0.1) * S, (c.y - 0.28) * S)
            .lineTo((c.x + i * 0.16 + 0.1) * S, (c.y + 0.28) * S)
            .stroke({ width: 1, color: stone ? MAP.stoneBldgEdge : MAP.woodBldgEdge, alpha: 0.35 });
        }
      }
    }
  }
  terrain.addChild(bld);

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
  // Each road hex contributes either a smooth curve (road passes through) or
  // spokes from the centre (junctions and dead ends).
  type Piece = { kind: 'curve'; a: Vec2; c: Vec2; b: Vec2; paved: boolean } | { kind: 'spoke'; a: Vec2; b: Vec2; paved: boolean };
  const pieces: Piece[] = [];
  for (const h of Object.values(map.hexes)) {
    const dirs = roadDirections(map, h.hex);
    if (!dirs.length) continue;
    const c = hexToPixel(h.hex);
    const paved = dirs.every((d) => map.hexsides[hexsideKey(h.hex, d)]?.road !== 'dirt');
    if (dirs.length === 2) {
      pieces.push({ kind: 'curve', a: hexsideMidpoint(h.hex, dirs[0]!), c, b: hexsideMidpoint(h.hex, dirs[1]!), paved });
    } else {
      for (const d of dirs) pieces.push({ kind: 'spoke', a: c, b: hexsideMidpoint(h.hex, d), paved });
    }
  }
  const draw = (p: Piece, width: number, color: number) => {
    if (p.kind === 'curve') g.moveTo(...px(p.a)).quadraticCurveTo(...px(p.c), ...px(p.b));
    else g.moveTo(...px(p.a)).lineTo(...px(p.b));
    g.stroke({ width, color, cap: 'round' });
  };
  for (const p of pieces) draw(p, 0.46 * S, MAP.roadEdge);
  for (const p of pieces) draw(p, 0.38 * S, p.paved ? MAP.road : MAP.dirtRoad);
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
