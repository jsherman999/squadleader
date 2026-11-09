/**
 * A heuristic opponent. chooseAction() looks at the current state and
 * returns the next action for the side the engine is waiting on; call it
 * repeatedly until it returns endPhase. It plays legally (every action is
 * validated by the engine) and reasonably: fire where the odds are good,
 * move stacks towards objectives, close assault at favourable odds.
 */
import { DIRECTIONS, hexKey, neighbor, parseHexKey, type HexKey } from '@squadwar/hex';
import {
  analyzeFire,
  canRally,
  canRepair,
  carried,
  ccHexes,
  enemiesIn,
  fireOdds,
  inMelee,
  isCover,
  isLeader,
  mfLeft,
  moveCost,
  objectiveStatus,
  oddsColumn,
  range,
  sideUnitsIn,
  squadType,
  stackingProblem,
  tryAction,
  unitsIn,
  weaponType,
  type Action,
  type Ctx,
  type FireUnit,
  type GameState,
  type Unit,
} from '@squadwar/engine';

export interface BotOptions {
  /** Minimum expected casualties (broken-or-worse) before firing. */
  readonly fireThreshold?: number;
}

const END: Action = { type: 'endPhase' };

export function chooseAction(ctx: Ctx, s: GameState, opts: BotOptions = {}): Action {
  const side = s.awaiting;
  switch (s.phase) {
    case 'setup':
    case 'rout':
    case 'closeCombat':
      return END;
    case 'rally':
      return rallyAction(ctx, s, side) ?? END;
    case 'prepFire':
      return fireAction(ctx, s, side, opts.fireThreshold ?? 0.35, true) ?? END;
    case 'defensiveFire':
      return fireAction(ctx, s, side, opts.fireThreshold ?? 0.12, false) ?? END;
    case 'advancingFire':
      return fireAction(ctx, s, side, 0.05, false) ?? END;
    case 'movement':
      return moveAction(ctx, s, side) ?? END;
    case 'advance':
      return advanceAction(ctx, s, side) ?? END;
    default:
      return END;
  }
}

function legal(ctx: Ctx, s: GameState, a: Action): boolean {
  return tryAction(ctx, s, a).ok;
}

function rallyAction(ctx: Ctx, s: GameState, side: string): Action | undefined {
  for (const w of Object.values(s.weapons)) {
    if (w.side === side && !canRepair(ctx, s, w.id)) return { type: 'repair', weapon: w.id };
  }
  for (const u of Object.values(s.units)) {
    if (u.side === side && !canRally(ctx, s, u.id)) return { type: 'rally', unit: u.id };
  }
  return undefined;
}

/** The fire group a hex can form now: every unit's inherent fire plus legal MGs. */
function hexFirers(ctx: Ctx, s: GameState, hex: HexKey, side: string): FireUnit[] {
  const out: FireUnit[] = [];
  for (const u of sideUnitsIn(s, hex, side)) {
    if (u.broken || (u.firedPhase && u.firedPhase !== s.phase)) continue;
    if (s.phase === 'prepFire' && u.berserk) continue;
    const st = squadType(ctx, u);
    const ws = carried(s, u).filter((w) => !w.malfunctioned && !w.usedThisTurn);
    if (s.phase === 'advancingFire' && u.ppUsed >= (st ? 4 : 2)) ws.length = 0;
    if (st) {
      const inherent = !u.usedInherent;
      // One MG (or two LMGs) with inherent fire (§17.1).
      const lmgs = ws.filter((w) => weaponType(ctx, w).kind === 'LMG');
      const pick = lmgs.length >= 2 ? lmgs.slice(0, 2) : ws.slice(0, 1);
      if (inherent || pick.length) out.push({ unit: u.id, inherent, weapons: pick.map((w) => w.id) });
    } else if (ws.length) {
      out.push({ unit: u.id, inherent: false, weapons: [ws[0]!.id] });
    }
  }
  return out;
}

function bestLeader(ctx: Ctx, s: GameState, hex: HexKey, side: string, firers: FireUnit[]): string | undefined {
  let best: Unit | undefined;
  for (const u of sideUnitsIn(s, hex, side)) {
    if (u.broken || u.directed || !isLeader(ctx, u)) continue;
    if (firers.some((f) => f.unit === u.id)) continue;
    const t = ctx.data.units[u.type]!;
    if (t.kind === 'leader' && t.leadership < 0 && (!best || t.leadership < (ctx.data.units[best.type] as { leadership: number }).leadership)) best = u;
  }
  return best?.id;
}

