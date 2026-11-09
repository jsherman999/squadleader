/**
 * Heights for the 3D view, in rules levels. The 3D landscape must agree
 * with the LOS rules (ADR 0004): woods and small buildings top out one
 * level above their ground, multi-story buildings two, hills at their
 * level. World height = levels × LEVEL × exaggeration.
 */
import { hexKey, pixelToHex, type Vec2 } from '@squadwar/hex';
import type { Building, GameMap } from '@squadwar/terrain';

/** World units per level at exaggeration 1 (a hex is 2 units across ≈ 40 m). */
export const LEVEL = 0.28;
/** Eye height above the floor, in levels. */
export const EYE = 0.3;
/** Tree canopy tops, in levels above ground (rules: woods = 1 level). */
export const TREE_TOP = { min: 0.85, max: 1.12 } as const;

export function levelAt(map: GameMap, p: Vec2): number {
  return map.hexes[hexKey(pixelToHex(p))]?.level ?? 0;
}

const RING = Array.from({ length: 8 }, (_, i) => ({ x: Math.cos((i * Math.PI) / 4), y: Math.sin((i * Math.PI) / 4) }));

/**
 * Ground height (levels) with crests softened into slopes. Hex centres sit
 * exactly at their level: the smoothing radius is smaller than the apothem.
 */
export function terrainHeight(map: GameMap, p: Vec2): number {
  let sum = levelAt(map, p) * 4;
  let w = 4;
  for (const [r, weight] of [
    [0.18, 1],
    [0.36, 0.6],
  ] as const) {
    for (const d of RING) {
      sum += levelAt(map, { x: p.x + d.x * r, y: p.y + d.y * r }) * weight;
      w += weight;
    }
  }
  return sum / w;
}

/** Wall top and roof ridge, in levels above the building's ground. */
export function buildingLevels(b: Building): { wall: number; ridge: number } {
  return b.multiStory ? { wall: 1.55, ridge: 2 } : { wall: 0.68, ridge: 1 };
}
