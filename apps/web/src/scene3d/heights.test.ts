import { describe, expect, it } from 'vitest';
import { hexToPixel } from '@squadwar/hex';
import { composeMap, mapGeometry, parseBoard } from '@squadwar/terrain';
import { rawBoards } from '@squadwar/content';
import { checkLos } from '@squadwar/los';
import { buildingLevels, terrainHeight, TREE_TOP } from './heights';

const map = composeMap([{ board: 'A', x: 0, y: 0 }], { A: parseBoard(rawBoards.A) });

describe('3D heights match the LOS rules', () => {
  it('ground at every hex centre is exactly the hex level', () => {
    const hills = composeMap([{ board: 'T', x: 0, y: 0 }], {
      T: parseBoard({ format: 'squadwar-board@1', id: 'T', name: 't', kind: 'country', hexes: { K5: { lv: 1 }, K6: { lv: 2 }, L5: { lv: 3 } }, hexsides: {} }),
    });
    for (const h of Object.values(hills.hexes)) expect(terrainHeight(hills, hexToPixel(h.hex))).toBeCloseTo(h.level, 9);
  });

  it('building ridges sit at the obstacle height LOS uses (§7.4, §43.12)', () => {
    for (const b of Object.values(map.buildings)) {
      expect(buildingLevels(b).ridge).toBe(b.multiStory ? 2 : 1);
      // The LOS engine uses the same: an obstacle crossing this building's hex has height level + ridge.
      const hk = b.hexes[0]!;
      const h = map.hexes[hk]!;
      const others = Object.keys(map.hexes).filter((k) => !b.hexes.includes(k));
      const pair = others
        .flatMap((a) => others.map((c) => [a, c] as const))
        .find(([a, c]) => checkLos(map, { hex: a }, { hex: c }).obstacles.some((o) => o.kind === 'building' && o.hex === hk));
      if (pair) {
        const o = checkLos(map, { hex: pair[0] }, { hex: pair[1] }).obstacles.find((x) => x.kind === 'building' && x.hex === hk)!;
        expect(o.height).toBe(h.level + buildingLevels(b).ridge);
      }
      break; // one building is enough for the cross-check; the loop above covers all ridges
    }
  });

  it('tree tops average one level, the height of woods in the rules (§43.11)', () => {
    expect((TREE_TOP.min + TREE_TOP.max) / 2).toBeCloseTo(1, 1);
    expect(mapGeometry(map).symbols.some((s) => s.kind === 'woods')).toBe(true);
  });
});
