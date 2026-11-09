/** Draws Fire Director frames on the 2D board (PixiJS). */
import { Text, TextStyle, type Container, type Graphics } from 'pixi.js';
import type { BoardRenderer } from '../board/renderer';
import { HEX_PX } from '../board/palette';
import type { FxFrame } from './sample';

const S = HEX_PX;
const styles = new Map<number, TextStyle>();
function style(color: number): TextStyle {
  let st = styles.get(color);
  if (!st) {
    st = new TextStyle({ fontFamily: 'Roboto Condensed, Arial Narrow, sans-serif', fontSize: 17, fontWeight: '800', fill: color, stroke: { color: 0x0c0e0c, width: 4 }, letterSpacing: 0.3 });
    styles.set(color, st);
  }
  return st;
}

export class Fx2D {
  private matte: Graphics;
  private light: Graphics;
  private labelLayer: Container;
  private texts = new Map<string, Text>();

  constructor(private r: BoardRenderer) {
    this.matte = r.overlay('fx-matte', 'top');
    // Normal blending: additive light vanishes on the pale printed map.
    this.light = r.overlay('fx-light', 'top');
    this.labelLayer = r.container('fx-labels', 'top');
  }

  draw(f: FxFrame): void {
    const m = this.matte.clear();
    const l = this.light.clear();
    // Keep effects legible when zoomed out: widths and labels hold their screen size.
    const z = Math.max(0.25, this.r.scale);
    const k = 1 / Math.sqrt(z);
    for (const ln of f.lines) {
      m.moveTo(ln.a.x * S, ln.a.y * S).lineTo(ln.b.x * S, ln.b.y * S).stroke({ width: 6 * k, color: 0x101410, alpha: 0.5 * ln.alpha });
      m.moveTo(ln.a.x * S, ln.a.y * S).lineTo(ln.b.x * S, ln.b.y * S).stroke({ width: 3 * k, color: ln.color, alpha: ln.alpha });
    }
    for (const g of f.glows) {
      if (g.light) {
        // A flash: hot core with a darker rim so it reads on the pale map.
        l.circle(g.at.x * S, g.at.y * S, g.r * S * 1.15).fill({ color: 0x3a2008, alpha: 0.35 * g.alpha });
        l.circle(g.at.x * S, g.at.y * S, g.r * S).fill({ color: 0xffb040, alpha: 0.85 * g.alpha });
        l.circle(g.at.x * S, g.at.y * S, g.r * S * 0.5).fill({ color: g.color, alpha: g.alpha });
      } else m.circle(g.at.x * S, g.at.y * S, g.r * S).fill({ color: g.color, alpha: g.alpha * 0.8 });
    }
    for (const s of f.streaks) {
      const line = (w: number, color: number, alpha: number) =>
        l.moveTo(s.a.x * S, s.a.y * S).lineTo(s.b.x * S, s.b.y * S).stroke({ width: w * k, color, alpha: alpha * s.alpha, cap: 'round' });
      line(s.width * 2.8, 0x241406, 0.45);
      line(s.width * 1.5, s.color, 1);
      line(s.width * 0.6, 0xfff6d8, 1);
    }
    for (const g of f.ghosts) {
      const half = 0.36 * S;
      const x = g.at.x * S;
      const y = g.at.y * S;
      m.rect(x - half, y - half, half * 2, half * 2).fill({ color: 0xd8d4c4, alpha: 0.25 * g.alpha }).stroke({ width: 2 * k, color: 0xffffff, alpha: g.alpha });
    }
    // Labels: reuse Text objects by id.
    const seen = new Set<string>();
    const items = [...f.labels, ...f.ghosts.map((g, i) => ({ id: `ghost${i}`, at: g.at, text: g.text, color: 0xe7e3d6, alpha: g.alpha, stack: -1, rise: 0 }))];
    for (const it of items) {
      seen.add(it.id);
      let t = this.texts.get(it.id);
      if (!t || t.text !== it.text) {
        t?.destroy();
        t = new Text({ text: it.text, style: style(it.color), resolution: 3 });
        t.anchor.set(0.5, 1);
        this.labelLayer.addChild(t);
        this.texts.set(it.id, t);
      }
      t.scale.set(1 / z);
      // Labels sit above the counter and stack upwards; the rise follows the label's height.
      t.position.set(it.at.x * S, it.at.y * S - (14 + it.stack * 19 + it.rise * 12) / z);
      t.alpha = it.alpha;
    }
    for (const [id, t] of this.texts) {
      if (!seen.has(id)) {
        t.destroy();
        this.texts.delete(id);
      }
    }
  }

  destroy(): void {
    for (const t of this.texts.values()) t.destroy();
    this.texts.clear();
    this.matte.clear();
    this.light.clear();
  }
}
