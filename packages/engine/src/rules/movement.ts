/** Movement (§5, §6, §19) and weapon handling (§5.7, §17.8). */
import type { HexKey } from '@squadwar/hex';
import type { Ctx } from '../ctx';
import {
  carried,
  enemiesIn,
  hexLabel,
  inMelee,
  isLeader,
  isOpenGround,
  leaderType,
  moveCost,
  portageOf,
  range,
  unitLabel,
  weaponType,
} from '../queries';
import { RuleError, type GameState, type Unit } from '../types';
import type { Emit } from './common';
import { reveal, smokeMf } from './special';

/** MF a unit may spend this Movement Phase (§5.41–5.44, §5.7). */
export function mfAllowance(ctx: Ctx, s: GameState, u: Unit): { mf: number; parts: string[] } {
  const m = ctx.data.tables.movement;
  const leader = isLeader(ctx, u);
  const parts: string[] = [];
  let mf = leader ? m.leaderMF : m.squadMF;
  parts.push(`${leader ? 'leader' : 'squad'} ${mf} MF (§5.4)`);
  if (!leader && u.withLeader && s.units[u.withLeader]) {
    mf += m.leaderBonus;
    parts.push(`+${m.leaderBonus} moving with a leader (§5.44)`);
  }
  const cap = leader ? m.leaderPortage : m.squadPortage;
  const pp = Math.max(u.ppUsed, portageOf(ctx, s, u));
  if (pp > cap) {
    mf -= pp - cap;
    parts.push(`−${pp - cap} carrying ${pp} PP (§5.7)`);
  }
  return { mf, parts };
}

export function mfLeft(ctx: Ctx, s: GameState, u: Unit): number {
  return mfAllowance(ctx, s, u).mf - u.mfSpent;
}

function checkMover(ctx: Ctx, s: GameState, u: Unit | undefined): asserts u is Unit {
  if (!u) throw new RuleError('Unknown unit');
  if (s.phase !== 'movement') throw new RuleError('Units move only in the Movement Phase', '§4.3');
  if (u.side !== s.phasing || s.awaiting !== s.phasing) throw new RuleError('Only the moving player moves units now', '§4.3');
  if (u.broken) throw new RuleError(`${unitLabel(ctx, u)} is broken; broken units only rout`, '§13');
  if (u.berserk) throw new RuleError('Berserk units charge automatically', '§18.42');
  if (u.firedPhase === 'prepFire') throw new RuleError(`${unitLabel(ctx, u)} fired in the Prep Fire Phase and may not move`, '§4.3');
  if (u.moveDone) throw new RuleError(`${unitLabel(ctx, u)} has finished moving`, '§19.2');
  if (inMelee(s, u.hex)) throw new RuleError(`${unitLabel(ctx, u)} is locked in melee`, '§20.8');
}

/** Move a stack of units one hex (§5, §19.4). */
export function moveStep(ctx: Ctx, s: GameState, ids: readonly string[], to: HexKey, emit: Emit): void {
  if (!ids.length) throw new RuleError('Choose units to move');
  const units = ids.map((id) => s.units[id]);
  units.forEach((u) => checkMover(ctx, s, u));
  const movers = units as Unit[];
  const from = movers[0]!.hex;
  if (movers.some((u) => u.hex !== from)) throw new RuleError('Units moving together must start in the same hex', '§19.4');
  if (range(from, to) !== 1) throw new RuleError('Units move one hex at a time');
  if (enemiesIn(s, to, s.phasing).length || Object.values(s.vehicles).some((v) => v.hex === to && v.side !== s.phasing)) throw new RuleError('Infantry may enter an enemy-occupied hex only in the Advance Phase', '§5.6');

  // A new group finishes the previous one (§19.2, §19.4).
  const continuing = s.moving.length > 0 && ids.every((id) => s.moving.includes(id));
  if (!continuing) {
    for (const id of s.moving) if (s.units[id]) s.units[id]!.moveDone = true;
    s.moving = [...ids];
    const leader = movers.find((u) => isLeader(ctx, u) && u.mfSpent === 0);
    for (const u of movers) {
      if (u.mfSpent === 0) u.withLeader = !isLeader(ctx, u) && leader ? leader.id : null;
      u.ppUsed = Math.max(u.ppUsed, portageOf(ctx, s, u));
    }
  } else {
    for (const id of s.moving) if (!ids.includes(id) && s.units[id]) s.units[id]!.moveDone = true;
    s.moving = [...ids];
  }
  // Squads lose the leader bonus once their leader stops moving with them.
  for (const u of movers) if (u.withLeader && !ids.includes(u.withLeader)) u.withLeader = null;

  const base = moveCost(ctx, from, to);
  const smokeExtra = smokeMf(s, to);
  const cost = smokeExtra ? { mf: base.mf + smokeExtra, parts: [...base.parts, '+1 smoke (§24.5)'] } : base;
  if (!Number.isFinite(cost.mf)) throw new RuleError(`Cannot enter ${hexLabel(ctx, to)}: ${cost.parts.join(', ')}`);
  for (const u of movers) {
    const left = mfLeft(ctx, s, u);
    if (cost.mf > left + 1e-9) throw new RuleError(`${unitLabel(ctx, u)} has ${left} MF left; entering ${hexLabel(ctx, to)} costs ${cost.mf} (${cost.parts.join(', ')})`, '§5.5');
  }
  const open = isOpenGround(ctx, to);
  // Moving gives a concealed stack away (§25.4, §25.42).
  reveal(ctx, s, from, emit, 'moved');
  for (const u of movers) {
    u.noConceal = true;
    u.hex = to;
    u.mfSpent += cost.mf;
    u.moved = true;
    for (const w of carried(s, u)) w.hex = to;
    (s.tracks[u.id] ??= []).push({ hex: to, mf: cost.mf, open });
  }
  emit({
    kind: 'move',
    text: `${movers.map((u) => unitLabel(ctx, u)).join(', ')} → ${hexLabel(ctx, to)} (${cost.mf} MF: ${cost.parts.join(', ')})`,
    side: s.phasing,
    units: [...ids],
    from,
    to,
  });
}

