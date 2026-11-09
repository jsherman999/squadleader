/** Rally Phase: weapon repair (§18.2) and rallying broken units (§14, §18.3). */
import type { Ctx } from '../ctx';
import { d6, roll2d6 } from '../rng';
import { hexLabel, inMelee, isLeader, leaderDrmFor, sideUnitsIn, unitLabel, weaponType } from '../queries';
import { RuleError, type GameState } from '../types';
import { eliminate, type Emit } from './common';
import { moraleCheck, moraleOf } from './morale';

export function canRally(ctx: Ctx, s: GameState, unitId: string): string | undefined {
  const u = s.units[unitId];
  if (!u) return 'Unknown unit';
  if (s.phase !== 'rally') return 'Rally attempts happen in the Rally Phase (§4.1)';
  if (u.side !== s.awaiting) return 'Not your unit';
  if (!u.broken) return `${unitLabel(ctx, u)} is not broken`;
  if (u.rallyTried) return `${unitLabel(ctx, u)} already tried to rally this phase`;
  if (!isLeader(ctx, u) && !leaderDrmFor(ctx, s, u.hex, u.side).leader) return 'A broken squad needs an unbroken friendly leader in its hex to rally (§14.1)';
  return undefined;
}

export function rallyAttempt(ctx: Ctx, s: GameState, unitId: string, emit: Emit): void {
  const why = canRally(ctx, s, unitId);
  if (why) throw new RuleError(why);
  const u = s.units[unitId]!;
  u.rallyTried = true;
  const { drm, leader } = leaderDrmFor(ctx, s, u.hex, u.side, u.id);
  const base = moraleOf(ctx, u);
  const need = u.dm ? base - ctx.data.tables.desperationMorale : base;
  const [a, b] = roll2d6(s);
  const raw = a + b;
  const total = raw + drm;
  const trace = [
    `Needs ${need} or less${u.dm ? ` (desperation morale: ${base} − ${ctx.data.tables.desperationMorale}, fired on since the last Rally Phase, §14.6)` : ''}`,
    `Dice ${a}+${b} = ${raw}${drm ? `, ${drm > 0 ? '+' : ''}${drm} ${leader?.name ?? 'leader'} (§14.2)` : ''} → ${total}`,
  ];
  if (raw === 12) {
    emit({ kind: 'rally', text: `${unitLabel(ctx, u)} rolls 12 while rallying: extra casualties (§18.3)`, trace, side: u.side, units: [u.id], dice: [a, b], fx: { result: 'casualty' } });
    const wasLeader = isLeader(ctx, u);
    const hex = u.hex;
    eliminate(ctx, s, u, 'rolled 12 attempting to rally (§18.3)', emit);
    if (wasLeader) {
      for (const o of sideUnitsIn(s, hex, u.side)) {
        moraleCheck(ctx, s, o, 0, { enemyFire: false, label: 'Morale check after the leader’s loss (§18.3)' }, emit);
      }
    }
    return;
  }
  if (total <= need) {
    u.broken = false;
    emit({ kind: 'rally', text: `${unitLabel(ctx, u)} in ${hexLabel(ctx, u.hex)} rallies (${total} ≤ ${need})`, trace, side: u.side, units: [u.id], dice: [a, b], fx: { result: 'rallied' } });
  } else {
    emit({ kind: 'rally', text: `${unitLabel(ctx, u)} fails to rally (${total} > ${need})`, trace, side: u.side, units: [u.id], dice: [a, b], fx: { result: 'failed' } });
  }
}

export function canRepair(ctx: Ctx, s: GameState, weaponId: string): string | undefined {
  const w = s.weapons[weaponId];
  if (!w) return 'Unknown weapon';
  if (s.phase !== 'rally') return 'Repairs happen in the Rally Phase (§18.2)';
  if (!w.malfunctioned) return 'That weapon works';
  if (w.repairTried) return 'Already tried to repair it this phase';
  const side = s.awaiting;
  if (w.side !== side) return 'Captured weapons cannot be repaired (§18.2)';
  if (inMelee(s, w.hex)) return 'Not while in melee (§18.2)';
  if (!sideUnitsIn(s, w.hex, side).some((u) => !u.broken)) return 'Needs an unbroken friendly squad or leader in the hex (§18.2)';
  return undefined;
}

export function repairAttempt(ctx: Ctx, s: GameState, weaponId: string, emit: Emit): void {
  const why = canRepair(ctx, s, weaponId);
  if (why) throw new RuleError(why);
  const w = s.weapons[weaponId]!;
  w.repairTried = true;
  const r = d6(s);
  const name = weaponType(ctx, w).name;
  if (r === 1) {
    w.malfunctioned = false;
    emit({ kind: 'repair', text: `${name} repaired (rolled 1, §18.2)`, side: w.side, dice: [r], hexes: [w.hex], fx: { result: 'repaired' } });
  } else if (r === 6) {
    if (w.owner && s.units[w.owner]) s.units[w.owner]!.weapons = s.units[w.owner]!.weapons.filter((x) => x !== w.id);
    delete s.weapons[w.id];
    emit({ kind: 'repair', text: `${name} is beyond repair and removed (rolled 6, §18.2)`, side: w.side, dice: [r], hexes: [w.hex], fx: { result: 'removed' } });
  } else {
    emit({ kind: 'repair', text: `${name} still malfunctioning (rolled ${r})`, side: w.side, dice: [r], hexes: [w.hex], fx: { result: 'jammed' } });
  }
}
