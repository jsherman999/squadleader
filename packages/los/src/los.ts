/**
 * Line of sight, following the categorical rules of §7, §11.5, §43 and §44.2.
 *
 * Heights are in levels. Each obstacle crossed between the two hexes has a
 * height; a unit has a height (hex level, plus 2 on the upper level of a
 * multi-story building, §7.4). For each obstacle:
 *   - both units higher than it        → no effect
 *   - one unit higher than it          → the higher unit sees over it, unless
 *                                        the lower unit sits in its blind zone
 *                                        (§7.4, §43.6) and is below its height
 *   - neither unit higher than it      → blocked (except bare hill ground that
 *                                        both units are level with, §43.7)
 * Obstacles in the firing or target hex never block (§7.2). Adjacent hexes
 * always see each other (§7.8). The result is symmetric (§43.8).
 */
import {
  hexCorners,
  hexDistance,
  hexKey,
  hexToPixel,
  hexsideEndpoints,
  hexsideHexes,
  hexsideKey,
  DIRECTIONS,
  distPointSegment,
  hexRound,
  inflatePolygon,
  neighbor,
  parseHexKey,
  segmentInsideIntervals,
  vLerp,
  vCross,
  vSub,
  type Direction,
  type HexKey,
  type HexsideKey,
  type Vec2,
} from '@squadwar/hex';
import { mapGeometry, type GameMap } from '@squadwar/terrain';

export type ObstacleKind = 'woods' | 'building' | 'hill' | 'wall' | 'hedge' | 'wheat';

export interface LosObstacle {
  readonly kind: ObstacleKind;
  /** Hex holding the obstacle (for hexside features: the hex on the far side). */
  readonly hex: HexKey;
  readonly hexside?: HexsideKey;
  /** Top of the obstacle, in levels. */
  readonly height: number;
  /** Position along the LOS, 0 at the firer and 1 at the target. */
  readonly t: number;
  readonly point: Vec2;
  /** Hexes directly behind the obstacle that cannot be seen (§7.4, §43.6, §43.62). */
  readonly blind: number;
  /** The LOS only clips the edge of the symbol (§7.1 "string" disputes). */
  readonly marginal: boolean;
}

export interface LosEndpoint {
  readonly hex: HexKey;
  /** On the upper level of a multi-story building (§7.9). */
  readonly upper?: boolean;
}

export interface LosOptions {
  /** How to treat LOS that only clips the edge of a symbol. Default 'blocked' (§7.1). */
  readonly marginal?: 'blocked' | 'clear';
  /** Wheatfields exist June–October (§44.24). Default true. */
  readonly wheatInSeason?: boolean;
}

export interface CrossedHex {
  readonly key: HexKey;
  readonly t0: number;
  readonly t1: number;
}

export interface LosResult {
  readonly clear: boolean;
  readonly from: LosEndpoint;
  readonly to: LosEndpoint;
  readonly fromHeight: number;
  readonly toHeight: number;
  readonly a: Vec2;
  readonly b: Vec2;
  /** Hexes the line passes through, in order (including both ends). */
  readonly hexes: readonly CrossedHex[];
  readonly obstacles: readonly LosObstacle[];
  readonly blockedBy?: LosObstacle;
  /** True when the target sits in the obstacle's blind zone. */
  readonly blindHex: boolean;
  /** Wheatfields crossed: fire through them is Area Fire (§44.21). */
  readonly hindrances: readonly LosObstacle[];
  /** Wall/hedge on the target hex's hexside that the LOS crosses (§11.53). */
  readonly targetHexside?: { readonly wall: boolean; readonly hedge: boolean; readonly key: HexsideKey };
  /** Wall/hedge on the firer hex's hexside that the LOS crosses. */
  readonly firerHexside?: { readonly wall: boolean; readonly hedge: boolean; readonly key: HexsideKey };
  readonly marginal: boolean;
  /** Human-readable explanation with § references. */
  readonly reason: string;
}

