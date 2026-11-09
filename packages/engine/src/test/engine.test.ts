import { describe, expect, it } from 'vitest';
import { applyAction, tryAction, createGame, replay } from '../engine';
import { analyzeFire, iftLookup } from '../rules/fire';
import { applyHexResults } from '../rules/morale';
import { oddsColumn } from '../rules/closeCombat';
import { mfAllowance } from '../rules/movement';
import { routOptions } from '../rules/rout';
import { makeCtx, parseScenario } from '../index';
import { rawBoards, rawScenarios } from '@squadwar/content';
import { parseBoard } from '@squadwar/terrain';
import type { GameEvent } from '../types';
import { blankState, data, hexOf, put, testCtx } from './helpers';

describe('fire combat (§8–11)', () => {
  it('reproduces the §10.6 example: 2× 4-6-7 at long range + MMG + −2 leader → 8 FP column', () => {
    const ctx = testCtx();
    const s = blankState(ctx);
    const a = put(ctx, s, 'ger-467', 'K2', { weapons: ['ger-mmg'] });
    const b = put(ctx, s, 'ger-467', 'K2');
    const L = put(ctx, s, 'ger-L92', 'K2');
    put(ctx, s, 'rus-447', 'K9'); // 7 hexes away, open ground
    const an = analyzeFire(
      ctx,
      s,
      [
        { unit: a.id, inherent: true, weapons: a.weapons },
        { unit: b.id, inherent: true, weapons: [] },
      ],
      hexOf(ctx, 'K9'),
      L.id,
    );
    expect(an.totalFp).toBe(8);
    expect(an.columnFp).toBe(8);
    expect(an.leaderDrm).toBe(-2);
    // Dice 8, −2 → 6 on the 8 column: +1 MC.
    expect(iftLookup(ctx, an.column, 8 + an.targets[0]!.units[0]!.drm)).toBe(1);
  });

  it('applies point blank, moving fire and terrain modifiers', () => {
    const ctx = testCtx({ K5: { t: 'stoneBuilding', b: 'x' } });
    const s = blankState(ctx, 'advancingFire');
    const a = put(ctx, s, 'ger-467', 'K4', { moved: true });
    put(ctx, s, 'rus-447', 'K5');
    const an = analyzeFire(ctx, s, [{ unit: a.id, inherent: true, weapons: [] }], hexOf(ctx, 'K5'));
    expect(an.totalFp).toBe(4); // ×2 point blank, ½ moving
    expect(an.targets[0]!.units[0]!.drm).toBe(3); // stone building
  });

  it('refuses fire without LOS, out of range, or by a broken unit', () => {
    const ctx = testCtx({ K5: { t: 'woods' } });
    const s = blankState(ctx);
    const a = put(ctx, s, 'ger-467', 'K2');
    put(ctx, s, 'rus-447', 'K8');
    expect(tryAction(ctx, s, { type: 'fire', firers: [{ unit: a.id, inherent: true, weapons: [] }], target: hexOf(ctx, 'K8') })).toMatchObject({ ok: false });
    const b = put(ctx, s, 'ger-467', 'X2', { broken: true });
    put(ctx, s, 'rus-447', 'X4');
    const r = tryAction(ctx, s, { type: 'fire', firers: [{ unit: b.id, inherent: true, weapons: [] }], target: hexOf(ctx, 'X4') });
    expect(r.ok).toBe(false);
  });

  it('a leader may direct only a fire group in his own hex (§15.2)', () => {
    const ctx = testCtx();
    const s = blankState(ctx);
    const a = put(ctx, s, 'ger-467', 'K2');
    const b = put(ctx, s, 'ger-467', 'L2');
    const L = put(ctx, s, 'ger-L92', 'K2');
    put(ctx, s, 'rus-447', 'K5');
    const firers = [
      { unit: a.id, inherent: true, weapons: [] },
      { unit: b.id, inherent: true, weapons: [] },
    ];
    expect(tryAction(ctx, s, { type: 'fire', firers, target: hexOf(ctx, 'K5'), leader: L.id }).ok).toBe(false);
    expect(tryAction(ctx, s, { type: 'fire', firers, target: hexOf(ctx, 'K5') }).ok).toBe(true);
  });

  it('defensive fire hits moving units in the hexes they crossed, −2 in the open (§16)', () => {
    const ctx = testCtx();
    const s = blankState(ctx, 'defensiveFire');
    const d = put(ctx, s, 'rus-447', 'K2');
    const m = put(ctx, s, 'ger-467', 'K7');
    s.tracks[m.id] = [
      { hex: hexOf(ctx, 'K5'), mf: 1, open: true },
      { hex: hexOf(ctx, 'K6'), mf: 1, open: true },
      { hex: hexOf(ctx, 'K7'), mf: 1, open: true },
    ];
    const an = analyzeFire(ctx, s, [{ unit: d.id, inherent: true, weapons: [] }], hexOf(ctx, 'K5'));
    expect(an.targets[0]!.units.map((u) => u.unit)).toEqual([m.id]);
    expect(an.targets[0]!.units[0]!.drm).toBe(-2);
  });

  it('a malfunction happens on an unmodified roll at the breakdown number (§18.1)', () => {
    const ctx = testCtx();
    const s = blankState(ctx);
    const a = put(ctx, s, 'ger-467', 'K2', { weapons: ['ger-lmg'] });
    put(ctx, s, 'rus-447', 'K5');
    s.diceQueue = [6, 6, 1, 1, 1, 1];
    const r = applyAction(ctx, s, { type: 'fire', firers: [{ unit: a.id, inherent: true, weapons: a.weapons }], target: hexOf(ctx, 'K5') });
    expect(r.state.weapons[a.weapons[0]!]!.malfunctioned).toBe(true);
  });
});

