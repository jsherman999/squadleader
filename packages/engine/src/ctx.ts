import type { HexKey } from '@squadwar/hex';
import { colIndex, composeMap, type BoardDef, type GameMap } from '@squadwar/terrain';
import { bestLos, checkLos, type LosResult } from '@squadwar/los';
import type { RulesData, Scenario } from './data';
import type { SideId } from './types';

/** Static context for a game: map, rules data, scenario and caches. Not part of the saved state. */
export interface Ctx {
  readonly map: GameMap;
  readonly data: RulesData;
  readonly scenario: Scenario;
  /** Setup zones per side. */
  readonly zones: Readonly<Record<SideId, ReadonlySet<HexKey>>>;
  /** Hexes of each objective building, by objective name. */
  readonly objectives: readonly { readonly name: string; readonly building: string; readonly hexes: readonly HexKey[] }[];
  /** Line of sight between two hexes, from whichever floors give one (§7.9). */
  los(from: HexKey, to: HexKey): LosResult;
  /** Line of sight between named floors of two hexes (§57); "upper" means nothing in a hex with no upper floor. */
  losLevel(from: HexKey, fromUpper: boolean, to: HexKey, toUpper: boolean): LosResult;
}

/** Wheatfields stand from June to October (§44.24). */
export function wheatInSeason(scenario: Scenario): boolean {
  if (scenario.wheat !== undefined) return scenario.wheat;
  const months = ['jun', 'jul', 'aug', 'sep', 'oct'];
  const d = scenario.date.toLowerCase();
  return months.some((m) => d.includes(m));
}

export function makeCtx(scenario: Scenario, data: RulesData, boards: Readonly<Record<string, BoardDef>>): Ctx {
  // Out of season, wheatfields are open ground (§44.24).
  const season = wheatInSeason(scenario);
  const used = season
    ? boards
    : Object.fromEntries(
        Object.entries(boards).map(([k, b]) => [k, { ...b, hexes: Object.fromEntries(Object.entries(b.hexes).map(([id, h]) => [id, h.t === 'wheat' ? { ...h, t: undefined } : h])) }]),
      );
  const map = composeMap(scenario.layout, used as Readonly<Record<string, BoardDef>>);
  const zones: Record<SideId, Set<HexKey>> = {};
  for (const side of scenario.sides) {
    const set = new Set<HexKey>();
    for (const z of side.setup) {
      const c0 = colIndex(z.cols[0]);
      const c1 = colIndex(z.cols[1]);
      for (const h of Object.values(map.hexes)) {
        if (h.board !== z.board) continue;
        const m = /^([A-Z]+)(\d+)$/.exec(h.localId)!;
        const c = colIndex(m[1]!);
        const row = Number(m[2]);
        if (c < c0 || c > c1) continue;
        if (z.rows && (row < z.rows[0] || row > z.rows[1])) continue;
        set.add(h.key);
      }
    }
    zones[side.id] = set;
  }
  const objectives = scenario.victory.controlBuildings.buildings.map((b) => {
    if (b.hexes) {
      const hexes = b.hexes.map((id) => {
        const k = map.byId[id];
        if (!k) throw new Error(`objective ${b.name}: no hex ${id}`);
        return k;
      });
      return { name: b.name, building: `area:${b.name}`, hexes };
    }
    const key = map.byId[b.hex];
    const building = key ? map.hexes[key]?.building : undefined;
    if (!building) throw new Error(`objective ${b.name}: ${b.hex} is not a building hex`);
    return { name: b.name, building, hexes: map.buildings[building]!.hexes };
  });
  const cache = new Map<string, LosResult>();
  const levelCache = new Map<string, LosResult>();
  return {
    map,
    data,
    scenario,
    zones,
    objectives,
    los(from, to) {
      const k = from < to ? `${from}|${to}` : `${to}|${from}`;
      let r = cache.get(k);
      if (!r) {
        r = bestLos(map, from, to);
        cache.set(k, r);
      }
      // Results are symmetric for clear/blocked; callers needing direction
      // details (hexside TEM) use losFrom.
      return r;
    },
    losLevel(from, fromUpper, to, toUpper) {
      const k = `${from}${fromUpper ? '^' : ''}>${to}${toUpper ? '^' : ''}`;
      let r = levelCache.get(k);
      if (!r) {
        r = checkLos(map, { hex: from, upper: fromUpper }, { hex: to, upper: toUpper });
        levelCache.set(k, r);
      }
      return r;
    },
  };
}

/** Directional LOS (hexside TEM depends on which end is the target). */
export function losFrom(ctx: Ctx, from: HexKey, to: HexKey): LosResult {
  return bestLos(ctx.map, from, to);
}