const SYMBOL_EPS = 0.002;
const MARGINAL_LEN = 0.04;

/** Height of a unit in a hex (§7.4, §43): hex level, +2 on a multi-story upper level. */
export function unitHeight(map: GameMap, e: LosEndpoint): number {
  const h = map.hexes[e.hex];
  if (!h) return 0;
  const b = h.building ? map.buildings[h.building] : undefined;
  return h.level + (e.upper && b?.multiStory ? 2 : 0);
}

export function canBeUpper(map: GameMap, hex: HexKey): boolean {
  const h = map.hexes[hex];
  return !!(h?.building && map.buildings[h.building]?.multiStory);
}

/** Hexes the segment a→b passes through (interior), ordered along the line. */
export function crossedHexes(map: GameMap, from: HexKey, to: HexKey): CrossedHex[] {
  const A = parseHexKey(from);
  const B = parseHexKey(to);
  const a = hexToPixel(A);
  const b = hexToPixel(B);
  const n = hexDistance(A, B);
  const cand = new Set<HexKey>();
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    // Nudge to avoid exact ties, and gather both sides of the line.
    for (const eps of [1e-6, -1e-6]) {
      const h = hexRound(A.q + (B.q - A.q) * t + eps, A.r + (B.r - A.r) * t + eps);
      cand.add(hexKey(h));
      for (const d of DIRECTIONS) cand.add(hexKey(neighbor(h, d)));
    }
  }
  const out: CrossedHex[] = [];
  for (const k of cand) {
    const h = parseHexKey(k);
    if (!map.hexes[k] && k !== from && k !== to) continue;
    const c = hexToPixel(h);
    if (distPointSegment(c, a, b) > 1.0001) continue;
    const iv = segmentInsideIntervals(a, b, hexCorners(h));
    if (k === from || k === to) {
      out.push({ key: k, t0: k === from ? 0 : iv[0]?.[0] ?? 1, t1: k === from ? iv[0]?.[1] ?? 0 : 1 });
      continue;
    }
    for (const [t0, t1] of iv) out.push({ key: k, t0, t1 });
  }
  out.sort((x, y) => x.t0 - y.t0 || x.t1 - y.t1);
  return out;
}

interface SideRun {
  readonly key: HexsideKey;
  readonly t0: number;
  readonly t1: number;
}

/** Stretches where the line runs exactly along a hexside. */
function hexsideRuns(map: GameMap, a: Vec2, b: Vec2, candidates: Iterable<HexKey>): SideRun[] {
  const out = new Map<HexsideKey, SideRun>();
  const d = vSub(b, a);
  const len2 = d.x * d.x + d.y * d.y;
  for (const k of candidates) {
    const h = parseHexKey(k);
    for (const dir of DIRECTIONS) {
      const [p, q] = hexsideEndpoints(h, dir);
      if (Math.abs(vCross(d, vSub(p, a))) > 1e-6 * Math.sqrt(len2)) continue;
      if (Math.abs(vCross(d, vSub(q, a))) > 1e-6 * Math.sqrt(len2)) continue;
      const tp = ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / len2;
      const tq = ((q.x - a.x) * d.x + (q.y - a.y) * d.y) / len2;
      const t0 = Math.max(0, Math.min(tp, tq));
      const t1 = Math.min(1, Math.max(tp, tq));
      if (t1 - t0 < 1e-6) continue;
      const key = hexsideKey(h, dir);
      if (!out.has(key)) out.set(key, { key, t0, t1 });
    }
  }
  return [...out.values()];
}

