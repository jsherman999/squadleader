import { describe, expect, it } from 'vitest';
import { rawBoards, rawRules } from '@squadwar/content';
import { parseBoard } from '@squadwar/terrain';
import { createGame, designYourOwn, makeCtx, parseRulesData, stackingProblem, type DyoRules, type DyoTerrain } from '@squadwar/engine';
import { selfPlay } from './selfplay';

const data = parseRulesData(rawRules);
const boards = Object.fromEntries(Object.entries(rawBoards).map(([k, v]) => [k, parseBoard(v)]));

describe('Design Your Own', () => {
  it('deals the same scenario for the same seed', () => {
    const a = designYourOwn(data, boards, { seed: 42 });
    const b = designYourOwn(data, boards, { seed: 42 });
    expect(a).toEqual(b);
    expect(a.draws).toHaveLength(6);
    expect(designYourOwn(data, boards, { seed: 43 }).scenario).not.toEqual(a.scenario);
  });

  it('every deal sets up legally', () => {
    const rules: DyoRules[] = ['infantry', 'support', 'full'];
    const terrain: DyoTerrain[] = ['city', 'country', 'any'];
    for (let seed = 1; seed <= 45; seed++) {
      const opts = { seed, rules: rules[seed % 3]!, terrain: terrain[Math.floor(seed / 3) % 3]! };
      const { scenario, points } = designYourOwn(data, boards, opts);
      const ctx = makeCtx(scenario, data, boards);
      const s = createGame(ctx, seed).state;
      const [def, att] = scenario.sides;
      expect(points[att!.id]!).toBeGreaterThan(points[def!.id]!);
      for (const u of Object.values(s.units)) expect(ctx.zones[u.side]!.has(u.hex), `${scenario.id} ${u.type}`).toBe(true);
      for (const v of Object.values(s.vehicles)) {
        expect(ctx.zones[v.side]!.has(v.hex)).toBe(true);
        expect(['stoneBuilding', 'woodBuilding', 'water']).not.toContain(ctx.map.hexes[v.hex]!.terrain);
      }
      for (const h of new Set(Object.values(s.units).map((u) => u.hex))) for (const side of [def!.id, att!.id]) expect(stackingProblem(ctx, s, h, side)).toBeUndefined();
      if (scenario.rulesLevel < 50) expect(scenario.sides.some((x) => x.nation === 'american')).toBe(false);
      if (opts.terrain === 'city') expect(scenario.layout.every((l) => boards[l.board]!.kind === 'city')).toBe(true);
    }
  });

  it('deals play to the end with the bot on both sides', () => {
    for (const seed of [3, 8]) {
      const { scenario } = designYourOwn(data, boards, { seed, rules: 'full' });
      const r = selfPlay(makeCtx(scenario, data, boards), seed);
      expect(r.problems).toEqual([]);
    }
  }, 120_000);
});
