/**
 * The scripted AI for armour (§28–41): tank and SP-gun fire and movement,
 * and infantry anti-tank attacks. Every decision carries its reasons, like
 * the infantry bot's.
 */
import { DIRECTIONS, hexKey, neighbor, parseHexKey, type HexKey } from '@squadwar/hex';
import {
  analyzeAntiTank,
  analyzeVehicleFire,
  carried,
  chance2d6,
  enemiesIn,
  enemyVehiclesIn,
  hitChance,
  inArc,
  facingToward,
  isCover,
  leaderDrmFor,
  moraleOf,
  mpLeft,
  objectiveStatus,
  passedNear,
  range,
  tryAction,
  unitLabel,
  vehicleFireOdds,
  vehicleLabel,
  vehicleStepCost,
  vehicleType,
  weaponType,
  type Action,
  type Ctx,
  type GameState,
  type Vehicle,
  type VehicleFireRequest,
} from '@squadwar/engine';
import { hexId, objectiveNear, pct, terrainNote, unitList, type Decision } from './explain';

const legal = (ctx: Ctx, s: GameState, a: Action) => tryAction(ctx, s, a).ok;

interface VShot {
  readonly req: VehicleFireRequest;
  readonly score: number;
  readonly text: string;
  readonly reasons: string[];
}

