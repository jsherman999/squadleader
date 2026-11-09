/** Builds the 3D landscape meshes from a composed map. */
import * as THREE from 'three';
import {
  hashString,
  hexToPixel,
  hexsideEndpoints,
  hexsideHexes,
  hexKey,
  mulberry32,
  pointInPolygon,
  segmentInsideIntervals,
  type Vec2,
} from '@squadwar/hex';
import { mapGeometry, type GameMap } from '@squadwar/terrain';
import { buildingLevels, LEVEL, TREE_TOP, terrainHeight } from './heights';

const col = (hex: number) => new THREE.Color(hex);

function mixColor(a: number, b: number, t: number): THREE.Color {
  return col(a).lerp(col(b), t);
}

/** Terrain grid in map coordinates: x → X, y → Z, height in levels × LEVEL. */
export function terrainGeometry(map: GameMap, step = 0.12): THREE.BufferGeometry {
  const { x0, y0, x1, y1 } = map.bounds;
  const nx = Math.ceil((x1 - x0) / step);
  const ny = Math.ceil((y1 - y0) / step);
  const pos = new Float32Array((nx + 1) * (ny + 1) * 3);
  const uv = new Float32Array((nx + 1) * (ny + 1) * 2);
  let i = 0;
  let j = 0;
  for (let iy = 0; iy <= ny; iy++) {
    const y = y0 + ((y1 - y0) * iy) / ny;
    for (let ix = 0; ix <= nx; ix++) {
      const x = x0 + ((x1 - x0) * ix) / nx;
      pos[i++] = x;
      pos[i++] = terrainHeight(map, { x, y }) * LEVEL;
      pos[i++] = y;
      uv[j++] = ix / nx;
      uv[j++] = 1 - iy / ny;
    }
  }
  const idx: number[] = [];
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const a = iy * (nx + 1) + ix;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Accumulates flat-shaded triangles with per-vertex colours. */
class TriBuilder {
  pos: number[] = [];
  color: number[] = [];
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, k: THREE.Color): void {
    for (const p of [a, b, c]) {
      this.pos.push(p.x, p.y, p.z);
      this.color.push(k.r, k.g, k.b);
    }
  }
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, k: THREE.Color): void {
    this.tri(a, b, c, k);
    this.tri(a, c, d, k);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3));
    g.computeVertexNormals();
    return g;
  }
}

const v3 = (p: Vec2, h: number) => new THREE.Vector3(p.x, h * LEVEL, p.y);

