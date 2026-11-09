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
      for (const moving of ['burst', 'melee', 'puff'] as const) expect(k.has(moving)).toBe(false);
      if (a.events.some((e) => e.kind === 'fire')) expect(k.has('line')).toBe(true);
    }
  });

  it('instant speed skips animation; moves and phase changes never animate', () => {
    for (const a of actions) expect(buildTimeline(ctx, a.before, a.events, { ...NORMAL, scale: 0 })).toBeUndefined();
    const quiet = actions.filter((a) => a.events.every((e) => e.kind === 'move' || e.kind === 'phase' || e.kind === 'info'));
    expect(quiet.length).toBeGreaterThan(0);
    for (const a of quiet) expect(buildTimeline(ctx, a.before, a.events, NORMAL)).toBeUndefined();
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
});
