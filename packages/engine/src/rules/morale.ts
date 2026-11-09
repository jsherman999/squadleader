import type { HexKey } from '@squadwar/hex';
import type { Ctx } from '../ctx';
import type { IftResult } from '../data';
import { d6, roll2d6 } from '../rng';
import { hexLabel, isLeader, leaderDrmFor, sideUnitsIn, unitLabel, unitType } from '../queries';
import type { GameState, Unit } from '../types';
import { breakUnit, eliminate, type Emit } from './common';
import { fanaticDrm } from './special';

export type MoraleOutcome = 'pass' | 'broke' | 'eliminated' | 'berserk';

export interface MoraleOptions {
  /** Caused by enemy fire (Russian berserk applies only then, §18.4). */
  readonly enemyFire: boolean;
  /** Only another unbroken leader's DRM applies (leader-loss checks, §12.22). */
  readonly label: string;
}

export function moraleOf(ctx: Ctx, u: Unit): number {
  const t = unitType(ctx, u);
  if (t.kind === 'leader') return t.morale;
  return u.broken ? t.brokenMorale : t.morale;
}

/**
 * One morale check (§12.1): pass on 2d6 + MC number + leader DRM ≤ morale.
 * A leader never applies his own DRM (§12.4). Failing while broken eliminates (§13.6).
 */
export function moraleCheck(ctx: Ctx, s: GameState, u: Unit, mc: number, opts: MoraleOptions, emit: Emit): MoraleOutcome {
  if (u.berserk) {
    emit({ kind: 'morale', text: `${unitLabel(ctx, u)} is berserk and ignores the morale check (§18.41)`, units: [u.id], side: u.side });
    return 'pass';
  }
  const { drm, leader } = leaderDrmFor(ctx, s, u.hex, u.side, u.id);
  const fan = fanaticDrm(ctx, u);
  u.noConceal = true; // a morale check stops concealment this turn (§25.3)
  const [a, b] = roll2d6(s);
  const raw = a + b;
  const morale = moraleOf(ctx, u);
  const total = raw + mc + drm + fan;
  const trace = [
    `${opts.label}: dice ${a}+${b} = ${raw}${mc ? `, +${mc} MC` : ''}${drm ? `, ${drm > 0 ? '+' : ''}${drm} leader ${leader?.name ?? ''} (§15.6)` : ''}${fan ? ', −1 fanatic (§26)' : ''} → ${total} vs morale ${morale}${u.broken ? ' (broken side, §13.6)' : ''}`,
  ];

  if (raw === 2 && opts.enemyFire && unitType(ctx, u).nation === 'russian') {
    u.berserk = true;
    u.broken = false;
    emit({
      kind: 'berserk',
      text: `${unitLabel(ctx, u)} in ${hexLabel(ctx, u.hex)} rolls a 2 and goes BERSERK (§18.4)`,
      trace,
      units: [u.id],
      side: u.side,
      dice: [a, b],
      fx: { result: 'berserk' },
    });
    if (isLeader(ctx, u)) leaderBerserk(ctx, s, u, emit);
    return 'berserk';
  }

  if (total <= morale) {
    emit({ kind: 'morale', text: `${unitLabel(ctx, u)} passes (${total} ≤ ${morale})`, trace, units: [u.id], side: u.side, dice: [a, b], fx: { result: 'pass' } });
    return 'pass';
  }
  if (u.broken) {
    emit({ kind: 'morale', text: `${unitLabel(ctx, u)} fails (${total} > ${morale}) while broken`, trace, units: [u.id], side: u.side, dice: [a, b], fx: { result: 'failed' } });
    eliminate(ctx, s, u, 'failed a morale check while broken (§12.3)', emit);
    return 'eliminated';
  }
  emit({ kind: 'morale', text: `${unitLabel(ctx, u)} fails (${total} > ${morale})`, trace, units: [u.id], side: u.side, dice: [a, b], fx: { result: 'failed' } });
  if (u.sewerAssault) {
    eliminate(ctx, s, u, 'broke coming up from the sewer (§27.7C)', emit);
    return 'eliminated';
  }
  breakUnit(ctx, s, u, emit);
  return 'broke';
}

/** A berserk leader may take his stack with him (§18.5). */
function leaderBerserk(ctx: Ctx, s: GameState, leader: Unit, emit: Emit): void {
  const lt = unitType(ctx, leader);
  const ldrm = lt.kind === 'leader' ? lt.leadership : 0;
  for (const u of sideUnitsIn(s, leader.hex, leader.side)) {
    if (u.id === leader.id || u.broken || u.berserk) continue;
    const need = moraleOf(ctx, u) - ctx.data.tables.desperationMorale;
    const roll = d6(s) + d6(s);
    if (roll + ldrm <= need) {
      u.berserk = true;
      emit({ kind: 'berserk', text: `${unitLabel(ctx, u)} joins the berserk charge (${roll}${ldrm} ≤ ${need}, §18.5)`, units: [u.id], side: u.side });
    }
  }
}

export interface HexFireOutcome {
  readonly hex: HexKey;
  readonly results: readonly { readonly unit: string; readonly result: IftResult; readonly finalDr: number }[];
}

/**
 * Apply IFT results to the units of a hex: KIA first, then morale checks with
 * leaders first; each leader that fails forces one normal MC on every other
 * unit of his side in the hex checked after him, including units the fire
 * itself left unharmed (§8.8, §12.21, §12.22, Q&A 12.22).
 */
export function applyHexResults(ctx: Ctx, s: GameState, out: HexFireOutcome, emit: Emit): void {
  for (const r of out.results) {
    if (r.result !== 'KIA') continue;
    const u = s.units[r.unit];
    if (u) eliminate(ctx, s, u, `KIA result (final roll ${r.finalDr})`, emit);
  }
  const sides = new Set(out.results.map((r) => s.units[r.unit]?.side).filter((x): x is string => !!x));
  for (const side of sides) {
    const mine = out.results.filter((r) => s.units[r.unit]?.side === side);
    const mcs = mine.filter((r) => r.result !== '-' && r.result !== 'KIA');
    const unharmed = mine.filter((r) => r.result === '-');
    mcs.sort((a, b) => Number(isLeader(ctx, s.units[b.unit]!)) - Number(isLeader(ctx, s.units[a.unit]!)));
    let leaderFailures = 0;
    for (const r of mcs) {
      const u = s.units[r.unit];
      if (!u) continue;
      const leader = isLeader(ctx, u);
      const extra = leaderFailures;
      const mc = r.result === 'M' ? 0 : (r.result as number);
      const first = moraleCheck(ctx, s, u, mc, { enemyFire: true, label: r.result === 'M' ? 'Morale check' : `+${mc} morale check` }, emit);
      let failedAsLeader = leader && (first === 'broke' || first === 'eliminated');
      for (let i = 0; i < extra && s.units[u.id]; i++) {
        const o = moraleCheck(ctx, s, s.units[u.id]!, 0, { enemyFire: false, label: 'Leader-loss morale check (§12.22)' }, emit);
        if (leader && !failedAsLeader && (o === 'broke' || o === 'eliminated')) failedAsLeader = true;
      }
      if (failedAsLeader) leaderFailures++;
    }
    for (const r of unharmed) {
      for (let i = 0; i < leaderFailures && s.units[r.unit]; i++) {
        moraleCheck(ctx, s, s.units[r.unit]!, 0, { enemyFire: false, label: 'Leader-loss morale check (§12.22)' }, emit);
      }
    }
  }
}
