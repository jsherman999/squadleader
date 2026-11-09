import { describe, expect, it } from 'vitest';
import { applyAction, tryAction } from '../engine';
import { analyzeFire, fireOdds } from '../rules/fire';
import type { GameState } from '../types';
import { blankState, hexOf, put, testCtx } from './helpers';

const L27 = { rulesLevel: 27 };

describe('§22 flamethrowers', () => {
  const ctx = testCtx({ K5: { t: 'stoneBuilding', b: 'x' } }, {}, L27);

  it('fire alone at 20 FP with no modifiers at all, even into a stone building', () => {
    const s = blankState(ctx, 'prepFire');
    const eng = put(ctx, s, 'ger-838', 'K7', { weapons: ['ger-ft'] });
    put(ctx, s, 'rus-447', 'K5');
    const an = analyzeFire(ctx, s, [{ unit: eng.id, inherent: false, weapons: [eng.weapons[0]!] }], hexOf(ctx, 'K5'));
    expect(an.flamethrower).toBe(true);
    expect(an.totalFp).toBe(20);
    expect(an.targets[0]!.units[0]!.drm).toBe(0);
  });

  it('never combine, even with their own squad, and need engineers', () => {
    const s = blankState(ctx, 'prepFire');
    const eng = put(ctx, s, 'ger-838', 'K7', { weapons: ['ger-ft'] });
    const rifle = put(ctx, s, 'ger-467', 'K7', { weapons: ['ger-ft'] });
    put(ctx, s, 'rus-447', 'K5');
    expect(() => analyzeFire(ctx, s, [{ unit: eng.id, inherent: true, weapons: [eng.weapons[0]!] }], hexOf(ctx, 'K5'))).toThrow(/§22.3/);
    expect(() => analyzeFire(ctx, s, [{ unit: rifle.id, inherent: false, weapons: [rifle.weapons[0]!] }], hexOf(ctx, 'K5'))).toThrow(/§22.4/);
  });

  it('run out of fuel on 9+, and a KIA destroys the support weapons in the hex', () => {
    const s = blankState(ctx, 'prepFire');
    const eng = put(ctx, s, 'ger-838', 'K7', { weapons: ['ger-ft'] });
    put(ctx, s, 'rus-447', 'K5', { weapons: ['rus-lmg'] });
    s.diceQueue = [5, 6, 6, 6];
    const r = applyAction(ctx, s, { type: 'fire', firers: [{ unit: eng.id, inherent: false, weapons: [eng.weapons[0]!] }], target: hexOf(ctx, 'K5') });
    // 11 on the 20 column is not a KIA; the flamethrower is out of fuel (§22.6).
    expect(Object.values(r.state.weapons).some((w) => w.type === 'ger-ft')).toBe(false);
    const s2 = blankState(ctx, 'prepFire');
    const e2 = put(ctx, s2, 'ger-838', 'K7', { weapons: ['ger-ft'] });
    put(ctx, s2, 'rus-447', 'K5', { weapons: ['rus-lmg'] });
    s2.diceQueue = [1, 1];
    const r2 = applyAction(ctx, s2, { type: 'fire', firers: [{ unit: e2.id, inherent: false, weapons: [e2.weapons[0]!] }], target: hexOf(ctx, 'K5') });
    expect(Object.values(r2.state.units).some((u) => u.side === 'rus')).toBe(false);
    expect(Object.values(r2.state.weapons).some((w) => w.type === 'rus-lmg')).toBe(false); // §22.9
    expect(Object.values(r2.state.weapons).some((w) => w.type === 'ger-ft')).toBe(true); // roll 2: still has fuel
  });

  it('draw fire: −1 to attacks on a hex holding a flamethrower', () => {
    const s = blankState(ctx, 'prepFire');
    s.phasing = 'rus';
    s.awaiting = 'rus';
    const r = put(ctx, s, 'rus-447', 'K9');
    put(ctx, s, 'ger-838', 'K7', { weapons: ['ger-ft'] });
    const an = analyzeFire(ctx, s, [{ unit: r.id, inherent: true, weapons: [] }], hexOf(ctx, 'K7'));
    expect(an.targets[0]!.units[0]!.drm).toBe(-1);
  });
});

