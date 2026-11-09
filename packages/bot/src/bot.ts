/**
 * A heuristic opponent. decide() looks at the current state and returns the
 * next action for the side the engine is waiting on, with the reasoning
 * behind it; call it repeatedly until it returns endPhase. It plays legally
 * (every action is validated by the engine) and reasonably: fire where the
 * odds are good, move stacks towards objectives from cover to cover, close
 * assault at favourable odds.
 */
import { DIRECTIONS, hexKey, neighbor, parseHexKey, type HexKey } from '@squadwar/hex';
import {
  analyzeFire,
  canRally,
  canRepair,
  carried,
  enemiesIn,
  exposureAt,
  fireOdds,
  hexTem,
  inMelee,
  isCover,
  isLeader,
  isOpenGround,
  leaderDrmFor,
  mfLeft,
  moraleOf,
  moveCost,
  objectiveStatus,
  oddsColumn,
  range,
  sideUnitsIn,
  squadType,
  stackingProblem,
  tryAction,
  unitLabel,
  unitsIn,
  weaponType,
  type Action,
  type Ctx,
  type FireAnalysis,
  type FireOdds,
  type FireUnit,
  type GameState,
  type Unit,
} from '@squadwar/engine';
import { chanceAtMost, hexId, leaderNote, objectiveNear, pct, stackName, terrainNote, unitList, type Decision, type Rationale } from './explain';

export interface BotOptions {
  /** Minimum expected casualties (broken-or-worse) before firing. */
  readonly fireThreshold?: number;
}

const END: Action = { type: 'endPhase' };

const end = (why: Rationale): Decision => ({ action: END, why });

/** The next action and why. */
export function decide(ctx: Ctx, s: GameState, opts: BotOptions = {}): Decision {
  const side = s.awaiting;
  switch (s.phase) {
    case 'setup':
      return end({ goal: 'Deploy as the scenario suggests', reasons: ['The bot keeps the scenario’s suggested setup inside its setup zone.'], weight: 'routine' });
    case 'rout':
      return end({
        goal: 'Let broken units rout',
        reasons: ['Broken units in the open or next to the enemy must rout to cover; the engine picks each legal route (§13.2–13.47).'],
        weight: 'routine',
      });
    case 'closeCombat':
      return end({
        goal: 'Resolve close combat',
        reasons: ['Every unit in a melee hex attacks; both sides roll at once and results are simultaneous (§20.2–20.3).'],
        weight: 'routine',
      });
    case 'rally':
      return rallyDecision(ctx, s, side) ?? end({ goal: 'Finish the Rally Phase', reasons: ['No broken unit has a leader to rally it, and no weapon needs repair.'], weight: 'routine' });
    case 'prepFire':
      return fireDecision(ctx, s, side, opts.fireThreshold ?? 0.35, true);
    case 'defensiveFire':
      return fireDecision(ctx, s, side, opts.fireThreshold ?? 0.12, false);
    case 'advancingFire':
      return fireDecision(ctx, s, side, 0.05, false);
    case 'movement':
      return moveDecision(ctx, s, side) ?? end({ goal: 'Finish movement', reasons: ['Every group has moved or chosen to stay.'], weight: 'routine' });
    case 'advance':
      return advanceDecision(ctx, s, side);
    default:
      return end({ goal: 'End the phase', reasons: [], weight: 'routine' });
  }
}

/** The next action only. */
export function chooseAction(ctx: Ctx, s: GameState, opts: BotOptions = {}): Action {
  return decide(ctx, s, opts).action;
}

function legal(ctx: Ctx, s: GameState, a: Action): boolean {
  return tryAction(ctx, s, a).ok;
}

// ---- Rally ---------------------------------------------------------------------------

