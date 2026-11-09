import {
  canRally,
  canRepair,
  carried,
  pendingRouts,
  range,
  routOptions,
  squadType,
  weaponType,
  type Ctx,
  type GameState,
} from '@squadwar/engine';

/** Why Assisted mode may end the current phase for a human, or undefined if there is a decision to make. */
export function autoSkipReason(ctx: Ctx, s: GameState): string | undefined {
  const side = s.awaiting;
  switch (s.phase) {
    case 'rally': {
      const any =
        Object.values(s.units).some((u) => u.side === side && !canRally(ctx, s, u.id)) ||
        Object.values(s.weapons).some((w) => w.side === side && !canRepair(ctx, s, w.id));
      return any ? undefined : 'nothing to rally or repair';
    }
    case 'prepFire':
    case 'defensiveFire':
    case 'advancingFire': {
      const targets = new Set(Object.values(s.units).filter((u) => u.side !== side).map((u) => u.hex));
      if (s.phase === 'defensiveFire') for (const steps of Object.values(s.tracks)) for (const st of steps) targets.add(st.hex);
      for (const u of Object.values(s.units)) {
        if (u.side !== side || u.broken || (u.firedPhase && u.firedPhase !== s.phase)) continue;
        if (s.phase === 'prepFire' && u.berserk) continue;
        const st = squadType(ctx, u);
        const reach = Math.max(st && !u.usedInherent ? st.range * 2 : 0, ...carried(s, u).filter((w) => !w.malfunctioned && !w.usedThisTurn).map((w) => weaponType(ctx, w).range * 2));
        if (!reach) continue;
        for (const t of targets) if (range(u.hex, t) <= reach && ctx.los(u.hex, t).clear) return undefined;
      }
      return 'no targets in sight';
    }
    case 'rout': {
      const pending = pendingRouts(ctx, s, side);
      return pending.every((u) => routOptions(ctx, s, u).length <= 1) ? (pending.length ? 'routs made by the only legal routes' : 'no broken units must rout') : undefined;
    }
    case 'closeCombat':
      return 'close combat attacks with everyone at the best odds';
    default:
      return undefined;
  }
}
