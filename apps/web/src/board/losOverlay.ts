import { hexsideEndpoints, hexsideHexes, hexToPixel, parseHexKey, type HexKey, type Vec2 } from '@squadwar/hex';
import { mapGeometry, type GameMap } from '@squadwar/terrain';
import type { LosResult } from '@squadwar/los';
import { hexFill, hexOutline, type Pen } from '../draw/pen';

export const LOS_COLORS = { clear: 0x6fe06a, blocked: 0xff5a46, hindrance: 0xf2d04b, end: 0xf0c66b, blind: 0xff7a5a };

/** The obstruction and markers of an LOS check (shared by 2D and 3D). */
export function drawLosMarks(pen: Pen, map: GameMap, r: LosResult): void {
  const o = r.blockedBy;
  if (o) {
    if (o.kind === 'woods' || o.kind === 'building') {
      for (const s of mapGeometry(map).byHex[o.hex] ?? []) pen.poly(s.polygon, { color: LOS_COLORS.blocked, alpha: 0.35 }, { width: 2.5, color: LOS_COLORS.blocked });
    } else if ((o.kind === 'wall' || o.kind === 'hedge') && o.hexside) {
      const { a: h, da } = hexsideHexes(o.hexside);
      pen.line(hexsideEndpoints(h, da), { width: 7, color: LOS_COLORS.blocked, alpha: 0.85 });
    } else {
      hexFill(pen, parseHexKey(o.hex), LOS_COLORS.blocked, 0.22);
      hexOutline(pen, parseHexKey(o.hex), LOS_COLORS.blocked, 0.9, 2.5);
    }
    if (r.blindHex) hexOutline(pen, parseHexKey(r.to.hex === o.hex ? r.from.hex : r.to.hex), LOS_COLORS.blind, 0.9, 2, 0.12);
  }
  for (const h of r.hindrances) pen.circle(h.point, 5, { color: LOS_COLORS.hindrance }, { width: 1.5, color: 0x101410 });
}

/** Draw the LOS line on the map plane, its obstruction and hindrances. */
export function drawLos(pen: Pen, map: GameMap, r: LosResult): void {
  const { a, b } = r;
  const stop: Vec2 = r.blockedBy ? r.blockedBy.point : b;
  pen.line([a, stop], { width: 7, color: 0x101410, alpha: 0.7 });
  pen.line([a, stop], { width: 3.5, color: LOS_COLORS.clear });
  if (r.blockedBy) {
    pen.line([stop, b], { width: 6, color: 0x101410, alpha: 0.95 }, [10, 7]);
    pen.line([stop, b], { width: 3, color: LOS_COLORS.blocked }, [10, 7]);
  }
  drawLosMarks(pen, map, r);
  if (r.blockedBy) {
    pen.circle(stop, 7, { color: 0x101410 });
    pen.circle(stop, 5, { color: LOS_COLORS.blocked });
  }
  for (const p of [a, b]) {
    pen.circle(p, 8, { color: 0x101410 });
    pen.circle(p, 5.5, { color: LOS_COLORS.end });
  }
}

/** Shade visible and hidden hexes from a viewpoint. */
export function drawViewshed(pen: Pen, map: GameMap, origin: HexKey, visible: Set<HexKey>): void {
  for (const h of Object.values(map.hexes)) {
    if (h.key === origin) continue;
    if (visible.has(h.key)) hexFill(pen, h.hex, 0x7fd06a, 0.2, 0.02);
    else hexFill(pen, h.hex, 0x0b0e0b, 0.45);
  }
  hexOutline(pen, parseHexKey(origin), LOS_COLORS.end, 1, 4);
  pen.circle(hexToPixel(parseHexKey(origin)), 6, { color: LOS_COLORS.end });
}