export function checkLos(map: GameMap, from: LosEndpoint, to: LosEndpoint, opts: LosOptions = {}): LosResult {
  const A = parseHexKey(from.hex);
  const B = parseHexKey(to.hex);
  const a = hexToPixel(A);
  const b = hexToPixel(B);
  const V = unitHeight(map, from);
  const T = unitHeight(map, to);
  const base = { from, to, fromHeight: V, toHeight: T, a, b };
  const hexes = from.hex === to.hex ? [] : crossedHexes(map, from.hex, to.hex);
  const dist = hexDistance(A, B);

  if (dist <= 1) {
    return {
      ...base,
      clear: true,
      hexes,
      obstacles: [],
      blindHex: false,
      hindrances: [],
      ...hexsideTEM(map, from.hex, to.hex, a, b),
      marginal: false,
      reason: dist === 0 ? 'Same hex.' : 'Adjacent hexes can always see each other (§7.8).',
    };
  }

  const geo = mapGeometry(map);
  const obstacles: LosObstacle[] = [];
  const hindrances: LosObstacle[] = [];
  const level = (k: HexKey) => map.hexes[k]?.level ?? 0;

  for (const ch of hexes) {
    if (ch.key === from.hex || ch.key === to.hex) continue;
    const mh = map.hexes[ch.key];
    if (!mh) continue;
    const mid = vLerp(a, b, (ch.t0 + ch.t1) / 2);
    if (mh.level > 0) {
      obstacles.push({ kind: 'hill', hex: ch.key, height: mh.level, t: ch.t0, point: vLerp(a, b, ch.t0), blind: 1, marginal: false });
    }
    if (mh.terrain === 'wheat' && opts.wheatInSeason !== false) {
      hindrances.push({ kind: 'wheat', hex: ch.key, height: mh.level + 0.5, t: ch.t0, point: mid, blind: 0, marginal: false });
    }
  }

  // Symbols (woods, buildings) of every hex touching the line, except the two
  // ends. Hexes the line only grazes along a hexside are included too.
  const symbolHexes = new Set(hexes.map((h) => h.key));
  for (const ch of hexes) {
    for (const d of DIRECTIONS) {
      const n = neighbor(parseHexKey(ch.key), d);
      const nk = hexKey(n);
      if (map.hexes[nk] && distPointSegment(hexToPixel(n), a, b) <= 1.0001) symbolHexes.add(nk);
    }
  }
  for (const k of symbolHexes) {
    if (k === from.hex || k === to.hex) continue;
    const mh = map.hexes[k];
    if (!mh) continue;
    let firstT = Infinity;
    let total = 0;
    let kind: ObstacleKind | undefined;
    for (const s of geo.byHex[k] ?? []) {
      for (const [t0, t1] of segmentInsideIntervals(a, b, inflatePolygon(s.polygon, SYMBOL_EPS))) {
        firstT = Math.min(firstT, t0);
        total += (t1 - t0) * Math.hypot(b.x - a.x, b.y - a.y);
        kind = s.kind;
      }
    }
    if (!kind) continue;
    const multi = kind === 'building' && !!map.buildings[mh.building!]?.multiStory;
    obstacles.push({
      kind,
      hex: k,
      height: mh.level + (multi ? 2 : 1),
      t: firstT,
      point: vLerp(a, b, firstT),
      blind: multi ? 2 : 1,
      marginal: total < MARGINAL_LEN,
    });
  }

  // Lines along hexsides: hill ground counts if both sides are high.
  const runs = hexsideRuns(map, a, b, symbolHexes);
  for (const run of runs) {
    const { a: h1, b: h2 } = hexsideHexes(run.key);
    const k1 = hexKey(h1);
    const k2 = hexKey(h2);
    if ([k1, k2].some((k) => k === from.hex || k === to.hex)) continue;
    const lv = Math.min(level(k1), level(k2));
    if (lv > 0) {
      obstacles.push({ kind: 'hill', hex: k1, hexside: run.key, height: lv, t: run.t0, point: vLerp(a, b, run.t0), blind: 1, marginal: false });
    }
  }

  // Walls and hedges crossed between intermediate hexes (§11.51).
  for (let i = 0; i < hexes.length - 1; i++) {
    const cur = hexes[i]!;
    const nxt = hexes[i + 1]!;
    if (cur.key === from.hex || nxt.key === to.hex) continue;
    const side = sideBetween(cur.key, nxt.key);
    if (!side) continue;
    const s = map.hexsides[side];
    if (!s || (!s.wall && !s.hedge)) continue;
    const height = Math.max(level(cur.key), level(nxt.key)) + 0.5;
    obstacles.push({ kind: s.wall ? 'wall' : 'hedge', hex: nxt.key, hexside: side, height, t: nxt.t0, point: vLerp(a, b, nxt.t0), blind: 0, marginal: false });
  }

  obstacles.sort((x, y) => x.t - y.t);
  const ordered = hexes.map((h) => h.key);
  const marginalAny = obstacles.some((o) => o.marginal);

  let blockedBy: LosObstacle | undefined;
  let blindHex = false;
  let reason = 'Clear line of sight.';
  for (const o of obstacles) {
    if (o.marginal && opts.marginal === 'clear') continue;
    const H = o.height;
    if (V > H && T > H) continue;
    if (o.kind === 'hill' && V >= H && T >= H) continue; // same level (§43.7)
    if (Math.max(V, T) > H) {
      const lowerIsTarget = T < V;
      const lowerHex = lowerIsTarget ? to.hex : from.hex;
      const lowerH = Math.min(V, T);
      let blind = o.blind;
      if (o.kind === 'hill' && sameHill(map, ordered, lowerIsTarget ? from.hex : to.hex, o.hex, H)) blind = 0; // §43.61
      if (lowerH < H && hexDistance(parseHexKey(o.hex), parseHexKey(lowerHex)) <= blind) {
        blockedBy = o;
        blindHex = true;
        reason = `${lowerIsTarget ? 'Target' : 'Firer'} is in the blind zone behind ${describe(map, o)} (${o.kind === 'building' && o.blind === 2 ? '§43.62' : '§7.4, §43.6'}).`;
        break;
      }
      continue;
    }
    blockedBy = o;
    reason = `Blocked by ${describe(map, o)}: height ${fmt(H)}; firer at ${fmt(V)}, target at ${fmt(T)} — neither is higher (${ruleFor(o)}).`;
    break;
  }
  if (!blockedBy && hindrances.length) {
    const seen = hindrances.filter((w) => !(V > w.height || T > w.height));
    if (seen.length) reason = `Clear for fire, but through ${seen.length} wheatfield hex${seen.length > 1 ? 'es' : ''}: Area Fire (§44.21).`;
  }

  return {
    ...base,
    clear: !blockedBy,
    hexes,
    obstacles,
    ...(blockedBy ? { blockedBy } : {}),
    blindHex,
    hindrances: hindrances.filter((w) => !(V > w.height || T > w.height)),
    ...hexsideTEM(map, from.hex, to.hex, a, b),
    marginal: marginalAny,
    reason,
  };
}

