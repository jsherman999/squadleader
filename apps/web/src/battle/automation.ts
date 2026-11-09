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
        Object.values(s.weapons).some((w) => w.side === side && !canRepair(ctx, s, w.id)) ||
        Object.values(s.vehicles).some((v) => v.side === side && !v.repairTried && (v.gun === 'malfunctioned' || v.mg === 'malfunctioned')) ||
        // Artillery and starshells are Rally Phase decisions (§46, §49.6).
        (s.batteries ?? []).some((b) => b.side === side && b.used < b.missions && (!b.tried || (b.contact && !b.acted))) ||
        (!!ctx.scenario.night && (s.starshellsLeft?.[side] ?? 0) > 0);
      return any ? undefined : 'nothing to rally or repair';
    }
    case 'prepFire':
    case 'defensiveFire':
    case 'advancingFire': {
      const targets = new Set(Object.values(s.units).filter((u) => u.side !== side).map((u) => u.hex));
      if (s.phase === 'defensiveFire') for (const steps of Object.values(s.tracks)) for (const st of steps) targets.add(st.hex);
      // Tanks, SP guns and AT guns with something in sight (§33).
      for (const v of Object.values(s.vehicles)) {
        if (v.side !== side || v.overran || (v.firedPhase && v.firedPhase !== s.phase)) continue;
        const foes = [...targets, ...Object.values(s.vehicles).filter((x) => x.side !== side).map((x) => x.hex)];
        if (foes.some((t) => range(v.hex, t) <= 24 && ctx.los(v.hex, t).clear)) return undefined;
      }
      for (const u of Object.values(s.units)) {
        if (u.side !== side || u.broken || (u.firedPhase && u.firedPhase !== s.phase)) continue;
        if (carried(s, u).some((w) => ['PF', 'BAZ', 'FT'].includes(weaponType(ctx, w).kind)) && Object.values(s.vehicles).some((x) => x.side !== side && range(u.hex, x.hex) <= 4)) return undefined;
        if (s.phase === 'prepFire' && u.berserk) continue;
        const st = squadType(ctx, u);
        const reach = Math.max(st && !u.usedInherent ? st.range * 2 : 0, ...carried(s, u).filter((w) => !w.malfunctioned && !w.usedThisTurn).map((w) => weaponType(ctx, w).range * 2));
        if (!reach) continue;
        for (const t of targets) if (range(u.hex, t) <= reach && ctx.los(u.hex, t).clear) return undefined;
      }
      // Squads caught in wire or next to a minefield they know of may clear it instead (§53.5, §55.5).
      if (s.phase === 'prepFire' && s.forts) {
        const f = s.forts;
        const known = f.mines.filter((m) => m.side === side || m.known).map((m) => m.hex);
        const work = Object.values(s.units).some((u) => u.side === side && !u.broken && !u.firedPhase && !u.riding && squadType(ctx, u) && (f.wire.includes(u.hex) || known.some((h) => range(h, u.hex) <= 1)));
        if (work) return undefined;
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
