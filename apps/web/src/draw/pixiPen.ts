import { Text, TextStyle, type Container, type Graphics } from 'pixi.js';
import type { Vec2 } from '@squadwar/hex';
import { HEX_PX } from '../board/palette';
import type { Pen, Stroke, TextOpts } from './pen';

const S = HEX_PX;
const flat = (pts: readonly Vec2[]) => pts.flatMap((p) => [p.x * S, p.y * S]);
const styles = new Map<string, TextStyle>();

/** Pen over a Pixi Graphics, with text into a sibling container. */
export function pixiPen(g: Graphics, labels?: Container): Pen {
  return {
    poly(pts, fill, stroke) {
      g.poly(flat(pts));
      if (fill) g.fill({ color: fill.color, alpha: fill.alpha ?? 1 });
      if (stroke) g.stroke({ width: stroke.width, color: stroke.color, alpha: stroke.alpha ?? 1 });
    },
    line(pts, stroke: Stroke, dash) {
      if (pts.length < 2) return;
      if (!dash) {
        g.moveTo(pts[0]!.x * S, pts[0]!.y * S);
        for (const p of pts.slice(1)) g.lineTo(p.x * S, p.y * S);
        g.stroke({ width: stroke.width, color: stroke.color, alpha: stroke.alpha ?? 1, cap: 'round', join: 'round' });
        return;
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        const len = Math.hypot(b.x - a.x, b.y - a.y) * S;
        const [on, off] = dash;
        for (let d = 0; d < len; d += on + off) {
          const t0 = d / len;
          const t1 = Math.min(1, (d + on) / len);
          g.moveTo((a.x + (b.x - a.x) * t0) * S, (a.y + (b.y - a.y) * t0) * S).lineTo((a.x + (b.x - a.x) * t1) * S, (a.y + (b.y - a.y) * t1) * S);
        }
      }
      g.stroke({ width: stroke.width, color: stroke.color, alpha: stroke.alpha ?? 1 });
    },
    circle(p, r, fill, stroke) {
      g.circle(p.x * S, p.y * S, r);
      if (fill) g.fill({ color: fill.color, alpha: fill.alpha ?? 1 });
      if (stroke) g.stroke({ width: stroke.width, color: stroke.color, alpha: stroke.alpha ?? 1 });
    },
    text(p, s, opts: TextOpts = {}) {
      if (!labels) return;
      const key = `${opts.size ?? 11}|${opts.color ?? 0xffffff}`;
      let style = styles.get(key);
      if (!style) {
        style = new TextStyle({ fontFamily: 'Roboto Condensed, Arial Narrow, sans-serif', fontSize: opts.size ?? 11, fontWeight: '700', fill: opts.color ?? 0xffffff, stroke: { color: 0x000000, width: 3 } });
        styles.set(key, style);
      }
      const t = new Text({ text: s, style, resolution: 3 });
      t.anchor.set(0.5, 0.5 + (opts.lift ?? 0));
      t.position.set(p.x * S, p.y * S);
      labels.addChild(t);
    },
  };
}
