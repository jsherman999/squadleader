import type { GameState } from '@squadwar/engine';

/**
 * What a group of sliding units draws while it moves: those units and the
 * weapons they carry, nothing else. Weapons lying on the map, vehicles and
 * wrecks stay with the board underneath.
 */
export function slidingGroupState(s: GameState, ids: readonly string[]): GameState {
  const mine = new Set(ids);
  return {
    ...s,
    units: Object.fromEntries(Object.entries(s.units).filter(([id]) => mine.has(id))),
    weapons: Object.fromEntries(Object.entries(s.weapons).filter(([, w]) => w.owner !== null && mine.has(w.owner))),
    vehicles: {},
    wrecks: [],
  };
}
