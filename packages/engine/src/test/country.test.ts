import { describe, expect, it } from 'vitest';
import { applyAction, tryAction } from '../engine';
import { analyzeFire } from '../rules/fire';
import { analyzeVehicleFire } from '../rules/armor';
import { exposureAt } from '../rules/exposure';
import { blankState, hexOf, put, putVehicle, testCtx } from './helpers';

describe('§42 hidden initial placement', () => {
  const ctx = testCtx({ K5: { t: 'woods' } }, {}, { rulesLevel: 46 });
  it('infantry walking into a hidden unit stop short and reveal it; fire at it is area fire', () => {
    const s = blankState(ctx, 'movement');
    const g = put(ctx, s, 'ger-467', 'K7');
    const r = put(ctx, s, 'rus-447', 'K5', { hidden: true });
    let st = applyAction(ctx, s, { type: 'move', units: [g.id], to: hexOf(ctx, 'K6') }).state;
    st = applyAction(ctx, st, { type: 'move', units: [g.id], to: hexOf(ctx, 'K5') }).state;
    expect(st.units[g.id]!.hex).toBe(hexOf(ctx, 'K6'));
    expect(st.units[g.id]!.moveDone).toBe(true);
    expect(st.units[r.id]!.hidden).toBe(false);
    const s2 = blankState(ctx, 'prepFire');
    const g2 = put(ctx, s2, 'ger-467', 'K8');
    put(ctx, s2, 'rus-447', 'K5', { hidden: true });
    const a = analyzeFire(ctx, s2, [{ unit: g2.id, inherent: true, weapons: [] }], hexOf(ctx, 'K5'));
    expect(a.targets[0]!.units[0]!.area).toBe(true);
  });
  it('a hidden gun and its crew go on the map when the gun fires (§42.2)', () => {
    const s = blankState(ctx, 'defensiveFire');
    const gun = putVehicle(ctx, s, 'rus-zis3', 'K5', 'SE-S', { hidden: true });
    const crew = put(ctx, s, 'rus-237', 'K5', { hidden: true });
    const g = put(ctx, s, 'ger-467', 'K9', { moved: true });
    const r = applyAction(ctx, s, { type: 'vfire', vehicle: gun.id, target: g.hex, weapon: 'main' });
    expect(r.state.vehicles[gun.id]!.hidden).toBe(false);
    expect(r.state.units[crew.id]!.hidden).toBe(false);
    expect(r.events.some((e) => /Hidden position revealed in T-K5: fired/.test(e.text))).toBe(true);
    // The danger map leaves a hidden gun out, and counts it once it is on the map.
    expect(exposureAt(ctx, s, 'ger', hexOf(ctx, 'K9')).threats.some((x) => x.vehicle === gun.id)).toBe(false);
    expect(exposureAt(ctx, r.state, 'ger', hexOf(ctx, 'K9')).threats.some((x) => x.vehicle === gun.id)).toBe(true);
  });
  it('a hidden vehicle that moves is on the map', () => {
    const s = blankState(ctx, 'movement');
    const pz = putVehicle(ctx, s, 'ger-pz4f2', 'K5', 'N-NE', { hidden: true });
    put(ctx, s, 'rus-447', 'B2');
    const st = applyAction(ctx, s, { type: 'vmove', vehicle: pz.id, to: hexOf(ctx, 'K4') }).state;
    expect(st.vehicles[pz.id]!.hidden).toBe(false);
  });
});

describe('§44 rural terrain', () => {
  it('point blank fire down a cliff is tripled', () => {
    const ctx = testCtx({ K5: { lv: 2 }, K6: {} }, { 'K5/S': { cliff: true } }, { rulesLevel: 46 });
    const s = blankState(ctx, 'prepFire');
    const g = put(ctx, s, 'ger-467', 'K5');
    put(ctx, s, 'rus-447', 'K6');
    const a = analyzeFire(ctx, s, [{ unit: g.id, inherent: true, weapons: [] }], hexOf(ctx, 'K6'));
    expect(a.totalFp).toBe(12);
  });
  it('wheatfields are open ground out of season', () => {
    const summer = testCtx({ K5: { t: 'wheat' } }, {}, { date: 'July 1943' });
    const winter = testCtx({ K5: { t: 'wheat' } }, {}, { date: 'December 1943' });
    expect(summer.map.hexes[hexOf(summer, 'K5')]!.terrain).toBe('wheat');
    expect(winter.map.hexes[hexOf(winter, 'K5')]!.terrain).toBe('open');
  });
});