/** Buildings: walls extruded from the rule footprints, hip/gable roofs along each block's ridge. */
/** Building walls and roofs; `exclude` leaves one building out (POV from inside it). */
export function buildingMeshes(map: GameMap, exclude?: string): { walls: THREE.BufferGeometry; roofs: THREE.BufferGeometry; chimneys: THREE.Vector3[] } {
  const geo = mapGeometry(map);
  const walls = new TriBuilder();
  const roofs = new TriBuilder();
  const chimneys: THREE.Vector3[] = [];
  for (const shape of Object.values(geo.buildings)) {
    if (shape.id === exclude) continue;
    const b = map.buildings[shape.id]!;
    const lv = buildingLevels(b);
    const stone = b.material === 'stone';
    const t = (shape.tint + 1) / 2;
    const wallCol = stone ? mixColor(0x8e8b84, 0xb3afa4, t) : mixColor(0xc2ab84, 0xdacbab, t);
    const roofCol = stone ? mixColor(0x4f555c, 0x6a6f74, t) : mixColor(0x8a3f27, 0xb05a35, t);
    for (const piece of shape.pieces) {
      const pts = piece.polygon;
      const base = map.hexes[piece.hex]!.level;
      const rect = shape.rects[piece.rect ?? 0]!;
      const tower = rect.kind === 'tower';
      const wallTop = base + (tower ? lv.ridge : lv.wall);
      const ridgeTop = base + (tower ? lv.ridge + 0.45 : lv.ridge);
      // Walls (quads around the outline).
      const shade = (i: number) => wallCol.clone().multiplyScalar(0.82 + 0.18 * Math.abs(Math.sin(i * 1.7 + rect.theta)));
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        const c = pts[(i + 1) % pts.length]!;
        walls.quad(v3(a, base - 0.05), v3(c, base - 0.05), v3(c, wallTop), v3(a, wallTop), shade(i));
      }
      // Roof: every outline point rises to the nearest point of the ridge.
      const u = { x: Math.cos(rect.theta), y: Math.sin(rect.theta) };
      let ra: Vec2 = { x: rect.c.x - u.x * rect.a, y: rect.c.y - u.y * rect.a };
      let rb: Vec2 = { x: rect.c.x + u.x * rect.a, y: rect.c.y + u.y * rect.a };
      if (tower) {
        ra = rect.c;
        rb = rect.c;
      } else {
        // Keep the ridge inside this piece, inset from its ends for a hip.
        const iv = segmentInsideIntervals(ra, rb, pts);
        if (iv.length) {
          const t0 = iv[0]![0];
          const t1 = iv[iv.length - 1]![1];
          const pa = { x: ra.x + (rb.x - ra.x) * t0, y: ra.y + (rb.y - ra.y) * t0 };
          const pb = { x: ra.x + (rb.x - ra.x) * t1, y: ra.y + (rb.y - ra.y) * t1 };
          const inset = Math.min(rect.b * 0.8, Math.hypot(pb.x - pa.x, pb.y - pa.y) * 0.3);
          const len = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
          const dx = ((pb.x - pa.x) / len) * inset;
          const dy = ((pb.y - pa.y) / len) * inset;
          // Hip only at the true ends of the block, not where it is cut by a hexside.
          ra = t0 < 1e-3 ? { x: pa.x + dx, y: pa.y + dy } : pa;
          rb = t1 > 1 - 1e-3 ? { x: pb.x - dx, y: pb.y - dy } : pb;
        } else {
          const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
          const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
          ra = rb = { x: cx, y: cy };
        }
      }
      const nearest = (p: Vec2): Vec2 => {
        const dx = rb.x - ra.x;
        const dy = rb.y - ra.y;
        const l2 = dx * dx + dy * dy;
        if (l2 < 1e-9) return ra;
        const s = Math.max(0, Math.min(1, ((p.x - ra.x) * dx + (p.y - ra.y) * dy) / l2));
        return { x: ra.x + dx * s, y: ra.y + dy * s };
      };
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        const c = pts[(i + 1) % pts.length]!;
        const na = nearest(a);
        const nc = nearest(c);
        const k = roofCol.clone().multiplyScalar(0.85 + 0.25 * ((i % 2) * 0.6 + 0.4));
        if (Math.hypot(na.x - nc.x, na.y - nc.y) < 1e-6) roofs.tri(v3(a, wallTop), v3(c, wallTop), v3(na, ridgeTop), k);
        else roofs.quad(v3(a, wallTop), v3(c, wallTop), v3(nc, ridgeTop), v3(na, ridgeTop), k);
      }
    }
    if (shape.chimney) chimneys.push(new THREE.Vector3(shape.chimney.x, (map.hexes[b.hexes[0]!]!.level + lv.ridge) * LEVEL, shape.chimney.y));
  }
  return { walls: walls.geometry(), roofs: roofs.geometry(), chimneys };
}

export interface TreeInstances {
  readonly conifers: THREE.Matrix4[];
  readonly broadleaf: THREE.Matrix4[];
  readonly trunks: THREE.Matrix4[];
  readonly colors: THREE.Color[];
  readonly broadColors: THREE.Color[];
}

