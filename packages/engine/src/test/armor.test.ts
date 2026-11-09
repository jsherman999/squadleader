import { describe, expect, it } from 'vitest';
import { DIRECTIONS, hexKey, neighbor, parseHexKey } from '@squadwar/hex';
import { applyAction, tryAction } from '../engine';
import { analyzeVehicleFire, hitAspect, hitChance, inArc, vehicleStepCost } from '../rules/armor';
import { blankState, hexOf, put, putVehicle, testCtx } from './helpers';

const L41 = { rulesLevel: 41 };
const ctx = testCtx(
  {
    K3: { t: 'woods' },
    M4: { t: 'stoneBuilding', b: 's' },
    I4: { t: 'woodBuilding', b: 'w' },
  },
  {},
  L41,
);
const id = (key: string) => ctx.map.hexes[key]!.id.slice(2);
const step = (at: string, d: number) => id(hexKey(neighbor(parseHexKey(hexOf(ctx, at)), DIRECTIONS[d]!)));

describe('§29 covered arc and §33.5 target facing', () => {
  it('the arc is the sector between the two front hexside rows', () => {
    const k5 = hexOf(ctx, 'K5');
    expect(inArc(k5, 0, hexOf(ctx, 'K2'))).toBe(true); // straight north
    expect(inArc(k5, 0, hexOf(ctx, step('K5', 1)))).toBe(true); // NE neighbour
    expect(inArc(k5, 0, hexOf(ctx, 'K8'))).toBe(false); // behind
    expect(inArc(k5, 0, hexOf(ctx, step('K5', 2)))).toBe(false); // SE neighbour
  });

  it('a shot from in front hits the front armour, from behind the rear', () => {
    const s = blankState(ctx, 'prepFire');
    const v = putVehicle(ctx, s, 'rus-t34', 'K5', 'N-NE');
    expect(hitAspect(v, hexOf(ctx, step(step('K5', 0), 1)))).toBe('front');
    expect(hitAspect(v, hexOf(ctx, 'K8'))).toBe('rear');
    expect(hitAspect(v, hexOf(ctx, step(step('K5', 5), 5)))).toBe('side');
  });
});

describe('§30 vehicle movement', () => {
  it('costs 1 MP in the open, 2 more to turn outside the arc first, and stone buildings are out', () => {
    const s = blankState(ctx, 'movement');
    const v = putVehicle(ctx, s, 'ger-pz4f2', 'K5', 'N-NE');
    expect(vehicleStepCost(ctx, s, v, hexOf(ctx, 'K4')).mp).toBe(1);
    expect(vehicleStepCost(ctx, s, v, hexOf(ctx, 'K6')).mp).toBe(3);
    expect(vehicleStepCost(ctx, s, v, hexOf(ctx, 'M4')).mp).toBe(Infinity);
    const r = applyAction(ctx, s, { type: 'vmove', vehicle: v.id, to: hexOf(ctx, 'K6') });
    const after = r.state.vehicles[v.id]!;
    expect(after.mpSpent).toBe(3);
    expect(inArc(hexOf(ctx, 'K5'), after.facing, hexOf(ctx, 'K6'))).toBe(true);
    // Once moved, turning again is free.
    expect(vehicleStepCost(ctx, r.state, after, hexOf(ctx, 'K5')).mp).toBe(1);
  });

  it('entering woods risks a breakdown: German AFVs on 5–6 (§39.1)', () => {
    const s = blankState(ctx, 'movement');
    const v = putVehicle(ctx, s, 'ger-pz4f2', 'K4', 'N-NE');
    s.diceQueue = [5, 6, 6];
    const r = applyAction(ctx, s, { type: 'vmove', vehicle: v.id, to: hexOf(ctx, 'K3') });
    const after = r.state.vehicles[v.id];
    // Immobilized, then the crew fails its morale check (12 > 7) and bails out.
    expect(after).toBeUndefined();
    expect(r.state.wrecks).toHaveLength(1);
    expect(Object.values(r.state.units).some((u) => u.type === 'ger-247')).toBe(true);
  });

  it('infantry may not move into an enemy AFV’s hex, and a vehicle that fired in Prep Fire may not move', () => {
    const s = blankState(ctx, 'movement');
    const sq = put(ctx, s, 'ger-467', 'K6');
    putVehicle(ctx, s, 'rus-t34', 'K5');
    expect(tryAction(ctx, s, { type: 'move', units: [sq.id], to: hexOf(ctx, 'K5') }).ok).toBe(false);
    const v = putVehicle(ctx, s, 'ger-pz4f2', 'C5', 'N-NE', { firedPhase: 'prepFire' });
    expect(tryAction(ctx, s, { type: 'vmove', vehicle: v.id, to: hexOf(ctx, 'C4') }).ok).toBe(false);
  });
});

