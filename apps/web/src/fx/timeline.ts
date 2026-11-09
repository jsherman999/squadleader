/**
 * The Fire Director's script (PLAN.md §7.5): turns the events of one game
 * action into timed cues — tracer bursts, muzzle flashes, impacts, close
 * combat, dice and result labels. Pure and deterministic, so 2D, 3D, sound
 * and the dice tray all play the same thing, and it can be tested.
 *
 * Positions are map units (x, y) plus a height z in rules levels.
 */
import { hexToPixel, parseHexKey, type HexKey } from '@squadwar/hex';
import type { Ctx, GameEvent, GameState } from '@squadwar/engine';
import { buildingLevels, EYE } from '../scene3d/heights';

export interface Pt {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type WeaponFx = 'rifle' | 'LMG' | 'MMG' | 'HMG';
export type Tone = 'bad' | 'warn' | 'good' | 'info';
export type SoundId = 'burst' | 'impact' | 'melee' | 'clank' | 'whizz' | 'flame' | 'blast' | 'hiss';

export type Cue =
  | { readonly kind: 'burst'; readonly t0: number; readonly dur: number; readonly from: Pt; readonly to: Pt; readonly weapon: WeaponFx; readonly rounds: number; readonly interval: number; readonly speed: number; readonly color: number; readonly seed: number; readonly spread: number }
  | { readonly kind: 'line'; readonly t0: number; readonly dur: number; readonly from: Pt; readonly to: Pt; readonly color: number }
  | { readonly kind: 'melee'; readonly t0: number; readonly dur: number; readonly at: Pt; readonly seed: number }
  | { readonly kind: 'puff'; readonly t0: number; readonly dur: number; readonly at: Pt; readonly size: number; readonly color: number }
  /** A flamethrower jet from the firer to the target hex (§22). */
  | { readonly kind: 'flame'; readonly t0: number; readonly dur: number; readonly from: Pt; readonly to: Pt; readonly seed: number }
  /** A demolition charge going off (§23). */
  | { readonly kind: 'blast'; readonly t0: number; readonly dur: number; readonly at: Pt; readonly seed: number }
  /** A smoke screen billowing up (§24). */
  | { readonly kind: 'smoke'; readonly t0: number; readonly dur: number; readonly at: Pt; readonly seed: number }
  | { readonly kind: 'label'; readonly t0: number; readonly dur: number; readonly at: Pt; readonly text: string; readonly tone: Tone; readonly stack?: number }
  | { readonly kind: 'ghost'; readonly t0: number; readonly dur: number; readonly at: Pt; readonly text: string }
  | { readonly kind: 'sound'; readonly t0: number; readonly sound: SoundId; readonly at: Pt; readonly weapon?: WeaponFx; readonly rounds?: number; readonly interval?: number }
  | { readonly kind: 'dice'; readonly t0: number; readonly dur: number; readonly dice: readonly number[]; readonly text: string; readonly tone: Tone }
  /** Units moving one hex (or a straight run): counters slide from `from` to `to`. */
  | { readonly kind: 'slide'; readonly t0: number; readonly dur: number; readonly units: readonly string[]; readonly from: Pt; readonly to: Pt }
  /** Something hit (or nearly hit) a hex: the POV camera shakes if it is there. */
  | { readonly kind: 'hit'; readonly t0: number; readonly hex: HexKey; readonly severity: 'near' | 'hit' };

export interface Timeline {
  readonly cues: readonly Cue[];
  /** When the board should switch to the new state (results land). */
  readonly commitAt: number;
  readonly duration: number;
}

export interface TimelineOptions {
  /** Time scale (1 = normal); 0 means no animation. */
  readonly scale: number;
  readonly reducedMotion: boolean;
  readonly dice: boolean;
}

export const TONE_COLOR: Record<Tone, number> = { bad: 0xff6a55, warn: 0xffb04a, good: 0x8fe07a, info: 0xe7e3d6 };
export const SIDE_TRACER: Record<string, number> = { german: 0xffa040, russian: 0xc8ff70, american: 0xfff0a0 };

const WEAPON: Record<WeaponFx, { rounds: number; interval: number; spread: number }> = {
  rifle: { rounds: 6, interval: 0.085, spread: 0.55 },
  LMG: { rounds: 11, interval: 0.06, spread: 0.42 },
  MMG: { rounds: 15, interval: 0.055, spread: 0.36 },
  HMG: { rounds: 17, interval: 0.07, spread: 0.32 },
};
/** Tracer speed in map units per second (slowed down so the eye can follow). */
const TRACER_SPEED = 24;

interface FireFx {
  readonly firerHexes?: readonly HexKey[];
  readonly targets?: readonly HexKey[];
  readonly kinds?: readonly string[];
  readonly shooters?: readonly { hex: HexKey; kind: string; unit: string }[];
  readonly outcomes?: readonly { hex: HexKey; penetration: boolean; results: readonly { unit: string; result: string | number }[] }[];
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Where units in a hex stand: on the ground, or on the roof line of a building (as the 3D standees do). */
export function hexPoint(ctx: Ctx, hex: HexKey, lift = 0): Pt {
  const h = ctx.map.hexes[hex];
  const c = hexToPixel(parseHexKey(hex));
  if (!h) return { x: c.x, y: c.y, z: 0 };
  const b = h.building ? ctx.map.buildings[h.building] : undefined;
  return { x: c.x, y: c.y, z: h.level + (b ? buildingLevels(b).ridge : 0) + lift };
}

function weaponOf(kind: string): WeaponFx {
  return kind === 'LMG' || kind === 'MMG' || kind === 'HMG' ? kind : 'rifle';
}

function iftLabel(r: string | number): { text: string; tone: Tone } {
  if (r === 'KIA') return { text: 'KIA', tone: 'bad' };
  if (r === 'M') return { text: 'MC', tone: 'warn' };
  if (r === '-') return { text: 'No effect', tone: 'info' };
  return { text: `+${r} MC`, tone: 'warn' };
}

const MORALE_LABEL: Record<string, { text: string; tone: Tone }> = {
  pass: { text: 'Pass', tone: 'good' },
  failed: { text: 'Fails', tone: 'warn' },
  broken: { text: 'Broken', tone: 'bad' },
  berserk: { text: 'Berserk!', tone: 'bad' },
  rallied: { text: 'Rallied', tone: 'good' },
  casualty: { text: 'Rolled 12!', tone: 'bad' },
  repaired: { text: 'Repaired', tone: 'good' },
  removed: { text: 'Weapon lost', tone: 'bad' },
  jammed: { text: 'Still jammed', tone: 'info' },
};

/** Build the cues for one action's events, or undefined if nothing is worth animating. */
export function buildTimeline(ctx: Ctx, before: GameState, events: readonly GameEvent[], opts: TimelineOptions): Timeline | undefined {
  if (opts.scale <= 0) return undefined;
  const k = opts.scale;
  const cues: Cue[] = [];
  const nation = (side: string | undefined) => before.sides.find((x) => x.id === side)?.nation ?? 'german';
  const unitHex = (id: string): HexKey | undefined => before.units[id]?.hex;
  /** Labels stack upwards when several land on one hex. */
  const labelsAt = new Map<HexKey, number>();
  const label = (hex: HexKey | undefined, t0: number, text: string, tone: Tone, dur = 1.6) => {
    if (!hex || !ctx.map.hexes[hex]) return;
    const n = labelsAt.get(hex) ?? 0;
    labelsAt.set(hex, n + 1);
    cues.push({ kind: 'label', t0, dur: dur * k, at: hexPoint(ctx, hex, 1.4 + n * 0.55), text, tone, stack: n });
  };
  const dice = (t0: number, e: GameEvent, text: string, tone: Tone) => {
    if (opts.dice && e.dice?.length) cues.push({ kind: 'dice', t0, dur: 1.5 * k, dice: e.dice, text, tone });
  };

  let t = 0; // running clock in seconds
  let commitAt: number | undefined;
  let firstFire = true;
  /** Moves play one after another along each unit's path. */
  let slideT = 0;
  const slide = (units: readonly string[], path: readonly HexKey[]) => {
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      if (!ctx.map.hexes[a] || !ctx.map.hexes[b] || a === b) continue;
      const dur = (opts.reducedMotion ? 0.12 : 0.26) * k;
      cues.push({ kind: 'slide', t0: slideT, dur, units, from: hexPoint(ctx, a), to: hexPoint(ctx, b) });
      slideT += dur;
    }
    t = Math.max(t, slideT);
  };