function fireAction(ctx: Ctx, s: GameState, side: string, threshold: number, isPrep: boolean): Action | undefined {
  const myHexes = [...new Set(Object.values(s.units).filter((u) => u.side === side).map((u) => u.hex))];
  const targets = new Set<HexKey>();
  for (const u of Object.values(s.units)) if (u.side !== side) targets.add(u.hex);
  if (s.phase === 'defensiveFire') for (const steps of Object.values(s.tracks)) for (const st of steps) targets.add(st.hex);
  let best: { a: Action; score: number } | undefined;
  for (const h of myHexes) {
    if (inMelee(s, h)) continue;
    let firers = hexFirers(ctx, s, h, side);
    if (!firers.length) continue;
    // In Prep Fire only a fire base fires: heavy-weapon crews (the rest move),
    // or stacks already next to their objective.
    if (isPrep) {
      if (!shouldPrepFire(ctx, s, h, side)) continue;
      const goal = nearestObjectiveHex(ctx, s, side, h);
      const atGoal = goal !== undefined && range(h, goal) <= 1;
      if (!atGoal) firers = firers.filter((f) => carried(s, s.units[f.unit]!).some((w) => weaponType(ctx, w).portage >= 4));
      if (!firers.length) continue;
    }
    const leader = bestLeader(ctx, s, h, side, firers);
    for (const t of targets) {
      if (range(h, t) > 16) continue;
      if (!ctx.los(h, t).clear) continue;
      // Drop firers that are out of range.
      const usable = firers.filter((f) => {
        const u = s.units[f.unit]!;
        const st = squadType(ctx, u);
        const r = range(u.hex, t);
        return (!f.inherent || (st && r <= st.range * 2)) && f.weapons.every((w) => r <= weaponType(ctx, s.weapons[w]!).range * 2);
      });
      if (!usable.length) continue;
      try {
        const an = analyzeFire(ctx, s, usable, t, leader);
        const odds = fireOdds(ctx, s, an);
        let score = 0;
        for (const o of odds.units) {
          const u = s.units[o.unit]!;
          if (u.side === side) score -= 2 * o.breakOrWorse;
          else score += (u.broken ? o.mc : o.breakOrWorse) * (isLeader(ctx, u) ? 1.3 : 1);
        }
        score -= odds.breakdown * 0.3;
        if (score > threshold && (!best || score > best.score)) {
          best = { a: { type: 'fire', firers: usable, target: t, ...(leader ? { leader } : {}) }, score };
        }
      } catch {
        // Not a legal attack; try the next target.
      }
    }
  }
  return best && legal(ctx, s, best.a) ? best.a : undefined;
}

/** The attacker prep fires with stacks that are slow (heavy MGs) or already in good positions. */
function shouldPrepFire(ctx: Ctx, s: GameState, hex: HexKey, side: string): boolean {
  const units = sideUnitsIn(s, hex, side).filter((u) => !u.broken);
  const heavy = units.some((u) => carried(s, u).some((w) => weaponType(ctx, w).portage >= 4));
  if (heavy) return true;
  const goal = nearestObjectiveHex(ctx, s, side, hex);
  return goal !== undefined && range(hex, goal) <= 1;
}

function objectiveHexes(ctx: Ctx, s: GameState, side: string): HexKey[] {
  const status = objectiveStatus(ctx, s);
  const attacker = ctx.scenario.victory.side === side;
  const out: HexKey[] = [];
  ctx.objectives.forEach((o, i) => {
    const owner = status[i]!.owner;
    if (attacker ? owner !== side : true) out.push(...o.hexes);
  });
  return out;
}

function nearestObjectiveHex(ctx: Ctx, s: GameState, side: string, from: HexKey): HexKey | undefined {
  let best: HexKey | undefined;
  let bestR = Infinity;
  for (const h of objectiveHexes(ctx, s, side)) {
    const r = range(from, h);
    if (r < bestR) {
      best = h;
      bestR = r;
    }
  }
  return best;
}

/** Cheapest MF path from a hex to the nearest goal, avoiding enemy hexes. */
function pathTo(ctx: Ctx, s: GameState, from: HexKey, goals: Set<HexKey>, side: string): HexKey[] | undefined {
  const dist = new Map<HexKey, number>([[from, 0]]);
  const prev = new Map<HexKey, HexKey>();
  const open = [from];
  const done = new Set<HexKey>();
  while (open.length) {
    open.sort((a, b) => dist.get(a)! - dist.get(b)!);
    const cur = open.shift()!;
    if (done.has(cur)) continue;
    done.add(cur);
    if (goals.has(cur) && cur !== from) {
      const path: HexKey[] = [];
      for (let h: HexKey | undefined = cur; h && h !== from; h = prev.get(h)) path.unshift(h);
      return path;
    }
    for (const d of DIRECTIONS) {
      const nk = hexKey(neighbor(parseHexKey(cur), d));
      if (!ctx.map.hexes[nk] || done.has(nk)) continue;
      const c = moveCost(ctx, cur, nk).mf;
      if (!Number.isFinite(c)) continue;
      const enemyThere = enemiesIn(s, nk, side).length > 0;
      if (enemyThere && !goals.has(nk)) continue;
      // Prefer cover: open ground costs a little extra in the planner.
      const nd = dist.get(cur)! + c + (isCover(ctx, nk) ? 0 : 0.4);
      if (nd < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nd);
        prev.set(nk, cur);
        open.push(nk);
      }
    }
  }
  return undefined;
}

