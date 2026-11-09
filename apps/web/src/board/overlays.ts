import type { Graphics } from 'pixi.js';
import { hexCorners, type Hex } from '@squadwar/hex';
import { HEX_PX } from './palette';

export function hexPoly(h: Hex, inset = 0): number[] {
  return hexCorners(h).flatMap((p) => {
    const c = { x: 1.5 * h.q, y: Math.sqrt(3) * (h.r + h.q / 2) };
    const k = 1 - inset;
    return [(c.x + (p.x - c.x) * k) * HEX_PX, (c.y + (p.y - c.y) * k) * HEX_PX];
  });
}

export function drawHexOutline(g: Graphics, h: Hex, color: number, alpha = 1, width = 2.5, inset = 0.04): void {
  g.poly(hexPoly(h, inset)).stroke({ width, color, alpha });
}

export function fillHex(g: Graphics, h: Hex, color: number, alpha: number, inset = 0): void {
  g.poly(hexPoly(h, inset)).fill({ color, alpha });
}
