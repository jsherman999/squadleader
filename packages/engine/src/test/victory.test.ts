import { describe, expect, it } from 'vitest';
import { applyAction } from '../engine';
import { evaluateVictory, exitHexes, objectiveStatus } from '../rules/victory';
import { eliminate } from '../rules/common';
import { blankState, hexOf, put, putVehicle, testCtx } from './helpers';

/** Victory conditions beyond building control: area objectives, exits and break points. */
describe('area objectives (a hill crest)', () => {
  const ctx = testCtx(
    {},
    {},
    {
      victory: {
        side: 'ger',
        text: 'x',
        controlBuildings: {
          buildings: [{ hex: 'T-K5', name: 'Crest', hexes: ['T-K4', 'T-K5', 'T-L5'] }],
          atLeast: 1,
        },
      },
    },
  );
  it('is held by the side with an unbroken unit on it and no enemy on any of its hexes', () => {
    expect(ctx.objectives[0]!.hexes).toHaveLength(3);
    const s = blankState(ctx);
    put(ctx, s, 'ger-467', 'K4');
    expect(objectiveStatus(ctx, s)[0]!.owner).toBe('ger');
    expect(evaluateVictory(ctx, s).winner).toBe('ger');
    put(ctx, s, 'rus-447', 'L5');
    expect(objectiveStatus(ctx, s)[0]!.owner).toBeUndefined();
    expect(evaluateVictory(ctx, s).winner).toBe('rus');
  });
});

describe('exit victory', () => {
  const ctx = testCtx(
    {},
    {},
    {
      rulesLevel: 63,
      victory: {
        side: 'ger',
        text: 'x',
        controlBuildings: { buildings: [], atLeast: 0 },
        exit: { side: 'ger', board: 'T', edge: 'W', squads: 2 },
      },
    },
  );
  it('the exit edge is the half hexes on the board edge and the full hexes next to them', () => {
    const edge = exitHexes(ctx);
    expect(edge.has(hexOf(ctx, 'A5'))).toBe(true);
    expect(edge.has(hexOf(ctx, 'B5'))).toBe(true);
    expect(edge.has(hexOf(ctx, 'C5'))).toBe(false);
  });
  it('unbroken units on the edge leave at the end of the Movement Phase; broken ones stay', () => {
    const s = blankState(ctx, 'movement');
    const a = put(ctx, s, 'ger-467', 'A5', { weapons: ['ger-lmg'] });
    const b = put(ctx, s, 'ger-467', 'A3', { broken: true });
    const c = put(ctx, s, 'ger-467', 'C5');
    put(ctx, s, 'rus-447', 'Z5');
    const r = applyAction(ctx, s, { type: 'endPhase' });
    expect(r.state.units[a.id]).toBeUndefined();
    expect(Object.values(r.state.weapons).some((w) => w.owner === a.id)).toBe(false);
    expect(r.state.units[b.id]).toBeDefined();
    expect(r.state.units[c.id]).toBeDefined();
    expect(r.state.exited?.ger).toEqual({ squads: 1, leaders: 0 });
    expect(r.state.phase).toBe('defensiveFire');
    // Leaving the map is not a loss.
    expect(r.state.losses.ger!.squads).toBe(0);
  });
  it('wins at once when enough squads are out, riders on a vehicle included', () => {
    const s = blankState(ctx, 'movement');
    put(ctx, s, 'ger-467', 'A5');
    const ht = putVehicle(ctx, s, 'ger-251', 'A7', 'SW-NW');
    put(ctx, s, 'ger-467', 'A7', { riding: ht.id });
    put(ctx, s, 'ger-467', 'K5');
    put(ctx, s, 'rus-447', 'Z5');
    const r = applyAction(ctx, s, { type: 'endPhase' });
    expect(r.state.vehicles[ht.id]).toBeUndefined();
    expect(r.state.phase).toBe('gameOver');
    expect(r.state.winner).toBe('ger');
  });
  it('the other side does not exit', () => {
    const s = blankState(ctx, 'movement');
    s.phasing = 'rus';
    s.awaiting = 'rus';
    const r1 = put(ctx, s, 'rus-447', 'A5');
    put(ctx, s, 'ger-467', 'Z5');
    const r = applyAction(ctx, s, { type: 'endPhase' });
    expect(r.state.units[r1.id]).toBeDefined();
  });
  it('without enough squads out, the defender wins at the end', () => {
    const s = blankState(ctx);
    s.exited = { ger: { squads: 1, leaders: 1 } };
    expect(evaluateVictory(ctx, s).winner).toBe('rus');
  });
  it('a side that got everything out is judged on its exits, not eliminated', () => {
    const s = blankState(ctx, 'movement');
    put(ctx, s, 'ger-467', 'A5');
    put(ctx, s, 'rus-447', 'Z5');
    const r = applyAction(ctx, s, { type: 'endPhase' });
    expect(r.state.phase).toBe('gameOver');
    expect(r.state.winner).toBe('rus');
    expect(r.state.result).toMatch(/1 squad off the map; 2 needed/);
  });
});

describe('break points', () => {
  const ctx = testCtx(
    {},
    {},
    {
      victory: {
        side: 'ger',
        text: 'x',
        controlBuildings: { buildings: [], atLeast: 0 },
        breakPoint: { rus: 2 },
      },
    },
  );
  it('a side that loses its break point in squads gives up at once', () => {
    const s = blankState(ctx, 'prepFire');
    const a = put(ctx, s, 'rus-447', 'K5');
    put(ctx, s, 'rus-447', 'K6');
    put(ctx, s, 'rus-447', 'K7');
    put(ctx, s, 'ger-467', 'Z5');
    eliminate(ctx, s, a, 'test', () => {});
    s.losses.rus!.vehicles = 1; // a destroyed vehicle counts too
    const r = applyAction(ctx, s, { type: 'endPhase' });
    expect(r.state.phase).toBe('gameOver');
    expect(r.state.winner).toBe('ger');
    expect(r.state.result).toMatch(/break point of 2/);
  });
  it('leaders do not count', () => {
    const s = blankState(ctx, 'prepFire');
    put(ctx, s, 'rus-447', 'K5');
    put(ctx, s, 'ger-467', 'Z5');
    s.losses.rus = { squads: 1, leaders: 3 };
    const r = applyAction(ctx, s, { type: 'endPhase' });
    expect(r.state.phase).toBe('movement');
  });
});
