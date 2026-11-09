import { describe, expect, it } from 'vitest';
import { createGame } from '@squadwar/engine';
import { ctxFor } from '../game/scenarios';
import { slidingGroupState } from './slideState';

describe('sliding units', () => {
  it('carry only their own weapons, never the weapons lying on the map', () => {
    const ctx = ctxFor('s1');
    const s = structuredClone(createGame(ctx, 1).state);
    const [a, b] = Object.values(s.units).filter((u) => u.weapons.length);
    // b's weapon is dropped somewhere else on the map.
    const dropped = s.weapons[b!.weapons[0]!]!;
    dropped.owner = null;
    b!.weapons = [];
    const g = slidingGroupState(s, [a!.id]);
    expect(Object.keys(g.units)).toEqual([a!.id]);
    expect(Object.values(g.weapons).every((w) => w.owner === a!.id)).toBe(true);
    expect(g.weapons[dropped.id]).toBeUndefined();
    expect(Object.keys(g.weapons).sort()).toEqual([...a!.weapons].sort());
  });
});
