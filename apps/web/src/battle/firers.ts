import type { HexKey } from '@squadwar/hex';
import { canOperateSpecial, carried, isLeader, leaderType, squadType, weaponType, type Ctx, type FireUnit, type GameState } from '@squadwar/engine';

const MG = new Set(['LMG', 'MMG', 'HMG']);

/** The natural fire contribution of each selected unit (inherent fire + MGs within §17.1). */
export function defaultFirers(ctx: Ctx, s: GameState, ids: readonly string[]): FireUnit[] {
  const out: FireUnit[] = [];
  for (const id of ids) {
    const u = s.units[id];
    if (!u || u.broken) continue;
    const st = squadType(ctx, u);
    // Flamethrowers fire alone and charges are placed, not fired: neither joins a fire group.
    const ws = carried(s, u).filter((w) => !w.malfunctioned && !w.usedThisTurn && MG.has(weaponType(ctx, w).kind));
    const heavy = s.phase === 'advancingFire' && u.ppUsed >= (st ? 4 : 2);
    const usable = heavy ? [] : ws;
    if (st) {
      const lmgs = usable.filter((w) => weaponType(ctx, w).kind === 'LMG');
      const pick = lmgs.length >= 2 ? lmgs.slice(0, 2) : usable.slice(0, 1);
      const inherent = !u.usedInherent;
      if (inherent || pick.length) out.push({ unit: id, inherent, weapons: pick.map((w) => w.id) });
    } else if (isLeader(ctx, u) && usable.length && ids.length === 1) {
      out.push({ unit: id, inherent: false, weapons: [usable[0]!.id] });
    }
  }
  return out;
}

/** The first selected unit's flamethrower, fired on its own (§22). */
export function flameFirers(ctx: Ctx, s: GameState, ids: readonly string[]): FireUnit[] {
  for (const id of ids) {
    const u = s.units[id];
    if (!u || u.broken || !canOperateSpecial(ctx, u)) continue;
    const ft = carried(s, u).find((w) => weaponType(ctx, w).kind === 'FT' && !w.malfunctioned && !w.usedThisTurn);
    if (ft) return [{ unit: id, inherent: false, weapons: [ft.id] }];
  }
  return [];
}

/** Best unused leader in the firers' hex (only for single-hex fire groups, §15.2). */
export function defaultLeader(ctx: Ctx, s: GameState, firers: readonly FireUnit[]): string | undefined {
  const hexes = new Set(firers.map((f) => s.units[f.unit]!.hex));
  if (hexes.size !== 1) return undefined;
  const hex: HexKey = [...hexes][0]!;
  let best: { id: string; drm: number } | undefined;
  for (const u of Object.values(s.units)) {
    if (u.hex !== hex || u.side !== s.awaiting || u.broken || u.directed) continue;
    if (firers.some((f) => f.unit === u.id)) continue;
    const lt = leaderType(ctx, u);
    if (lt && lt.leadership < 0 && (!best || lt.leadership < best.drm)) best = { id: u.id, drm: lt.leadership };
  }
  return best?.id;
}