describe('§49 night', () => {
  const ctx = testCtx({}, {}, { rulesLevel: 49, night: true, starshells: { ger: 2 } });
  it('fire needs the target within the night visibility range, or lit by a starshell', () => {
    const s = blankState(ctx, 'prepFire');
    s.nightVis = 3;
    s.starshells = [];
    s.flashes = { now: [], prev: [] };
    const g = put(ctx, s, 'ger-467', 'K9');
    put(ctx, s, 'rus-447', 'K3');
    expect(tryAction(ctx, s, { type: 'fire', firers: [{ unit: g.id, inherent: true, weapons: [] }], target: hexOf(ctx, 'K3') }).ok).toBe(false);
    s.starshells = [{ hex: hexOf(ctx, 'K4'), side: 'ger' }];
    expect(tryAction(ctx, s, { type: 'fire', firers: [{ unit: g.id, inherent: true, weapons: [] }], target: hexOf(ctx, 'K3') }).ok).toBe(true);
    s.starshells = [];
    s.flashes = { now: [], prev: [hexOf(ctx, 'K3')] };
    const a = analyzeFire(ctx, s, [{ unit: g.id, inherent: true, weapons: [] }], hexOf(ctx, 'K3'));
    expect(a.targets[0]!.units[0]!.area).toBe(true);
  });
  it('a leader who sees the enemy fires a starshell within 5 hexes', () => {
    const s = blankState(ctx, 'rally');
    s.nightVis = 6;
    s.starshells = [];
    s.starshellsLeft = { ger: 1, rus: 0 };
    const L = put(ctx, s, 'ger-L81', 'K8');
    put(ctx, s, 'rus-447', 'K4');
    const r = applyAction(ctx, s, { type: 'starshell', unit: L.id, hex: hexOf(ctx, 'K5') });
    expect(r.state.starshells).toHaveLength(1);
    expect(r.state.starshellsLeft!.ger).toBe(0);
  });
});

describe('§45–46 offboard artillery', () => {
  const ctx = testCtx({}, {}, { rulesLevel: 46, date: 'July 1943', artillery: [{ side: 'ger', mm: 105, missions: 2 }] });
  it('contact, request, spotting round, fire for effect on the 7-hex blast area', () => {
    let s = blankState(ctx, 'rally');
    s.batteries = [{ id: 'art1', side: 'ger', mm: 105, missions: 2, used: 0, contact: false, tried: false, leader: null, mode: 'idle', hex: null, smoke: false, acted: false }];
    const L = put(ctx, s, 'ger-L81', 'K9', { weapons: ['ger-radio'] });
    const target = put(ctx, s, 'rus-447', 'K4');
    put(ctx, s, 'rus-447', 'B2'); // someone left after the barrage
    s.diceQueue = [3, 3];
    s = applyAction(ctx, s, { type: 'radio', battery: 'art1', unit: L.id }).state;
    expect(s.batteries![0]!.contact).toBe(true);
    s = applyAction(ctx, s, { type: 'arty', battery: 'art1', op: 'request', hex: hexOf(ctx, 'K4') }).state;
    expect(s.batteries![0]!.mode).toBe('request');
    s = applyAction(ctx, s, { type: 'endPhase' }).state; // the Russians' rally step
    s = applyAction(ctx, s, { type: 'endPhase' }).state; // → Prep Fire (the Rally Phase ends)
    expect(s.batteries![0]!.mode).toBe('request');
    // Close Combat Phase: the spotting round lands on target on a 1–2 (German).
    s.phase = 'advance';
    s.diceQueue = [1];
    s = applyAction(ctx, s, { type: 'endPhase' }).state;
    expect(s.batteries![0]!.mode).toBe('sr');
    expect(s.batteries![0]!.hex).toBe(hexOf(ctx, 'K4'));
    // Next Rally Phase: keep contact (−2), fire for effect; it lands in Prep Fire.
    s.phase = 'rally';
    s.phasing = 'ger';
    s.awaiting = 'ger';
    s.diceQueue = [4, 4];
    s = applyAction(ctx, s, { type: 'radio', battery: 'art1', unit: L.id }).state;
    s = applyAction(ctx, s, { type: 'arty', battery: 'art1', op: 'ffe', hex: hexOf(ctx, 'K4') }).state;
    s = applyAction(ctx, s, { type: 'endPhase' }).state; // the Russians' rally step
    s.diceQueue = [1, 1];
    const r = applyAction(ctx, s, { type: 'endPhase' }); // → Prep Fire: the barrage lands
    expect(r.state.phase).toBe('prepFire');
    expect(r.state.batteries![0]!.used).toBe(1);
    expect(r.state.units[target.id]).toBeUndefined(); // 16 FP, roll 2: KIA
    expect(r.events.some((e) => e.kind === 'fire' && (e.fx as { artillery?: boolean })?.artillery)).toBe(true);
  });
});

