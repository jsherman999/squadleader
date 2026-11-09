import { DIRECTIONS, hexKey, hexToPixel, neighbor, parseHexKey, type Direction, type HexKey, type Vec2 } from '@squadwar/hex';
import { inArc, type Vehicle } from '@squadwar/engine';
import type { Rationale } from '@squadwar/bot';
import type { Action, Ctx, GameEvent, GameState } from '@squadwar/engine';
import { hexFill, hexOutline, type Pen } from '../draw/pen';
import type { PathStep } from './pathing';

const at = (h: HexKey): Vec2 => hexToPixel(parseHexKey(h));

/** A vehicle's covered arc (§29.4): the two front hex rows and a light wash over the hexes between them. */
export function drawArc(pen: Pen, ctx: Ctx, v: Vehicle, reach = 10): void {
  const start = parseHexKey(v.hex);
  for (const d of [v.facing, (v.facing + 1) % 6]) {
    let h = start;
    const pts = [hexToPixel(h)];
    for (let i = 0; i < reach; i++) {
      h = neighbor(h, DIRECTIONS[d] as Direction);
      if (!ctx.map.hexes[hexKey(h)]) break;
      pts.push(hexToPixel(h));
    }
    pen.line(pts, { width: 2.5, color: 0xf0c66b, alpha: 0.7 }, [7, 5]);
  }
  for (const h of Object.values(ctx.map.hexes)) {
    const r = Math.max(Math.abs(h.hex.q - start.q), Math.abs(h.hex.r - start.r), Math.abs(h.hex.q + h.hex.r - start.q - start.r));
    if (r === 0 || r > reach || !inArc(v.hex, v.facing, h.key)) continue;
    hexFill(pen, h.hex, 0xf0c66b, 0.07, 0.06);
  }
}

/** Night (§49): darkness everywhere except within 3 hexes of a starshell. */
export function drawNight(pen: Pen, ctx: Ctx, s: GameState): void {
  if (!ctx.scenario.night) return;
  const lit = (s.starshells ?? []).map((x) => parseHexKey(x.hex));
  for (const h of Object.values(ctx.map.hexes)) {
    const near = lit.some((l) => Math.max(Math.abs(l.q - h.hex.q), Math.abs(l.r - h.hex.r), Math.abs(l.q + l.r - h.hex.q - h.hex.r)) <= 3);
    hexFill(pen, h.hex, 0x0b1430, near ? 0.08 : 0.42);
  }
  for (const x of s.starshells ?? []) {
    const c = at(x.hex);
    pen.circle(c, 10, { color: 0xfff6c0, alpha: 0.95 }, { width: 3, color: 0xffd060, alpha: 0.6 });
    pen.text({ x: c.x, y: c.y - 0.45 }, 'STARSHELL', { size: 9, color: 0xfff6c0 });
  }
}

/** Artillery marks (§46): the request, the spotting round and the fire-for-effect blast area. */
export function drawArtillery(pen: Pen, ctx: Ctx, s: GameState, viewer?: string): void {
  for (const b of s.batteries ?? []) {
    if (!b.hex || b.mode === 'idle') continue;
    // The enemy sees spotting rounds and barrages, not requests.
    if (viewer && b.side !== viewer && b.mode === 'request') continue;
    const c = at(b.hex);
    if (b.mode === 'request') {
      pen.circle(c, 12, { color: 0x3a6fd8, alpha: 0.35 }, { width: 2.5, color: 0x3a6fd8 });
      pen.text(c, 'ART REQ', { size: 9, color: 0xdfe8ff, lift: 0.5 });
    } else if (b.mode === 'sr') {
      pen.circle(c, 9, { color: 0xd04030, alpha: 0.85 }, { width: 2, color: 0x101410 });
      pen.text({ x: c.x, y: c.y - 0.4 }, `SR ${b.mm}`, { size: 9, color: 0xffe0d8 });
    } else {
      for (const h of [b.hex, ...[0, 1, 2, 3, 4, 5].map((d) => hexKey(neighbor(parseHexKey(b.hex!), d as Direction)))]) {
        if (!ctx.map.hexes[h]) continue;
        hexFill(pen, parseHexKey(h), b.smoke ? 0xd8d8d0 : 0xd04030, 0.16, 0.05);
        hexOutline(pen, parseHexKey(h), b.smoke ? 0x9a9a92 : 0xd04030, 0.8, 2, 0.05);
      }
      pen.text({ x: c.x, y: c.y - 0.45 }, `FFE ${b.mm}${b.smoke ? ' smoke' : ''}`, { size: 10, color: 0xffe0d8 });
    }
  }
}

