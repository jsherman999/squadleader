/** Advance Phase (§4.7, §5.73) and berserk charges (§18.42–18.43). */
import { DIRECTIONS, hexKey, neighbor, parseHexKey, type HexKey } from '@squadwar/hex';
import type { Ctx } from '../ctx';
import {
  allUnits,
  carried,
  enemiesIn,
  hexLabel,
  inMelee,
  isLeader,
  moveCost,
  portageOf,
  range,
  stackingProblem,
  unitLabel,
} from '../queries';
import { RuleError, type GameState, type Unit } from '../types';
import type { Emit } from './common';
import { enemyVehiclesIn, preAfvCheck, vehicleLabel } from './armor';
import { mineAttack, onFire } from './western';
import { unitSees } from './floors';

export function advance(ctx: Ctx, s: GameState, ids: readonly string[], to: HexKey, emit: Emit): void {
  if (s.phase !== 'advance') throw new RuleError('Units advance only in the Advance Phase', '§4.7');
  if (!ids.length) throw new RuleError('Choose units to advance');
  const units = ids.map((id) => s.units[id]);
  const from = units[0]?.hex;
  for (const u of units) {
    if (!u) throw new RuleError('Unknown unit');
    if (u.side !== s.phasing || s.awaiting !== s.phasing) throw new RuleError('Only the moving player advances', '§4.7');
    if (u.broken) throw new RuleError('Broken units cannot advance', '§4.7');
    if (u.advanced) throw new RuleError(`${unitLabel(ctx, u)} has already advanced`);
    if (u.hex !== from) throw new RuleError('Units advancing together must start in the same hex');
    if (inMelee(s, u.hex)) throw new RuleError(`${unitLabel(ctx, u)} is locked in melee`, '§20.8');
    const cap = isLeader(ctx, u) ? ctx.data.tables.movement.advanceLeaderPortage : ctx.data.tables.movement.advanceSquadPortage;
    if (portageOf(ctx, s, u) > cap) throw new RuleError(`${unitLabel(ctx, u)} carries too much to advance (max ${cap} PP)`, '§5.73');
  }
  if (range(from!, to) !== 1) throw new RuleError('Advance is one hex', '§4.7');
  if (!Number.isFinite(moveCost(ctx, from!, to).mf)) throw new RuleError(`Cannot enter ${hexLabel(ctx, to)}`);
  if (onFire(s, to)) throw new RuleError('No unit may move into a burning hex', '§59.6');
  // Onto an enemy AFV with no enemy infantry: each unit must pass a pre-AFV attack check (§36.21).
  const afv = enemyVehiclesIn(s, to, s.phasing)[0];
  const going = afv && !enemiesIn(s, to, s.phasing).length ? (units as Unit[]).filter((u) => preAfvCheck(ctx, s, u, emit)) : (units as Unit[]);
  for (const u of units as Unit[]) u.advanced = true;
  if (!going.length) return;
  for (const u of going) {
    u.hex = to;
    for (const w of carried(s, u)) w.hex = to;
    if (afv && !enemiesIn(s, to, s.phasing).length) s.afvAssaults.push({ unit: u.id, vehicle: afv.id, from: from! });
  }
  // Mines attack units leaving and entering (§55.2, §55.22).
  if (s.forts?.mines.some((m) => m.hex === from)) mineAttack(ctx, s, going.filter((u) => s.units[u.id]), from!, 'leave', emit);
  if (s.forts?.mines.some((m) => m.hex === to)) mineAttack(ctx, s, going.filter((u) => s.units[u.id]), to, 'enter', emit);
  const bad = stackingProblem(ctx, s, to, s.phasing);
  if (bad) throw new RuleError(`Stacking limit in ${hexLabel(ctx, to)}: ${bad}`, '§6.1');
  const intoEnemy = enemiesIn(s, to, s.phasing).length > 0;
  emit({
    kind: 'advance',
    text: `${going.map((u) => unitLabel(ctx, u)).join(', ')} advance ${hexLabel(ctx, from!)} → ${hexLabel(ctx, to)}${intoEnemy ? ' into close combat' : afv ? ` onto ${vehicleLabel(ctx, afv)} to attack it` : ''}`,
    side: s.phasing,
    units: going.map((u) => u.id),
    from: from!,
    to,
  });
}

