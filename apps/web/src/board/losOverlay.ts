import type { Graphics } from 'pixi.js';
import { hexsideEndpoints, hexsideHexes, hexToPixel, parseHexKey, vLerp, type HexKey, type Vec2 } from '@squadwar/hex';
import { mapGeometry, type GameMap } from '@squadwar/terrain';
import type { LosResult } from '@squadwar/los';
import { drawHexOutline, fillHex } from './overlays';
import { HEX_PX } from './palette';

const S = HEX_PX;
export const LOS_COLORS = { clear: 0x6fe06a, blocked: 0xff5a46, hindrance: 0xf2d04b, end: 0xf0c66b, blind: 0xff7a5a };

function dashed(g: Graphics, a: Vec2, b: Vec2, color: number, width: number, dash = 10, gap = 7) {
  const len = Math.hypot(b.x - a.x, b.y - a.y) * S;
  const steps = Math.max(1, Math.floor(len / (dash + gap)));
  for (let i = 0; i < steps; i++) {
    const t0 = (i * (dash + gap)) / len;
    const t1 = Math.min(1, (i * (dash + gap) + dash) / len);
    const p = vLerp(a, b, t0);
    const q = vLerp(a, b, t1);
    g.moveTo(p.x * S, p.y * S).lineTo(q.x * S, q.y * S);
  }
  g.stroke({ width, color, alpha: 0.95 });
}

/** Draw the LOS line, its obstruction and hindrances. */
export function drawLos(g: Graphics, map: GameMap, r: LosResult): void {
  const { a, b } = r;
  const stop = r.blockedBy ? r.blockedBy.point : b;
  // Dark casing, then the clear stretch.
  g.moveTo(a.x * S, a.y * S).lineTo(stop.x * S, stop.y * S).stroke({ width: 7, color: 0x101410, alpha: 0.7 });
  g.moveTo(a.x * S, a.y * S).lineTo(stop.x * S, stop.y * S).stroke({ width: 3.5, color: LOS_COLORS.clear });
  if (r.blockedBy) {
    dashed(g, stop, b, 0x101410, 6);
    dashed(g, stop, b, LOS_COLORS.blocked, 3);
    const o = r.blockedBy;
    if (o.kind === 'woods' || o.kind === 'building') {
      for (const s of mapGeometry(map).byHex[o.hex] ?? []) {
        g.poly(s.polygon.flatMap((p) => [p.x * S, p.y * S])).fill({ color: LOS_COLORS.blocked, alpha: 0.35 }).stroke({ width: 2.5, color: LOS_COLORS.blocked });
      }
    } else if ((o.kind === 'wall' || o.kind === 'hedge') && o.hexside) {
      const { a: h, da } = hexsideHexes(o.hexside);
      const [p, q] = hexsideEndpoints(h, da);
      g.moveTo(p.x * S, p.y * S).lineTo(q.x * S, q.y * S).stroke({ width: 7, color: LOS_COLORS.blocked, alpha: 0.85 });
    } else {
      fillHex(g, parseHexKey(o.hex), LOS_COLORS.blocked, 0.22);
      drawHexOutline(g, parseHexKey(o.hex), LOS_COLORS.blocked, 0.9, 2.5);
    }
    if (r.blindHex) drawHexOutline(g, parseHexKey(r.to.hex === o.hex ? r.from.hex : r.to.hex), LOS_COLORS.blind, 0.9, 2, 0.12);
    g.circle(stop.x * S, stop.y * S, 7).fill(0x101410);
    g.circle(stop.x * S, stop.y * S, 5).fill(LOS_COLORS.blocked);
  }
  for (const h of r.hindrances) {
    g.circle(h.point.x * S, h.point.y * S, 5).fill(LOS_COLORS.hindrance).stroke({ width: 1.5, color: 0x101410 });
  }
  for (const p of [a, b]) {
    g.circle(p.x * S, p.y * S, 8).fill(0x101410);
    g.circle(p.x * S, p.y * S, 5.5).fill(LOS_COLORS.end);
  }
}

/** Shade visible and hidden hexes from a viewpoint. */
export function drawViewshed(g: Graphics, map: GameMap, origin: HexKey, visible: Set<HexKey>): void {
  for (const h of Object.values(map.hexes)) {
    if (h.key === origin) continue;
    if (visible.has(h.key)) fillHex(g, h.hex, 0x7fd06a, 0.2, 0.02);
    else fillHex(g, h.hex, 0x0b0e0b, 0.45);
  }
  drawHexOutline(g, parseHexKey(origin), LOS_COLORS.end, 1, 4);
  const c = hexToPixel(parseHexKey(origin));
  g.circle(c.x * S, c.y * S, 6).fill(LOS_COLORS.end);
}