describe('§33 AFV against AFV', () => {
  it('To Hit then Kill: a hit through the side kills on the AP75 number, and the crew may bail out', () => {
    const s = blankState(ctx, 'prepFire');
    const pz = putVehicle(ctx, s, 'ger-pz4f2', 'K8', 'N-NE');
    const t34 = putVehicle(ctx, s, 'rus-t34', 'K4', 'NE-SE');
    const a = analyzeVehicleFire(ctx, s, { vehicle: pz.id, target: t34.hex, weapon: 'main', vs: t34.id });
    expect(a.hitNumber).toBe(10); // vehicle in the open, 1–6 hexes, black
    expect(a.aspect).toBe('side');
    expect(a.kill).toBe(8); // AP 75 side
    s.diceQueue = [3, 3, 4, 3, 1, 1];
    const r = applyAction(ctx, s, { type: 'vfire', vehicle: pz.id, target: t34.hex, weapon: 'main', vs: t34.id });
    expect(r.state.vehicles[t34.id]).toBeUndefined();
    expect(r.state.wrecks).toEqual([{ hex: t34.hex, type: 'rus-t34', side: 'rus' }]);
    expect(Object.values(r.state.units).some((u) => u.type === 'rus-237')).toBe(true);
    expect(r.state.losses.rus?.vehicles).toBe(1);
  });

  it('Russian guns use the red numbers; moving tanks fire at +5 and SP guns not at all after moving', () => {
    const s = blankState(ctx, 'advancingFire');
    s.phasing = 'rus';
    s.awaiting = 'rus';
    const t34 = putVehicle(ctx, s, 'rus-t34', 'Q2', 'S-SW', { moved: true });
    const pz = putVehicle(ctx, s, 'ger-pz4f2', 'Q10', 'N-NE');
    const a = analyzeVehicleFire(ctx, s, { vehicle: t34.id, target: pz.hex, weapon: 'main', vs: pz.id });
    expect(a.hitNumber).toBe(8); // 7–12 hexes, red
    expect(a.hitDrm).toBe(5);
    const su = putVehicle(ctx, s, 'rus-su122', 'S2', 'S-SW', { moved: true });
    expect(() => analyzeVehicleFire(ctx, s, { vehicle: su.id, target: pz.hex, weapon: 'main', vs: pz.id })).toThrow();
  });

  it('an unmodified 12 malfunctions the gun; the Rally Phase repairs it on a 1', () => {
    const s = blankState(ctx, 'prepFire');
    const pz = putVehicle(ctx, s, 'ger-pz4f2', 'K8', 'N-NE');
    const t34 = putVehicle(ctx, s, 'rus-t34', 'K4', 'NE-SE');
    s.diceQueue = [6, 6];
    let st = applyAction(ctx, s, { type: 'vfire', vehicle: pz.id, target: t34.hex, weapon: 'main', vs: t34.id }).state;
    expect(st.vehicles[pz.id]!.gun).toBe('malfunctioned');
    st.phase = 'rally';
    st.diceQueue = [1];
    st = applyAction(ctx, st, { type: 'vrepair', vehicle: pz.id }).state;
    expect(st.vehicles[pz.id]!.gun).toBe('ok');
  });

  it('the To Hit chance counts the third die on an unmodified 2 (§33.32)', () => {
    expect(hitChance(0, 0)).toBeCloseTo((1 / 36) * (3 / 6));
    expect(hitChance(7, 0)).toBeCloseTo(21 / 36);
  });
});

describe('§34 AFV against infantry', () => {
  it('a 75mm HE hit is 8 FP on the IFT, doubled point blank', () => {
    const s = blankState(ctx, 'prepFire');
    const pz = putVehicle(ctx, s, 'ger-pz4f2', 'K8', 'N-NE');
    put(ctx, s, 'rus-447', 'K4');
    const far = analyzeVehicleFire(ctx, s, { vehicle: pz.id, target: hexOf(ctx, 'K4'), weapon: 'main' });
    expect(far.fp).toBe(8);
    expect(far.hitNumber).toBe(9);
    const s2 = blankState(ctx, 'prepFire');
    const pz2 = putVehicle(ctx, s2, 'ger-pz4f2', 'K5', 'N-NE');
    put(ctx, s2, 'rus-447', 'K4');
    expect(analyzeVehicleFire(ctx, s2, { vehicle: pz2.id, target: hexOf(ctx, 'K4'), weapon: 'main' }).fp).toBe(16);
    // MGs: covered-arc 4 + all-round 2, doubled adjacent; using the all-round MG exposes the crew.
    const mg = analyzeVehicleFire(ctx, s2, { vehicle: pz2.id, target: hexOf(ctx, 'K4'), weapon: 'mg' });
    expect(mg.fp).toBe(12);
    s2.diceQueue = [6, 6, 6, 6, 6];
    const r = applyAction(ctx, s2, { type: 'vfire', vehicle: pz2.id, target: hexOf(ctx, 'K4'), weapon: 'mg' });
    expect(r.state.vehicles[pz2.id]!.ce).toBe(true);
  });

  it('overruns attack with 16 FP; infantry left under the AFV move off after Defensive Fire (§35)', () => {
    const s = blankState(ctx, 'movement');
    const pz = putVehicle(ctx, s, 'ger-pz4f2', 'K6', 'N-NE');
    const sq = put(ctx, s, 'rus-447', 'K5');
    s.diceQueue = [5, 5, 3, 3];
    let st = applyAction(ctx, s, { type: 'vmove', vehicle: pz.id, to: hexOf(ctx, 'K5') }).state;
    expect(st.vehicles[pz.id]!.overran).toBe(true);
    expect(() => analyzeVehicleFire(ctx, st, { vehicle: pz.id, target: hexOf(ctx, 'K4'), weapon: 'mg' })).toThrow();
    st = applyAction(ctx, st, { type: 'endPhase' }).state; // → Defensive Fire
    st = applyAction(ctx, st, { type: 'endPhase' }).state; // → Advancing Fire
    if (st.units[sq.id]) expect(st.units[sq.id]!.hex).not.toBe(hexOf(ctx, 'K5'));
  });
});