export function endMove(s: GameState, ids: readonly string[]): void {
  for (const id of ids) {
    const u = s.units[id];
    if (u && u.side === s.phasing) u.moveDone = true;
  }
  s.moving = s.moving.filter((id) => !ids.includes(id));
}

/**
 * Pick up, hand over or drop a support weapon in the same hex (§5.7, §2.7).
 * Allowed during setup and in the owner's Movement Phase.
 */
export function transferWeapon(ctx: Ctx, s: GameState, weaponId: string, to: string | null, emit: Emit): void {
  const w = s.weapons[weaponId];
  if (!w) throw new RuleError('Unknown weapon');
  if (s.phase !== 'setup' && s.phase !== 'movement') throw new RuleError('Weapons change hands during setup or the Movement Phase', '§5.7');
  const side = s.awaiting;
  const holder = w.owner ? s.units[w.owner] : undefined;
  if (holder && holder.side !== side) throw new RuleError('That weapon is held by the enemy');
  const wt = weaponType(ctx, w);
  if (to === null) {
    if (!holder) throw new RuleError('Nobody carries that weapon');
    holder.weapons = holder.weapons.filter((x) => x !== w.id);
    w.owner = null;
    emit({ kind: 'info', text: `${unitLabel(ctx, holder)} drops the ${wt.name} in ${hexLabel(ctx, w.hex)}`, side });
    return;
  }
  const u = s.units[to];
  if (!u || u.side !== side) throw new RuleError('Choose one of your units');
  if (u.hex !== w.hex) throw new RuleError('The weapon must be in the same hex');
  if (u.broken) throw new RuleError('Broken units cannot carry support weapons', '§13.5');
  if (s.phase === 'movement' && u.side !== s.phasing) throw new RuleError('Only the moving player handles weapons now');
  if (!holder && w.side !== side) {
    if (enemiesIn(s, w.hex, side).length) throw new RuleError('Weapons cannot be captured in a melee hex', '§20.84');
  }
  const lt = leaderType(ctx, u);
  if (lt && wt.leaderPortage === null) throw new RuleError(`A leader cannot carry an ${wt.kind}`, 'chart 5.7');
  if (lt && portageOf(ctx, s, u) + (wt.leaderPortage ?? 0) > 3) throw new RuleError('A leader may carry at most 3 leader portage points', '§5.71');
  if (s.phase === 'movement') {
    const pp = portageOf(ctx, s, u) + (lt ? (wt.leaderPortage ?? 0) : wt.portage);
    const next = Math.max(u.ppUsed + (lt ? (wt.leaderPortage ?? 0) : wt.portage), pp);
    const m = ctx.data.tables.movement;
    const cap = lt ? m.leaderPortage : m.squadPortage;
    const base = (lt ? m.leaderMF : m.squadMF) + (u.withLeader ? m.leaderBonus : 0);
    if (u.mfSpent > base - Math.max(0, next - cap)) throw new RuleError(`${unitLabel(ctx, u)} has already spent too many MF to carry that much`, 'Q&A 5.7');
    u.ppUsed = next;
  }
  if (holder) holder.weapons = holder.weapons.filter((x) => x !== w.id);
  w.owner = u.id;
  u.weapons.push(w.id);
  emit({ kind: 'info', text: `${unitLabel(ctx, u)} ${holder ? `takes the ${wt.name} from ${unitLabel(ctx, holder)}` : `picks up the ${wt.name}`}${w.side !== side ? ' (captured)' : ''}`, side });
}
