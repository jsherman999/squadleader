import { describe, expect, it } from 'vitest';
import { decide } from '@squadwar/bot';
import { createGame, tryAction, type GameEvent, type GameState } from '@squadwar/engine';
import { ctxFor } from '../game/scenarios';
import { sampleFx } from './sample';
import { buildTimeline, type Cue } from './timeline';

const ctx = ctxFor('s1');

/** Every action of a bot-vs-bot game with the state before it and its events. */
function game(seed: number): { before: GameState; events: readonly GameEvent[] }[] {
  let s = createGame(ctx, seed).state;
  const out: { before: GameState; events: readonly GameEvent[] }[] = [];
  for (let i = 0; i < 4000 && s.phase !== 'gameOver'; i++) {
    const r = tryAction(ctx, s, decide(ctx, s).action);
    if (!r.ok) throw new Error(r.error);
    out.push({ before: s, events: r.events });
    s = r.state;
  }
  return out;
}

const NORMAL = { scale: 1, reducedMotion: false, dice: true };
const kinds = (cues: readonly Cue[]) => new Set(cues.map((c) => c.kind));

describe('Fire Director timeline', () => {
  const actions = [...game(4), ...game(9)];

  it('animates every fire event: a burst from each shooter, a result on each target', () => {
    let fires = 0;
    for (const a of actions) {
      for (const e of a.events.filter((x) => x.kind === 'fire')) {
        fires++;
        const tl = buildTimeline(ctx, a.before, a.events, NORMAL)!;
        expect(tl).toBeDefined();
        const shooters = (e.fx as { shooters: unknown[] }).shooters;
        expect(tl.cues.filter((c) => c.kind === 'burst').length).toBeGreaterThanOrEqual(shooters.length);
        for (const h of (e.fx as { targets: string[] }).targets) expect(tl.cues.some((c) => c.kind === 'label' && Math.abs(c.at.x - ctx.map.hexes[h]!.hex.q * 1.5) < 1e-6)).toBe(true);
        expect(tl.commitAt).toBeGreaterThan(0);
        expect(tl.commitAt).toBeLessThanOrEqual(tl.duration);
        expect(tl.duration).toBeLessThan(10);
      }
    }
    expect(fires).toBeGreaterThan(10);
  });

  it('shows every roll in the dice tray, with the rolled faces', () => {
    for (const a of actions) {
      const rolled = a.events.filter((e) => e.dice?.length && ['fire', 'morale', 'rally', 'repair', 'closeCombat', 'berserk'].includes(e.kind));
      if (!rolled.length) continue;
      const tl = buildTimeline(ctx, a.before, a.events, NORMAL)!;
      const dice = tl.cues.filter((c): c is Extract<Cue, { kind: 'dice' }> => c.kind === 'dice');
      expect(dice.map((d) => d.dice.join())).toEqual(rolled.map((e) => e.dice!.join()));
    }
  });

  it('animates close combat', () => {
    const cc = actions.filter((a) => a.events.some((e) => e.kind === 'closeCombat'));
    expect(cc.length).toBeGreaterThan(0);
    for (const a of cc) expect(kinds(buildTimeline(ctx, a.before, a.events, NORMAL)!.cues).has('melee')).toBe(true);
  });

  it('reduced motion uses lines and labels only', () => {
    for (const a of actions) {
      const tl = buildTimeline(ctx, a.before, a.events, { ...NORMAL, reducedMotion: true });
      if (!tl) continue;
      const k = kinds(tl.cues);
      for (const moving of ['burst', 'melee', 'puff', 'flame', 'blast', 'smoke'] as const) expect(k.has(moving)).toBe(false);
      if (a.events.some((e) => e.kind === 'fire')) expect(k.has('line')).toBe(true);
    }
  });

  it('instant speed skips animation; phase changes never animate', () => {
    for (const a of actions) expect(buildTimeline(ctx, a.before, a.events, { ...NORMAL, scale: 0 })).toBeUndefined();
    const quiet = actions.filter((a) => a.events.every((e) => e.kind === 'phase' || e.kind === 'info'));
    expect(quiet.length).toBeGreaterThan(0);
    for (const a of quiet) expect(buildTimeline(ctx, a.before, a.events, NORMAL)).toBeUndefined();
  });

  it('slides moving, advancing and routing counters along their path, showing the new board at once', () => {
    const moved = actions.filter((a) => a.events.some((e) => e.kind === 'move' || e.kind === 'advance' || e.kind === 'rout'));
    expect(moved.length).toBeGreaterThan(20);
    for (const a of moved) {
      const tl = buildTimeline(ctx, a.before, a.events, NORMAL)!;
      const slides = tl.cues.filter((c): c is Extract<Cue, { kind: 'slide' }> => c.kind === 'slide');
      expect(slides.length).toBeGreaterThan(0);
      expect(tl.commitAt).toBe(0);
      // Legs follow each other in time, and a group is drawn at its start before its first leg.
      const f0 = sampleFx(tl.cues, 0);
      expect(f0.slides.length).toBeGreaterThan(0);
      const done = sampleFx(tl.cues, tl.duration + 0.01);
      expect(done.slides).toHaveLength(0);
    }
    const rout = moved.find((a) => a.events.some((e) => e.kind === 'rout' && (e.hexes?.length ?? 0) > 2));
    if (rout) expect(buildTimeline(ctx, rout.before, rout.events, NORMAL)!.cues.filter((c) => c.kind === 'slide').length).toBeGreaterThan(1);
  });

  it('frames show tracers in flight and nothing after the end', () => {
    const a = actions.find((x) => x.events.some((e) => e.kind === 'fire'))!;
    const tl = buildTimeline(ctx, a.before, a.events, NORMAL)!;
    let streaks = 0;
    for (let t = 0; t < tl.duration; t += 0.05) streaks += sampleFx(tl.cues, t).streaks.length;
    expect(streaks).toBeGreaterThan(5);
    const end = sampleFx(tl.cues, tl.duration + 0.5);
    expect(end.streaks.length + end.glows.length + end.labels.length).toBe(0);
  });

  it('flamethrowers, charges and smoke have their own effects (§22–24)', () => {
    const ctx2 = ctxFor('s2');
    const seen = { flame: 0, blast: 0, smoke: 0 };
    for (const seed of [1, 2, 3, 4]) {
      let s = createGame(ctx2, seed).state;
      for (let i = 0; i < 4000 && s.phase !== 'gameOver'; i++) {
        const r = tryAction(ctx2, s, decide(ctx2, s).action);
        if (!r.ok) throw new Error(r.error);
        const tl = buildTimeline(ctx2, s, r.events, NORMAL);
        const k = tl ? kinds(tl.cues) : new Set<string>();
        for (const e of r.events) {
          const fx = (e.fx ?? {}) as { shooters?: { kind: string }[]; smoke?: string };
          if (e.kind === 'fire' && fx.shooters?.some((x) => x.kind === 'FT')) {
            expect(k.has('flame')).toBe(true);
            seen.flame++;
          }
          if (e.kind === 'fire' && fx.shooters?.some((x) => x.kind === 'DC')) {
            expect(k.has('blast')).toBe(true);
            seen.blast++;
          }
          if (fx.smoke) {
            expect(k.has('smoke')).toBe(true);
            seen.smoke++;
          }
        }
        if (tl && (k.has('flame') || k.has('blast'))) {
          let glows = 0;
          for (let t = 0; t < tl.duration; t += 0.1) glows += sampleFx(tl.cues, t).glows.length;
          expect(glows).toBeGreaterThan(10);
        }
        s = r.state;
      }
    }
    expect(seen.smoke).toBeGreaterThan(0);
    expect(seen.flame + seen.blast).toBeGreaterThan(0);
  }, 60_000);
});
