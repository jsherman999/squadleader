/** Close Combat (§20). Attacks are designated by both sides, then resolved simultaneously. */
import type { HexKey } from '@squadwar/hex';
import type { Ctx } from '../ctx';
import { roll2d6 } from '../rng';
import { carried, hexLabel, isLeader, leaderType, sideUnitsIn, squadType, unitLabel, unitsIn, weaponType } from '../queries';
import { RuleError, type CloseCombatAttack, type GameState, type SideId, type Unit } from '../types';
import { eliminate, type Emit } from './common';

/** Hexes where both sides have units. */
export function ccHexes(s: GameState): HexKey[] {
  const sides = new Map<HexKey, Set<SideId>>();
  for (const u of Object.values(s.units)) (sides.get(u.hex) ?? sides.set(u.hex, new Set()).get(u.hex)!).add(u.side);
  return [...sides.entries()].filter(([, v]) => v.size > 1).map(([k]) => k);
}

function ccStrength(ctx: Ctx, s: GameState, u: Unit, attacking: boolean, alone: boolean): number {
  const st = squadType(ctx, u);
  if (!st) return alone ? 1 : 0; // a lone leader fights with 1 (§20.72)
  let fp = st.fp;
  if (attacking) {
    for (const w of carried(s, u)) {
      const wt = weaponType(ctx, w);
      if (wt.kind === 'LMG' && !w.malfunctioned) fp += wt.fp; // §20.5
    }
  }
  return fp;
}

function onlyLeaders(ctx: Ctx, units: Unit[]): boolean {
  return units.length > 0 && units.every((u) => isLeader(ctx, u));
}

export function validatePlan(ctx: Ctx, s: GameState, side: SideId, hex: HexKey, attacks: readonly CloseCombatAttack[]): void {
  const mine = sideUnitsIn(s, hex, side).filter((u) => !u.broken);
  const theirs = unitsIn(s, hex).filter((u) => u.side !== side && !u.broken);
  if (!theirs.length || !mine.length) throw new RuleError(`No close combat in ${hexLabel(ctx, hex)}`);
  const used = new Set<string>();
  const leadersUsed = new Set<string>();
  const myLeadersOnly = onlyLeaders(ctx, mine);
  const theirLeadersOnly = onlyLeaders(ctx, theirs);
  for (const a of attacks) {
    if (!a.attackers.length || !a.defenders.length) throw new RuleError('Each attack needs attackers and defenders');
    for (const id of a.attackers) {
      const u = s.units[id];
      if (!u || u.side !== side || u.hex !== hex || u.broken) throw new RuleError('Attackers must be your unbroken units in the hex');
      if (used.has(id)) throw new RuleError(`${unitLabel(ctx, u)} attacks only once`, '§20.4');
      if (isLeader(ctx, u) && !myLeadersOnly) throw new RuleError('Leaders attack only when no friendly squads are present; they add their DRM instead', '§20.6, §20.72');
      used.add(id);
    }
    for (const id of a.defenders) {
      const u = s.units[id];
      if (!u || u.side === side || u.hex !== hex || u.broken) throw new RuleError('Defenders must be enemy units in the hex');
      if (isLeader(ctx, u) && !theirLeadersOnly) throw new RuleError('A leader can be attacked only when alone', '§20.7');
    }
    if (a.leader) {
      const L = s.units[a.leader];
      if (!L || L.side !== side || L.hex !== hex || L.broken || !isLeader(ctx, L)) throw new RuleError('Leader must be your unbroken leader in the hex');
      if (leadersUsed.has(L.id)) throw new RuleError('Each leader modifies one close combat roll', '§20.6');
      leadersUsed.add(L.id);
    }
  }
}

/** Default designation: everyone attacks everyone, with the best leader (Assisted mode). */
export function autoPlan(ctx: Ctx, s: GameState, side: SideId, hex: HexKey): CloseCombatAttack[] {
  const mine = sideUnitsIn(s, hex, side).filter((u) => !u.broken);
  const theirs = unitsIn(s, hex).filter((u) => u.side !== side && !u.broken);
  if (!mine.length || !theirs.length) return [];
  const leadersOnly = onlyLeaders(ctx, mine);
  const attackers = mine.filter((u) => leadersOnly || !isLeader(ctx, u)).map((u) => u.id);
  const theirLeadersOnly = onlyLeaders(ctx, theirs);
  const defenders = theirs.filter((u) => theirLeadersOnly || !isLeader(ctx, u)).map((u) => u.id);
  const best = mine
    .filter((u) => isLeader(ctx, u) && !leadersOnly)
    .sort((a, b) => (leaderType(ctx, a)!.leadership ?? 0) - (leaderType(ctx, b)!.leadership ?? 0))[0];
  return [{ attackers, defenders, ...(best && leaderType(ctx, best)!.leadership < 0 ? { leader: best.id } : {}) }];
}