/** The best shot each vehicle of the side has now. */
function vehicleShots(ctx: Ctx, s: GameState, side: string): VShot[] {
  const out: VShot[] = [];
  const targets = new Set<HexKey>();
  for (const u of Object.values(s.units)) if (u.side !== side) targets.add(u.hex);
  if (s.phase === 'defensiveFire') for (const steps of Object.values(s.tracks)) for (const st of steps) targets.add(st.hex);
  for (const v of Object.values(s.vehicles)) {
    if (v.side !== side) continue;
    const t = vehicleType(ctx, v);
    const tries: VehicleFireRequest[] = [];
    for (const ev of Object.values(s.vehicles)) if (ev.side !== side && range(v.hex, ev.hex) <= 30) tries.push({ vehicle: v.id, target: ev.hex, weapon: 'main', vs: ev.id });
    for (const h of targets) {
      if (range(v.hex, h) > 24) continue;
      tries.push({ vehicle: v.id, target: h, weapon: 'main' });
      if (range(v.hex, h) <= 16) tries.push({ vehicle: v.id, target: h, weapon: 'mg', mgs: ['ca'] });
    }
    for (const req of tries) {
      try {
        const a = analyzeVehicleFire(ctx, s, req);
        const o = vehicleFireOdds(ctx, s, a);
        if (req.vs) {
          const ev = s.vehicles[req.vs]!;
          const score = o.kill! * 2.2;
          out.push({
            req,
            score,
            text: `${vehicleLabel(ctx, v)} fires ${a.ammo} at ${vehicleLabel(ctx, ev)}`,
            reasons: [
              `Range ${a.range}, To Hit ${a.hitNumber}${a.hitDrm ? ` with ${a.hitDrm > 0 ? '+' : ''}${a.hitDrm}` : ''}: ${pct(o.hit)} to hit (§33.3).`,
              `A hit on its ${a.aspect} armour kills on ${a.kill}${a.killDrm ? ` (${a.killDrm > 0 ? '+' : ''}${a.killDrm} armour)` : ''}: ${pct(o.kill!)} overall (§33.4).`,
            ],
          });
        } else {
          const score = (o.units ?? []).reduce((acc, x) => acc + x.breakOrWorse, 0);
          if (score <= 0) continue;
          out.push({
            req,
            score,
            text: `${vehicleLabel(ctx, v)} ${req.weapon === 'main' ? `fires HE (${a.fp} FP)` : `fires its MG (${a.fp} FP)`} at ${hexId(ctx, req.target)}`,
            reasons: [
              req.weapon === 'main' ? `To Hit ${a.hitNumber}${a.hitDrm ? ` ${a.hitDrm > 0 ? '+' : ''}${a.hitDrm}` : ''}: ${pct(o.hit)}; a hit is ${a.fp} FP on the IFT against ${terrainNote(ctx, req.target)} (§34.2).` : `${a.fp} FP on the IFT against ${terrainNote(ctx, req.target)} (§34.3).`,
              `Expected ${score.toFixed(2)} enemy units broken or worse.`,
            ],
          });
        }
      } catch {
        // not possible
      }
    }
    void t;
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Fire a vehicle if a shot is good enough. In Prep Fire only vehicles with no reason to move fire. */
export function vehicleFireDecision(ctx: Ctx, s: GameState, side: string, threshold: number): Decision | undefined {
  const shots = vehicleShots(ctx, s, side);
  for (const sh of shots) {
    if (sh.score < threshold) break;
    const v = s.vehicles[sh.req.vehicle]!;
    // In Prep Fire a vehicle that wants to move only stops for a really good shot.
    if (s.phase === 'prepFire' && !v.immobilized && sh.score < 0.45 && wantsToMove(ctx, s, v)) continue;
    const a: Action = { type: 'vfire', ...sh.req } as Action;
    if (!legal(ctx, s, a)) continue;
    return {
      action: a,
      why: {
        goal: sh.text,
        reasons: [...sh.reasons, ...(s.phase === 'advancingFire' && v.moved ? ['It moved this turn, so the gun fires at +5 to hit (case F); its MGs at half.'] : [])],
        tip: 'Tanks fire best from a halt: firing in Prep Fire or Defensive Fire avoids the moving penalty. Shots at the side or rear of an AFV kill far more often (§33.5).',
        weight: 'key',
        focus: { from: v.hex, to: sh.req.target },
      },
    };
  }
  return undefined;
}

/** Vehicle movement cost map (Dijkstra over MP, woods and wooden buildings discouraged). */
function vehiclePath(ctx: Ctx, s: GameState, v: Vehicle, goals: Set<HexKey>): HexKey[] | undefined {
  const dist = new Map<HexKey, number>([[v.hex, 0]]);
  const prev = new Map<HexKey, HexKey>();
  const open = [v.hex];
  const done = new Set<HexKey>();
  const probe = { ...v, moved: true };
  while (open.length) {
    open.sort((a, b) => dist.get(a)! - dist.get(b)!);
    const cur = open.shift()!;
    if (done.has(cur)) continue;
    done.add(cur);
    if (goals.has(cur) && cur !== v.hex) {
      const path: HexKey[] = [];
      for (let h: HexKey | undefined = cur; h && h !== v.hex; h = prev.get(h)) path.unshift(h);
      return path;
    }
    for (const d of DIRECTIONS) {
      const nk = hexKey(neighbor(parseHexKey(cur), d));
      if (!ctx.map.hexes[nk] || done.has(nk)) continue;
      const c = vehicleStepCost(ctx, s, { ...probe, hex: cur }, nk);
      if (!Number.isFinite(c.mp)) continue;
      const nd = dist.get(cur)! + c.mp + (c.risk ? 6 : 0);
      if (nd < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nd);
        prev.set(nk, cur);
        open.push(nk);
      }
    }
  }
  return undefined;
}

/** Hexes where the AFV can support the attack on the objectives without sitting next to enemy infantry. */
function vehicleGoals(ctx: Ctx, s: GameState, v: Vehicle): Set<HexKey> {
  const attacker = ctx.scenario.victory.side === v.side;
  const status = objectiveStatus(ctx, s);
  const objs = ctx.objectives.filter((_, i) => (attacker ? status[i]!.owner !== v.side : true)).flatMap((o) => o.hexes);
  const goals = new Set<HexKey>();
  for (const h of Object.values(ctx.map.hexes)) {
    if (h.terrain === 'stoneBuilding' || h.terrain === 'water' || h.terrain === 'woods' || h.terrain === 'woodBuilding') continue;
    const near = objs.filter((o) => range(o, h.key) <= 4);
    if (!near.length || near.some((o) => range(o, h.key) < 2)) continue;
    // A firing position: it sees at least one objective hex.
    if (!near.some((o) => ctx.los(h.key, o).clear)) continue;
    if (dangerClose(s, v.side, h.key)) continue;
    if (Object.values(s.vehicles).some((o) => o.id !== v.id && o.hex === h.key)) continue;
    goals.add(h.key);
  }
  return goals;
}

/** Unbroken enemy infantry next to the hex: grenade bundles and close assaults (§36). */
function dangerClose(s: GameState, side: string, hex: HexKey): boolean {
  return DIRECTIONS.some((d) => enemiesIn(s, hexKey(neighbor(parseHexKey(hex), d)), side).some((u) => !u.broken)) || enemiesIn(s, hex, side).length > 0;
}

function wantsToMove(ctx: Ctx, s: GameState, v: Vehicle): boolean {
  if (v.immobilized) return false;
  const goals = vehicleGoals(ctx, s, v);
  return goals.size > 0 && !goals.has(v.hex) && ctx.scenario.victory.side === v.side;
}

export function vehicleMoveDecision(ctx: Ctx, s: GameState, side: string): Decision | undefined {
  const attacker = ctx.scenario.victory.side === side;
  for (const v of Object.values(s.vehicles)) {
    if (v.side !== side || v.moveDone || v.immobilized || v.firedPhase === 'prepFire') continue;
    const shared = (h: HexKey) => Object.values(s.vehicles).some((o) => o.id !== v.id && o.hex === h);
    const stop = (goal: string, reasons: string[]): Decision => {
      // Two vehicles may not end in one hex (§29.1): step aside into the cheapest free hex.
      if (v.moved && shared(v.hex)) {
        const out = DIRECTIONS.map((d) => hexKey(neighbor(parseHexKey(v.hex), d)))
          .filter((h) => ctx.map.hexes[h] && !shared(h) && !enemiesIn(s, h, side).length)
          .map((h) => ({ h, mp: vehicleStepCost(ctx, s, v, h).mp }))
          .filter((x) => x.mp <= mpLeft(ctx, v) + 1e-9)
          .sort((a, b) => a.mp - b.mp)[0];
        if (out) return { action: { type: 'vmove', vehicle: v.id, to: out.h }, why: { goal: `${vehicleLabel(ctx, v)} pulls clear into ${hexId(ctx, out.h)}`, reasons: ['Two vehicles may not end their move in one hex (§29.1).'], weight: 'routine', focus: { from: v.hex, to: out.h } } };
      }
      return { action: { type: 'vstop', vehicle: v.id }, why: { goal, reasons, weight: 'routine', focus: { from: v.hex } } };
    };
    const goals = vehicleGoals(ctx, s, v);
    if (!attacker || goals.has(v.hex) || !goals.size) {
      // Hold, facing the nearest enemy.
      const foe = nearestEnemy(s, v);
      if (foe && !v.moved && !inArc(v.hex, v.facing, foe) && !vehicleType(ctx, v).turret && mpLeft(ctx, v) >= 2) {
        const f = facingToward(v.hex, v.facing, foe);
        const a: Action = { type: 'face', vehicle: v.id, facing: f };
        if (legal(ctx, s, a))
          return { action: a, why: { goal: `Turn ${vehicleLabel(ctx, v)} toward ${hexId(ctx, foe)}`, reasons: ['An SP gun fires only within its covered arc (§33.31); pivoting costs 2 MP and +3 to hit in Advancing Fire (case G).'], weight: 'routine', focus: { from: v.hex, to: foe } } };
      }
      return stop(`${vehicleLabel(ctx, v)} holds ${hexId(ctx, v.hex)}`, [goals.has(v.hex) ? 'It is already in a firing position near the objective, out of reach of close assaults.' : attacker ? 'No safe firing position near the objectives right now.' : 'A defending AFV keeps its position and fires from a halt.']);
    }
    const path = vehiclePath(ctx, s, v, goals);
    if (!path?.length) return stop(`${vehicleLabel(ctx, v)} stays in ${hexId(ctx, v.hex)}`, ['No route to a safe firing position.']);
    const next = path[0]!;
    const cost = vehicleStepCost(ctx, s, v, next);
    if (v.moved && cost.mp > mpLeft(ctx, v) + 1e-9) return stop(`${vehicleLabel(ctx, v)} stops in ${hexId(ctx, v.hex)}`, [`Out of movement points (${mpLeft(ctx, v)} left, ${cost.mp} needed).`]);
    if (dangerClose(s, side, next) && path.length > 1) return stop(`${vehicleLabel(ctx, v)} stops short of enemy infantry`, ['The next hex is next to enemy infantry, who could immobilize or close-assault it (§36).']);
    // Never end up stuck in a hex another vehicle holds (§29.1): pass through only if it can go on.
    if (shared(next)) {
      const left = mpLeft(ctx, v) - cost.mp;
      const probe = { ...v, hex: next, moved: true, mpSpent: v.mpSpent + cost.mp };
      const exits = DIRECTIONS.map((d) => hexKey(neighbor(parseHexKey(next), d))).filter((h) => h !== v.hex && ctx.map.hexes[h] && !shared(h) && vehicleStepCost(ctx, s, probe, h).mp <= left + 1e-9);
      if (!exits.length) return stop(`${vehicleLabel(ctx, v)} waits in ${hexId(ctx, v.hex)}`, ['Another vehicle is in the way and there is not enough movement to get past it (§29.1).']);
    }
    const a: Action = { type: 'vmove', vehicle: v.id, to: next };
    if (!legal(ctx, s, a)) return stop(`${vehicleLabel(ctx, v)} stops`, ['The way on is blocked.']);
    const dest = path[path.length - 1]!;
    return {
      action: a,
      why: {
        goal: `Move ${vehicleLabel(ctx, v)} toward ${objectiveNear(ctx, dest) ? `the ${objectiveNear(ctx, dest)}` : hexId(ctx, dest)}`,
        reasons: [`Entering ${hexId(ctx, next)} costs ${cost.mp} MP (${cost.parts.join(', ')}); ${mpLeft(ctx, v) - cost.mp} left after.`, 'Armour supports the infantry from 2–3 hexes out: close enough to fire, far enough from grenade bundles (§36).'],
        tip: 'Keep tanks on roads and open ground: woods and wooden buildings can throw a track (§39.1), and stone buildings are impassable (§30.1).',
        weight: v.moved ? 'routine' : 'key',
        focus: { from: v.hex, to: next, path, goal: dest },
      },
    };
  }
  return undefined;
}

function nearestEnemy(s: GameState, v: Vehicle): HexKey | undefined {
  let best: { h: HexKey; d: number } | undefined;
  for (const x of [...Object.values(s.units), ...Object.values(s.vehicles)]) {
    if (x.side === v.side) continue;
    const d = range(v.hex, x.hex);
    if (!best || d < best.d) best = { h: x.hex, d };
  }
  return best?.h;
}

/** Panzerfausts, bazookas and flamethrowers at AFVs; grenade attacks in Defensive Fire (§36–37). */
export function antiTankDecision(ctx: Ctx, s: GameState, side: string): Decision | undefined {
  for (const u of Object.values(s.units)) {
    if (u.side !== side || u.broken) continue;
    for (const v of Object.values(s.vehicles)) {
      if (v.side === side || range(u.hex, v.hex) > 4) continue;
      for (const w of carried(s, u)) {
        const kind = weaponType(ctx, w).kind;
        if (kind !== 'PF' && kind !== 'BAZ' && kind !== 'FT') continue;
        try {
          const an = analyzeAntiTank(ctx, s, [u.id], v.id, w.id);
          const p = (an.hit === undefined ? 1 : hitChance(an.hit, an.hitDrm ?? 0)) * chance2d6(an.kill!, an.killDrm ?? 0);
          if (p < 0.2) continue;
          const a: Action = { type: 'antiTank', units: [u.id], vehicle: v.id, weapon: w.id };
          if (!legal(ctx, s, a)) continue;
          return {
            action: a,
            why: {
              goal: `${unitLabel(ctx, u)} fires a ${weaponType(ctx, w).name.toLowerCase()} at ${vehicleLabel(ctx, v)}`,
              reasons: [...an.trace, `About ${pct(p)} to knock it out.`],
              tip: 'Infantry anti-tank weapons are short-ranged: let the tank come to you, and aim for the side or rear (§33.5).',
              weight: 'key',
              focus: { from: u.hex, to: v.hex },
            },
          };
        } catch {
          // not possible
        }
      }
    }
  }
  if (s.phase !== 'defensiveFire') return undefined;
  // Grenade bundles: squads in cover the AFV drove past.
  for (const v of Object.values(s.vehicles)) {
    if (v.side === side || v.immobilized || !v.moved) continue;
    const hexes = new Set(Object.values(s.units).filter((u) => u.side === side && !u.broken && !u.firedPhase && !u.usedInherent && passedNear(s, v, u.hex) && isCover(ctx, u.hex)).map((u) => u.hex));
    for (const h of hexes) {
      const us = Object.values(s.units).filter((u) => u.side === side && u.hex === h && !u.broken && !u.firedPhase && !u.usedInherent);
      try {
        const an = analyzeAntiTank(ctx, s, us.map((u) => u.id), v.id);
        const lead = leaderDrmFor(ctx, s, h, side).drm;
        const pPass = chance2d6(moraleOf(ctx, us[0]!), lead);
        const p = 1 - (1 - pPass * chance2d6(an.immobilizeOn!, lead)) ** us.length;
        if (p < 0.12) continue;
        const a: Action = { type: 'antiTank', units: us.map((u) => u.id), vehicle: v.id };
        if (!legal(ctx, s, a)) continue;
        return {
          action: a,
          why: {
            goal: `${unitList(ctx, us)} go for ${vehicleLabel(ctx, v)} with grenade bundles`,
            reasons: [`The AFV drove past ${hexId(ctx, h)}, which is ${terrainNote(ctx, h)}.`, ...an.trace, `About ${pct(p)} to immobilize it; a failed pre-attack check costs nothing (§36.11).`],
            tip: 'Tanks that drive close to infantry in cover risk being immobilized; an immobilized crew may bail out (§39.2).',
            weight: 'key',
            focus: { from: h, to: v.hex },
          },
        };
      } catch {
        // not possible
      }
    }
  }
  return undefined;
}

export function vehicleRepairDecision(ctx: Ctx, s: GameState, side: string): Decision | undefined {
  for (const v of Object.values(s.vehicles)) {
    if (v.side !== side || v.repairTried || (v.gun !== 'malfunctioned' && v.mg !== 'malfunctioned')) continue;
    const a: Action = { type: 'vrepair', vehicle: v.id };
    if (!legal(ctx, s, a)) continue;
    return { action: a, why: { goal: `Repair ${vehicleLabel(ctx, v)}`, reasons: ['A roll of 1 fixes it, a 6 disables it for good (§38.1).'], weight: 'routine', focus: { from: v.hex } } };
  }
  return undefined;
}

/** Advance onto a lone enemy AFV when the squad has a fair chance to destroy it (§36.2). */
export function afvAssaultTarget(ctx: Ctx, s: GameState, side: string, hex: HexKey): { to: HexKey; p: number; label: string } | undefined {
  let best: { to: HexKey; p: number; label: string } | undefined;
  const us = Object.values(s.units).filter((u) => u.side === side && u.hex === hex && !u.broken && !u.advanced);
  if (!us.length) return undefined;
  for (const d of DIRECTIONS) {
    const n = hexKey(neighbor(parseHexKey(hex), d));
    const v = enemyVehiclesIn(s, n, side)[0];
    if (!v || enemiesIn(s, n, side).length) continue;
    const lead = leaderDrmFor(ctx, s, hex, side).drm;
    let miss = 1;
    for (const u of us) {
      const fp = ctx.data.units[u.type]!.kind === 'leader' ? 2 : (ctx.data.units[u.type] as { fp: number }).fp;
      miss *= 1 - chance2d6(moraleOf(ctx, u), lead) * chance2d6(fp, lead);
    }
    const p = 1 - miss;
    if (!best || p > best.p) best = { to: n, p, label: vehicleLabel(ctx, v) };
  }
  return best;
}
