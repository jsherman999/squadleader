/**
 * Riders on tanks, SP guns and halftracks (§31, §47), and AT guns (§48):
 * boarding and getting off, and pushing a gun.
 */
import { directionTo, parseHexKey, type HexKey } from '@squadwar/hex';
import type { Ctx } from '../ctx';
import { carried, enemiesIn, hexLabel, isLeader, moveCost, range, squadType, unitLabel } from '../queries';
import { RuleError, type GameState, type Unit, type Vehicle } from '../types';
import { isUpper } from './floors';
import type { Emit } from './common';
import { enemyVehiclesIn, mpLeft, vehicleLabel, vehicleType } from './armor';
import { reveal } from './special';

export function riders(s: GameState, v: Vehicle): Unit[] {
  return Object.values(s.units).filter((u) => u.riding === v.id);
}

/** A crew (or squad, for pushing) in the gun's hex that has not moved or fired. */
export function gunCrew(ctx: Ctx, s: GameState, gun: Vehicle): Unit | undefined {
  // The gun is on the ground floor (§57.6): a crew that has gone upstairs is not serving it.
  return Object.values(s.units).find((u) => u.hex === gun.hex && u.side === gun.side && !u.broken && !u.riding && ctx.data.units[u.type]?.kind === 'crew' && !isUpper(ctx, s, u));
}

/** Infantry in the vehicle's hex climb on; the vehicle may not move this turn (§31.1–31.3). */
export function board(ctx: Ctx, s: GameState, ids: readonly string[], vehicleId: string, emit: Emit): void {
  const v = s.vehicles[vehicleId];
  if (!v || v.side !== s.phasing) throw new RuleError('Not your vehicle');
  const t = vehicleType(ctx, v);
  if (t.kind === 'gun' || t.kind === 'mortar') throw new RuleError('Guns carry no riders');
  if (s.phase !== 'movement' || s.awaiting !== s.phasing) throw new RuleError('Infantry board in the Movement Phase', '§31.3');
  if (v.moved) throw new RuleError('The vehicle has already moved this turn', '§31.3');
  const us = ids.map((id) => s.units[id]);
  if (!us.length || us.some((u) => !u || u.side !== v.side || u.hex !== v.hex)) throw new RuleError('Riders must be your units in the vehicle’s hex');
  for (const u of us as Unit[]) {
    if (u.broken) throw new RuleError('Broken units may not board', '§31.6');
    if (u.riding) throw new RuleError(`${unitLabel(ctx, u)} is already riding`);
    if (u.mfSpent > 0 || u.moveDone || u.firedPhase === 'prepFire') throw new RuleError(`${unitLabel(ctx, u)} has moved or fired`);
  }
  const all = [...riders(s, v), ...(us as Unit[])];
  const cap = t.riders ?? ctx.data.armor.capacity;
  const nonLeaders = all.filter((u) => !isLeader(ctx, u));
  // A jeep takes two officers, or one crew squad (§52.1).
  const jeepCrew = cap.squads === 0 && all.length === 1 && ctx.data.units[all[0]!.type]?.kind === 'crew';
  if (!jeepCrew && (all.length > cap.units || nonLeaders.length > cap.squads)) throw new RuleError(`At most ${cap.units} units, ${cap.squads ? `only ${cap.squads} of them a squad` : 'leaders only (or one crew)'}`, '§31.1, §51.1, §52.1');
  for (const u of us as Unit[]) {
    u.riding = v.id;
    u.moveDone = true;
    u.concealed = false;
  }
  v.moveDone = true;
  emit({ kind: 'info', text: `${(us as Unit[]).map((u) => unitLabel(ctx, u)).join(', ')} climb onto ${vehicleLabel(ctx, v)} in ${hexLabel(ctx, v.hex)}; it may not move this turn (§31.3)`, side: v.side, units: [...ids], hexes: [v.hex] });
}

