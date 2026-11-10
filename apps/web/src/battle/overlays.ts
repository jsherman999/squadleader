import { DIRECTIONS, hexKey, hexsideEndpoints, hexsideHexes, hexToPixel, neighbor, parseHexKey, type Direction, type HexKey, type HexsideKey, type Vec2 } from '@squadwar/hex';
import { inArc, type Vehicle } from '@squadwar/engine';
import type { Rationale } from '@squadwar/bot';
import type { Action, Ctx, GameEvent, GameState } from '@squadwar/engine';
import { hexFill, hexOutline, hexPolygon, type Pen } from '../draw/pen';
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

/** Smoke screens, river mist, placed demolition charges and blown sewer entrances (§23–27, §60.5). */
export function drawSpecial(pen: Pen, s: GameState): void {
  for (const sm of s.smoke) {
    const c = at(sm.hex);
    const mist = sm.side === '__mist';
    hexFill(pen, parseHexKey(sm.hex), mist ? 0xdfe6ee : 0xd8d8d0, mist ? 0.38 : 0.45, 0.04);
    if (mist) continue;
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

const STONES: readonly [number, number, number][] = [
  [-0.35, -0.2, 5],
  [0.05, -0.38, 4],
  [0.38, -0.12, 6],
  [-0.15, 0.18, 6],
  [0.25, 0.3, 4],
  [-0.45, 0.32, 3.5],
  [0.12, 0.02, 3],
];
const FLAMES: readonly [number, number, number][] = [
  [-0.28, 0.2, 0.42],
  [0.05, 0.25, 0.55],
  [0.32, 0.22, 0.38],
];

function arcVector(h: HexKey, d: number): Vec2 {
  const a = parseHexKey(h);
  const p = hexToPixel(a);
  const q = hexToPixel(neighbor(a, DIRECTIONS[d] as Direction));
  return { x: q.x - p.x, y: q.y - p.y };
}

/** Game Set III marks (§53–62): snow, rubble, wire, entrenchments, minefields, bunkers, roadblocks and fires. */
export function drawWestern(pen: Pen, ctx: Ctx, s: GameState, snowWash = true): void {
  if (ctx.scenario.snow && snowWash) for (const h of Object.values(ctx.map.hexes)) hexFill(pen, h.hex, 0xf6f9fd, 0.45);
  for (const h of s.rubble ?? []) {
    const c = at(h);
    hexFill(pen, parseHexKey(h), 0x6e5f50, 0.62, 0.06);
    for (const [dx, dy, r] of STONES) pen.circle({ x: c.x + dx, y: c.y + dy }, r, { color: 0xb3a590, alpha: 0.95 }, { width: 1, color: 0x332a22, alpha: 0.8 });
    pen.text({ x: c.x, y: c.y + 0.52 }, 'RUBBLE', { size: 9, color: 0xf3ece0 });
  }
  const f = s.forts;
  if (f) {
    for (const h of f.trenches) {
      const c = at(h);
      const ring = Array.from({ length: 25 }, (_, i) => {
        const t = (i / 24) * Math.PI * 2;
        const r = 0.5 + (i % 2 ? 0.07 : -0.07);
        return { x: c.x + Math.cos(t) * r, y: c.y + Math.sin(t) * r };
      });
      pen.line(ring, { width: 5, color: 0x5a3d22, alpha: 0.85 });
      pen.line(ring, { width: 2, color: 0xa47a4a, alpha: 0.9 });
    }
    for (const h of f.wire) {
      const c = at(h);
      for (const dy of [-0.32, 0, 0.32]) {
        const pts: Vec2[] = [];
        for (let i = 0; i <= 10; i++) pts.push({ x: c.x - 0.55 + i * 0.11, y: c.y + dy + (i % 2 ? 0.07 : -0.07) });
        pen.line(pts, { width: 1.6, color: 0x2a2a2a, alpha: 0.9 });
      }
      for (const [dx, dy] of [[-0.3, -0.16], [0.2, -0.16], [-0.05, 0.16], [0.4, 0.16]] as const) {
        pen.line([{ x: c.x + dx - 0.06, y: c.y + dy - 0.06 }, { x: c.x + dx + 0.06, y: c.y + dy + 0.06 }], { width: 1.6, color: 0x2a2a2a });
        pen.line([{ x: c.x + dx + 0.06, y: c.y + dy - 0.06 }, { x: c.x + dx - 0.06, y: c.y + dy + 0.06 }], { width: 1.6, color: 0x2a2a2a });
      }
    }
    for (const m of f.mines) {
      const c = at(m.hex);
      for (let i = 0; i < 9; i++) {
        const t = (i / 9) * Math.PI * 2;
        pen.circle({ x: c.x + Math.cos(t) * 0.6, y: c.y + Math.sin(t) * 0.6 }, 3.2, { color: m.known ? 0xd0402e : 0xe0a040, alpha: 0.95 }, { width: 1, color: 0x101410 });
      }
      pen.text({ x: c.x, y: c.y + 0.42 }, `MINES ${m.factors}`, { size: 7, color: m.known ? 0xffd8d0 : 0xffe8b8 });
    }
    for (const b of f.bunkers) {
      const c = at(b.hex);
      for (const d of [b.facing, (b.facing + 1) % 6]) {
        const v = arcVector(b.hex, d);
        pen.line([c, { x: c.x + v.x * 0.45, y: c.y + v.y * 0.45 }], { width: 3, color: 0xf0c66b, alpha: 0.85 });
      }
      pen.poly(
        [0, 1, 2, 3, 4, 5].map((i) => ({ x: c.x + Math.cos((i * Math.PI) / 3) * 0.34, y: c.y + Math.sin((i * Math.PI) / 3) * 0.34 })),
        { color: 0x77756c, alpha: 0.95 },
        { width: 2.5, color: 0x24241f },
      );
      pen.text({ x: c.x, y: c.y + 0.5 }, `${b.capacity}+${b.ca}+${b.nca}`, { size: 7, color: 0xf2f0e6 });
    }
    for (const k of f.roadblocks) {
      const { a, da } = hexsideHexes(k as HexsideKey);
      const [p, q] = hexsideEndpoints(a, da);
      pen.line([p, q], { width: 7, color: 0x4a3218, alpha: 0.95 });
      for (let i = 1; i < 6; i++) {
        const t = i / 6;
        const m = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
        pen.line([{ x: m.x - 0.08, y: m.y - 0.08 }, { x: m.x + 0.08, y: m.y + 0.08 }], { width: 2, color: 0x7a5a30 });
      }
    }
  }
  for (const h of s.fires ?? []) {
    const c = at(h);
    hexFill(pen, parseHexKey(h), 0xe0561e, 0.32, 0.04);
    for (const [dx, dy, ht] of FLAMES) {
      const base = { x: c.x + dx, y: c.y + dy };
      pen.poly([{ x: base.x - 0.13, y: base.y }, { x: base.x, y: base.y - ht }, { x: base.x + 0.13, y: base.y }], { color: 0xff8a2a, alpha: 0.9 }, { width: 1, color: 0x8a2a10 });
      pen.poly([{ x: base.x - 0.06, y: base.y }, { x: base.x, y: base.y - ht * 0.55 }, { x: base.x + 0.06, y: base.y }], { color: 0xffe06a, alpha: 0.95 });
    }
    pen.text({ x: c.x, y: c.y + 0.55 }, 'FIRE', { size: 9, color: 0xfff0d0 });
  }
}

/**
 * Objective buildings: a gold outline round each hex, and a numbered marker
 * with the building's name on its topmost hex. The numbers match the
 * Objectives list; `focus` lights one building up (picked from that list).
 */
export function drawObjectives(pen: Pen, ctx: Ctx, focus?: string, s?: GameState): void {
  const busy = new Set(s ? Object.values(s.units).map((u) => u.hex) : []);
  ctx.objectives.forEach((o, i) => {
    const on = focus === o.name;
    for (const h of o.hexes) {
      if (on) hexFill(pen, parseHexKey(h), 0xf0c66b, 0.32, 0.04);
      hexOutline(pen, parseHexKey(h), 0xf0c66b, on ? 1 : 0.55, on ? 4.5 : 2, 0.1);
    }
    // On the top edge of the building's highest hex that leaves room for the name on the board, an empty one if there is one.
    const byHeight = [...o.hexes].sort((a, b) => at(a).y - at(b).y || at(a).x - at(b).x);
    const fits = byHeight.filter((h) => at(h).y - 1.05 >= ctx.map.bounds.y0);
    const pick = fits.find((h) => !busy.has(h)) ?? fits[0] ?? byHeight[0];
    const top = pick ? at(pick) : undefined;
    if (!top) return;
    const p = { x: top.x, y: top.y - 0.6 };
    pen.circle(p, on ? 13 : 11, { color: 0x1c1a12, alpha: 0.95 }, { width: 2, color: 0xf0c66b });
    pen.text(p, String(i + 1), { size: on ? 15 : 13, color: 0xf0c66b });
    pen.text({ x: p.x, y: p.y - 0.36 }, o.name, { size: on ? 14 : 12, color: 0xffe9b0 });
  });
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

/** Danger map colours: fill and outline for a chance under 25%, 25–50% and over 50%. */
const DANGER_FILL = [0xf0d24a, 0xe08a3a, 0xd0402e];
const DANGER_LINE = [0xa88300, 0xd06a12, 0xb82a1a];
const dangerTier = (p: number): number => (p > 0.5 ? 2 : p > 0.25 ? 1 : 0);

/**
 * The danger map: each hex shaded by the chance a squad moving through it breaks.
 * The outline sits well inside the hex, clear of the gold outline of an objective,
 * and the lowest band is dashed, so the three bands differ by more than colour.
 */
export function drawDanger(pen: Pen, hexes: Iterable<readonly [HexKey, number]>): void {
  for (const [key, p] of hexes) {
    const tier = dangerTier(p);
    const h = parseHexKey(key);
    hexFill(pen, h, DANGER_FILL[tier]!, Math.min(0.42, 0.2 + p * 0.28));
    const ring = hexPolygon(h, 0.2);
    pen.line([...ring, ring[0]!], { width: tier === 2 ? 3 : 2.5, color: DANGER_LINE[tier]!, alpha: 0.9 }, tier === 0 ? [5, 4] : undefined);
  }
}

/**
 * A tag on each of the player's own stacks that the enemy can fire on where it
 * stands: the chance one of its squads breaks if it stays put and everything in
 * sight fires. Drawn over the counters, at the top of the hex.
 */
export function drawDangerTags(pen: Pen, stacks: Iterable<readonly [HexKey, number]>): void {
  for (const [key, p] of stacks) {
    if (p < 0.005) continue;
    const c = at(key);
    const y = c.y - 0.69;
    const color = DANGER_FILL[dangerTier(p)]!;
    const w = 0.36;
    const h = 0.17;
    pen.poly(
      [
        { x: c.x - w, y: y - h },
        { x: c.x + w, y: y - h },
        { x: c.x + w, y: y + h },
        { x: c.x - w, y: y + h },
      ],
      { color: 0x15181a, alpha: 0.94 },
      { width: 2, color },
    );
    pen.text({ x: c.x, y }, `${Math.max(1, Math.round(p * 100))}%`, { size: 14, color });
  }
}

/**
 * Defensive Fire: where the enemy moved this phase (§16.1). Each unit's route
 * is a dashed line. With `canHit` (the hexes the player has a shot at), those
 * hexes get a target ring, red where the mover was caught in the open (−2 on
 * the dice), amber elsewhere, and the rest a small grey dot. Without it
 * (watching the computer) every hex gets a dot.
 */
export function drawTracks(pen: Pen, s: GameState, canHit?: ReadonlySet<HexKey>): void {
  const open = new Map<HexKey, boolean>();
  for (const steps of Object.values(s.tracks)) {
    if (steps.length > 1) pen.line(steps.map((st) => at(st.hex)), { width: 2, color: 0xfff1c9, alpha: 0.45 }, [6, 6]);
    for (const st of steps) open.set(st.hex, (open.get(st.hex) ?? false) || st.open);
  }
  for (const [hex, inOpen] of open) {
    const p = at(hex);
    const color = inOpen ? 0xff5a46 : 0xf0c66b;
    if (!canHit) {
      pen.circle({ x: p.x, y: p.y + 0.3 }, 5, { color: inOpen ? 0xff7a5a : 0xe0c070, alpha: 0.9 }, { width: 1, color: 0x101410, alpha: 0.7 });
      continue;
    }
    if (!canHit.has(hex)) {
      pen.circle({ x: p.x, y: p.y + 0.3 }, 4, { color: 0x8f8b80, alpha: 0.85 });
      continue;
    }
    // A sight ring wide enough to show round a counter, with four ticks.
    const R = 36;
    pen.circle(p, R, undefined, { width: 6, color: 0x101410, alpha: 0.45 });
    pen.circle(p, R, undefined, { width: 3.5, color, alpha: 0.95 });
    const r0 = (R - 9) / 48;
    const r1 = (R + 7) / 48;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) pen.line([{ x: p.x + dx * r0, y: p.y + dy * r0 }, { x: p.x + dx * r1, y: p.y + dy * r1 }], { width: 3.5, color, alpha: 0.95 });
    if (inOpen) pen.text({ x: p.x, y: p.y + 0.52 }, '−2 open', { size: 11, color: 0xffd8d0 });
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
