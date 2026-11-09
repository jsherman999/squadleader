import type { Ctx } from '../ctx';
import { allUnits, otherSide, unitsIn } from '../queries';
import type { GameState, SideId } from '../types';
import type { Emit } from './common';

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

export function evaluateVictory(ctx: Ctx, s: GameState): { winner: SideId; text: string } {
  const v = ctx.scenario.victory;
  const held = objectiveStatus(ctx, s).filter((o) => o.owner === v.side);
  const ok = held.length >= v.controlBuildings.atLeast;
  const name = (id: SideId) => s.sides.find((x) => x.id === id)?.name ?? id;
  const winner = ok ? v.side : otherSide(s, v.side);
  return {
    winner,
    text: `${name(v.side)} control ${held.length} of ${ctx.objectives.length} objectives${held.length ? ` (${held.map((o) => o.name).join(', ')})` : ''}; ${v.controlBuildings.atLeast} needed. ${name(winner)} victory.`,
  };
}

/** A side with no units left loses at once. */
export function suddenDeath(ctx: Ctx, s: GameState, emit: Emit): void {
  if (s.phase === 'setup' || s.phase === 'gameOver') return;
  for (const side of s.sides) {
    if (!allUnits(s, side.id).length && !Object.values(s.vehicles).some((v) => v.side === side.id)) {
      const other = s.sides.find((x) => x.id !== side.id)!;
      s.phase = 'gameOver';
      s.winner = other.id;
      s.result = `${side.name} forces eliminated. ${other.name} victory.`;
      emit({ kind: 'gameOver', text: s.result });
      return;
    }
  }
  void ctx;
}