function moveAction(ctx: Ctx, s: GameState, side: string): Action | undefined {
  const attacker = ctx.scenario.victory.side === side;
  // Continue the group that is moving.
  const movers = (hex: HexKey) =>
    sideUnitsIn(s, hex, side).filter((u) => !u.broken && !u.berserk && !u.moveDone && u.firedPhase !== 'prepFire' && !inMelee(s, u.hex));
  const hexes = s.moving.length ? [s.units[s.moving[0]!]?.hex].filter((h): h is HexKey => !!h) : [];
  for (const u of Object.values(s.units)) if (u.side === side && !hexes.includes(u.hex)) hexes.push(u.hex);
  for (const h of hexes) {
    const group = movers(h);
    if (!group.length) continue;
    const ids = group.map((u) => u.id);
    const goal = groupGoal(ctx, s, side, h, attacker);
    if (!goal) {
      return { type: 'endMove', units: ids };
    }
    const path = pathTo(ctx, s, h, goal, side);
    const next = path?.[0];
    if (!next || enemiesIn(s, next, side).length) return { type: 'endMove', units: ids };
    // Bound from cover to cover: only set off if the group can reach a hex
    // that is in cover or unseen by the enemy this phase.
    if (!reachesSafeStop(ctx, s, side, h, path!, group)) return { type: 'endMove', units: ids };
    // Slow units (heavy weapons) stay as a fire base when far from the goal.
    const minLeft = Math.min(...group.map((u) => mfLeft(ctx, s, u)));
    const cost = moveCost(ctx, h, next).mf;
    if (cost > minLeft + 1e-9) {
      // Split off whoever can still go on, or stop.
      const able = group.filter((u) => mfLeft(ctx, s, u) >= cost);
      if (able.length && able.length < group.length) {
        const split: Action = { type: 'move', units: able.map((u) => u.id), to: next };
        const r = tryAction(ctx, s, split);
        if (r.ok && !stackingProblem(ctx, r.state, next, side)) return split;
      }
      return { type: 'endMove', units: ids };
    }
    // Do not end overstacked: look ahead one step.
    const a: Action = { type: 'move', units: ids, to: next };
    const r = tryAction(ctx, s, a);
    if (!r.ok) return { type: 'endMove', units: ids };
    // Never enter a hex where the group would be overstacked (§6.1).
    if (stackingProblem(ctx, r.state, next, side)) return { type: 'endMove', units: ids };
    return a;
  }
  return undefined;
}

function exposed(ctx: Ctx, s: GameState, side: string, h: HexKey): boolean {
  if (isCover(ctx, h)) return false;
  for (const e of Object.values(s.units)) {
    if (e.side === side || e.broken) continue;
    const st = squadType(ctx, e);
    const reach = Math.max(st ? st.range * 2 : 0, ...carried(s, e).map((w) => weaponType(ctx, w).range * 2));
    if (reach && range(e.hex, h) <= reach && ctx.los(e.hex, h).clear) return true;
  }
  return false;
}

function reachesSafeStop(ctx: Ctx, s: GameState, side: string, from: HexKey, path: HexKey[], group: Unit[]): boolean {
  if (exposed(ctx, s, side, from)) return true; // already in the open: keep going
  const turnsLeft = ctx.scenario.turns - s.turn;
  if (turnsLeft <= 2) return true; // no time left for caution
  const squads = group.filter((u) => !isLeader(ctx, u)).length;
  if (squads >= 2 && group.some((u) => isLeader(ctx, u))) return true; // a led assault group pushes on
  let left = Math.min(...group.map((u) => mfLeft(ctx, s, u)));
  let at = from;
  for (const h of path) {
    const c = moveCost(ctx, at, h).mf;
    if (c > left + 1e-9) break;
    left -= c;
    at = h;
    if (!exposed(ctx, s, side, h)) return true;
  }
  return false;
}