/** The higher endpoint's hill continues, at or above `height`, up to the obstacle hex. */
function sameHill(map: GameMap, ordered: HexKey[], higher: HexKey, obstacleHex: HexKey, height: number): boolean {
  const lv = (k: HexKey) => map.hexes[k]?.level ?? 0;
  if (lv(higher) < height) return false;
  const i = ordered.indexOf(higher);
  const j = ordered.indexOf(obstacleHex);
  if (i < 0 || j < 0) return false;
  const [lo, hi] = i < j ? [i, j] : [j, i];
  for (let x = lo; x <= hi; x++) if (lv(ordered[x]!) < height) return false;
  return true;
}

function sideBetween(a: HexKey, b: HexKey): HexsideKey | undefined {
  const ha = parseHexKey(a);
  for (const d of DIRECTIONS) {
    if (hexKey(neighbor(ha, d)) === b) return hexsideKey(ha, d as Direction);
  }
  return undefined;
}

/** Wall/hedge hexsides of the target and firer hexes that the line crosses (§11.53). */
function hexsideTEM(map: GameMap, from: HexKey, to: HexKey, a: Vec2, b: Vec2) {
  const out: { targetHexside?: LosResult['targetHexside']; firerHexside?: LosResult['firerHexside'] } = {};
  const find = (hk: HexKey) => {
    const h = parseHexKey(hk);
    for (const d of DIRECTIONS) {
      const key = hexsideKey(h, d);
      const s = map.hexsides[key];
      if (!s || (!s.wall && !s.hedge)) continue;
      const [p, q] = hexsideEndpoints(h, d);
      if (properCross(a, b, p, q)) return { wall: !!s.wall, hedge: !!s.hedge, key };
    }
    return undefined;
  };
  const t = find(to);
  const f = find(from);
  if (t) out.targetHexside = t;
  if (f) out.firerHexside = f;
  return out;
}

