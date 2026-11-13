/**
 * Words for the bot's reasoning: what each decision tries to achieve and
 * why, in terms a learner can check against the rules. Shared helpers keep
 * the phrasing consistent across phases.
 */
import type { HexKey } from '@squadwar/hex';
import { DICE2, exitedOf, hexLabel, hexTem, isLeader, objectiveStatus, sideUnitsIn, unitLabel, type Action, type Ctx, type GameState, type Unit } from '@squadwar/engine';

export interface Rationale {
  /** What the decision is trying to achieve, in one line. */
  readonly goal: string;
  /** Why this option: numbers and rule references. */
  readonly reasons: readonly string[];
  /** Options weighed, and why they lost. */
  readonly alternatives?: readonly string[];
  /** A general lesson for the learner. */
  readonly tip?: string;
  /** Key decisions shape the game; routine ones (ending phases, follow-on steps) are filtered out by the tutor. */
  readonly weight: 'key' | 'routine';
  /** Hexes the explanation refers to, for highlighting. */
  readonly focus?: {
    readonly from?: HexKey;
    readonly to?: HexKey;
    readonly goal?: HexKey;
    readonly path?: readonly HexKey[];
  };
}

export interface Decision {
  readonly action: Action;
  readonly why: Rationale;
}

export const pct = (p: number): string => (p > 0 && p < 0.005 ? '<1%' : `${Math.round(p * 100)}%`);

export const hexId = (ctx: Ctx, h: HexKey): string => hexLabel(ctx, h);

/** "4-6-7, 4-6-7 and Lt. Brandt 9-2" */
export function unitList(ctx: Ctx, units: readonly Unit[]): string {
  const names = units.map((u) => unitLabel(ctx, u));
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function stackName(ctx: Ctx, s: GameState, hex: HexKey, side: string): string {
  return unitList(ctx, sideUnitsIn(s, hex, side));
}

/** The objective a hex belongs to or is next to, by name. */
export function objectiveNear(ctx: Ctx, hex: HexKey): string | undefined {
  for (const o of ctx.objectives) if (o.hexes.includes(hex)) return o.name;
  return undefined;
}

export function terrainNote(ctx: Ctx, hex: HexKey): string {
  const t = hexTem(ctx, hex);
  return t.drm ? `${t.label} (TEM +${t.drm}, §11.1)` : `${t.label} (no TEM)`;
}

/** P(2d6 + drm ≤ need). */
export function chanceAtMost(need: number, drm = 0): number {
  return DICE2.filter((d) => d.total + drm <= need).reduce((a, d) => a + d.p, 0);
}

export function leaderNote(ctx: Ctx, units: readonly Unit[]): string | undefined {
  const l = units.find((u) => isLeader(ctx, u) && !u.broken);
  return l ? unitLabel(ctx, l) : undefined;
}

/** One line on the state of the objectives, from a side's point of view. */
export function situation(ctx: Ctx, s: GameState, side: string): string {
  const st = objectiveStatus(ctx, s);
  const mine = st.filter((o) => o.owner === side).length;
  const need = ctx.scenario.victory.controlBuildings.atLeast;
  const attacker = ctx.scenario.victory.side === side;
  const left = Math.max(0, ctx.scenario.turns - s.turn);
  const exit = ctx.scenario.victory.exit;
  if (exit && !st.length) {
    const out = exitedOf(s, exit.side).squads;
    return attacker
      ? `Breaking out: ${out} of ${exit.squads} squads off the map by the ${exit.edge} edge, ${left} turn${left === 1 ? '' : 's'} after this one.`
      : `Blocking: the enemy has ${out} of the ${exit.squads} squads it needs off the map; ${left} turn${left === 1 ? '' : 's'} after this one.`;
  }
  return attacker
    ? `Holding ${mine} of the ${need} objectives needed, ${left} turn${left === 1 ? '' : 's'} after this one.`
    : `Defending: the attacker must take ${need} of ${st.length} objectives; ${left} turn${left === 1 ? '' : 's'} after this one.`;
}
