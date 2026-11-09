import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { composeMap, parseBoard, type BoardDef, type BoardHex, type GameMap } from '@squadwar/terrain';
import { rawBoards } from '@squadwar/content';
import { bestLos, checkLos, viewshed, losProfile } from './los';

function board(hexes: Record<string, BoardHex>, hexsides: BoardDef['hexsides'] = {}): GameMap {
  const def = parseBoard({ format: 'squadwar-board@1', id: 'T', name: 'Test', kind: 'country', seed: 3, hexes, hexsides });
  return composeMap([{ board: 'T', x: 0, y: 0 }], { T: def });
}
const id = (m: GameMap, s: string) => {
  const k = m.byId[`T-${s}`];
  if (!k) throw new Error(`no hex ${s}`);
  return k;
};
const los = (m: GameMap, a: string, b: string, au = false, bu = false) =>
  checkLos(m, { hex: id(m, a), upper: au }, { hex: id(m, b), upper: bu });

describe('basic LOS (§7)', () => {
  it('is clear over open ground', () => {
    const m = board({});
    expect(los(m, 'K2', 'K8').clear).toBe(true);
  });

  it('woods symbol in between blocks; in the end hexes it does not (§7.2)', () => {
    const m = board({ K5: { t: 'woods' }, K2: { t: 'woods' }, K8: { t: 'woods' } });
    const r = los(m, 'K2', 'K8');
    expect(r.clear).toBe(false);
    expect(r.blockedBy?.kind).toBe('woods');
    expect(m.hexes[r.blockedBy!.hex]!.id).toBe('T-K5');
    expect(los(m, 'K2', 'K4').clear).toBe(true);
  });

  it('woods beside the line do not block', () => {
    const m = board({ J5: { t: 'woods' }, L5: { t: 'woods' } });
    expect(los(m, 'K2', 'K8').clear).toBe(true);
  });

  it('adjacent hexes always see each other (§7.8)', () => {
    const m = board({ K5: { t: 'stoneBuilding', b: 'x' }, K6: { t: 'stoneBuilding', b: 'x' } });
    expect(los(m, 'K5', 'K6').clear).toBe(true);
  });

  it('LOS along a hexside is blocked only with the obstacle on both sides (§7.1)', () => {
    // K5 → M5 runs exactly along the hexside between L4 and L5.
    const both = board({ L4: { t: 'woods' }, L5: { t: 'woods' } });
    const one = board({ L4: { t: 'woods' } });
    expect(los(both, 'K5', 'M5').clear).toBe(false);
    expect(los(one, 'K5', 'M5').clear).toBe(true);
  });
});

describe('multi-story buildings (§7.4–7.7, §7.9)', () => {
  const tower = { K1: { t: 'stoneBuilding', b: 't' }, K2: { t: 'stoneBuilding', b: 't' }, K3: { t: 'stoneBuilding', b: 't' } } as const;

  it('the upper level sees over a small building, except the blind hex behind it', () => {
    const m = board({ ...tower, K5: { t: 'woodBuilding', b: 's' } });
    expect(los(m, 'K3', 'K7', true).clear).toBe(true);
    const blind = los(m, 'K3', 'K6', true);
    expect(blind.clear).toBe(false);
    expect(blind.blindHex).toBe(true);
    expect(los(m, 'K3', 'K7', false).clear).toBe(false);
    expect(bestLos(m, id(m, 'K3'), id(m, 'K7')).clear).toBe(true);
  });

  it('ground units see over obstacles to a multi-story target unless in the blind hex (§7.6)', () => {
    const m = board({ ...tower, K5: { t: 'woods' } });
    expect(los(m, 'K7', 'K3', false, true).clear).toBe(true);
    expect(los(m, 'K6', 'K3', false, true).clear).toBe(false);
  });

  it('multi-story buildings block LOS between upper levels (§7.5) with a 2-hex blind zone (§43.62)', () => {
    const m = board({ ...tower, K5: { t: 'stoneBuilding', b: 'u' }, J5: { t: 'stoneBuilding', b: 'u' }, L5: { t: 'stoneBuilding', b: 'u' } });
    expect(los(m, 'K3', 'K8', true, true).clear).toBe(false);
    const hill = board({ K3: { lv: 3 }, K5: { t: 'stoneBuilding', b: 'u' }, J5: { t: 'stoneBuilding', b: 'u' }, L5: { t: 'stoneBuilding', b: 'u' } });
    expect(los(hill, 'K3', 'K7').clear).toBe(false); // 2 hexes behind: still blind
    expect(los(hill, 'K3', 'K8').clear).toBe(true);
  });

  it('units in the same building see each other only if adjacent or with no symbol between (§7.7)', () => {
    const m = board({ M2: { t: 'stoneBuilding', b: 'm' }, M3: { t: 'stoneBuilding', b: 'm' }, M4: { t: 'stoneBuilding', b: 'm' }, M5: { t: 'stoneBuilding', b: 'm' } });
    expect(bestLos(m, id(m, 'M2'), id(m, 'M5')).clear).toBe(false);
    expect(bestLos(m, id(m, 'M2'), id(m, 'M3')).clear).toBe(true);
  });
});