/** Riders get off in the vehicle's hex; the vehicle pays 2 MP unless they are broken (§31.3–31.4). */
export function unload(ctx: Ctx, s: GameState, ids: readonly string[], vehicleId: string, emit: Emit): void {
  const v = s.vehicles[vehicleId];
  if (!v || v.side !== s.phasing) throw new RuleError('Not your vehicle');
  if (s.phase !== 'movement' || s.awaiting !== s.phasing) throw new RuleError('Riders get off in the Movement Phase', '§31.4');
  const us = ids.map((id) => s.units[id]);
  if (!us.length || us.some((u) => !u || u.riding !== v.id)) throw new RuleError('Those units are not riding it');
  const cost = (us as Unit[]).every((u) => u.broken) ? 0 : ctx.data.armor.movement.unload ?? 2;
  if (cost && !v.immobilized && mpLeft(ctx, v) < cost && v.moved) throw new RuleError(`Unloading costs the vehicle ${cost} MP`, '§31.3');
  if (enemiesIn(s, v.hex, v.side).length) throw new RuleError('Not into an enemy-held hex', '§31.4');
  v.mpSpent += cost;
  for (const u of us as Unit[]) {
    delete u.riding;
    u.debarked = true;
    u.moveDone = false;
    u.mfSpent = 0;
  }
  emit({ kind: 'info', text: `${(us as Unit[]).map((u) => unitLabel(ctx, u)).join(', ')} get off ${vehicleLabel(ctx, v)} in ${hexLabel(ctx, v.hex)}; they may move one hex more (§31.4)`, side: v.side, units: [...ids], hexes: [v.hex] });
}

/** Riders move with their vehicle. */
export function carryRiders(s: GameState, v: Vehicle): void {
  for (const u of riders(s, v)) {
    u.hex = v.hex;
    for (const w of carried(s, u)) w.hex = v.hex;
  }
}

/** Tank and SP-gun riders jump off when it fires or takes a non-infantry hit (§31.7). */
export function dismountAll(ctx: Ctx, s: GameState, v: Vehicle, why: string, emit: Emit): void {
  const t = vehicleType(ctx, v);
  if (t.kind === 'halftrack') return;
  const rs = riders(s, v);
  if (!rs.length) return;
  for (const u of rs) delete u.riding;
  emit({ kind: 'info', text: `The riders jump off ${vehicleLabel(ctx, v)}: ${why} (§31.7)`, side: v.side, units: rs.map((u) => u.id), hexes: [v.hex] });
}

/** A squad or crew that has not moved pushes an AT gun one hex; not uphill (§48.4). */
export function pushGun(ctx: Ctx, s: GameState, unitId: string, gunId: string, to: HexKey, emit: Emit): void {
  const g = s.vehicles[gunId];
  const u = s.units[unitId];
  if (!g || vehicleType(ctx, g).kind !== 'gun') throw new RuleError('That is not an AT gun');
  if (!u || u.side !== g.side || u.hex !== g.hex) throw new RuleError('The pushing unit must be with the gun');
  if (s.phase !== 'movement' || s.awaiting !== s.phasing || g.side !== s.phasing) throw new RuleError('Guns are pushed in the Movement Phase', '§48.4');
  if (!squadType(ctx, u) || u.broken) throw new RuleError('A squad or crew pushes the gun', '§48.4');
  if (u.mfSpent > 0 || u.moveDone || u.firedPhase || g.firedPhase || g.moved) throw new RuleError('Neither may have moved or fired this turn', '§48.4');
  if (range(g.hex, to) !== 1) throw new RuleError('One hex', '§48.4');
  const a = ctx.map.hexes[g.hex]!;
  const b = ctx.map.hexes[to];
  if (!b || b.level > a.level) throw new RuleError('Not uphill', '§48.4');
  if (!Number.isFinite(moveCost(ctx, g.hex, to).mf) || directionTo(parseHexKey(g.hex), parseHexKey(to)) === undefined) throw new RuleError('Impassable');
  if (enemiesIn(s, to, g.side).length || enemyVehiclesIn(s, to, g.side).length) throw new RuleError('Not into an enemy-held hex');
  const from = g.hex;
  // Moving gives a hidden or concealed gun position away (§25.4, §42.2).
  reveal(ctx, s, from, emit, 'moved');
  g.hex = to;
  g.moved = true;
  g.moveDone = true;
  u.hex = to;
  for (const w of carried(s, u)) w.hex = to;
  u.moved = true;
  u.mfSpent = 99;
  u.moveDone = true;
  emit({ kind: 'move', text: `${unitLabel(ctx, u)} pushes the ${vehicleType(ctx, g).name} ${hexLabel(ctx, from)} → ${hexLabel(ctx, to)} (§48.4)`, side: g.side, units: [u.id], from, to, fx: { vehicles: [g.id] } });
}
