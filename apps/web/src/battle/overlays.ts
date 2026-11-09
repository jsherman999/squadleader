import type { Container, Graphics} from 'pixi.js';
import { Text, TextStyle } from 'pixi.js';
import { hexToPixel, parseHexKey, type HexKey, type Vec2 } from '@squadwar/hex';
import type { Ctx, GameState, GameEvent } from '@squadwar/engine';
import { drawHexOutline, fillHex } from '../board/overlays';
import { HEX_PX } from '../board/palette';
import type { PathStep } from './pathing';

const S = HEX_PX;
const label = new TextStyle({ fontFamily: 'Roboto Condensed, Arial Narrow, sans-serif', fontSize: 11, fontWeight: '700', fill: 0xffffff, stroke: { color: 0x000000, width: 3 } });

const px = (h: HexKey): Vec2 => {
  const p = hexToPixel(parseHexKey(h));
  return { x: p.x * S, y: p.y * S };
};

export function drawObjectives(g: Graphics, ctx: Ctx, s: GameState): void {
  for (const o of ctx.objectives) {
    for (const h of o.hexes) drawHexOutline(g, parseHexKey(h), 0xf0c66b, 0.55, 2, 0.1);
  }
  void s;
}

export function drawSelection(g: Graphics, sel: HexKey | undefined, target: HexKey | undefined, groupHexes: readonly HexKey[]): void {
  for (const h of groupHexes) drawHexOutline(g, parseHexKey(h), 0xf0c66b, 0.9, 3);
  if (sel) drawHexOutline(g, parseHexKey(sel), 0xf0c66b, 1, 4);
  if (target) {
    fillHex(g, parseHexKey(target), 0xff5a46, 0.18);
    drawHexOutline(g, parseHexKey(target), 0xff5a46, 1, 4);
  }
}

export function drawSetupZone(g: Graphics, hexes: Iterable<HexKey>): void {
  for (const h of hexes) fillHex(g, parseHexKey(h), 0x7fd06a, 0.12, 0.04);
}

/** Planned or hovered move path with cumulative MF labels. */
export function drawPath(g: Graphics, labels: Container, from: HexKey, path: readonly PathStep[], ok: boolean): void {
  if (!path.length) return;
  const pts = [px(from), ...path.map((p) => px(p.hex))];
  const color = ok ? 0x7fd06a : 0xff8a5a;
  g.moveTo(pts[0]!.x, pts[0]!.y);
  for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
  g.stroke({ width: 5, color: 0x101410, alpha: 0.6, cap: 'round', join: 'round' });
  g.moveTo(pts[0]!.x, pts[0]!.y);
  for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
  g.stroke({ width: 2.5, color, cap: 'round', join: 'round' });
  path.forEach((st) => {
    const p = px(st.hex);
    g.circle(p.x, p.y, 4).fill(color);
    const t = new Text({ text: fmt(st.total), style: label, resolution: 3 });
    t.anchor.set(0.5, 1.4);
    t.position.set(p.x, p.y);
    labels.addChild(t);
  });
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Lines from firing hexes to the target, green where LOS is clear. */
export function drawFireLines(g: Graphics, ctx: Ctx, from: readonly HexKey[], to: HexKey): void {
  for (const f of from) {
    const a = px(f);
    const b = px(to);
    const clear = ctx.los(f, to).clear;
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 5, color: 0x101410, alpha: 0.55 });
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2.5, color: clear ? 0xffd060 : 0xff5a46, alpha: 0.95 });
  }
}

/** Faint trace of the most recent attack. */
export function drawLastFire(g: Graphics, e: GameEvent | undefined): void {
  if (!e || e.kind !== 'fire' || !e.fx) return;
  const from = (e.fx.firerHexes as HexKey[] | undefined) ?? [];
  const targets = (e.fx.targets as HexKey[] | undefined) ?? [];
  for (const f of from) {
    for (const t of targets) {
      const a = px(f);
      const b = px(t);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2, color: 0xffb04a, alpha: 0.45 });
    }
  }
  for (const t of targets) {
    const b = px(t);
    g.circle(b.x, b.y, 14).stroke({ width: 2, color: 0xffb04a, alpha: 0.6 });
  }
}

/** Hexes the moving units passed through this phase (Defensive Fire targets, §16.1). */
export function drawTracks(g: Graphics, s: GameState): void {
  for (const steps of Object.values(s.tracks)) {
    for (const st of steps) {
      const p = px(st.hex);
      g.circle(p.x, p.y + 14, 3.5).fill({ color: st.open ? 0xff7a5a : 0xe0c070, alpha: 0.9 });
    }
  }
}