/** Where a stack wants to go: attackers to objectives; defenders reinforce threatened objectives. */
function groupGoal(ctx: Ctx, s: GameState, side: string, hex: HexKey, attacker: boolean): Set<HexKey> | undefined {
  const objs = ctx.objectives.map((o) => o.hexes);
  if (attacker) {
    const status = objectiveStatus(ctx, s);
    const todo = objs.filter((_, i) => status[i]!.owner !== side);
    const inOne = todo.some((hs) => hs.includes(hex));
    if (inOne && enemiesIn(s, hex, side).length === 0) return undefined;
    // Stop next to an enemy-held objective hex; the Advance Phase goes in.
    const goals = new Set<HexKey>();
    const covered = new Set<HexKey>();
    for (const hs of todo) {
      for (const h of hs) {
        if (enemiesIn(s, h, side).length) {
          for (const d of DIRECTIONS) {
            const n = hexKey(neighbor(parseHexKey(h), d));
            if (!ctx.map.hexes[n] || enemiesIn(s, n, side).length) continue;
            goals.add(n);
            if (isCover(ctx, n)) covered.add(n);
          }
        } else goals.add(h);
      }
    }
    // Assault positions in cover beat open ones (§16.5 punishes the open).
    if (goals.has(hex)) return undefined;
    if (covered.size) return covered;
    return goals.size ? goals : undefined;
  }
  // Defender: stay if already in an objective, else head for the nearest one.
  if (objs.some((hs) => hs.includes(hex))) return undefined;
  return new Set(objs.flat().filter((h) => !enemiesIn(s, h, side).length));
}

function ccStrength(ctx: Ctx, s: GameState, units: Unit[], attacking: boolean): number {
  return units.reduce((acc, u) => {
    const st = squadType(ctx, u);
    if (!st) return acc;
    let fp = st.fp;
    if (attacking) for (const w of carried(s, u)) if (weaponType(ctx, w).kind === 'LMG' && !w.malfunctioned) fp += weaponType(ctx, w).fp;
    return acc + fp;
  }, 0);
}

function advanceAction(ctx: Ctx, s: GameState, side: string): Action | undefined {
  const attacker = ctx.scenario.victory.side === side;
  const hexes = [...new Set(Object.values(s.units).filter((u) => u.side === side).map((u) => u.hex))];
  for (const h of hexes) {
    if (inMelee(s, h)) continue;
    const group = sideUnitsIn(s, h, side).filter((u) => !u.broken && !u.advanced);
    if (!group.length) continue;
    const portable = group.filter((u) => {
      const pp = carried(s, u).reduce((a, w) => a + weaponType(ctx, w).portage, 0);
      return pp <= (isLeader(ctx, u) ? 3 : 5);
    });
    if (!portable.length) continue;
    const A = ccStrength(ctx, s, portable, true);
    for (const d of DIRECTIONS) {
      const n = hexKey(neighbor(parseHexKey(h), d));
      if (!ctx.map.hexes[n]) continue;
      const foes = enemiesIn(s, n, side).filter((u) => !u.broken);
      const D = Math.max(1, ccStrength(ctx, s, foes, false));
      const anyEnemy = enemiesIn(s, n, side).length > 0;
      if (anyEnemy && !foes.length) {
        const a: Action = { type: 'advance', units: portable.map((u) => u.id), to: n };
        if (legal(ctx, s, a)) return a;
      }
      if (foes.length) {
        const col = oddsColumn(ctx, A, D);
        const need = attacker ? 4 : 5; // 3-2 for attackers, 2-1 for defenders
        if (col >= need) {
          const a: Action = { type: 'advance', units: portable.map((u) => u.id), to: n };
          if (legal(ctx, s, a)) return a;
        }
      } else if (attacker && unitsIn(s, n).length === 0) {
        // Step into an empty objective hex, or from the open into cover closer to one.
        const goal = nearestObjectiveHex(ctx, s, side, h);
        const isObj = ctx.objectives.some((o) => o.hexes.includes(n));
        const better = goal !== undefined && range(n, goal) < range(h, goal) && isCover(ctx, n) && !isCover(ctx, h);
        if (isObj || better) {
          const a: Action = { type: 'advance', units: portable.map((u) => u.id), to: n };
          if (legal(ctx, s, a)) return a;
        }
      }
    }
  }
  void ccHexes;
  return undefined;
}

/** Play out decisions until the engine waits on another side or the game ends. */
export function playUntilHandoff(ctx: Ctx, s: GameState, maxSteps = 400): { state: GameState; actions: Action[] } {
  const side = s.awaiting;
  const actions: Action[] = [];
  let cur = s;
  for (let i = 0; i < maxSteps && cur.phase !== 'gameOver' && cur.awaiting === side; i++) {
    const a = chooseAction(ctx, cur);
    const r = tryAction(ctx, cur, a);
    if (!r.ok) {
      const e = tryAction(ctx, cur, END);
      if (!e.ok) break;
      actions.push(END);
      cur = e.state;
      continue;
    }
    actions.push(a);
    cur = r.state;
  }
  return { state: cur, actions };
}