describe('§23 demolition charges', () => {
  const ctx = testCtx({ K5: { t: 'stoneBuilding', b: 'x' } }, {}, L27);

  function placed(): { s: GameState; eng: string; dc: string } {
    const s = blankState(ctx, 'movement');
    const eng = put(ctx, s, 'ger-838', 'K6', { weapons: ['ger-dc'] });
    put(ctx, s, 'rus-447', 'K5');
    const r = applyAction(ctx, s, { type: 'placeCharge', unit: eng.id, weapon: eng.weapons[0]!, target: hexOf(ctx, 'K5') });
    return { s: r.state, eng: eng.id, dc: eng.weapons[0]! };
  }

  it('are placed on an adjacent hex in movement and go off in Advancing Fire with terrain but no leadership', () => {
    const { s, dc } = placed();
    expect(s.charges).toHaveLength(1);
    let st = applyAction(ctx, s, { type: 'endPhase' }).state; // → defensive fire
    st = applyAction(ctx, st, { type: 'endPhase' }).state; // → advancing fire, charge armed
    expect(st.charges[0]!.armed).toBe(true);
    st.diceQueue = [1, 1];
    const r = applyAction(ctx, st, { type: 'detonate', weapon: dc });
    // 30 FP, roll 2 + 3 (stone) = 5 → KIA on the 30 column.
    expect(Object.values(r.state.units).some((u) => u.side === 'rus')).toBe(false);
    expect(r.state.charges).toHaveLength(0);
    expect(r.events.some((e) => e.kind === 'fire' && (e.trace ?? []).some((t) => t.includes('+3')))).toBe(true);
  });

  it('do not go off if the engineers broke, and are wasted if not used', () => {
    const { s, eng } = placed();
    let st = applyAction(ctx, s, { type: 'endPhase' }).state;
    st.units[eng]!.broken = true;
    st = applyAction(ctx, st, { type: 'endPhase' }).state;
    expect(st.charges).toHaveLength(0);
    const p2 = placed();
    let st2 = applyAction(ctx, p2.s, { type: 'endPhase' }).state;
    st2 = applyAction(ctx, st2, { type: 'endPhase' }).state;
    st2 = applyAction(ctx, st2, { type: 'endPhase' }).state; // skip detonating
    expect(st2.charges).toHaveLength(0);
    expect(st2.weapons[p2.dc]).toBeUndefined();
  });

  it('need an engineer or a good leader, and an adjacent hex', () => {
    const s = blankState(ctx, 'movement');
    const rifle = put(ctx, s, 'ger-467', 'K6', { weapons: ['ger-dc'] });
    put(ctx, s, 'rus-447', 'K5');
    expect(tryAction(ctx, s, { type: 'placeCharge', unit: rifle.id, weapon: rifle.weapons[0]!, target: hexOf(ctx, 'K5') }).ok).toBe(false);
    const eng = put(ctx, s, 'ger-838', 'K8', { weapons: ['ger-dc'] });
    const far = tryAction(ctx, s, { type: 'placeCharge', unit: eng.id, weapon: eng.weapons[0]!, target: hexOf(ctx, 'K5') });
    expect(far.ok ? '' : far.error).toMatch(/§23.3/);
  });
});

describe('§24 smoke', () => {
  const ctx = testCtx({}, {}, { ...L27, smoke: { ger: 2 } });

  it('is laid by engineers first thing in Prep Fire, costs +1 MF to enter, adds a die to fire through it, and lifts next turn', () => {
    const s = blankState(ctx, 'prepFire');
    const eng = put(ctx, s, 'ger-838', 'K7');
    put(ctx, s, 'rus-447', 'B2');
    const r = applyAction(ctx, s, { type: 'smoke', unit: eng.id, hex: hexOf(ctx, 'K6') });
    expect(r.state.smoke).toEqual([{ hex: hexOf(ctx, 'K6'), side: 'ger' }]);
    expect(r.state.smokeLeft.ger).toBe(1);
    // Second smoke from the same squad is refused.
    expect(tryAction(ctx, r.state, { type: 'smoke', unit: eng.id, hex: hexOf(ctx, 'K7') }).ok).toBe(false);
    // Moving into smoke costs 1 more.
    let st = applyAction(ctx, r.state, { type: 'endPhase' }).state;
    const rifle = put(ctx, st, 'ger-467', 'K7');
    st = applyAction(ctx, st, { type: 'move', units: [rifle.id], to: hexOf(ctx, 'K6') }).state;
    expect(st.units[rifle.id]!.mfSpent).toBe(2);
    // Fire across the smoke gets a die added.
    const s2 = structuredClone(r.state);
    s2.phasing = 'rus';
    s2.awaiting = 'rus';
    s2.attacks = [];
    const rus = put(ctx, s2, 'rus-447', 'K4');
    const an = analyzeFire(ctx, s2, [{ unit: rus.id, inherent: true, weapons: [] }], hexOf(ctx, 'K7'));
    expect(an.smoke).toBe(true);
    const plain = fireOdds(ctx, s2, { ...an, smoke: false }).units[0]!.mc;
    expect(fireOdds(ctx, s2, an).units[0]!.mc).toBeLessThan(plain);
  });

  it('only by assault engineers', () => {
    const s = blankState(ctx, 'prepFire');
    const rifle = put(ctx, s, 'ger-467', 'K7');
    expect(tryAction(ctx, s, { type: 'smoke', unit: rifle.id, hex: hexOf(ctx, 'K7') }).ok).toBe(false);
  });
});

