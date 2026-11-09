import type { Vec2 } from '@squadwar/hex';
import { HEX_PX } from '../board/palette';
import type { Pen } from './pen';

const css = (color: number, alpha = 1) => `rgba(${(color >> 16) & 255},${(color >> 8) & 255},${color & 255},${alpha})`;

/**
 * Pen over a 2D canvas whose transform maps map units to canvas pixels
 * (`ppu` pixels per map unit). Text is handed to `onText` because labels
 * read better as 3D sprites than as texels on the ground.
 */
export function canvasPen(c: CanvasRenderingContext2D, ppu: number, onText?: (p: Vec2, s: string, size: number, color: number, lift: number) => void): Pen {
  const k = ppu / HEX_PX; // board pixels → canvas pixels
  const path = (pts: readonly Vec2[]) => {
    c.beginPath();
    c.moveTo(pts[0]!.x, pts[0]!.y);
    for (const p of pts.slice(1)) c.lineTo(p.x, p.y);
  };
  return {
    poly(pts, fill, stroke) {
      if (pts.length < 3) return;
      path(pts);
      c.closePath();
      if (fill) {
        c.fillStyle = css(fill.color, fill.alpha ?? 1);
        c.fill();
      }
      if (stroke) {
        c.lineWidth = (stroke.width * k) / ppu;
        c.strokeStyle = css(stroke.color, stroke.alpha ?? 1);
        c.stroke();
      }
    },
    line(pts, stroke, dash) {
      if (pts.length < 2) return;
      path(pts);
      c.lineWidth = (Math.max(stroke.width, 2) * k) / ppu;
      c.strokeStyle = css(stroke.color, stroke.alpha ?? 1);
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.setLineDash(dash ? dash.map((d) => (d * k) / ppu) : []);
      c.stroke();
      c.setLineDash([]);
    },
    circle(p, r, fill, stroke) {
      c.beginPath();
      c.arc(p.x, p.y, (r * k) / ppu, 0, Math.PI * 2);
      if (fill) {
        c.fillStyle = css(fill.color, fill.alpha ?? 1);
        c.fill();
      }
      if (stroke) {
        c.lineWidth = (stroke.width * k) / ppu;
        c.strokeStyle = css(stroke.color, stroke.alpha ?? 1);
        c.stroke();
      }
    },
    text(p, s, opts = {}) {
      onText?.(p, s, opts.size ?? 11, opts.color ?? 0xffffff, opts.lift ?? 0);
    },
  };
}