describe('§31, §47 riders and halftracks; §48 AT guns', () => {
  const ctx = testCtx({}, {}, { rulesLevel: 48 });
  it('infantry board a halftrack, ride with it, are shielded from rifle fire, and get off', () => {
    let s = blankState(ctx, 'movement');
    const ht = putVehicle(ctx, s, 'ger-251', 'K8', 'N-NE');
    const sq = put(ctx, s, 'ger-467', 'K8');
    s = applyAction(ctx, s, { type: 'board', units: [sq.id], vehicle: ht.id }).state;
    expect(s.units[sq.id]!.riding).toBe(ht.id);
    expect(tryAction(ctx, s, { type: 'vmove', vehicle: ht.id, to: hexOf(ctx, 'K7') }).ok).toBe(false); // not the turn it was boarded
    const s2 = blankState(ctx, 'movement');
    const ht2 = putVehicle(ctx, s2, 'ger-251', 'K8', 'N-NE');
    const sq2 = put(ctx, s2, 'ger-467', 'K8', { riding: ht2.id, moveDone: true });
    let st = applyAction(ctx, s2, { type: 'vmove', vehicle: ht2.id, to: hexOf(ctx, 'K7') }).state;
    expect(st.units[sq2.id]!.hex).toBe(hexOf(ctx, 'K7'));
    // Russian rifles cannot touch the riders.
    st = { ...st, phase: 'defensiveFire', awaiting: 'rus' };
    const rus = put(ctx, st, 'rus-447', 'K3');
    expect(tryAction(ctx, st, { type: 'fire', firers: [{ unit: rus.id, inherent: true, weapons: [] }], target: hexOf(ctx, 'K7') }).ok).toBe(false);
    st = { ...st, phase: 'movement', awaiting: 'ger' };
    st = applyAction(ctx, st, { type: 'unload', units: [sq2.id], vehicle: ht2.id }).state;
    expect(st.units[sq2.id]!.riding).toBeUndefined();
    expect(st.vehicles[ht2.id]!.mpSpent).toBeGreaterThan(1);
  });
  it('an AT gun fires only with its crew; a hit of 37mm or more destroys it', () => {
    const s = blankState(ctx, 'prepFire');
    s.phasing = 'rus';
    s.awaiting = 'rus';
    const gun = putVehicle(ctx, s, 'rus-zis3', 'K3', 'S-SW');
    const pz = putVehicle(ctx, s, 'ger-pz4f2', 'K8', 'N-NE');
    expect(() => analyzeVehicleFire(ctx, s, { vehicle: gun.id, target: pz.hex, weapon: 'main', vs: pz.id })).toThrow();
    put(ctx, s, 'rus-237', 'K3');
    expect(analyzeVehicleFire(ctx, s, { vehicle: gun.id, target: pz.hex, weapon: 'main', vs: pz.id }).hitNumber).toBe(10);
    const s2 = blankState(ctx, 'prepFire');
    const g2 = putVehicle(ctx, s2, 'rus-zis3', 'K3', 'S-SW');
    const pz2 = putVehicle(ctx, s2, 'ger-pz4f2', 'K8', 'N-NE');
    const a = analyzeVehicleFire(ctx, s2, { vehicle: pz2.id, target: g2.hex, weapon: 'main', vs: g2.id });
    expect(a.hitNumber).toBe(6); // AT gun row
    s2.diceQueue = [2, 2, 3, 3];
    const r = applyAction(ctx, s2, { type: 'vfire', vehicle: pz2.id, target: g2.hex, weapon: 'main', vs: g2.id });
    expect(r.state.vehicles[g2.id]).toBeUndefined();
    expect(r.state.wrecks).toHaveLength(0);
  });
});
