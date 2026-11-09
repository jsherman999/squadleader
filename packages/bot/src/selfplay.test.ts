import { describe, expect, it } from 'vitest';
import { replay } from '@squadwar/engine';
import { scenarioCtx, selfPlay } from './selfplay';

describe('bot self-play (scenario 1)', () => {
  const ctx = scenarioCtx(0);

  it('plays complete games without rule violations', () => {
    for (const seed of [1, 2, 3]) {
      const r = selfPlay(ctx, seed);
      expect(r.problems).toEqual([]);
      expect(r.winner).toBeDefined();
    }
  }, 120_000);

  it('a game replays exactly from its seed and action log', () => {
    const r = selfPlay(ctx, 11);
    const again = replay(ctx, 11, r.log);
    expect(again.state.winner).toBe(r.winner);
    expect(again.state.result).toBe(r.result);
  }, 120_000);
});

describe('bot self-play (scenarios 2–4: special weapons, concealment, sewers, armour)', () => {
  for (const index of [1, 2, 3]) {
    const ctx = scenarioCtx(index);
    it(`${ctx.scenario.id} plays and replays cleanly`, () => {
      for (const seed of [1, 2]) {
        const r = selfPlay(ctx, seed);
        expect(r.problems).toEqual([]);
        expect(r.winner).toBeDefined();
        const again = replay(ctx, seed, r.log);
        expect(again.state.winner).toBe(r.winner);
        expect(again.state.result).toBe(r.result);
      }
    }, 120_000);
  }
});
