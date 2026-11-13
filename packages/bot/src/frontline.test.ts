import { describe, expect, it } from 'vitest';
import { rawScenarios } from '@squadwar/content';
import { DEFAULT_OPTIONS, replay } from '@squadwar/engine';
import { scenarioCtx, selfPlay } from './selfplay';

/** The front-line series (h1–h12): every scenario plays to a result and replays exactly. */
describe('bot self-play (front-line series)', () => {
  const first = rawScenarios.findIndex((s) => (s as { id: string }).id === 'h1');
  it('has twelve scenarios after the original twelve', () => {
    expect(first).toBe(12);
    expect(rawScenarios.slice(first).map((s) => (s as { id: string }).id)).toEqual(Array.from({ length: 12 }, (_, i) => `h${i + 1}`));
  });
  for (let index = first; index < first + 12; index++) {
    const ctx = scenarioCtx(index);
    it(`${ctx.scenario.id} ${ctx.scenario.title} plays and replays cleanly`, () => {
      for (const seed of [1, 2]) {
        const r = selfPlay(ctx, seed);
        expect(r.problems).toEqual([]);
        expect(r.winner).toBeDefined();
        const again = replay(ctx, seed, r.log, DEFAULT_OPTIONS);
        expect(again.state.winner).toBe(r.winner);
        expect(again.state.result).toBe(r.result);
      }
    }, 120_000);
  }
});
