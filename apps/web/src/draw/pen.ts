/**
 * A tiny drawing interface for map-space overlays, implemented for the 2D
 * board (PixiJS) and the 3D view (a canvas draped over the terrain). All
 * coordinates are map units (hex circumradius = 1); widths and radii are
 * in board pixels at zoom 1 (HEX_PX per map unit).
 */
import { hexCorners, hexToPixel, type Hex, type Vec2 } from '@squadwar/hex';

export interface Stroke {
  readonly width: number;
  readonly color: number;
  readonly alpha?: number;
}

export interface TextOpts {
  readonly size?: number;
  readonly color?: number;
  /** Vertical anchor offset in multiples of the text height (1 = above the point). */
  readonly lift?: number;
}

export interface Pen {
  poly(pts: readonly Vec2[], fill?: { color: number; alpha?: number }, stroke?: Stroke): void;
  line(pts: readonly Vec2[], stroke: Stroke, dash?: [number, number]): void;
  circle(p: Vec2, r: number, fill?: { color: number; alpha?: number }, stroke?: Stroke): void;
  text(p: Vec2, s: string, opts?: TextOpts): void;
}

export function hexPolygon(h: Hex, inset = 0): Vec2[] {
  const c = hexToPixel(h);
  return hexCorners(h).map((p) => ({ x: c.x + (p.x - c.x) * (1 - inset), y: c.y + (p.y - c.y) * (1 - inset) }));
}

export function hexFill(pen: Pen, h: Hex, color: number, alpha: number, inset = 0): void {
  pen.poly(hexPolygon(h, inset), { color, alpha });
}

export function hexOutline(pen: Pen, h: Hex, color: number, alpha = 1, width = 2.5, inset = 0.04): void {
  const pts = hexPolygon(h, inset);
  pen.line([...pts, pts[0]!], { width, color, alpha });
}

export const NO_PEN: Pen = { poly() {}, line() {}, circle() {}, text() {} };