/** Smoke screens, placed demolition charges and blown sewer entrances (§23–27). */
export function drawSpecial(pen: Pen, s: GameState): void {
  for (const sm of s.smoke) {
    const c = at(sm.hex);
    hexFill(pen, parseHexKey(sm.hex), 0xd8d8d0, 0.45, 0.04);
    for (const [dx, dy, r] of [
      [-0.3, -0.12, 0.34],
      [0.12, -0.3, 0.3],
      [0.3, 0.08, 0.36],
      [-0.1, 0.24, 0.32],
      [0, 0, 0.38],
    ] as const) {
      pen.circle({ x: c.x + dx, y: c.y + dy }, r * 44, { color: 0xf2f2ec, alpha: 0.42 }, { width: 1, color: 0x8a8a82, alpha: 0.4 });
    }
    pen.text({ x: c.x, y: c.y - 0.55 }, 'SMOKE', { size: 10, color: 0x2a2a26 });
  }
  for (const ch of s.charges) {
    const c = at(ch.target);
    const color = ch.armed ? 0xff6a3a : 0xe0a040;
    pen.line([at(ch.from), c], { width: 2, color, alpha: 0.8 }, [5, 4]);
    pen.circle({ x: c.x + 0.42, y: c.y - 0.42 }, 9, { color: 0x2a1a10, alpha: 0.9 }, { width: 2, color });
    pen.text({ x: c.x + 0.42, y: c.y - 0.42 }, 'DC', { size: 8, color, lift: 0.5 });
  }
  for (const h of s.closedSewers) {
    const c = at(h);
    const p = { x: c.x + 0.42, y: c.y + 0.4 };
    pen.line([{ x: p.x - 0.12, y: p.y - 0.12 }, { x: p.x + 0.12, y: p.y + 0.12 }], { width: 2.5, color: 0xd0402e });
    pen.line([{ x: p.x + 0.12, y: p.y - 0.12 }, { x: p.x - 0.12, y: p.y + 0.12 }], { width: 2.5, color: 0xd0402e });
  }
}

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

const TUTOR = 0x7ad3ff;

/** What a bot decision was about: its route, target or goal (tutor mode). */
export function drawFocus(pen: Pen, note: Rationale | undefined, action: Action | undefined): void {
  const f = note?.focus;
  if (!f && !action) return;
  if (f?.goal) {
    hexOutline(pen, parseHexKey(f.goal), TUTOR, 0.9, 3, 0.16);
    pen.text(at(f.goal), 'goal', { size: 10, color: TUTOR, lift: 1.6 });
  }
  if (action?.type === 'fire') {
    const src = f?.from ? [f.from] : [];
    for (const h of src) {
      pen.line([at(h), at(action.target)], { width: 7, color: 0x101410, alpha: 0.55 });
      pen.line([at(h), at(action.target)], { width: 3.5, color: 0xffb04a });
    }
    hexFill(pen, parseHexKey(action.target), 0xff5a46, 0.2);
    hexOutline(pen, parseHexKey(action.target), 0xff5a46, 1, 4);
    if (f?.from) hexOutline(pen, parseHexKey(f.from), 0xffb04a, 1, 3);
    return;
  }
  if (f?.path && f.from) {
    const pts = [at(f.from), ...f.path.map(at)];
    pen.line(pts, { width: 6, color: 0x101410, alpha: 0.45 });
    pen.line(pts, { width: 3, color: TUTOR, alpha: 0.9 }, [9, 6]);
  }
  if (f?.from && f.to) {
    pen.line([at(f.from), at(f.to)], { width: 7, color: 0x101410, alpha: 0.6 });
    pen.line([at(f.from), at(f.to)], { width: 4, color: action?.type === 'advance' ? 0xffd060 : TUTOR });
    pen.circle(at(f.to), 6, { color: action?.type === 'advance' ? 0xffd060 : TUTOR }, { width: 1.5, color: 0x101410 });
  }
  if (f?.from) hexOutline(pen, parseHexKey(f.from), action?.type === 'rally' ? 0x7fd06a : 0xf0c66b, 1, 3.5);
}