/** Nearest enemy unit in LOS of a berserk unit (by hexes, §18.42). */
function nearestEnemyInLos(ctx: Ctx, s: GameState, u: Unit): Unit | undefined {
  let best: Unit | undefined;
  let bestR = Infinity;
  for (const e of allUnits(s)) {
    if (e.side === u.side) continue;
    const r = range(u.hex, e.hex);
    if (r < bestR && unitSees(ctx, s, u, e)) {
      best = e;
      bestR = r;
    }
  }
  return best;
}

/** At the start of the Movement Phase, berserk units charge by the shortest MF route (§18.42–18.43). */
export function berserkMovement(ctx: Ctx, s: GameState, emit: Emit): void {
  for (const u of allUnits(s, s.phasing)) {
    if (!u.berserk || inMelee(s, u.hex)) continue;
    const target = nearestEnemyInLos(ctx, s, u);
    if (!target || range(u.hex, target.hex) <= 1) continue;
    const mfMax = isLeader(ctx, u) ? 8 : 6;
    // Dijkstra to any hex adjacent to the target.
    const dist = new Map<HexKey, number>([[u.hex, 0]]);
    const prev = new Map<HexKey, HexKey>();
    const open = [u.hex];
    const done = new Set<HexKey>();
    let goal: HexKey | undefined;
    while (open.length) {
      open.sort((a, b) => dist.get(a)! - dist.get(b)!);
      const cur = open.shift()!;
      if (done.has(cur)) continue;
      done.add(cur);
      if (range(cur, target.hex) === 1) {
        goal = cur;
        break;
      }
      for (const d of DIRECTIONS) {
        const nk = hexKey(neighbor(parseHexKey(cur), d));
        if (!ctx.map.hexes[nk] || done.has(nk) || enemiesIn(s, nk, u.side).length) continue;
        const c = moveCost(ctx, cur, nk).mf;
        if (!Number.isFinite(c)) continue;
        const nd = dist.get(cur)! + c;
        if (nd < (dist.get(nk) ?? Infinity)) {
          dist.set(nk, nd);
          prev.set(nk, cur);
          open.push(nk);
        }
      }
    }
    if (!goal) continue;
    const path: HexKey[] = [];
    for (let h: HexKey | undefined = goal; h && h !== u.hex; h = prev.get(h)) path.unshift(h);
    let spent = 0;
    let at = u.hex;
    const from = u.hex;
    for (const h of path) {
      const c = moveCost(ctx, at, h).mf;
      if (spent + c > mfMax) break;
      spent += c;
      (s.tracks[u.id] ??= []).push({ hex: h, mf: c, open: ctx.map.hexes[h]?.terrain === 'open' });
      at = h;
    }
    if (at === from) continue;
    u.hex = at;
    u.moved = true;
    u.mfSpent = spent;
    u.moveDone = true;
    for (const w of carried(s, u)) w.hex = at;
    emit({ kind: 'move', text: `Berserk ${unitLabel(ctx, u)} charges ${hexLabel(ctx, from)} → ${hexLabel(ctx, at)} (§18.42)`, side: u.side, units: [u.id], from, to: at });
  }
}

/** Berserk units adjacent to an enemy must advance into it (§18.42). */
export function berserkAdvance(ctx: Ctx, s: GameState, emit: Emit): void {
  for (const u of allUnits(s, s.phasing)) {
    if (!u.berserk || u.advanced || inMelee(s, u.hex)) continue;
    const targets = DIRECTIONS.map((d) => hexKey(neighbor(parseHexKey(u.hex), d))).filter((h) => enemiesIn(s, h, u.side).length);
    if (!targets.length) continue;
    try {
      advance(ctx, s, [u.id], targets[0]!, emit);
    } catch {
      // Stacking prevents the charge this turn.
    }
  }
}
