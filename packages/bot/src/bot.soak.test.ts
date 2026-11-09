import { describe, expect, it } from 'vitest';
import { scenarioCtx, selfPlay } from './selfplay';

const GAMES = Number(process.env.SOAK_GAMES ?? 60);

describe('soak: bot vs bot', () => {
  it(`plays ${GAMES} games of scenario 1 cleanly and reports balance`, () => {
    const ctx = scenarioCtx(0);
    const wins: Record<string, number> = {};
    const problems: string[] = [];
    for (let seed = 1000; seed < 1000 + GAMES; seed++) {
      const r = selfPlay(ctx, seed);
      wins[r.winner ?? 'none'] = (wins[r.winner ?? 'none'] ?? 0) + 1;
      problems.push(...r.problems.map((p) => `seed ${seed}: ${p}`));
    }
    console.log('scenario 1 results', wins);
    expect(problems).toEqual([]);
  });
});