/** Tree positions inside the woods symbols, tops around one level (§43.11). */
export function treeInstances(map: GameMap, density = 1): TreeInstances {
  const out: TreeInstances = { conifers: [], broadleaf: [], trunks: [], colors: [], broadColors: [] };
  const spacing = 0.27 / Math.sqrt(density);
  for (const s of mapGeometry(map).symbols) {
    if (s.kind !== 'woods') continue;
    const rnd = mulberry32(hashString(`trees:${s.hex}`));
    const c = hexToPixel(map.hexes[s.hex]!.hex);
    for (let gx = -1; gx <= 1; gx += spacing) {
      for (let gy = -1; gy <= 1; gy += spacing) {
        const p = { x: c.x + gx + (rnd() - 0.5) * spacing, y: c.y + gy + (rnd() - 0.5) * spacing };
        if (!pointInPolygon(p, s.polygon)) continue;
        const ground = terrainHeight(map, p);
        const top = TREE_TOP.min + rnd() * (TREE_TOP.max - TREE_TOP.min);
        const conifer = rnd() < 0.4;
        const m = new THREE.Matrix4();
        const trunkH = top * 0.32;
        out.trunks.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, (ground + trunkH / 2) * LEVEL, p.y), new THREE.Quaternion(), new THREE.Vector3(0.035, trunkH * LEVEL, 0.035)));
        if (conifer) {
          const h = top * 0.78;
          const r = 0.13 + rnd() * 0.06;
          m.compose(new THREE.Vector3(p.x, (ground + top - h / 2) * LEVEL, p.y), new THREE.Quaternion(), new THREE.Vector3(r, h * LEVEL, r));
          out.conifers.push(m);
          out.colors.push(mixColor(0x2f4a28, 0x46603a, rnd()));
        } else {
          const r = 0.15 + rnd() * 0.07;
          const hr = Math.min(r, top * LEVEL * 0.45);
          m.compose(new THREE.Vector3(p.x, (ground + top) * LEVEL - hr, p.y), new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(), rnd(), rnd())), new THREE.Vector3(r, hr, r));
          out.broadleaf.push(m);
          out.broadColors.push(mixColor(0x4d6b33, 0x6f8a45, rnd()));
        }
      }
    }
  }
  return out;
}

/** Stone walls, hedges and cliffs on hexsides. */
export function hexsideMeshes(map: GameMap): { walls: THREE.Matrix4[]; hedges: THREE.Matrix4[]; cliffs: THREE.Matrix4[] } {
  const out = { walls: [] as THREE.Matrix4[], hedges: [] as THREE.Matrix4[], cliffs: [] as THREE.Matrix4[] };
  for (const side of Object.values(map.hexsides)) {
    if (!side.wall && !side.hedge && !side.cliff) continue;
    const { a, da, b } = hexsideHexes(side.key);
    const [p, q] = hexsideEndpoints(a, da);
    const la = map.hexes[hexKey(a)]?.level ?? 0;
    const lb = map.hexes[hexKey(b)]?.level ?? 0;
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    const ang = Math.atan2(q.y - p.y, q.x - p.x);
    const len = Math.hypot(q.x - p.x, q.y - p.y) * 0.9;
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ang);
    const ground = Math.max(la, lb);
    if (side.wall) out.walls.push(new THREE.Matrix4().compose(new THREE.Vector3(mid.x, (ground + 0.22) * LEVEL, mid.y), rot, new THREE.Vector3(len, 0.44 * LEVEL, 0.06)));
    if (side.hedge) {
      const rnd = mulberry32(hashString(`hedge:${side.key}`));
      for (let i = 0; i <= 8; i++) {
        const t = 0.06 + (0.88 * i) / 8;
        const pt = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
        const r = 0.07 + rnd() * 0.03;
        out.hedges.push(new THREE.Matrix4().compose(new THREE.Vector3(pt.x, (ground + 0.22) * LEVEL, pt.y), new THREE.Quaternion(), new THREE.Vector3(r, 0.24 * LEVEL, r)));
      }
    }
    if (side.cliff) {
      const lo = Math.min(la, lb);
      const hi = Math.max(la, lb);
      out.cliffs.push(new THREE.Matrix4().compose(new THREE.Vector3(mid.x, ((lo + hi) / 2) * LEVEL, mid.y), rot, new THREE.Vector3(len, Math.max(0.2, hi - lo) * LEVEL, 0.12)));
    }
  }
  return out;
}