function rallyDecision(ctx: Ctx, s: GameState, side: string): Decision | undefined {
  for (const w of Object.values(s.weapons)) {
    if (w.side === side && !canRepair(ctx, s, w.id)) {
      const name = weaponType(ctx, w).name;
      return {
        action: { type: 'repair', weapon: w.id },
        why: {
          goal: `Get the ${name} in ${hexId(ctx, w.hex)} working again`,
          reasons: [`A malfunctioned weapon can’t fire. A repair roll of 1 fixes it, a 6 loses it for good (§18.2): 1 in 6 either way, so trying costs nothing.`],
          tip: 'Machine guns give a squad much more firepower. Repair them every Rally Phase until they work.',
          weight: 'routine',
          focus: { from: w.hex },
        },
      };
    }
  }
  for (const u of Object.values(s.units)) {
    if (u.side === side && !canRally(ctx, s, u.id)) {
      const { drm, leader } = leaderDrmFor(ctx, s, u.hex, u.side, u.id);
      const base = moraleOf(ctx, u);
      const need = u.dm ? base - ctx.data.tables.desperationMorale : base;
      const p = chanceAtMost(need, drm);
      return {
        action: { type: 'rally', unit: u.id },
        why: {
          goal: `Rally ${unitLabel(ctx, u)} in ${hexId(ctx, u.hex)}`,
          reasons: [
            `Needs ${need} or less on two dice${drm ? ` with ${leader ? unitLabel(ctx, leader) : 'the leader'}’s ${drm} DRM` : ''} (§14.2): ${pct(p)} chance.`,
            ...(u.dm ? [`It was fired on since the last Rally Phase, so it rallies at desperation morale (§14.6).`] : []),
            'A roll of 12 costs a casualty (§18.3), but a broken unit is no use to anyone: it can’t fire or hold a building.',
          ],
          tip: 'Leaders are what bring broken squads back (§14.1). Keep a leader near the line, out of the worst fire.',
          weight: 'key',
          focus: { from: u.hex },
        },
      };
    }
  }
  return undefined;
}

// ---- Fire ----------------------------------------------------------------------------

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

interface FireOption {
  readonly a: Action & { type: 'fire' };
  readonly score: number;
  readonly from: HexKey;
  readonly target: HexKey;
  readonly an: FireAnalysis;
  readonly odds: FireOdds;
}

function fireDecision(ctx: Ctx, s: GameState, side: string, threshold: number, isPrep: boolean): Decision {
  const myHexes = [...new Set(Object.values(s.units).filter((u) => u.side === side).map((u) => u.hex))];
  const targets = new Set<HexKey>();
  for (const u of Object.values(s.units)) if (u.side !== side) targets.add(u.hex);
  if (s.phase === 'defensiveFire') for (const steps of Object.values(s.tracks)) for (const st of steps) targets.add(st.hex);
  const options: FireOption[] = [];
  let heldBack = 0;
  for (const h of myHexes) {
    if (inMelee(s, h)) continue;
    let firers = hexFirers(ctx, s, h, side);
    if (!firers.length) continue;
    // In Prep Fire only a fire base fires: heavy-weapon crews (the rest move),
    // or stacks already next to their objective.
    if (isPrep) {
      if (!shouldPrepFire(ctx, s, h, side)) {
        heldBack++;
        continue;
      }
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
        options.push({ a: { type: 'fire', firers: usable, target: t, ...(leader ? { leader } : {}) }, score, from: h, target: t, an, odds });
      } catch {
        // Not a legal attack; try the next target.
      }
    }
  }
  // Highest score first; ties keep the search order (first found wins).
  const ranked = options.map((o, i) => ({ o, i })).sort((x, y) => y.o.score - x.o.score || x.i - y.i).map((x) => x.o);
  const best = ranked[0];
  if (best && best.score > threshold && legal(ctx, s, best.a)) return { action: best.a, why: explainFire(ctx, s, side, best, ranked.slice(1), threshold, isPrep) };
  return end(explainHoldFire(ctx, s, best, threshold, isPrep, heldBack));
}

