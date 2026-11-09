import { describe, expect, it } from 'vitest';
import { applyAction } from '@squadwar/engine';
import { blankState, hexOf, put, testCtx } from '../../engine/src/test/helpers';
import { decide } from './bot';

describe('bot and the special rules (§22–27)', () => {
  it('fires point blank at enemies come up from the sewers into its hex (§27.7)', () => {
    const ctx = testCtx({ K5: { t: 'stoneBuilding', b: 's', sw: true }, K8: { t: 'open', sw: true } }, {}, { rulesLevel: 27, sewers: true });
    const s = blankState(ctx, 'movement');
    const sq = put(ctx, s, 'ger-467', 'K8');
    const ld = put(ctx, s, 'ger-L81', 'K8');
    put(ctx, s, 'rus-447', 'K5');
    s.diceQueue = [2];
    let st = applyAction(ctx, s, { type: 'sewer', units: [sq.id, ld.id], to: hexOf(ctx, 'K5') }).state;
    st = applyAction(ctx, st, { type: 'endPhase' }).state;
    expect(st.phase).toBe('defensiveFire');
    const d = decide(ctx, st);
    expect(d.action.type).toBe('fire');
    if (d.action.type === 'fire') expect(d.action.target).toBe(hexOf(ctx, 'K5'));
  });

  it('places a demolition charge next to the enemy and blows it in Advancing Fire', () => {
    const ctx = testCtx({ K5: { t: 'stoneBuilding', b: 's' } }, {}, { rulesLevel: 27 });
    const s = blankState(ctx, 'movement');
    put(ctx, s, 'ger-838', 'K6', { weapons: ['ger-dc'] });
    put(ctx, s, 'rus-447', 'K5');
    const d = decide(ctx, s);
    expect(d.action.type).toBe('placeCharge');
    let st = applyAction(ctx, s, d.action).state;
    st = applyAction(ctx, st, { type: 'endPhase' }).state; // → defensive fire
    while (st.phase !== 'advancingFire') st = applyAction(ctx, st, { type: 'endPhase' }).state;
    expect(st.charges[0]?.armed).toBe(true);
    expect(decide(ctx, st).action.type).toBe('detonate');
  });
});