  for (const e of events) {
    const fx = (e.fx ?? {}) as FireFx & { result?: string; hit?: boolean };
    switch (e.kind) {
      case 'fire': {
        const start = firstFire ? 0 : t + 0.2 * k;
        firstFire = false;
        const color = SIDE_TRACER[nation(e.side)] ?? 0xffd060;
        const targets = fx.targets ?? (e.to ? [e.to] : []);
        const shooters = fx.shooters?.length
          ? fx.shooters
          : (fx.firerHexes ?? (e.from ? [e.from] : [])).map((hex) => ({ hex, kind: fx.kinds?.find((x) => x !== 'rifle') ?? 'rifle', unit: '' }));
        // One burst per firing unit and weapon; MG penetration fires down the lane to the far hex.
        const farTarget = targets[targets.length - 1];
        let end = start;
        let land = start;
        const special = shooters.find((sh) => sh.kind === 'FT' || sh.kind === 'DC');
        if (special && farTarget) {
          const tgt = hexPoint(ctx, farTarget, 0.25);
          if (opts.reducedMotion) {
            const from = special.kind === 'FT' ? hexPoint(ctx, special.hex, EYE) : tgt;
            cues.push({ kind: 'line', t0: start, dur: 1.2 * k, from, to: tgt, color: 0xff7a30 });
            land = start + 0.3 * k;
            end = start + 1.2 * k;
          } else if (special.kind === 'FT') {
            const los = ctx.los(special.hex, farTarget);
            const from = { ...hexPoint(ctx, special.hex), z: los.fromHeight + EYE };
            const dur = 1.5 * k;
            cues.push({ kind: 'flame', t0: start, dur, from, to: { ...tgt, z: los.toHeight + EYE * 0.5 }, seed: hashSeed(`${special.hex}${farTarget}${e.text}`) });
            cues.push({ kind: 'sound', t0: start, sound: 'flame', at: from });
            land = start + dur * 0.55;
            end = start + dur;
          } else {
            const dur = 2.2 * k;
            const t0 = start + 0.25 * k;
            cues.push({ kind: 'blast', t0, dur, at: tgt, seed: hashSeed(`${farTarget}${e.text}`) });
            cues.push({ kind: 'sound', t0, sound: 'blast', at: tgt });
            land = t0 + 0.2 * k;
            end = t0 + dur;
          }
        }
        (special ? [] : shooters).forEach((sh, i) => {
          const to = farTarget ?? sh.hex;
          const w = weaponOf(sh.kind);
          const spec = WEAPON[w];
          const los = ctx.los(sh.hex, to);
          const from = { ...hexPoint(ctx, sh.hex), z: los.fromHeight + EYE };
          const tgt = { ...hexPoint(ctx, to), z: los.toHeight + EYE * 0.6 };
          const t0 = start + i * 0.14 * k;
          const dist = Math.hypot(tgt.x - from.x, tgt.y - from.y);
          const travel = dist / TRACER_SPEED;
          if (opts.reducedMotion) {
            cues.push({ kind: 'line', t0, dur: 1.4 * k, from, to: tgt, color });
            land = Math.max(land, t0 + 0.3 * k);
            end = Math.max(end, t0 + 1.4 * k);
            return;
          }
          const dur = (spec.rounds * spec.interval + travel) * k + 0.6;
          cues.push({ kind: 'burst', t0, dur, from, to: tgt, weapon: w, rounds: spec.rounds, interval: spec.interval * k, speed: TRACER_SPEED / k, color, seed: hashSeed(`${sh.hex}${to}${i}${e.text}`), spread: spec.spread });
          cues.push({ kind: 'sound', t0, sound: 'burst', at: from, weapon: w, rounds: spec.rounds, interval: spec.interval * k });
          land = Math.max(land, t0 + travel * k + spec.rounds * spec.interval * k * 0.6);
          end = Math.max(end, t0 + dur);
        });
        dice(start, e, `Fire: ${e.dice?.join('+') ?? ''}`, 'info');
        // A defensive-fire target that has moved on: show its ghost where it was fired on (§16.4).
        for (const h of targets) {
          const here = Object.values(before.units).some((u) => u.hex === h);
          if (!here && before.phase === 'defensiveFire') {
            const who = (fx.outcomes?.find((o) => o.hex === h)?.results ?? []).map((r) => before.units[r.unit]).filter(Boolean);
            cues.push({ kind: 'ghost', t0: start, dur: end - start + 0.8 * k, at: hexPoint(ctx, h, 0.5), text: who.length ? 'moving' : 'moving' });
          }
        }
        const results = fx.outcomes ?? targets.map((hex) => ({ hex, penetration: false, results: (fx as { results?: (string | number)[] }).results?.map((r) => ({ unit: '', result: r })) ?? [] }));
        for (const o of results) {
          // The worst result in the hex, once.
          const order = (r: string | number) => (r === 'KIA' ? 99 : r === 'M' ? 1 : r === '-' ? -1 : Number(r) + 1);
          const worst = [...o.results].sort((a, b) => order(b.result) - order(a.result))[0];
          if (!worst) continue;
          const l = iftLabel(worst.result);
          label(o.hex, land, l.text, l.tone);
          cues.push({ kind: 'hit', t0: land, hex: o.hex, severity: worst.result === '-' ? 'near' : 'hit' });
          if (!opts.reducedMotion && worst.result === 'KIA') cues.push({ kind: 'puff', t0: land, dur: 1.6 * k, at: hexPoint(ctx, o.hex, 0.4), size: 0.9, color: 0x3a3630 });
        }
        commitAt ??= land;
        t = Math.max(land, start + 0.5 * k);
        break;
      }
      case 'closeCombat': {
        const hex = e.hexes?.[0];
        if (!hex) break;
        const t0 = commitAt === undefined ? t : t + 0.15 * k;
        const at = hexPoint(ctx, hex, 0.3);
        if (opts.reducedMotion) {
          cues.push({ kind: 'label', t0, dur: 0.9 * k, at: hexPoint(ctx, hex, 1.4), text: 'Close combat', tone: 'info' });
        } else {
          cues.push({ kind: 'melee', t0, dur: 1.1 * k, at, seed: hashSeed(e.text) });
          cues.push({ kind: 'sound', t0, sound: 'melee', at });
        }
        dice(t0, e, `Close combat: ${e.dice?.join('+') ?? ''}`, fx.hit ? 'bad' : 'info');
        const land = t0 + 0.9 * k;
        label(hex, land, fx.hit ? 'Eliminated' : 'Survive', fx.hit ? 'bad' : 'info');
        commitAt ??= land;
        t = land;
        break;
      }
      case 'morale':
      case 'rally':
      case 'repair':
      case 'berserk': {
        const r = fx.result;
        const l = r ? MORALE_LABEL[r] : undefined;
        if (!l && !e.dice?.length) break;
        const hex = e.units?.length ? unitHex(e.units[0]!) : e.hexes?.[0];
        const t0 = commitAt === undefined ? t : t + 0.35 * k;
        if (e.dice?.length) dice(t0, e, `${e.kind === 'repair' ? 'Repair' : e.kind === 'rally' ? 'Rally' : 'Morale'}: ${e.dice.join('+')}`, l?.tone ?? 'info');
        const land = t0 + (e.dice?.length && opts.dice ? 0.7 : 0.2) * k;
        if (l) label(hex, land, l.text, l.tone);
        commitAt ??= land;
        t = land;
        break;
      }
      case 'eliminated': {
        const hex = e.hexes?.[0] ?? (e.units?.[0] ? unitHex(e.units[0]) : undefined);
        const t0 = t + 0.15 * k;
        label(hex, t0, 'Eliminated', 'bad');
        if (hex && !opts.reducedMotion) cues.push({ kind: 'puff', t0, dur: 1.4 * k, at: hexPoint(ctx, hex, 0.4), size: 0.7, color: 0x2f2b26 });
        commitAt ??= t0;
        t = t0;
        break;
      }
      case 'move':
      case 'advance': {
        if (e.units?.length && e.from && e.to) slide(e.units, [e.from, e.to]);
        break;
      }
      case 'rout': {
        if (e.units?.length && e.from) slide(e.units, e.hexes?.length ? e.hexes : [e.from, e.to ?? e.from]);
        break;
      }
      case 'info': {
        const hex = (fx as { smoke?: HexKey }).smoke;
        if (!hex || !ctx.map.hexes[hex] || opts.reducedMotion) break;
        const t0 = t;
        const dur = 2 * k;
        cues.push({ kind: 'smoke', t0, dur, at: hexPoint(ctx, hex), seed: hashSeed(hex) });
        cues.push({ kind: 'sound', t0, sound: 'hiss', at: hexPoint(ctx, hex) });
        t = t0 + dur * 0.5;
        break;
      }
      case 'breakdown': {
        const hex = e.hexes?.[0];
        const t0 = t + 0.2 * k;
        label(hex, t0, 'Malfunction', 'warn');
        if (hex) cues.push({ kind: 'sound', t0, sound: 'clank', at: hexPoint(ctx, hex) });
        t = t0;
        break;
      }
      default:
        break;
    }
  }
  if (!cues.length) return undefined;
  const duration = Math.max(...cues.map((c) => c.t0 + ('dur' in c ? c.dur : 0.3)));
  // With moves, the board shows the new positions at once and the movers slide into place.
  const moves = cues.some((c) => c.kind === 'slide');
  return { cues, commitAt: moves ? 0 : (commitAt ?? 0), duration };
}