describe('morale (§12, rulebook example 12.4)', () => {
  it('follows the leader-first sequence and leader-loss checks exactly', () => {
    const ctx = testCtx();
    const s = blankState(ctx);
    const L = put(ctx, s, 'rus-L81', 'K5');
    const A = put(ctx, s, 'rus-447', 'K5');
    const B = put(ctx, s, 'rus-447', 'K5');
    const ev: GameEvent[] = [];
    const emit = (e: GameEvent) => ev.push(e);
    // First attack: +1 MC. Officer rolls 4 (passes on 7). Squads need 7 (+1 MC, −1 leader): 6 passes, 11 breaks.
    s.diceQueue = [1, 3, 3, 3, 5, 6];
    applyHexResults(ctx, s, { hex: L.hex, results: [L, A, B].map((u) => ({ unit: u.id, result: 1, finalDr: 6 })) }, emit);
    expect(s.units[L.id]!.broken).toBe(false);
    expect(s.units[A.id]!.broken).toBe(false);
    expect(s.units[B.id]!.broken).toBe(true);
    // Second attack: M. Officer rolls 9 and breaks; squads take two normal checks needing 7.
    // Broken squad B rolls 7 then 3: survives. Squad A rolls 8 (breaks) then 9 (eliminated).
    s.diceQueue = [4, 5, 3, 4, 1, 2, 4, 4, 5, 4];
    applyHexResults(ctx, s, { hex: L.hex, results: [L, B, A].map((u) => ({ unit: u.id, result: 'M', finalDr: 8 })) }, emit);
    expect(s.units[L.id]!.broken).toBe(true);
    expect(s.units[B.id]?.broken).toBe(true);
    expect(s.units[A.id]).toBeUndefined();
  });

  it('a Russian unit rolling an unmodified 2 goes berserk (§18.4)', () => {
    const ctx = testCtx();
    const s = blankState(ctx);
    const A = put(ctx, s, 'rus-447', 'K5');
    s.diceQueue = [1, 1];
    applyHexResults(ctx, s, { hex: A.hex, results: [{ unit: A.id, result: 2, finalDr: 5 }] }, () => {});
    expect(s.units[A.id]!.berserk).toBe(true);
  });
});

describe('movement (§5)', () => {
  it('charges terrain, roads, hexside walls and the leader bonus', () => {
    const ctx = testCtx({ K4: { t: 'woodBuilding', b: 'h' } }, { 'K5/N': { wall: true } });
    const s = blankState(ctx, 'movement');
    const sq = put(ctx, s, 'ger-467', 'K6');
    const L = put(ctx, s, 'ger-L80', 'K6');
    put(ctx, s, 'rus-447', 'B9');
    let st = applyAction(ctx, s, { type: 'move', units: [sq.id, L.id], to: hexOf(ctx, 'K5') }).state;
    expect(mfAllowance(ctx, st, st.units[sq.id]!).mf).toBe(6);
    st = applyAction(ctx, st, { type: 'move', units: [sq.id, L.id], to: hexOf(ctx, 'K4') }).state; // 2 + 1 wall
    expect(st.units[sq.id]!.mfSpent).toBe(4);
    const r = tryAction(ctx, st, { type: 'move', units: [sq.id], to: hexOf(ctx, 'K3') });
    expect(r.ok).toBe(false); // leader left the group: back to 4 MF
  });

  it('portage beyond 3 PP costs MF (§5.7)', () => {
    const ctx = testCtx();
    const s = blankState(ctx, 'movement');
    const sq = put(ctx, s, 'ger-467', 'K6', { weapons: ['ger-hmg'] });
    expect(mfAllowance(ctx, s, sq).mf).toBe(2);
  });

  it('cannot enter an enemy hex in the Movement Phase (§5.6)', () => {
    const ctx = testCtx();
    const s = blankState(ctx, 'movement');
    const sq = put(ctx, s, 'ger-467', 'K6');
    put(ctx, s, 'rus-447', 'K5');
    expect(tryAction(ctx, s, { type: 'move', units: [sq.id], to: hexOf(ctx, 'K5') }).ok).toBe(false);
  });

  it('refuses to end the phase overstacked (§6.3)', () => {
    const ctx = testCtx();
    const s = blankState(ctx, 'movement');
    for (let i = 0; i < 4; i++) put(ctx, s, 'ger-467', 'K6');
    expect(tryAction(ctx, s, { type: 'endPhase' }).ok).toBe(false);
  });
});