function explainFire(ctx: Ctx, s: GameState, side: string, o: FireOption, others: FireOption[], threshold: number, isPrep: boolean): Rationale {
  const firerUnits = o.a.firers.map((f) => s.units[f.unit]!);
  const weapons = o.a.firers.flatMap((f) => f.weapons.map((w) => weaponType(ctx, s.weapons[w]!).name));
  const enemies = unitsIn(s, o.target).filter((u) => u.side !== side);
  const moving = s.phase === 'defensiveFire' && Object.values(s.tracks).some((st) => st.some((x) => x.hex === o.target));
  const tem = hexTem(ctx, o.target);
  const enemyOdds = o.odds.units.filter((x) => s.units[x.unit]!.side !== side);
  const anyBreak = 1 - enemyOdds.reduce((acc, x) => acc * (1 - x.breakOrWorse), 1);
  const kia = Math.max(0, ...enemyOdds.map((x) => x.kia));
  const objective = objectiveNear(ctx, o.target);
  const goal =
    s.phase === 'defensiveFire'
      ? moving
        ? `Catch the enemy moving through ${hexId(ctx, o.target)}`
        : `Hit the enemy in ${hexId(ctx, o.target)}`
      : s.phase === 'advancingFire'
        ? `Weaken ${hexId(ctx, o.target)} before close combat`
        : objective
          ? `Soften up the ${objective} at ${hexId(ctx, o.target)} before the assault`
          : `Pin down the enemy in ${hexId(ctx, o.target)}`;
  const reasons = [
    `${unitList(ctx, firerUnits)}${weapons.length ? ` with ${weapons.join(' and ')}` : ''} in ${hexId(ctx, o.from)} fire ${fmt(o.an.totalFp)} FP → the ${o.an.columnFp} column (§10.3).`,
    ...(o.an.leader ? [`${unitLabel(ctx, s.units[o.an.leader]!)} directs the fire: ${drmText(o.an.leaderDrm)} DRM (§15.2).`] : []),
    `Target: ${unitList(ctx, enemies)} in ${terrainNote(ctx, o.target)}${moving && isOpenGround(ctx, o.target) ? `, moving in the open: ${drmText(ctx.data.tables.tem.movingInOpen)} DRM (§16.5)` : ''}.`,
    ...(enemies.some((u) => u.broken) ? ['Broken units that fail a morale check are eliminated (§13.6), so even a weak attack on them counts.'] : []),
    `${pct(anyBreak)} chance to break or kill at least one unit${kia >= 0.01 ? `, ${pct(kia)} chance of a kill` : ''}; expected units broken or worse: ${o.score.toFixed(2)}.`,
    ...(o.odds.breakdown > 0 ? [`Breakdown risk for the machine gun: ${pct(o.odds.breakdown)} (§18.1).`] : []),
  ];
  const alternatives = others.slice(0, 2).map((x) => `${stackName(ctx, s, x.from, side)} in ${hexId(ctx, x.from)} at ${hexId(ctx, x.target)}: expected ${x.score.toFixed(2)}.`);
  if (!alternatives.length) alternatives.push(`Holding fire. It fires when the expected result is above ${threshold} for this phase.`);
  let tip: string;
  if (moving && isOpenGround(ctx, o.target)) tip = 'Defensive fire is deadliest against units crossing open ground: they get no TEM and suffer −2 more (§16.5). Cover your own moves the same way.';
  else if (tem.drm >= 2) tip = `Buildings protect well (+${tem.drm} TEM). More firepower moves the attack to a stronger IFT column, which offsets cover.`;
  else if (o.an.leader) tip = 'A good leader’s negative DRM is worth as much as a bigger fire group: keep leaders with your main firepower.';
  else if (isPrep) tip = 'Units that fire in Prep Fire can’t move this turn. Fire with heavy weapons that can’t move far anyway, or with units already in position.';
  else tip = 'Fire at the weakest cover you can see: TEM changes the result more than a column or two of firepower.';
  return { goal, reasons, alternatives, tip, weight: 'key', focus: { from: o.from, to: o.target } };
}

