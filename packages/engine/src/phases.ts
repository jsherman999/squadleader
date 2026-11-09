/** Sequence of play (§4; Advanced Sequence of Play p. 41). */
import type { Ctx } from './ctx';
import { allUnits, hexLabel, otherSide, stackingProblem } from './queries';
import { PHASE_NAMES, RuleError, type GameState, type SideId } from './types';
import { berserkAdvance, berserkMovement } from './rules/advance';
import { autoPlan, ccHexes, purgeBrokenInMelee, resolveCloseCombat } from './rules/closeCombat';
import type { Emit } from './rules/common';
import { doRout, pendingRouts } from './rules/rout';
import { evaluateVictory } from './rules/victory';
import { armCharges, clearSmoke, expireCharges, gainConcealment, returnLostUnits, revealAdjacent, setupConcealment } from './rules/special';
import { displaceOverrun, endFirePhase, resetVehicles, resolveAfvAssaults } from './rules/armor';
import { clearStarshells, rollNightVisibility, rotateFlashes } from './rules/night';
import { endRally, fireForEffect, spottingRounds } from './rules/artillery';
import { burnMist, escapeFires, rollLanding, spreadFires } from './rules/western';

export function sideName(s: GameState, id: SideId): string {
  return s.sides.find((x) => x.id === id)?.name ?? id;
}

function announce(s: GameState, emit: Emit): void {
  emit({
    kind: 'phase',
    text: `Turn ${s.turn} · ${sideName(s, s.phasing)} ${PHASE_NAMES[s.phase]}`,
    side: s.phasing,
  });
}

/** Reset per-player-turn markers and begin the Rally Phase. */
export function startPlayerTurn(ctx: Ctx, s: GameState, emit: Emit): void {
  for (const u of Object.values(s.units)) {
    u.firedPhase = null;
    u.usedInherent = false;
    u.moved = false;
    u.mfSpent = 0;
    u.ppUsed = 0;
    u.withLeader = null;
    u.moveDone = false;
    u.directed = false;
    u.rallyTried = false;
    u.routed = false;
    u.advanced = false;
    u.noConceal = false;
    u.smokeMade = false;
    u.sewerAssault = false;
    u.debarked = false;
  }
  for (const w of Object.values(s.weapons)) {
    w.usedThisTurn = false;
    w.repairTried = false;
  }
  resetVehicles(s);
  rotateFlashes(s);
  burnMist(ctx, s, emit);
  s.tracks = {};
  s.moving = [];
  s.attacks = [];
  s.ccPlans = {};
  s.afvAssaults = [];
  s.phase = 'rally';
  s.awaiting = s.phasing;
  announce(s, emit);
  void ctx;
}

function endPlayerTurn(ctx: Ctx, s: GameState, emit: Emit): void {
  gainConcealment(ctx, s, emit);
  clearStarshells(s);
  if (s.half === 0) {
    s.half = 1;
    s.phasing = otherSide(s, ctx.scenario.moveFirst);
  } else {
    s.turn++;
    s.half = 0;
    s.phasing = ctx.scenario.moveFirst;
    if (s.turn > ctx.scenario.turns) {
      const v = evaluateVictory(ctx, s);
      s.phase = 'gameOver';
      s.winner = v.winner;
      s.result = v.text;
      emit({ kind: 'gameOver', text: v.text });
      return;
    }
  }
  startPlayerTurn(ctx, s, emit);
}

/** Problems that prevent ending the current phase (e.g. overstacking, §6.3). */
export function phaseBlockers(ctx: Ctx, s: GameState): string[] {
  const out: string[] = [];
  if (s.phase === 'movement' || s.phase === 'setup') {
    const side = s.awaiting;
    // In the Movement Phase, the stacks the moving player made this phase (§6.3).
    const hexes =
      s.phase === 'setup'
        ? new Set(allUnits(s, side).map((u) => u.hex))
        : new Set(allUnits(s, side).filter((u) => u.mfSpent > 0).map((u) => u.hex));
    for (const h of hexes) {
      const p = stackingProblem(ctx, s, h, side);
      if (p) out.push(`${hexLabel(ctx, h)}: ${p} (§6.1)`);
    }
    // One vehicle per hex at the end of movement (§29.1, §30.8).
    for (const v of Object.values(s.vehicles)) {
      if (v.side !== side || (s.phase === 'movement' && !v.moved)) continue;
      if (Object.values(s.vehicles).some((o) => o.id !== v.id && o.hex === v.hex)) out.push(`${hexLabel(ctx, v.hex)}: two vehicles may not end in one hex (§29.1)`);
    }
  }
  return out;
}

