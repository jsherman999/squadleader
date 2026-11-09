import { DIRECTIONS, DIRECTION_NAMES, hexsideKey, type HexKey } from '@squadwar/hex';
import type { GameMap, HexTerrain } from '@squadwar/terrain';

export const TERRAIN_NAMES: Record<HexTerrain, string> = {
  open: 'Open ground',
  woods: 'Woods',
  woodBuilding: 'Wooden building',
  stoneBuilding: 'Stone building',
  wheat: 'Wheatfield',
  water: 'Water',
};

export interface HexDescription {
  id: string;
  terrain: string;
  details: string[];
}

export function describeHex(map: GameMap, key: HexKey): HexDescription | undefined {
  const h = map.hexes[key];
  if (!h) return undefined;
  const details: string[] = [];
  if (h.level > 0) details.push(`Hill level ${h.level}`);
  if (h.building) {
    const b = map.buildings[h.building]!;
    details.push(`${b.hexes.length}-hex ${b.material} building${b.multiStory ? ' · multi-story' : ''}`);
  }
  if (h.shellhole) details.push('Shellholes');
  if (h.sewer) details.push('Sewer entrance');
  if (h.half) details.push('Board-edge half hex');
  const sides: string[] = [];
  for (const d of DIRECTIONS) {
    const s = map.hexsides[hexsideKey(h.hex, d)];
    if (!s) continue;
    const f = [s.wall && 'wall', s.hedge && 'hedge', s.cliff && 'cliff', s.road && `${s.road} road`].filter(Boolean);
    if (f.length) sides.push(`${DIRECTION_NAMES[d]}: ${f.join(', ')}`);
  }
  if (sides.length) details.push(`Hexsides — ${sides.join(' · ')}`);
  return { id: h.id, terrain: TERRAIN_NAMES[h.terrain], details };
}