function explainHoldFire(ctx: Ctx, s: GameState, best: FireOption | undefined, threshold: number, isPrep: boolean, heldBack: number): Rationale {
  const reasons: string[] = [];
  if (best) reasons.push(`The best shot left, ${hexId(ctx, best.from)} at ${hexId(ctx, best.target)}, expects ${best.score.toFixed(2)} units broken: below the ${threshold} bar for this phase.`);
  else reasons.push('No unit that can still fire has a target in range and line of sight.');
  if (isPrep && heldBack) reasons.push(`${heldBack} stack${heldBack === 1 ? ' holds' : 's hold'} fire so ${heldBack === 1 ? 'it' : 'they'} can move this turn (units that Prep Fire can’t move).`);
  return {
    goal: isPrep ? 'Save the rest of the force for movement' : 'Hold fire',
    reasons,
    ...(isPrep ? { tip: 'Prep Fire or move: each unit gets one or the other. Attackers usually move most units and keep a fire base.' } : {}),
    weight: 'routine',
  };
}

function drmText(n: number): string {
  return n < 0 ? `−${-n}` : `+${n}`;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
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

// ---- Movement --------------------------------------------------------------------------

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

function moveDecision(ctx: Ctx, s: GameState, side: string): Decision | undefined {
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
    const who = unitList(ctx, group);
    const continuing = s.moving.length > 0 && ids.includes(s.moving[0]!);
    const stay = (goal: string, reasons: string[], weight: Rationale['weight'] = 'routine', tip?: string): Decision => ({
      action: { type: 'endMove', units: ids },
      why: { goal, reasons, weight, focus: { from: h }, ...(tip ? { tip } : {}) },
    });
    const goal = groupGoal(ctx, s, side, h, attacker);
    if (!goal) {
      const obj = objectiveNear(ctx, h);
      if (attacker) {
        return stay(
          obj ? `Hold the ${obj}` : `Hold ${hexId(ctx, h)}, ready to assault`,
          [obj ? `${who} already stand in the ${obj}.` : `${hexId(ctx, h)} is next to an enemy-held objective hex: the Advance Phase can take them in.`],
          continuing ? 'routine' : 'key',
        );
      }
      return stay(obj ? `Hold the ${obj}` : `Hold ${hexId(ctx, h)}`, [obj ? `${who} defend the ${obj}; leaving would hand it to the attacker.` : 'No objective needs this group.']);
    }
    const path = pathTo(ctx, s, h, goal, side);
    const next = path?.[0];
    if (!next || enemiesIn(s, next, side).length) return stay(`Stay in ${hexId(ctx, h)}`, ['No route to the goal that avoids enemy-held hexes.']);
    const dest = path![path!.length - 1]!;
    const destName = objectiveNear(ctx, dest) ?? objectiveNear(ctx, nearestObjectiveHex(ctx, s, side, dest) ?? dest);
    const aim = attacker
      ? enemiesIn(s, dest, side).length || goalIsAssault(ctx, s, side, dest)
        ? `Close in on the enemy-held ${destName ?? hexId(ctx, dest)} for an assault`
        : `Take the ${destName ?? `objective at ${hexId(ctx, dest)}`}`
      : `Reinforce the ${destName ?? hexId(ctx, dest)}`;
    // Bound from cover to cover: only set off if the group can reach a hex
    // that is in cover or unseen by the enemy this phase.
    const safe = reachesSafeStop(ctx, s, side, h, path!, group);
    if (!safe.ok) {
      const e = exposureAt(ctx, s, side, next);
      return stay(
        `Wait in cover at ${hexId(ctx, h)}`,
        [
          `The route to the ${destName ?? hexId(ctx, dest)} runs over open ground the enemy can see, and no hex in reach this phase is safe.`,
          `Stepping into ${hexId(ctx, next)} risks a ${pct(e.pBreak)} chance of breaking under defensive fire from ${e.shooters} stack${e.shooters === 1 ? '' : 's'}.`,
        ],
        'key',
        'Move from cover to cover. End every move where the enemy can’t see you or where terrain protects you; crossing open ground in view invites −2 defensive fire (§16.5).',
      );
    }
    // Slow units (heavy weapons) stay as a fire base when far from the goal.
    const minLeft = Math.min(...group.map((u) => mfLeft(ctx, s, u)));
    const mc = moveCost(ctx, h, next);
    const cost = mc.mf;
    if (cost > minLeft + 1e-9) {
      // Split off whoever can still go on, or stop.
      const able = group.filter((u) => mfLeft(ctx, s, u) >= cost);
      if (able.length && able.length < group.length) {
        const split: Action = { type: 'move', units: able.map((u) => u.id), to: next };
        const r = tryAction(ctx, s, split);
        if (r.ok && !stackingProblem(ctx, r.state, next, side)) {
          const slow = group.filter((u) => !able.includes(u));
          return {
            action: split,
            why: {
              goal: `Split the stack: ${unitList(ctx, able)} press on`,
              reasons: [
                `Entering ${hexId(ctx, next)} costs ${fmt(cost)} MF; ${unitList(ctx, slow)} ${slow.length === 1 ? 'has' : 'have'} only ${fmt(Math.min(...slow.map((u) => mfLeft(ctx, s, u))))} MF left.`,
                'The faster units keep going; the slower ones stay as a fire base.',
              ],
              ...(slow.some((u) => carried(s, u).some((w) => weaponType(ctx, w).portage >= 3))
                ? { tip: 'Heavy weapons are slow to carry (portage, §5.7): crews with them often stay behind as the fire base.' }
                : {}),
              weight: 'key',
              focus: { from: h, to: next, path: path!, goal: dest },
            },
          };
        }
      }
      return stay(`Stop in ${hexId(ctx, h)}`, [`Entering ${hexId(ctx, next)} costs ${fmt(cost)} MF, but the group has ${fmt(minLeft)} MF left.`]);
    }
    // Do not end overstacked: look ahead one step.
    const a: Action = { type: 'move', units: ids, to: next };
    const r = tryAction(ctx, s, a);
    if (!r.ok) return stay(`Stop in ${hexId(ctx, h)}`, [`Can’t enter ${hexId(ctx, next)}: ${r.error}`]);
    // Never enter a hex where the group would be overstacked (§6.1).
    const over = stackingProblem(ctx, r.state, next, side);
    if (over) return stay(`Stop in ${hexId(ctx, h)}`, [`Entering ${hexId(ctx, next)} would put ${over} in one hex (stacking, §6.1).`]);
    const e = exposureAt(ctx, s, side, next);
    const total = routeCost(ctx, h, path!);
    const reasons = [
      `${continuing ? 'Next step' : `${who} set off`}: ${hexId(ctx, h)} → ${hexId(ctx, next)} for ${fmt(cost)} MF (${mc.parts.join(', ')}), leaving ${fmt(minLeft - cost)} MF.`,
      `Route to ${hexId(ctx, dest)}: ${path!.map((x) => hexId(ctx, x)).join(' → ')} (${fmt(total)} MF in all).`,
      isCover(ctx, next)
        ? `${hexId(ctx, next)} is ${terrainNote(ctx, next)}: cover against defensive fire.`
        : e.shooters
          ? `${hexId(ctx, next)} is open and in view of ${e.shooters} enemy stack${e.shooters === 1 ? '' : 's'}: ${pct(e.pBreak)} chance a squad breaks there.`
          : `${hexId(ctx, next)} is open, but no enemy can see it.`,
      ...(safe.why ? [safe.why] : []),
    ];
    const ldr = leaderNote(ctx, group);
    let tip: string | undefined;
    if (mc.parts.some((p) => p.includes('road'))) tip = 'Along a road each hex costs only ½ MF (§5.52): fast, but roads are usually open ground.';
    else if (ldr && group.length > 1) tip = `Squads moving with a leader get +${ctx.data.tables.movement.leaderBonus} MF (§5.44), and ${ldr} can rally them if they break.`;
    else if (!isCover(ctx, next) && e.shooters) tip = 'Every hex entered in view of the enemy can draw defensive fire at that hex (§16.1–16.3).';
    return {
      action: a,
      why: { goal: aim, reasons, ...(tip ? { tip } : {}), weight: continuing ? 'routine' : 'key', focus: { from: h, to: next, path: path!, goal: dest } },
    };
  }
  return undefined;
}