export function endPhase(ctx: Ctx, s: GameState, emit: Emit): void {
  const blockers = phaseBlockers(ctx, s);
  if (blockers.length) throw new RuleError(`Fix stacking first — ${blockers.join('; ')}`, '§6.3');
  const other = otherSide(s, s.phasing);
  switch (s.phase) {
    case 'setup': {
      setupConcealment(ctx, s, s.awaiting, emit);
      s.setupDone.push(s.awaiting);
      const next = s.sides.find((x) => !s.setupDone.includes(x.id));
      if (next) {
        s.awaiting = next.id;
        emit({ kind: 'phase', text: `${next.name} sets up` });
        return;
      }
      s.turn = 1;
      s.half = 0;
      s.phasing = ctx.scenario.moveFirst;
      startPlayerTurn(ctx, s, emit);
      return;
    }
    case 'rally':
      if (s.awaiting === s.phasing) {
        s.awaiting = other;
        return;
      }
      for (const u of Object.values(s.units)) u.dm = false; // §14.6
      rollNightVisibility(ctx, s, emit);
      endRally(s, emit);
      s.phase = 'prepFire';
      s.awaiting = s.phasing;
      s.attacks = [];
      announce(s, emit);
      clearSmoke(ctx, s, s.phasing, emit);
      fireForEffect(ctx, s, s.phasing, emit);
      return;
    case 'prepFire':
      endFirePhase(s, 'prepFire');
      s.phase = 'movement';
      s.attacks = [];
      announce(s, emit);
      returnLostUnits(ctx, s, emit);
      rollLanding(ctx, s, emit);
      berserkMovement(ctx, s, emit);
      return;
    case 'movement':
      for (const id of s.moving) if (s.units[id]) s.units[id]!.moveDone = true;
      s.moving = [];
      s.phase = 'defensiveFire';
      s.awaiting = other;
      s.attacks = [];
      announce(s, emit);
      fireForEffect(ctx, s, other, emit);
      return;
    case 'defensiveFire':
      endFirePhase(s, 'defensiveFire');
      displaceOverrun(ctx, s, emit);
      s.phase = 'advancingFire';
      s.awaiting = s.phasing;
      s.attacks = [];
      revealAdjacent(ctx, s, emit);
      announce(s, emit);
      armCharges(ctx, s, emit);
      return;
    case 'advancingFire':
      endFirePhase(s, 'advancingFire');
      expireCharges(ctx, s, emit);
      spreadFires(ctx, s, emit);
      s.phase = 'rout';
      s.awaiting = s.phasing;
      for (const u of Object.values(s.units)) u.routed = false;
      announce(s, emit);
      escapeFires(ctx, s, emit);
      return;
    case 'rout':
      // Mandatory routs not made by hand take the first cheapest route (§13.43).
      for (const u of pendingRouts(ctx, s, s.awaiting)) if (s.units[u.id]) doRout(ctx, s, u.id, undefined, emit);
      if (s.awaiting === s.phasing) {
        s.awaiting = other;
        return;
      }
      s.phase = 'advance';
      s.awaiting = s.phasing;
      announce(s, emit);
      return;
    case 'advance':
      berserkAdvance(ctx, s, emit);
      revealAdjacent(ctx, s, emit);
      spottingRounds(ctx, s, emit);
      s.phase = 'closeCombat';
      s.awaiting = s.phasing;
      purgeBrokenInMelee(ctx, s, emit);
      if (!ccHexes(s).length && !s.afvAssaults.length) {
        endPlayerTurn(ctx, s, emit);
        return;
      }
      announce(s, emit);
      return;
    case 'closeCombat':
      for (const h of ccHexes(s)) {
        const plans = (s.ccPlans[s.awaiting] ??= {});
        plans[h] ??= autoPlan(ctx, s, s.awaiting, h);
      }
      if (s.awaiting === s.phasing) {
        s.awaiting = other;
        return;
      }
      resolveAfvAssaults(ctx, s, emit);
      resolveCloseCombat(ctx, s, emit);
      endPlayerTurn(ctx, s, emit);
      return;
    case 'gameOver':
      throw new RuleError('The game is over');
  }
}
