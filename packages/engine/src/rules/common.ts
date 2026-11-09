import type { HexKey } from '@squadwar/hex';
import type { Ctx } from '../ctx';
import { carried, hexLabel, isLeader, unitLabel } from '../queries';
import type { GameEvent, GameState, Unit } from '../types';

export type Emit = (e: GameEvent) => void;

/** Remove a unit from play. Its weapons stay in the hex, unowned. */
export function eliminate(ctx: Ctx, s: GameState, u: Unit, reason: string, emit: Emit): void {
  for (const w of carried(s, u)) w.owner = null;
  delete s.units[u.id];
  delete s.tracks[u.id];
  s.moving = s.moving.filter((id) => id !== u.id);
  const loss = (s.losses[u.side] ??= { squads: 0, leaders: 0 });
  if (isLeader(ctx, u)) loss.leaders++;
  else loss.squads++;
  emit({ kind: 'eliminated', text: `${unitLabel(ctx, u)} in ${hexLabel(ctx, u.hex)} eliminated: ${reason}`, side: u.side, units: [u.id], hexes: [u.hex] });
}

/** Break a unit: it inverts and abandons its support weapons (§12.3, §13.5). */
export function breakUnit(ctx: Ctx, s: GameState, u: Unit, emit: Emit): void {
  const label = unitLabel(ctx, u);
  u.broken = true;
  // Broken riders jump off a tank or SP gun; in a halftrack they may stay (§31.6, §47.9).
  const ride = u.riding ? s.vehicles[u.riding] : undefined;
  if (ride && ctx.data.vehicles[ride.type]?.kind !== 'halftrack') delete u.riding;
  const dropped = carried(s, u);
  for (const w of dropped) w.owner = null;
  u.weapons = [];
  emit({
    kind: 'morale',
    text: `${label} in ${hexLabel(ctx, u.hex)} breaks${dropped.length ? ' and abandons its weapons (§13.5)' : ''}`,
    side: u.side,
    units: [u.id],
    hexes: [u.hex],
    fx: { result: 'broken' },
  });
}

export function hexOf(s: GameState, unit: string): HexKey | undefined {
  return s.units[unit]?.hex;
}