function routeCost(ctx: Ctx, from: HexKey, path: readonly HexKey[]): number {
  let at = from;
  let total = 0;
  for (const h of path) {
    total += moveCost(ctx, at, h).mf;
    at = h;
  }
  return total;
}

/** True when the goal hex is an assault position next to an enemy-held objective. */
function goalIsAssault(ctx: Ctx, s: GameState, side: string, hex: HexKey): boolean {
  if (ctx.objectives.some((o) => o.hexes.includes(hex))) return false;
  return DIRECTIONS.some((d) => {
    const n = hexKey(neighbor(parseHexKey(hex), d));
    return ctx.objectives.some((o) => o.hexes.includes(n)) && enemiesIn(s, n, side).length > 0;
  });
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

function reachesSafeStop(ctx: Ctx, s: GameState, side: string, from: HexKey, path: HexKey[], group: Unit[]): { ok: boolean; why?: string } {
  if (exposed(ctx, s, side, from)) return { ok: true, why: `Already in the open in view of the enemy: staying is no safer than moving on.` };
  const turnsLeft = ctx.scenario.turns - s.turn;
  if (turnsLeft <= 2) return { ok: true, why: `Only ${turnsLeft} turn${turnsLeft === 1 ? '' : 's'} left after this one: no time for caution.` };
  const squads = group.filter((u) => !isLeader(ctx, u)).length;
  if (squads >= 2 && group.some((u) => isLeader(ctx, u))) return { ok: true, why: 'A led group of two or more squads pushes on: it can absorb fire and rally its own broken units.' };
  let left = Math.min(...group.map((u) => mfLeft(ctx, s, u)));
  let at = from;
  for (const h of path) {
    const c = moveCost(ctx, at, h).mf;
    if (c > left + 1e-9) break;
    left -= c;
    at = h;
    if (!exposed(ctx, s, side, h)) return { ok: true, why: `It can reach ${hexId(ctx, h)} this phase, which is in cover or out of enemy sight.` };
  }
  return { ok: false };
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

// ---- Advance -------------------------------------------------------------------------

function ccStrength(ctx: Ctx, s: GameState, units: Unit[], attacking: boolean): number {
  return units.reduce((acc, u) => {
    const st = squadType(ctx, u);
    if (!st) return acc;
    let fp = st.fp;
    if (attacking) for (const w of carried(s, u)) if (weaponType(ctx, w).kind === 'LMG' && !w.malfunctioned) fp += weaponType(ctx, w).fp;
    return acc + fp;
  }, 0);
}

function advanceDecision(ctx: Ctx, s: GameState, side: string): Decision {
  const attacker = ctx.scenario.victory.side === side;
  const cc = ctx.data.tables.closeCombat;
  const need = attacker ? 4 : 5; // 3-2 for attackers, 2-1 for defenders
  const hexes = [...new Set(Object.values(s.units).filter((u) => u.side === side).map((u) => u.hex))];
  const declined: string[] = [];
  for (const h of hexes) {
    if (inMelee(s, h)) continue;
    const group = sideUnitsIn(s, h, side).filter((u) => !u.broken && !u.advanced);
    if (!group.length) continue;
    const portable = group.filter((u) => {
      const pp = carried(s, u).reduce((a, w) => a + weaponType(ctx, w).portage, 0);
      return pp <= (isLeader(ctx, u) ? 3 : 5);
    });
    if (!portable.length) continue;
    const ids = portable.map((u) => u.id);
    const who = unitList(ctx, portable);
    const A = ccStrength(ctx, s, portable, true);
    const withLmg = portable.some((u) => carried(s, u).some((w) => weaponType(ctx, w).kind === 'LMG' && !w.malfunctioned));
    for (const d of DIRECTIONS) {
      const n = hexKey(neighbor(parseHexKey(h), d));
      if (!ctx.map.hexes[n]) continue;
      const foes = enemiesIn(s, n, side).filter((u) => !u.broken);
      const D = Math.max(1, ccStrength(ctx, s, foes, false));
      const anyEnemy = enemiesIn(s, n, side).length > 0;
      const a: Action = { type: 'advance', units: ids, to: n };
      if (anyEnemy && !foes.length) {
        if (legal(ctx, s, a)) {
          return {
            action: a,
            why: {
              goal: `Overrun the broken enemy in ${hexId(ctx, n)}`,
              reasons: [`Only broken units hold ${hexId(ctx, n)}: ${unitList(ctx, enemiesIn(s, n, side))}.`, `Broken units in a close combat hex are eliminated (§20.9), so ${who} take the hex for free.`],
              tip: 'Broken units are easy prey: advancing into them removes them without a fight.',
              weight: 'key',
              focus: { from: h, to: n },
            },
          };
        }
      }
      if (foes.length) {
        const col = oddsColumn(ctx, A, D);
        const kill = cc.kill[col]!;
        if (col >= need) {
          if (legal(ctx, s, a)) {
            const back = oddsColumn(ctx, D, Math.max(1, ccStrength(ctx, s, portable, false)));
            return {
              action: a,
              why: {
                goal: `Assault ${hexId(ctx, n)}${objectiveNear(ctx, n) ? `, part of the ${objectiveNear(ctx, n)}` : ''}`,
                reasons: [
                  `${who} (${A} FP${withLmg ? ' with LMGs, §20.5' : ''}) against ${unitList(ctx, foes)} (${D} FP): ${cc.labels[col]} odds, kill on ${kill} or less (§20.3): ${pct(chanceAtMost(kill))}.`,
                  `Their counterattack is at ${cc.labels[back]} odds: ${pct(chanceAtMost(cc.kill[back]!))} to kill ours. Both are rolled at once (§20.2).`,
                  `The bot assaults at ${cc.labels[need]} or better as the ${attacker ? 'attacker' : 'defender'}.`,
                ],
                tip: 'Close combat ignores terrain (§20): it is how infantry takes a stone building that fire can’t crack.',
                weight: 'key',
                focus: { from: h, to: n },
              },
            };
          }
        } else declined.push(`${hexId(ctx, h)} → ${hexId(ctx, n)}: ${cc.labels[col]} odds (${A} vs ${D}), below the ${cc.labels[need]} the bot wants.`);
      } else if (attacker && unitsIn(s, n).length === 0) {
        // Step into an empty objective hex, or from the open into cover closer to one.
        const goal = nearestObjectiveHex(ctx, s, side, h);
        const obj = objectiveNear(ctx, n);
        const better = goal !== undefined && range(n, goal) < range(h, goal) && isCover(ctx, n) && !isCover(ctx, h);
        if ((obj || better) && legal(ctx, s, a)) {
          return {
            action: a,
            why: obj
              ? {
                  goal: `Occupy ${hexId(ctx, n)} in the ${obj}`,
                  reasons: [`${hexId(ctx, n)} is empty. A building counts as controlled when your unbroken unit is in it and no enemy is (scenario rules).`],
                  weight: 'key',
                  focus: { from: h, to: n },
                }
              : {
                  goal: `Step into cover at ${hexId(ctx, n)}`,
                  reasons: [`${hexId(ctx, h)} is ${terrainNote(ctx, h)}; ${hexId(ctx, n)} is ${terrainNote(ctx, n)} and one hex closer to the objective.`],
                  tip: 'The Advance Phase moves one hex without drawing defensive fire: use it to get out of the open before the enemy’s turn.',
                  weight: 'key',
                  focus: { from: h, to: n },
                },
          };
        }
      }
    }
  }
  return end({
    goal: 'Stay put',
    reasons: declined.length ? ['No assault at good enough odds.'] : ['Nothing to assault or occupy next to our units.'],
    ...(declined.length ? { alternatives: declined.slice(0, 3) } : {}),
    weight: 'routine',
  });
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
