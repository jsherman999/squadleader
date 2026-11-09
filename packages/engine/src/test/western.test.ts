import { describe, expect, it } from 'vitest';
import { applyAction, createGame, tryAction } from '../engine';
import { analyzeFire } from '../rules/fire';
import { moveCost } from '../queries';
import { blankState, hexOf, put, putVehicle, testCtx } from './helpers';

describe('§50 Americans', () => {
  it('American squads rally at full morale even when fired on', () => {
    const ctx = testCtx({}, {}, { rulesLevel: 63 });
    const s = blankState(ctx, 'rally');
    s.sides = [{ id: 'rus', nation: 'russian', name: 'Soviet' }, { id: 'ger', nation: 'american', name: 'American' }] as never;
    const sq = put(ctx, s, 'us-666', 'K5', { broken: true, dm: true, side: 'ger' });
    put(ctx, s, 'us-L91', 'K5', { side: 'ger' });
    s.diceQueue = [3, 3];
    const r = applyAction(ctx, s, { type: 'rally', unit: sq.id });
    expect(r.state.units[sq.id]!.broken).toBe(false);
  });
});

describe('§53–55 wire, entrenchments, mines', () => {
  const ctx = testCtx({}, {}, { rulesLevel: 63, fortifications: { wire: ['T-K5'], trenches: ['T-K3'], mines: [{ side: 'rus', hex: 'T-M5', factors: 8 }] } });
  it('wire can only be entered in the Advance Phase', () => {
    const s = createGame(ctx, 1).state;
    const t = blankState(ctx, 'movement');
    t.forts = s.forts!;
    const g = put(ctx, t, 'ger-467', 'K6');
    expect(tryAction(ctx, t, { type: 'move', units: [g.id], to: hexOf(ctx, 'K5') }).ok).toBe(false);
  });
  it('units in an entrenchment get +2 against infantry fire', () => {
    const s = createGame(ctx, 1).state;
    const t = blankState(ctx, 'prepFire');
    t.forts = s.forts!;
    const g = put(ctx, t, 'ger-467', 'K8');
    put(ctx, t, 'rus-447', 'K3');
    const a = analyzeFire(ctx, t, [{ unit: g.id, inherent: true, weapons: [] }], hexOf(ctx, 'K3'));
    expect(a.targets[0]!.units[0]!.drm).toBe(2);
  });
  it('entering a minefield attacks the moving unit with its factors', () => {
    const s = createGame(ctx, 1).state;
    const t = blankState(ctx, 'movement');
    t.forts = s.forts!;
    const g = put(ctx, t, 'ger-467', 'M6');
    put(ctx, t, 'rus-447', 'B2');
    t.diceQueue = [1, 1];
    const r = applyAction(ctx, t, { type: 'move', units: [g.id], to: hexOf(ctx, 'M5') });
    expect(r.state.units[g.id]).toBeUndefined(); // 8 factors, roll 2: KIA
    expect(r.state.forts!.mines[0]!.known).toBe(true);
  });
  it('a squad digs in on 5 or less in Prep Fire', () => {
    const t = blankState(ctx, 'prepFire');
    const g = put(ctx, t, 'ger-467', 'C5');
    t.diceQueue = [2, 2];
    const r = applyAction(ctx, t, { type: 'dig', unit: g.id, work: 'entrench' });
    expect(r.state.forts!.trenches).toContain(hexOf(ctx, 'C5'));
  });
});

describe('§61 snow; §51 trucks', () => {
  it('snow doubles infantry terrain costs off the road', () => {
    const snow = testCtx({}, {}, { rulesLevel: 63, snow: true });
    expect(moveCost(snow, hexOf(snow, 'K5'), hexOf(snow, 'K4')).mf).toBe(2);
  });
  it('trucks pay 6 MP in the open, never enter enemy hexes, and are wrecked by infantry fire', () => {
    const ctx = testCtx({}, {}, { rulesLevel: 63 });
    const s = blankState(ctx, 'movement');
    const tr = putVehicle(ctx, s, 'ger-truck', 'K8', 'N-NE');
    const r = applyAction(ctx, s, { type: 'vmove', vehicle: tr.id, to: hexOf(ctx, 'K7') });
    expect(r.state.vehicles[tr.id]!.mpSpent).toBe(6);
    put(ctx, s, 'rus-447', 'K6');
    const s2 = r.state;
    put(ctx, s2, 'rus-447', 'K6');
    expect(tryAction(ctx, s2, { type: 'vmove', vehicle: tr.id, to: hexOf(ctx, 'K6') }).ok).toBe(false);
    const f = blankState(ctx, 'prepFire');
    f.phasing = 'rus';
    f.awaiting = 'rus';
    const r2 = put(ctx, f, 'rus-447', 'K9');
    const tr2 = putVehicle(ctx, f, 'ger-truck', 'K8', 'N-NE');
    put(ctx, f, 'ger-467', 'B2');
    f.diceQueue = [1, 1];
    const out = applyAction(ctx, f, { type: 'fire', firers: [{ unit: r2.id, inherent: true, weapons: [] }], target: hexOf(ctx, 'K8') });
    expect(out.state.vehicles[tr2.id]).toBeUndefined();
  });
});

describe('§58–59 rubble and fire', () => {
  it('a flamethrower KIA sets a building alight, and nobody may enter it', () => {
    const ctx = testCtx({ K5: { t: 'woodBuilding', b: 'h' } }, {}, { rulesLevel: 63 });
    const s = blankState(ctx, 'prepFire');
    const eng = put(ctx, s, 'ger-838', 'K7', { weapons: ['ger-ft'] });
    put(ctx, s, 'rus-447', 'K5');
    put(ctx, s, 'rus-447', 'B2');
    s.diceQueue = [1, 1];
    const r = applyAction(ctx, s, { type: 'fire', firers: [{ unit: eng.id, inherent: false, weapons: [eng.weapons[0]!] }], target: hexOf(ctx, 'K5') });
    expect(r.state.fires).toContain(hexOf(ctx, 'K5'));
    const m = blankState(ctx, 'movement');
    m.fires = [hexOf(ctx, 'K5')];
    const g = put(ctx, m, 'ger-467', 'K6');
    expect(tryAction(ctx, m, { type: 'move', units: [g.id], to: hexOf(ctx, 'K5') }).ok).toBe(false);
  });
});

describe('§60 reinforcements', () => {
  it('units with an entry turn wait off the map and come on at an edge hex', () => {
    const ctx = testCtx({}, {}, {
      rulesLevel: 63,
      sides: [
        { id: 'rus', nation: 'russian', name: 'Soviet', setup: [{ board: 'T', cols: ['A', 'P'] }], units: [{ type: 'rus-447', hex: 'T-B2' }] },
        { id: 'ger', nation: 'german', name: 'German', setup: [{ board: 'T', cols: ['Q', 'GG'] }], units: [{ type: 'ger-467', hex: 'T-Z2' }, { type: 'ger-467', enters: { turn: 1, board: 'T', edge: 'E' } }] },
      ],
    });
    const s0 = createGame(ctx, 1).state;
    expect(s0.reserves).toHaveLength(1);
    const s = { ...blankState(ctx, 'movement'), reserves: s0.reserves };
    put(ctx, s, 'rus-447', 'B2');
    const id = s0.reserves![0]!.units[0]!.id;
    const hex = s0.reserves![0]!.hexes[0]!;
    const r = applyAction(ctx, s, { type: 'enter', units: [id], hex });
    expect(r.state.units[id]!.hex).toBe(hex);
    expect(r.state.reserves).toHaveLength(0);
  });
});
