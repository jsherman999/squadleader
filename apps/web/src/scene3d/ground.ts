/** Paints the ground texture for the 3D view: meadow, yards, fields, woods floor, roads, craters. */
import { hashString, hexCorners, hexToPixel, inflatePolygon, mulberry32, type Vec2 } from '@squadwar/hex';
import { mapGeometry, roadChains, type GameMap } from '@squadwar/terrain';

export function groundPpu(map: GameMap, max = 48): number {
  const w = map.bounds.x1 - map.bounds.x0;
  const h = map.bounds.y1 - map.bounds.y0;
  return Math.min(max, 4096 / Math.max(w, h));
}

export function paintGround(map: GameMap): HTMLCanvasElement {
  const ppu = groundPpu(map);
  const { x0, y0, x1, y1 } = map.bounds;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil((x1 - x0) * ppu);
  cv.height = Math.ceil((y1 - y0) * ppu);
  const c = cv.getContext('2d')!;
  c.setTransform(ppu, 0, 0, ppu, -x0 * ppu, -y0 * ppu);
  const rnd = mulberry32(map.seed + 31);
  const poly = (pts: readonly Vec2[]) => {
    c.beginPath();
    c.moveTo(pts[0]!.x, pts[0]!.y);
    for (const p of pts.slice(1)) c.lineTo(p.x, p.y);
    c.closePath();
  };

  // Meadow with soft variation.
  c.fillStyle = '#7d8c52';
  c.fillRect(x0, y0, x1 - x0, y1 - y0);
  for (let i = 0; i < (x1 - x0) * (y1 - y0) * 9; i++) {
    const x = x0 + rnd() * (x1 - x0);
    const y = y0 + rnd() * (y1 - y0);
    c.fillStyle = rnd() < 0.5 ? 'rgba(160,170,95,0.10)' : 'rgba(70,85,45,0.10)';
    c.beginPath();
    c.arc(x, y, 0.1 + rnd() * 0.45, 0, Math.PI * 2);
    c.fill();
  }

  for (const h of Object.values(map.hexes)) {
    const corners = hexCorners(h.hex);
    if (h.level > 0) {
      poly(corners);
      c.fillStyle = `rgba(165,150,92,${0.12 * h.level})`;
      c.fill();
    }
    if (h.terrain === 'wheat') {
      poly(corners);
      c.fillStyle = '#c4aa55';
      c.fill();
      c.strokeStyle = 'rgba(150,120,40,0.5)';
      c.lineWidth = 0.025;
      const ctr = hexToPixel(h.hex);
      for (let k = -4; k <= 4; k++) {
        c.beginPath();
        c.moveTo(ctr.x - 0.85, ctr.y + k * 0.18);
        c.lineTo(ctr.x + 0.85, ctr.y + k * 0.18 - 0.1);
        c.stroke();
      }
    }
    if (h.terrain === 'water') {
      poly(corners);
      c.fillStyle = '#4f7792';
      c.fill();
    }
    if (h.building) {
      // Yards and cobbles around buildings.
      poly(inflatePolygon(corners, -0.05));
      c.fillStyle = 'rgba(140,132,104,0.45)';
      c.fill();
    }
  }

  const geo = mapGeometry(map);
  for (const s of geo.symbols) {
    if (s.kind === 'woods') {
      poly(s.polygon);
      c.fillStyle = '#4b5f31';
      c.fill();
    } else {
      // Contact shadow under buildings.
      poly(inflatePolygon(s.polygon, 0.05));
      c.fillStyle = 'rgba(40,36,30,0.55)';
      c.fill();
    }
  }

  // Roads.
  const stroke = (pts: readonly Vec2[], w: number, color: string) => {
    c.beginPath();
    c.moveTo(pts[0]!.x, pts[0]!.y);
    for (const p of pts.slice(1)) c.lineTo(p.x, p.y);
    c.lineWidth = w;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = color;
    c.stroke();
  };
  const chains = roadChains(map);
  for (const ch of chains) stroke(ch.pts, ch.dirt ? 0.34 : 0.48, ch.dirt ? '#7d6a46' : '#5f5c55');
  for (const ch of chains) stroke(ch.pts, ch.dirt ? 0.27 : 0.4, ch.dirt ? '#a28c5e' : '#8c887d');

  // Shellholes.
  for (const h of Object.values(map.hexes)) {
    if (!h.shellhole) continue;
    const r2 = mulberry32(hashString(`shell3d:${h.key}`));
    const ctr = hexToPixel(h.hex);
    for (let i = 0; i < 5; i++) {
      const x = ctr.x + (r2() - 0.5) * 1.1;
      const y = ctr.y + (r2() - 0.5) * 1.0;
      const r = 0.1 + r2() * 0.09;
      c.fillStyle = 'rgba(110,90,60,0.8)';
      c.beginPath();
      c.arc(x, y, r * 1.5, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(45,35,25,0.95)';
      c.beginPath();
      c.arc(x, y, r * 0.75, 0, Math.PI * 2);
      c.fill();
    }
  }
  // Faint hex grid, one path so shared sides don't darken twice.
  c.beginPath();
  for (const h of Object.values(map.hexes)) {
    const k = hexCorners(h.hex);
    c.moveTo(k[0]!.x, k[0]!.y);
    for (const p of k.slice(1)) c.lineTo(p.x, p.y);
    c.closePath();
  }
  c.lineWidth = 0.03;
  c.strokeStyle = 'rgba(28,32,20,0.28)';
  c.stroke();
  // Sewer entrances (§27): manhole covers in the street.
  for (const h of Object.values(map.hexes)) {
    if (!h.sewer) continue;
    const m = hexToPixel(h.hex);
    const x = m.x + 0.42;
    const y = m.y + 0.4;
    c.fillStyle = '#3e3e3a';
    c.strokeStyle = '#bbbbaa';
    c.lineWidth = 0.03;
    c.beginPath();
    c.arc(x, y, 0.15, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.beginPath();
    for (const dx of [-0.06, 0, 0.06]) {
      c.moveTo(x + dx, y - 0.1);
      c.lineTo(x + dx, y + 0.1);
    }
    c.stroke();
  }
  return cv;
}
