import type { HexKey } from '@squadwar/hex';
import type { Ctx } from '../ctx';
import { allUnits, carried, hexLabel, isLeader, otherSide, unitLabel, unitsIn } from '../queries';
import type { GameState, SideId } from '../types';
import type { Emit } from './common';
import { edgeHexes } from './western';

/** A building is controlled by the side with an unbroken unit in it and no enemy in any of its hexes. */
export function controller(s: GameState, hexes: readonly string[]): SideId | undefined {
  // Riders on vehicles do not hold buildings.
  const present = hexes.flatMap((h) => unitsIn(s, h)).filter((u) => !u.riding);
  const sides = new Set(present.map((u) => u.side));
  if (sides.size !== 1) return undefined;
  const side = [...sides][0]!;
  return present.some((u) => !u.broken) ? side : undefined;
}

export function objectiveStatus(ctx: Ctx, s: GameState): { name: string; owner?: SideId }[] {
  return ctx.objectives.map((o) => {
    const owner = controller(s, o.hexes);
    return { name: o.name, ...(owner ? { owner } : {}) };
  });
}

const exitCache = new WeakMap<Ctx, ReadonlySet<HexKey>>();
/** The board-edge hexes the exit side leaves the map from (empty when the scenario has no exit victory). */
export function exitHexes(ctx: Ctx): ReadonlySet<HexKey> {
  const cached = exitCache.get(ctx);
  if (cached) return cached;
  const x = ctx.scenario.victory.exit;
  const set = new Set<HexKey>();
  if (x) {
    // The full hexes along the edge, and the half hexes beyond them.
    for (const h of edgeHexes(ctx, x.board, x.edge)) set.add(h);
    const ci = (c: string) => (c.length === 1 ? c.charCodeAt(0) - 65 : 26 + c.charCodeAt(0) - 65);
    for (const h of Object.values(ctx.map.hexes)) {
      if (h.board !== x.board || !h.half) continue;
      const m = /^([A-Z]+)(\d+)$/.exec(h.localId)!;
      const c = ci(m[1]!);
      const row = Number(m[2]);
      if ((x.edge === 'W' && c === 0) || (x.edge === 'E' && c === 32) || (x.edge === 'N' && row === 0) || (x.edge === 'S' && row === 10)) set.add(h.key);
    }
  }
  exitCache.set(ctx, set);
  return set;
}

/** Squads (and leaders) of a side that have left the map by the exit edge. */
export function exitedOf(s: GameState, side: SideId): { squads: number; leaders: number } {
  return s.exited?.[side] ?? { squads: 0, leaders: 0 };
}

/** What a side has lost towards its break point: squads, crews and vehicles. */
export function breakLosses(s: GameState, side: SideId): number {
  const l = s.losses[side];
  return (l?.squads ?? 0) + (l?.vehicles ?? 0);
}

function name(s: GameState, id: SideId): string {
  return s.sides.find((x) => x.id === id)?.name ?? id;
}

export function evaluateVictory(ctx: Ctx, s: GameState): { winner: SideId; text: string } {
  const v = ctx.scenario.victory;
  const parts: string[] = [];
  let ok = true;
  if (ctx.objectives.length) {
    const held = objectiveStatus(ctx, s).filter((o) => o.owner === v.side);
    if (held.length < v.controlBuildings.atLeast) ok = false;
    parts.push(
      `${name(s, v.side)} control ${held.length} of ${ctx.objectives.length} objectives${held.length ? ` (${held.map((o) => o.name).join(', ')})` : ''}; ${v.controlBuildings.atLeast} needed.`,
    );
  }
  if (v.exit) {
    const out = exitedOf(s, v.exit.side).squads;
    if (out < v.exit.squads) ok = false;
    parts.push(
      `${name(s, v.exit.side)} got ${out} squad${out === 1 ? '' : 's'} off the map; ${v.exit.squads} needed.`,
    );
  }
  const winner = ok ? v.side : otherSide(s, v.side);
  return { winner, text: `${parts.join(' ')} ${name(s, winner)} victory.`.trim() };
}