describe('hills (§43)', () => {
  it('a level 1 viewer cannot see over ground woods; level 2 can, except the blind hex (§43.4, §43.6)', () => {
    const l1 = board({ K2: { lv: 1 }, K4: { t: 'woods' } });
    expect(los(l1, 'K2', 'K6').clear).toBe(false);
    const l2 = board({ K2: { lv: 2 }, K4: { t: 'woods' } });
    expect(los(l2, 'K2', 'K6').clear).toBe(true);
    expect(los(l2, 'K2', 'K5').clear).toBe(false);
  });

  it('a level 1 viewer sees over walls and hedges (§43.4)', () => {
    const m = board({ K2: { lv: 1 } }, { 'K4/S': { wall: true } });
    expect(los(m, 'K2', 'K7').clear).toBe(true);
  });

  it('from inside a plateau you cannot see down; from its crest you can (§43.5)', () => {
    const m = board({ K2: { lv: 1 }, K3: { lv: 1 }, K4: { lv: 1 }, K5: { lv: 1 } });
    expect(los(m, 'K2', 'K8').clear).toBe(false);
    expect(los(m, 'K5', 'K8').clear).toBe(true);
  });

  it('units on the same level see across it (§43.7)', () => {
    const m = board(Object.fromEntries(['K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8'].map((k) => [k, { lv: 1 }])));
    expect(los(m, 'K2', 'K8').clear).toBe(true);
  });

  it('crest lines of the viewer’s own hill make no blind hex; another hill does (§43.61)', () => {
    const same = board({ K2: { lv: 2 }, K3: { lv: 1 }, K4: { lv: 1 } });
    expect(los(same, 'K2', 'K5').clear).toBe(true);
    const other = board({ K2: { lv: 2 }, K4: { lv: 1 } });
    const r = los(other, 'K2', 'K5');
    expect(r.clear).toBe(false);
    expect(r.blindHex).toBe(true);
  });

  it('a ground unit cannot see past the first crest of a level 1 hill (§43.3)', () => {
    const m = board({ K5: { lv: 1 }, K6: { lv: 1 }, K7: { lv: 1 } });
    expect(los(m, 'K2', 'K5').clear).toBe(true);
    expect(los(m, 'K2', 'K7').clear).toBe(false);
  });
});

describe('walls and hedges (§11.5)', () => {
  const m = board({}, { 'K4/S': { wall: true }, 'K6/S': { hedge: true } });

  it('block ground LOS when crossed between other hexes (§11.51)', () => {
    const r = los(m, 'K2', 'K7');
    expect(r.clear).toBe(false);
    expect(r.blockedBy?.kind).toBe('wall');
  });

  it('do not block when they form a hexside of the target hex, and report it for TEM (§11.53)', () => {
    const r = los(m, 'K2', 'K5');
    expect(r.clear).toBe(true);
    expect(r.targetHexside?.wall).toBe(true);
    const h = los(m, 'K5', 'K7');
    expect(h.clear).toBe(true);
    expect(h.targetHexside?.hedge).toBe(true);
  });
});

describe('wheatfields (§44.2)', () => {
  it('are a hindrance (Area Fire), not a block', () => {
    const m = board({ K4: { t: 'wheat' }, K5: { t: 'wheat' } });
    const r = los(m, 'K2', 'K7');
    expect(r.clear).toBe(true);
    expect(r.hindrances).toHaveLength(2);
    expect(checkLos(m, { hex: id(m, 'K2') }, { hex: id(m, 'K7') }, { wheatInSeason: false }).hindrances).toHaveLength(0);
  });
});

describe('City A', () => {
  const map = composeMap([{ board: 'A', x: 0, y: 0 }], { A: parseBoard(rawBoards.A) });
  const keys = Object.keys(map.hexes);

  it('LOS is reciprocal (§43.8)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: keys.length - 1 }), fc.integer({ min: 0, max: keys.length - 1 }), (i, j) => {
        const a = keys[i]!;
        const b = keys[j]!;
        expect(bestLos(map, a, b).clear).toBe(bestLos(map, b, a).clear);
        for (const [au, bu] of [[false, false], [true, true], [true, false]] as const) {
          expect(checkLos(map, { hex: a, upper: au }, { hex: b, upper: bu }).clear).toBe(
            checkLos(map, { hex: b, upper: bu }, { hex: a, upper: au }).clear,
          );
        }
      }),
      { numRuns: 400 },
    );
  });

  it('viewshed and profile run across the whole board', () => {
    const from = map.byId['A-N5']!;
    const t = performance.now();
    const seen = viewshed(map, from);
    const ms = performance.now() - t;
    expect(seen.has(from)).toBe(true);
    expect(seen.size).toBeGreaterThan(20);
    expect(seen.size).toBeLessThan(keys.length);
    expect(ms).toBeLessThan(2000);
    const r = bestLos(map, from, map.byId['A-N9']!);
    expect(losProfile(map, r).length).toBeGreaterThan(0);
  });
});
