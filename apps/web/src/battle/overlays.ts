import { hexToPixel, parseHexKey, type HexKey, type Vec2 } from '@squadwar/hex';
import type { Ctx, GameEvent, GameState } from '@squadwar/engine';
import { hexFill, hexOutline, type Pen } from '../draw/pen';
import type { PathStep } from './pathing';

const at = (h: HexKey): Vec2 => hexToPixel(parseHexKey(h));

export function drawObjectives(pen: Pen, ctx: Ctx): void {
  for (const o of ctx.objectives) for (const h of o.hexes) hexOutline(pen, parseHexKey(h), 0xf0c66b, 0.55, 2, 0.1);
}

export function drawSelection(pen: Pen, sel: HexKey | undefined, target: HexKey | undefined, groupHexes: readonly HexKey[]): void {
  for (const h of groupHexes) hexOutline(pen, parseHexKey(h), 0xf0c66b, 0.9, 3);
  if (sel) hexOutline(pen, parseHexKey(sel), 0xf0c66b, 1, 4);
  if (target) {
    hexFill(pen, parseHexKey(target), 0xff5a46, 0.18);
    hexOutline(pen, parseHexKey(target), 0xff5a46, 1, 4);
  }
}

export function drawSetupZone(pen: Pen, hexes: Iterable<HexKey>): void {
  for (const h of hexes) hexFill(pen, parseHexKey(h), 0x7fd06a, 0.12, 0.04);
}

/** Planned or hovered move path with cumulative MF labels. */
export function drawPath(pen: Pen, from: HexKey, path: readonly PathStep[], ok: boolean): void {
  if (!path.length) return;
  const pts = [at(from), ...path.map((p) => at(p.hex))];
  const color = ok ? 0x7fd06a : 0xff8a5a;
  pen.line(pts, { width: 5, color: 0x101410, alpha: 0.6 });
  pen.line(pts, { width: 2.5, color });
  for (const st of path) {
    const p = at(st.hex);
    pen.circle(p, 4, { color });
    pen.text(p, Number.isInteger(st.total) ? String(st.total) : st.total.toFixed(1), { lift: 0.9 });
  }
}

/** Lines from firing hexes to the target, yellow where LOS is clear. */
export function drawFireLines(pen: Pen, ctx: Ctx, from: readonly HexKey[], to: HexKey): void {
  for (const f of from) {
    const clear = ctx.los(f, to).clear;
    pen.line([at(f), at(to)], { width: 5, color: 0x101410, alpha: 0.55 });
    pen.line([at(f), at(to)], { width: 2.5, color: clear ? 0xffd060 : 0xff5a46, alpha: 0.95 });
  }
}

/** Faint trace of the most recent attack. */
export function drawLastFire(pen: Pen, e: GameEvent | undefined): void {
  if (!e || e.kind !== 'fire' || !e.fx) return;
  const from = (e.fx.firerHexes as HexKey[] | undefined) ?? [];
  const targets = (e.fx.targets as HexKey[] | undefined) ?? [];
  for (const f of from) for (const t of targets) pen.line([at(f), at(t)], { width: 2, color: 0xffb04a, alpha: 0.45 });
  for (const t of targets) pen.circle(at(t), 14, undefined, { width: 2, color: 0xffb04a, alpha: 0.6 });
}

/** Hexes the moving units passed through this phase (Defensive Fire targets, §16.1). */
export function drawTracks(pen: Pen, s: GameState): void {
  for (const steps of Object.values(s.tracks)) {
    for (const st of steps) {
      const p = at(st.hex);
      pen.circle({ x: p.x, y: p.y + 0.3 }, 3.5, { color: st.open ? 0xff7a5a : 0xe0c070, alpha: 0.9 });
    }
  }
}