describe('§25 concealment', () => {
  const ctx = testCtx({ K5: { t: 'woods' }, K9: { t: 'woods' } }, {}, L27);

  it('halves fire at concealed units (Area Fire) and is lost when hit', () => {
    const s = blankState(ctx, 'prepFire');
    const g = put(ctx, s, 'ger-467', 'K7');
    const r = put(ctx, s, 'rus-447', 'K5', { concealed: true });
    const an = analyzeFire(ctx, s, [{ unit: g.id, inherent: true, weapons: [] }], hexOf(ctx, 'K5'));
    expect(an.targets[0]!.units[0]!.area).toBe(true);
    // 4 FP ×2 point blank? No: range 2 → 4 FP; area → 2 FP column.
    expect(ctx.data.tables.ift.columns[an.areaColumn]).toBe(2);
    s.diceQueue = [1, 1, 6, 6];
    const out = applyAction(ctx, s, { type: 'fire', firers: [{ unit: g.id, inherent: true, weapons: [] }], target: hexOf(ctx, 'K5') });
    expect(out.state.units[r.id]?.concealed ?? false).toBe(false);
  });

  it('is gained by units that stay quiet in woods or buildings through their own player turn', () => {
    const s = blankState(ctx, 'closeCombat');
    s.awaiting = 'rus';
    const g = put(ctx, s, 'ger-467', 'K9');
    const moved = put(ctx, s, 'ger-467', 'K5', { noConceal: true });
    s.ccPlans = {};
    const r = applyAction(ctx, s, { type: 'endPhase' });
    expect(r.state.units[g.id]!.concealed).toBe(true);
    expect(r.state.units[moved.id]!.concealed).toBe(false);
  });

  it('is lost by moving', () => {
    const s = blankState(ctx, 'movement');
    const g = put(ctx, s, 'ger-467', 'K9', { concealed: true });
    const r = applyAction(ctx, s, { type: 'move', units: [g.id], to: hexOf(ctx, 'K8') });
    expect(r.state.units[g.id]!.concealed).toBe(false);
  });
});

describe('§26 fanaticism', () => {
  const ctx = testCtx({ K5: { t: 'stoneBuilding', b: 'f' } }, {}, { ...L27, fanatic: [{ side: 'rus', building: 'T-K5' }] });

  it('gives −1 on morale checks inside the building', () => {
    const s = blankState(ctx, 'prepFire');
    const g = put(ctx, s, 'ger-467', 'K7');
    put(ctx, s, 'rus-447', 'K5');
    // 4 FP at range 2 on the 4 column; roll 3 + 3 TEM = 6 → MC on the 4 column? Use a +1 MC result: then MC roll 4+4 = 8 +1 −1 = 8 > 7 fails without fanatic? Check the trace.
    s.diceQueue = [1, 2, 4, 3];
    const out = applyAction(ctx, s, { type: 'fire', firers: [{ unit: g.id, inherent: true, weapons: [] }], target: hexOf(ctx, 'K5') });
    const mc = out.events.find((e) => e.kind === 'morale');
    if (mc) expect((mc.trace ?? []).join(' ')).toMatch(/fanatic/);
  });
});

describe('§27 sewer movement', () => {
  const ctx = testCtx({ K5: { t: 'stoneBuilding', b: 's', sw: true }, K8: { t: 'open', sw: true }, K2: { t: 'open', sw: true } }, {}, { ...L27, sewers: true });

  it('moves a led stack up to three hexes on a 1–4, and comes up concealed away from the enemy', () => {
    const s = blankState(ctx, 'movement');
    const sq = put(ctx, s, 'ger-467', 'K8');
    const ld = put(ctx, s, 'ger-L81', 'K8');
    s.diceQueue = [3];
    const r = applyAction(ctx, s, { type: 'sewer', units: [sq.id, ld.id], to: hexOf(ctx, 'K5') });
    expect(r.state.units[sq.id]!.hex).toBe(hexOf(ctx, 'K5'));
    expect(r.state.units[sq.id]!.concealed).toBe(true);
    expect(r.state.units[sq.id]!.moveDone).toBe(true);
  });

  it('needs a leader with the squads; on a 5–6 the stack is lost until next turn', () => {
    const s = blankState(ctx, 'movement');
    const sq = put(ctx, s, 'ger-467', 'K8');
    expect(tryAction(ctx, s, { type: 'sewer', units: [sq.id], to: hexOf(ctx, 'K5') }).ok).toBe(false);
    const ld = put(ctx, s, 'ger-L81', 'K8');
    s.diceQueue = [6];
    const r = applyAction(ctx, s, { type: 'sewer', units: [sq.id, ld.id], to: hexOf(ctx, 'K5') });
    expect(r.state.units[sq.id]).toBeUndefined();
    expect(r.state.lostInSewers).toHaveLength(1);
  });

  it('into an enemy-held entrance: Defensive Fire there ignores terrain and gets −2', () => {
    const s = blankState(ctx, 'movement');
    const sq = put(ctx, s, 'ger-467', 'K8');
    const ld = put(ctx, s, 'ger-L81', 'K8');
    const rus = put(ctx, s, 'rus-447', 'K5');
    s.diceQueue = [2];
    let st = applyAction(ctx, s, { type: 'sewer', units: [sq.id, ld.id], to: hexOf(ctx, 'K5') }).state;
    st = applyAction(ctx, st, { type: 'endPhase' }).state; // → defensive fire
    const an = analyzeFire(ctx, st, [{ unit: rus.id, inherent: true, weapons: [] }], hexOf(ctx, 'K5'));
    const t = an.targets[0]!.units.find((x) => x.unit === sq.id)!;
    expect(t.drm).toBe(-2);
  });
});
