import { describe, expect, it } from 'vitest';
import { createGame } from '@squadwar/engine';
import { rawScenarios } from '@squadwar/content';
import { scenarioCtx } from './selfplay';

const COVER = ['woods', 'woodBuilding', 'stoneBuilding', 'brush', 'orchard'];

/** Every scenario's order of battle must start in legal places. */
describe('scenario set-ups', () => {
  for (let i = 0; i < rawScenarios.length; i++) {
    const ctx = scenarioCtx(i);
    it(`${ctx.scenario.id} ${ctx.scenario.title}`, () => {
      const { state: s } = createGame(ctx, 1);
      const probs: string[] = [];
      const terr = (k: string) => ctx.map.hexes[k]!.terrain;
      const id = (k: string) => ctx.map.hexes[k]!.id;
      for (const u of Object.values(s.units)) {
        if (!ctx.zones[u.side]!.has(u.hex)) probs.push(`${u.type} at ${id(u.hex)} outside its setup zone`);
        if (u.hidden && !COVER.includes(terr(u.hex))) probs.push(`hidden ${u.type} in ${terr(u.hex)} at ${id(u.hex)}`);
      }
      for (const v of Object.values(s.vehicles)) {
        const t = terr(v.hex);
        const kind = ctx.data.vehicles[v.type]!.kind;
        if (!ctx.zones[v.side]!.has(v.hex)) probs.push(`${v.type} at ${id(v.hex)} outside its setup zone`);
        if (t === 'stoneBuilding' || t === 'water' || (t === 'woodBuilding' && kind !== 'gun' && kind !== 'mortar')) probs.push(`${v.type} in ${t} at ${id(v.hex)}`);
        if (v.hidden && !COVER.includes(t)) probs.push(`hidden ${v.type} in ${t} at ${id(v.hex)}`);
      }
      for (const b of s.forts?.bunkers ?? []) if (terr(b.hex) !== 'open') probs.push(`bunker in ${terr(b.hex)} at ${id(b.hex)}`);
      for (const h of [...(s.forts?.trenches ?? []), ...(s.forts?.wire ?? []), ...(s.forts?.mines ?? []).map((m) => m.hex)]) if (/Building|water/.test(terr(h))) probs.push(`fortification in ${terr(h)} at ${id(h)}`);
      for (const h of s.rubble ?? []) if (!ctx.map.hexes[h]!.building) probs.push(`rubble outside a building at ${id(h)}`);
      for (const b of ctx.scenario.victory.controlBuildings.buildings) {
        if (b.hexes) {
          // An area objective (a hill crest): real hexes, its marker hex among them.
          for (const h of b.hexes) if (!ctx.map.byId[h]) probs.push(`objective ${b.name}: no hex ${h}`);
          if (!b.hexes.includes(b.hex)) probs.push(`objective ${b.name}: ${b.hex} is not one of its hexes`);
        } else if (!ctx.map.hexes[ctx.map.byId[b.hex]!]?.building) probs.push(`objective ${b.hex} is not a building`);
      }
      const v = ctx.scenario.victory;
      if (!v.controlBuildings.buildings.length && !v.exit) probs.push('no objectives and no exit: the victory side could never win');
      if (v.controlBuildings.atLeast > v.controlBuildings.buildings.length) probs.push('more objectives needed than there are');
      // Riders name a vehicle of their own side.
      for (const sd of ctx.scenario.sides) for (const e of sd.units) if (e.rides && !sd.units.some((x) => x.names?.includes(e.rides!) && ctx.data.vehicles[x.type])) probs.push(`${e.type} rides unknown ${e.rides}`);
      for (const r of s.reserves ?? []) if (!r.hexes.length) probs.push(`reserves of ${r.side} have no entry hexes`);
      expect(probs).toEqual([]);
    });
  }
});
