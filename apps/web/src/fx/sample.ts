/**
 * What the Fire Director shows at time t: tracer streaks, glows (muzzle
 * flashes, sparks), dust puffs, labels, static lines and ghosts. Pure;
 * the 2D board and the 3D scene both draw these primitives.
 */
import { mulberry32, type HexKey } from '@squadwar/hex';
import { TONE_COLOR, type Cue, type Pt } from './timeline';

export interface Streak {
  readonly a: Pt;
  readonly b: Pt;
  readonly color: number;
  readonly alpha: number;
  /** Board pixels at zoom 1 (2D) / relative thickness (3D). */
  readonly width: number;
}
export interface Glow {
  readonly at: Pt;
  /** Radius in map units. */
  readonly r: number;
  readonly color: number;
  readonly alpha: number;
  /** Additive light (flashes, sparks) or matte (dust, smoke). */
  readonly light: boolean;
}
export interface FxLabel {
  readonly id: string;
  readonly at: Pt;
  readonly text: string;
  readonly color: number;
  readonly alpha: number;
  /** Position in a stack of labels on one hex (0 = lowest). */
  readonly stack: number;
  /** 0..1 over the label's life: labels drift up as they fade. */
  readonly rise: number;
}
export interface FxLine {
  readonly a: Pt;
  readonly b: Pt;
  readonly color: number;
  readonly alpha: number;
}
export interface FxGhost {
  readonly at: Pt;
  readonly text: string;
  readonly alpha: number;
}

export interface FxFrame {
  readonly streaks: Streak[];
  readonly glows: Glow[];
  readonly labels: FxLabel[];
  readonly lines: FxLine[];
  readonly ghosts: FxGhost[];
  /** Hexes being hit right now, 0..1 intensity (POV shake). */
  readonly hits: Map<HexKey, number>;
}

const STREAK_LEN = 1.5;
const DUST = 0xb39d78;

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Per-round randomness for a burst, stable across frames. */
function rounds(c: Extract<Cue, { kind: 'burst' }>) {
  const r = mulberry32(c.seed);
  return Array.from({ length: c.rounds }, (_, i) => {
    const ang = r() * Math.PI * 2;
    const rad = Math.sqrt(r()) * c.spread;
    const miss = r() < 0.25; // some rounds overshoot or fall short
    return {
      start: c.t0 + i * c.interval + (r() - 0.5) * c.interval * 0.5,
      from: { x: c.from.x + (r() - 0.5) * 0.3, y: c.from.y + (r() - 0.5) * 0.3, z: c.from.z },
      to: { x: c.to.x + Math.cos(ang) * rad * (miss ? 1.8 : 1), y: c.to.y + Math.sin(ang) * rad * (miss ? 1.8 : 1), z: Math.max(0, c.to.z + (r() - 0.5) * 0.5) },
      tracer: c.weapon === 'rifle' ? i % 2 === 0 : i % 3 !== 2,
    };
  });
}
const roundCache = new WeakMap<Cue, ReturnType<typeof rounds>>();

export function sampleFx(cues: readonly Cue[], t: number): FxFrame {
  const f: FxFrame = { streaks: [], glows: [], labels: [], lines: [], ghosts: [], hits: new Map() };
  cues.forEach((c, ci) => {
    if (c.kind === 'sound' || c.kind === 'dice') return;
    if (c.kind === 'hit') {
      const u = (t - c.t0) / 0.45;
      if (u >= 0 && u <= 1) f.hits.set(c.hex, Math.max(f.hits.get(c.hex) ?? 0, (c.severity === 'hit' ? 1 : 0.45) * (1 - u)));
      return;
    }
    const local = t - c.t0;
    if (local < 0 || local > c.dur) return;
    const u = local / c.dur;
    switch (c.kind) {
      case 'burst': {
        let rs = roundCache.get(c);
        if (!rs) roundCache.set(c, (rs = rounds(c)));
        for (const r of rs) {
          const dist = Math.hypot(r.to.x - r.from.x, r.to.y - r.from.y) || 1;
          const travel = dist / c.speed;
          const p = (t - r.start) / travel;
          // Muzzle flash.
          const fl = (t - r.start) / 0.06;
          if (fl >= 0 && fl <= 1) f.glows.push({ at: r.from, r: c.weapon === 'HMG' ? 0.32 : 0.24, color: 0xfff1b0, alpha: 1 - fl, light: true });
          if (p >= 0 && p <= 1 && r.tracer) {
            const head = lerp(r.from, r.to, p);
            const tail = lerp(r.from, r.to, Math.max(0, p - STREAK_LEN / dist));
            f.streaks.push({ a: tail, b: head, color: c.color, alpha: 1, width: c.weapon === 'HMG' ? 3.2 : c.weapon === 'rifle' ? 1.8 : 2.4 });
          }
          // Impact: a spark, then dust.
          const imp = (t - (r.start + travel)) / 0.55;
          if (imp >= 0 && imp <= 1) {
            if (imp < 0.18) f.glows.push({ at: r.to, r: 0.16, color: 0xffd28a, alpha: 1 - imp / 0.18, light: true });
            f.glows.push({ at: { ...r.to, z: r.to.z + imp * 0.25 }, r: 0.1 + imp * 0.28, color: DUST, alpha: 0.55 * (1 - imp), light: false });
          }
        }
        break;
      }
      case 'line': {
        const a = u < 0.15 ? u / 0.15 : u > 0.7 ? (1 - u) / 0.3 : 1;
        f.lines.push({ a: c.from, b: c.to, color: c.color, alpha: clamp01(a) });
        break;
      }
      case 'melee': {
        const r = mulberry32(c.seed + Math.floor(local * 14));
        for (let i = 0; i < 4; i++) {
          const at = { x: c.at.x + (r() - 0.5) * 1.1, y: c.at.y + (r() - 0.5) * 1.0, z: c.at.z + r() * 0.4 };
          f.glows.push({ at, r: 0.12 + r() * 0.14, color: r() < 0.5 ? 0xfff1b0 : 0xffa060, alpha: 0.9 * (1 - u * 0.5), light: true });
        }
        f.glows.push({ at: c.at, r: 0.55 + u * 0.3, color: DUST, alpha: 0.35 * Math.sin(u * Math.PI), light: false });
        break;
      }
      case 'puff': {
        f.glows.push({ at: { ...c.at, z: c.at.z + u * 0.6 }, r: c.size * (0.3 + u * 0.7), color: c.color, alpha: 0.7 * (1 - u), light: false });
        break;
      }
      case 'label': {
        const a = u < 0.1 ? u / 0.1 : u > 0.75 ? (1 - u) / 0.25 : 1;
        f.labels.push({ id: `${ci}`, at: { ...c.at, z: c.at.z + u * 0.35 }, text: c.text, color: TONE_COLOR[c.tone], alpha: clamp01(a), stack: c.stack ?? 0, rise: u });
        break;
      }
      case 'ghost': {
        const a = u < 0.1 ? u / 0.1 : u > 0.8 ? (1 - u) / 0.2 : 1;
        f.ghosts.push({ at: c.at, text: c.text, alpha: clamp01(a) * (0.55 + 0.15 * Math.sin(local * 8)) });
        break;
      }
    }
  });
  return f;
}

export const EMPTY_FRAME: FxFrame = { streaks: [], glows: [], labels: [], lines: [], ghosts: [], hits: new Map() };