describe('rout (§13)', () => {
  it('a broken unit in the open routs to the nearest building away from the enemy', () => {
    const ctx = testCtx({ K8: { t: 'woodBuilding', b: 'a' }, K2: { t: 'woodBuilding', b: 'b' } });
    const s = blankState(ctx, 'rout');
    const u = put(ctx, s, 'ger-467', 'K6', { broken: true });
    put(ctx, s, 'rus-447', 'K3', { broken: true });
    const plans = routOptions(ctx, s, u);
    expect(plans[0]!.dest).toBe(hexOf(ctx, 'K8'));
  });

  it('is eliminated when only open ground in enemy LOS lies around it (§13.42, §13.47)', () => {
    const ctx = testCtx({ K9: { t: 'woodBuilding', b: 'a' } });
    const s = blankState(ctx, 'rout');
    const u = put(ctx, s, 'ger-467', 'K6', { broken: true });
    put(ctx, s, 'rus-447', 'K3');
    expect(routOptions(ctx, s, u)).toHaveLength(0);
    const r = applyAction(ctx, s, { type: 'rout', unit: u.id });
    expect(r.state.units[u.id]).toBeUndefined();
  });
});

describe('rally (§14)', () => {
  it('needs a leader for squads and applies desperation morale', () => {
    const ctx = testCtx();
    const s = blankState(ctx, 'rally');
    const sq = put(ctx, s, 'ger-467', 'K6', { broken: true, dm: true });
    expect(tryAction(ctx, s, { type: 'rally', unit: sq.id }).ok).toBe(false);
    put(ctx, s, 'ger-L92', 'K6');
    s.diceQueue = [3, 2]; // 5 − 2 = 3 ≤ 7 − 4
    const r = applyAction(ctx, s, { type: 'rally', unit: sq.id });
    expect(r.state.units[sq.id]!.broken).toBe(false);
  });

  it('an unmodified 12 eliminates (§18.3)', () => {
    const ctx = testCtx();
    const s = blankState(ctx, 'rally');
    const L = put(ctx, s, 'ger-L80', 'K6', { broken: true });
    s.diceQueue = [6, 6];
    expect(applyAction(ctx, s, { type: 'rally', unit: L.id }).state.units[L.id]).toBeUndefined();
  });
});

describe('close combat (§20.3)', () => {
  it('rounds odds in the defender’s favour', () => {
    const ctx = testCtx();
    const label = (a: number, d: number) => data.tables.closeCombat.labels[oddsColumn(ctx, a, d)];
    expect(label(12, 4)).toBe('3-1');
    expect(label(6, 4)).toBe('3-2');
    expect(label(11, 4)).toBe('2-1');
    expect(label(4, 15)).toBe('1-4');
    expect(label(1, 9)).toBe('1-5');
  });
});

describe('scenario 1', () => {
  const sc = parseScenario(rawScenarios[0]);
  const ctx = makeCtx(sc, data, { A: parseBoard(rawBoards.A) });

  it('sets up and runs a full player turn of phases', () => {
    let s = createGame(ctx, 42).state;
    expect(s.phase).toBe('setup');
    s = applyAction(ctx, s, { type: 'endPhase' }).state;
    s = applyAction(ctx, s, { type: 'endPhase' }).state;
    expect(s.phase).toBe('rally');
    expect(s.phasing).toBe('ger');
    const seen: string[] = [];
    for (let i = 0; i < 30 && s.half === 0; i++) {
      seen.push(s.phase);
      s = applyAction(ctx, s, { type: 'endPhase' }).state;
    }
    expect(seen).toEqual(['rally', 'rally', 'prepFire', 'movement', 'defensiveFire', 'advancingFire', 'rout', 'rout', 'advance']);
    expect(s.phasing).toBe('rus');
  });

  it('replays deterministically from seed and actions', () => {
    const actions = Array.from({ length: 40 }, () => ({ type: 'endPhase' as const }));
    const a = replay(ctx, 7, actions.slice(0, 20));
    const b = replay(ctx, 7, actions.slice(0, 20));
    expect(a.state).toEqual(b.state);
  });
});