/**
 * End of the exit side's Movement Phase: its unbroken units on the exit edge leave the map,
 * with what they carry and the vehicles they ride. Returns true if that wins the game.
 */
export function exitUnits(ctx: Ctx, s: GameState, emit: Emit): boolean {
  const x = ctx.scenario.victory.exit;
  if (!x || s.phasing !== x.side) return false;
  const edge = exitHexes(ctx);
  const vehicles = Object.values(s.vehicles).filter(
    (v) => v.side === x.side && edge.has(v.hex) && !v.immobilized,
  );
  const leaving = allUnits(s, x.side).filter(
    (u) => !u.broken && (u.riding ? vehicles.some((v) => v.id === u.riding) : edge.has(u.hex)),
  );
  if (!leaving.length && !vehicles.length) return false;
  const out = ((s.exited ??= {})[x.side] ??= { squads: 0, leaders: 0 });
  for (const u of leaving) {
    for (const w of carried(s, u)) delete s.weapons[w.id];
    delete s.units[u.id];
    delete s.tracks[u.id];
    if (isLeader(ctx, u)) out.leaders++;
    else if (ctx.data.units[u.type]?.kind === 'squad') out.squads++;
  }
  for (const v of vehicles) delete s.vehicles[v.id];
  const what = [
    ...leaving.map((u) => unitLabel(ctx, u)),
    ...vehicles.map((v) => v.name ?? ctx.data.vehicles[v.type]?.name ?? v.type),
  ];
  emit({
    kind: 'info',
    text: `${what.join(', ')} leave${what.length === 1 ? 's' : ''} the map at ${hexLabel(ctx, leaving[0]?.hex ?? vehicles[0]!.hex)}: ${out.squads} of ${x.squads} squads out.`,
    side: x.side,
    units: leaving.map((u) => u.id),
  });
  s.moving = s.moving.filter((id) => s.units[id]);
  if (out.squads >= x.squads) {
    s.phase = 'gameOver';
    s.winner = x.side;
    s.result = `${name(s, x.side)} got ${out.squads} squads off the map; ${x.squads} needed. ${name(s, x.side)} victory.`;
    emit({ kind: 'gameOver', text: s.result });
    return true;
  }
  return false;
}

/** A side with no units left, or past its break point, loses at once. */
export function suddenDeath(ctx: Ctx, s: GameState, emit: Emit): void {
  if (s.phase === 'setup' || s.phase === 'gameOver') return;
  const end = (winner: SideId, text: string) => {
    s.phase = 'gameOver';
    s.winner = winner;
    s.result = text;
    emit({ kind: 'gameOver', text });
  };
  const bp = ctx.scenario.victory.breakPoint;
  for (const side of s.sides) {
    const limit = bp?.[side.id];
    if (limit !== undefined && breakLosses(s, side.id) >= limit) {
      const other = s.sides.find((x) => x.id !== side.id)!;
      end(
        other.id,
        `${side.name} have lost ${breakLosses(s, side.id)} squads, crews and vehicles, their break point of ${limit}, and give up the fight. ${other.name} victory.`,
      );
      return;
    }
  }
  for (const side of s.sides) {
    if (
      !allUnits(s, side.id).length &&
      !Object.values(s.vehicles).some((v) => v.side === side.id) &&
      !(s.reserves ?? []).some((r) => r.side === side.id)
    ) {
      // A side that took the exit with all it had is judged on what got out.
      if (exitedOf(s, side.id).squads + exitedOf(s, side.id).leaders > 0) {
        const v = evaluateVictory(ctx, s);
        end(v.winner, v.text);
        return;
      }
      const other = s.sides.find((x) => x.id !== side.id)!;
      end(other.id, `${side.name} forces eliminated. ${other.name} victory.`);
      return;
    }
  }
}
