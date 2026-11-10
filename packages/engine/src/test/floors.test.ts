import { describe, expect, it } from 'vitest';
import { applyAction, tryAction } from '../engine';
import { analyzeFire } from '../rules/fire';
import { exposureAt } from '../rules/exposure';
import { STAIRS_MF, isUpper } from '../rules/floors';
import { mfLeft } from '../rules/movement';
import type { GameState } from '../types';
import { blankState, hexOf, put, testCtx } from './helpers';

/**
 * A three-hex stone building K6–K8 (so it has an upper floor), woods at K4 between it and the
 * open ground at K2. From the ground floor of K6 the woods hide K2; from upstairs K2 is in view.
 */
const town = () => testCtx({ K6: { t: 'stoneBuilding', b: 's' }, K7: { t: 'stoneBuilding', b: 's' }, K8: { t: 'stoneBuilding', b: 's' }, K4: { t: 'woods' } });
const withFloors = (s: GameState): GameState => ({ ...s, options: { ...s.options, floors: true } });

describe('building floors (§57)', () => {
  it('a unit sees from its own floor only', () => {
    const ctx = town();
    const K6 = hexOf(ctx, 'K6');
    const K2 = hexOf(ctx, 'K2');
    expect(ctx.losLevel(K6, false, K2, false).clear).toBe(false);
    expect(ctx.losLevel(K6, true, K2, false).clear).toBe(true);
    const s = withFloors(blankState(ctx, 'prepFire'));
    const up = put(ctx, s, 'ger-467', 'K6', { upstairs: K6 });
    const down = put(ctx, s, 'ger-467', 'K6');
    put(ctx, s, 'rus-447', 'K2');
    expect(isUpper(ctx, s, up)).toBe(true);
    expect(isUpper(ctx, s, down)).toBe(false);
    expect(analyzeFire(ctx, s, [{ unit: up.id, inherent: true, weapons: [] }], K2).totalFp).toBeGreaterThan(0);
    expect(() => analyzeFire(ctx, s, [{ unit: down.id, inherent: true, weapons: [] }], K2)).toThrow(/No line of sight/);
    // Firing together, the group sees only what all of it sees.
    expect(() =>
      analyzeFire(
        ctx,
        s,
        [
          { unit: up.id, inherent: true, weapons: [] },
          { unit: down.id, inherent: true, weapons: [] },
        ],
        K2,
      ),
    ).toThrow(/No line of sight/);
  });

  it('fire strikes only the floors the firers can see', () => {
    const ctx = town();
    const K6 = hexOf(ctx, 'K6');
    const s = withFloors(blankState(ctx, 'prepFire'));
    const firer = put(ctx, s, 'ger-467', 'K2');
    const up = put(ctx, s, 'rus-447', 'K6', { upstairs: K6 });
    const down = put(ctx, s, 'rus-447', 'K6');
    const a = analyzeFire(ctx, s, [{ unit: firer.id, inherent: true, weapons: [] }], K6);
    expect(a.targets[0]!.units.map((x) => x.unit)).toEqual([up.id]);
    // With nobody upstairs there is nothing to shoot at, and the message says why.
    delete s.units[up.id];
    expect(() => analyzeFire(ctx, s, [{ unit: firer.id, inherent: true, weapons: [] }], K6)).toThrow(/ground floor/);
    expect(s.units[down.id]).toBeDefined();
  });

  it('without the rule either floor counts, as in games saved before it', () => {
    const ctx = town();
    const s = blankState(ctx, 'prepFire');
    const down = put(ctx, s, 'ger-467', 'K6');
    put(ctx, s, 'rus-447', 'K2');
    expect(analyzeFire(ctx, s, [{ unit: down.id, inherent: true, weapons: [] }], hexOf(ctx, 'K2')).totalFp).toBeGreaterThan(0);
    expect(tryAction(ctx, { ...s, phase: 'movement' }, { type: 'floor', units: [down.id], upper: true }).ok).toBe(false);
  });

  it('the stairs cost movement, and leaving from upstairs costs them again', () => {
    const ctx = town();
    const K6 = hexOf(ctx, 'K6');
    let s = withFloors(blankState(ctx, 'movement'));
    const u = put(ctx, s, 'ger-467', 'K6');
    put(ctx, s, 'rus-447', 'X9');
    const before = mfLeft(ctx, s, s.units[u.id]!);
    s = applyAction(ctx, s, { type: 'floor', units: [u.id], upper: true }).state;
    expect(isUpper(ctx, s, s.units[u.id]!)).toBe(true);
    expect(mfLeft(ctx, s, s.units[u.id]!)).toBe(before - STAIRS_MF);
    expect(s.tracks[u.id]).toEqual([{ hex: K6, mf: STAIRS_MF, open: false, upper: true }]);
    // It has 2 MF left: not enough to come down and step out.
    expect(tryAction(ctx, s, { type: 'move', units: [u.id], to: hexOf(ctx, 'K5') }).ok).toBe(false);
    // A unit that starts the phase upstairs pays the stairs, then the hex, and is seen on the ground floor on its way out.
    const w = put(ctx, s, 'ger-467', 'K7', { upstairs: hexOf(ctx, 'K7') });
    s = applyAction(ctx, s, { type: 'move', units: [w.id], to: hexOf(ctx, 'L7') }).state;
    expect(s.units[w.id]!.upstairs).toBeUndefined();
    expect(mfLeft(ctx, s, s.units[w.id]!)).toBe(before - STAIRS_MF - 1);
    expect(s.tracks[w.id]!.map((st) => st.hex)).toEqual([hexOf(ctx, 'K7'), hexOf(ctx, 'L7')]);
    // Not in a small building, and not twice.
    const small = testCtx({ K6: { t: 'stoneBuilding', b: 'x' } });
    const t = withFloors(blankState(small, 'movement'));
    const v = put(small, t, 'ger-467', 'K6');
    expect(tryAction(small, t, { type: 'floor', units: [v.id], upper: true }).ok).toBe(false);
  });

  it('a unit that climbs into view can be fired on there in Defensive Fire', () => {
    const ctx = town();
    const K6 = hexOf(ctx, 'K6');
    let s = withFloors(blankState(ctx, 'movement'));
    const climber = put(ctx, s, 'ger-467', 'K6');
    const stayer = put(ctx, s, 'ger-467', 'K6');
    const watcher = put(ctx, s, 'rus-447', 'K2');
    s = applyAction(ctx, s, { type: 'floor', units: [climber.id], upper: true }).state;
    s = { ...s, phase: 'defensiveFire', awaiting: 'rus' };
    const a = analyzeFire(ctx, s, [{ unit: watcher.id, inherent: true, weapons: [] }], K6);
    expect(a.targets[0]!.units.map((x) => x.unit)).toEqual([climber.id]);
    expect(s.units[stayer.id]).toBeDefined();
  });

  it('in the Advance Phase the stairs are the unit’s advance', () => {
    const ctx = town();
    let s = withFloors(blankState(ctx, 'advance'));
    const u = put(ctx, s, 'ger-467', 'K7');
    put(ctx, s, 'rus-447', 'X9');
    s = applyAction(ctx, s, { type: 'floor', units: [u.id], upper: true }).state;
    expect(isUpper(ctx, s, s.units[u.id]!)).toBe(true);
    expect(s.units[u.id]!.advanced).toBe(true);
    expect(tryAction(ctx, s, { type: 'advance', units: [u.id], to: hexOf(ctx, 'K6') }).ok).toBe(false);
  });

  it('danger is worked out for the floor a stack is on', () => {
    const ctx = town();
    const K6 = hexOf(ctx, 'K6');
    const s = withFloors(blankState(ctx, 'movement'));
    put(ctx, s, 'rus-447', 'K2', { weapons: ['rus-lmg'] });
    expect(exposureAt(ctx, s, 'ger', K6, false, false).pBreak).toBe(0);
    expect(exposureAt(ctx, s, 'ger', K6, false, true).pBreak).toBeGreaterThan(0);
  });
});