export function designate(ctx: Ctx, s: GameState, hex: HexKey, attacks: readonly CloseCombatAttack[]): void {
  if (s.phase !== 'closeCombat') throw new RuleError('Close combat attacks are designated in the Close Combat Phase', '§4.8');
  validatePlan(ctx, s, s.awaiting, hex, attacks);
  (s.ccPlans[s.awaiting] ??= {})[hex] = attacks.map((a) => ({ ...a, attackers: [...a.attackers], defenders: [...a.defenders] }));
}

/** Broken units in a close combat hex are eliminated (§20.9). */
export function purgeBrokenInMelee(ctx: Ctx, s: GameState, emit: Emit): void {
  for (const hex of ccHexes(s)) {
    for (const u of unitsIn(s, hex)) if (u.broken) eliminate(ctx, s, u, 'broken unit in a close combat hex (§20.9)', emit);
  }
}

export function oddsColumn(ctx: Ctx, a: number, d: number): number {
  const t = ctx.data.tables.closeCombat.thresholds;
  const ratio = d <= 0 ? Infinity : a / d;
  let col = 0;
  for (let i = 0; i < t.length; i++) if (ratio + 1e-9 >= t[i]!) col = i;
  return col;
}

export function resolveCloseCombat(ctx: Ctx, s: GameState, emit: Emit): void {
  const table = ctx.data.tables.closeCombat;
  for (const hex of ccHexes(s)) {
    const sides = [...new Set(unitsIn(s, hex).map((u) => u.side))];
    const startSquads = new Map(sides.map((sd) => [sd, sideUnitsIn(s, hex, sd).filter((u) => !isLeader(ctx, u)).map((u) => u.id)]));
    const doomed = new Set<string>();
    for (const side of sides) {
      const plans = s.ccPlans[side]?.[hex] ?? autoPlan(ctx, s, side, hex);
      const mine = sideUnitsIn(s, hex, side);
      const theirs = unitsIn(s, hex).filter((u) => u.side !== side);
      const myAlone = onlyLeaders(ctx, mine);
      const theirAlone = onlyLeaders(ctx, theirs);
      for (const p of plans) {
        const att = p.attackers.map((id) => s.units[id]).filter((u): u is Unit => !!u);
        const def = p.defenders.map((id) => s.units[id]).filter((u): u is Unit => !!u);
        if (!att.length || !def.length) continue;
        const A = att.reduce((acc, u) => acc + ccStrength(ctx, s, u, true, myAlone), 0);
        const D = def.reduce((acc, u) => acc + ccStrength(ctx, s, u, false, theirAlone), 0);
        const col = oddsColumn(ctx, A, D);
        const kill = table.kill[col]!;
        const L = p.leader ? s.units[p.leader] : undefined;
        const ldrm = L ? (leaderType(ctx, L)?.leadership ?? 0) : myAlone && att.length === 1 ? (leaderType(ctx, att[0]!)?.leadership ?? 0) : 0;
        const [d1, d2] = roll2d6(s);
        const total = d1 + d2 + ldrm;
        const hit = total <= kill;
        if (hit) for (const u of def) doomed.add(u.id);
        emit({
          kind: 'closeCombat',
          text: `${hexLabel(ctx, hex)}: ${att.map((u) => unitLabel(ctx, u)).join(' + ')} attack ${def.map((u) => unitLabel(ctx, u)).join(' + ')} at ${table.labels[col]} — ${hit ? 'eliminated' : 'survive'}`,
          trace: [
            `Odds ${A} : ${D} → ${table.labels[col]} (rounded in the defender’s favour, §20.3); kill number ${kill}`,
            `Dice ${d1}+${d2}${ldrm ? ` ${ldrm > 0 ? '+' : ''}${ldrm} leader (§20.6)` : ''} = ${total} ${hit ? '≤' : '>'} ${kill}`,
          ],
          side,
          dice: [d1, d2],
          hexes: [hex],
          units: [...p.attackers, ...p.defenders],
          fx: { hit },
        });
      }
    }
    // Simultaneous removal (§20.2).
    for (const id of doomed) {
      const u = s.units[id];
      if (u) eliminate(ctx, s, u, 'close combat (§20.3)', emit);
    }
    // Leaders die with their squads (§20.71).
    for (const side of sides) {
      const started = startSquads.get(side) ?? [];
      if (started.length && started.every((id) => !s.units[id])) {
        for (const u of sideUnitsIn(s, hex, side)) eliminate(ctx, s, u, 'all squads in the hex were lost (§20.71)', emit);
      }
    }
    const left = new Set(unitsIn(s, hex).map((u) => u.side));
    if (left.size > 1) emit({ kind: 'info', text: `${hexLabel(ctx, hex)} is locked in melee (§20.8)`, hexes: [hex] });
  }
  s.ccPlans = {};
}