describe('§36–37 infantry against AFVs', () => {
  it('Defensive Fire: a squad in woods the tank passed next to may try to immobilize it', () => {
    const s = blankState(ctx, 'movement');
    const pz = putVehicle(ctx, s, 'ger-pz4f2', step('K3', 3), 'N-NE');
    const sq = put(ctx, s, 'rus-447', 'K3');
    let st = applyAction(ctx, s, { type: 'vmove', vehicle: pz.id, to: hexOf(ctx, step(step('K3', 3), 3)) }).state;
    st = applyAction(ctx, st, { type: 'endPhase' }).state;
    expect(st.phase).toBe('defensiveFire');
    // Pre-AFV check 3+3 ≤ 7, immobilize 2+1 ≤ 4 (woods), then the crew check 6+6 fails: abandoned.
    st.diceQueue = [3, 3, 2, 1, 6, 6];
    const r = applyAction(ctx, st, { type: 'antiTank', units: [sq.id], vehicle: pz.id });
    expect(r.state.vehicles[pz.id]).toBeUndefined();
    expect(r.state.units[sq.id]!.firedPhase).toBe('defensiveFire');
  });

  it('a panzerfaust at 1 hex hits on 8 and kills on the PF column', () => {
    const s = blankState(ctx, 'prepFire');
    const sq = put(ctx, s, 'ger-467', 'K6', { weapons: ['ger-pf'] });
    const t34 = putVehicle(ctx, s, 'rus-t34', 'K5', 'S-SW');
    s.diceQueue = [4, 4, 3, 3, 1, 1];
    const r = applyAction(ctx, s, { type: 'antiTank', units: [sq.id], vehicle: t34.id, weapon: sq.weapons[0] });
    expect(r.state.vehicles[t34.id]).toBeUndefined();
    expect(r.state.weapons[sq.weapons[0]!]).toBeUndefined();
  });

  it('Close Combat: infantry advancing onto a lone AFV kills it on its firepower or less, else falls back', () => {
    const s = blankState(ctx, 'advance');
    const sq = put(ctx, s, 'ger-467', 'K6');
    const t34 = putVehicle(ctx, s, 'rus-t34', 'K5');
    s.diceQueue = [2, 2];
    let st = applyAction(ctx, s, { type: 'advance', units: [sq.id], to: hexOf(ctx, 'K5') }).state;
    expect(st.afvAssaults).toHaveLength(1);
    st = applyAction(ctx, st, { type: 'endPhase' }).state;
    expect(st.phase).toBe('closeCombat');
    st.diceQueue = [5, 6];
    st = applyAction(ctx, st, { type: 'endPhase' }).state;
    st = applyAction(ctx, st, { type: 'endPhase' }).state;
    expect(st.vehicles[t34.id]).toBeDefined();
    expect(st.units[sq.id]!.hex).toBe(hexOf(ctx, 'K6'));
  });
});

describe('cover and sudden death', () => {
  it('infantry beside a friendly AFV get +1; a side with only vehicles left is still in the game', () => {
    const s = blankState(ctx, 'prepFire');
    const g = put(ctx, s, 'ger-467', 'K8');
    put(ctx, s, 'rus-447', 'K5');
    putVehicle(ctx, s, 'rus-t34', 'K5');
    const r = tryAction(ctx, s, { type: 'fire', firers: [{ unit: g.id, inherent: true, weapons: [] }], target: hexOf(ctx, 'K5') });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.events.find((e) => e.kind === 'fire')!.trace!.some((t) => t.includes('+1 beside an AFV'))).toBe(true);
    const s2 = blankState(ctx, 'prepFire');
    put(ctx, s2, 'ger-467', 'K8');
    putVehicle(ctx, s2, 'rus-t34', 'K5');
    expect(applyAction(ctx, s2, { type: 'endPhase' }).state.phase).not.toBe('gameOver');
  });
});