function properCross(a: Vec2, b: Vec2, p: Vec2, q: Vec2): boolean {
  const d1 = vCross(vSub(b, a), vSub(p, a));
  const d2 = vCross(vSub(b, a), vSub(q, a));
  const d3 = vCross(vSub(q, p), vSub(a, p));
  const d4 = vCross(vSub(q, p), vSub(b, p));
  return d1 * d2 < -1e-12 && d3 * d4 < -1e-12;
}

function fmt(h: number): string {
  return Number.isInteger(h) ? `level ${h}` : `level ${h}`;
}

function describe(map: GameMap, o: LosObstacle): string {
  const id = map.hexes[o.hex]?.id ?? o.hex;
  switch (o.kind) {
    case 'woods':
      return `woods in ${id}`;
    case 'building': {
      const b = map.buildings[map.hexes[o.hex]?.building ?? ''];
      return `${b?.multiStory ? 'multi-story ' : ''}${b?.material ?? ''} building in ${id}`;
    }
    case 'hill':
      return `level ${o.height} hill at ${id}`;
    case 'wall':
      return `stone wall at ${id}`;
    case 'hedge':
      return `hedge at ${id}`;
    case 'wheat':
      return `wheatfield in ${id}`;
  }
}

function ruleFor(o: LosObstacle): string {
  if (o.kind === 'hill') return '§43.3';
  if (o.kind === 'wall' || o.kind === 'hedge') return '§11.51';
  return '§7.2, §43.4';
}

/**
 * Best LOS between two hexes, letting occupants of multi-story buildings be
 * on whichever level gives a clear line (§7.9).
 */
export function bestLos(map: GameMap, fromHex: HexKey, toHex: HexKey, opts: LosOptions = {}): LosResult {
  const fu = canBeUpper(map, fromHex) ? [false, true] : [false];
  const tu = canBeUpper(map, toHex) ? [false, true] : [false];
  let first: LosResult | undefined;
  for (const f of fu) {
    for (const t of tu) {
      const r = checkLos(map, { hex: fromHex, upper: f }, { hex: toHex, upper: t }, opts);
      if (r.clear) return r;
      first ??= r;
    }
  }
  return first!;
}

/** Every hex visible from `from` (by the most favourable levels). */
export function viewshed(map: GameMap, from: HexKey, opts: LosOptions = {}): Set<HexKey> {
  const out = new Set<HexKey>();
  for (const k of Object.keys(map.hexes)) {
    if (bestLos(map, from, k, opts).clear) out.add(k);
  }
  return out;
}

export interface ProfileSample {
  readonly t0: number;
  readonly t1: number;
  readonly hex: HexKey;
  readonly ground: number;
  /** Top of any obstacle symbol the line crosses in this hex. */
  readonly top?: number;
  readonly kind?: ObstacleKind;
}

/** Side-view data for the elevation profile panel (§43.9). */
export function losProfile(map: GameMap, r: LosResult): ProfileSample[] {
  return r.hexes.map((h) => {
    const mh = map.hexes[h.key];
    const ob = r.obstacles.find((o) => o.hex === h.key && (o.kind === 'woods' || o.kind === 'building'));
    return {
      t0: h.t0,
      t1: h.t1,
      hex: h.key,
      ground: mh?.level ?? 0,
      ...(ob ? { top: ob.height, kind: ob.kind } : {}),
    };
  });
}
