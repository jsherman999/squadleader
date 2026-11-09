/**
 * Campaign Game (Game Set IV): the player is one leader, carried from
 * scenario to scenario. Performance points for élan and cowardice are read
 * off the game record; ten points up or down change rank (one step per
 * scenario at most), and a leader killed in action is replaced by a new
 * corporal.
 */
import type { RulesData, Scenario } from './data';
import type { Action, GameState, Nation } from './types';

export interface CampaignRank {
  readonly title: string;
  readonly morale: number;
  readonly leadership: number;
  /** Leader counter suffix, e.g. "L81" for 8-1. */
  readonly counter: string;
}

/** Ranks with their morale and leadership (Campaign Game 3.1). */
export const CAMPAIGN_RANKS: readonly CampaignRank[] = [
  { title: 'Cpl.', morale: 7, leadership: 0, counter: 'L70' },
  { title: 'Sgt.', morale: 8, leadership: 0, counter: 'L80' },
  { title: '1st Sgt.', morale: 8, leadership: -1, counter: 'L81' },
  { title: '2nd Lt.', morale: 9, leadership: -1, counter: 'L91' },
  { title: '1st Lt.', morale: 9, leadership: -2, counter: 'L92' },
  { title: 'Capt.', morale: 10, leadership: -2, counter: 'L102' },
  { title: 'Maj.', morale: 10, leadership: -3, counter: 'L103' },
];

const PREFIX: Record<Nation, string> = { german: 'ger', russian: 'rus', american: 'us' };

export function campaignLeaderType(nation: Nation, rank: number): string {
  return `${PREFIX[nation]}-${CAMPAIGN_RANKS[Math.max(0, Math.min(CAMPAIGN_RANKS.length - 1, rank))]!.counter}`;
}

export function campaignLeaderName(name: string, rank: number): string {
  return `${CAMPAIGN_RANKS[rank]!.title} ${name}`;
}

/**
 * The scenario with the player's personal leader added to `side` (Campaign
 * Game 3.2): with the side's first stack, or with its first reinforcements
 * when everything enters later.
 */
export function addCampaignLeader(data: RulesData, sc: Scenario, side: string, rank: number, name: string, id: string): Scenario {
  const s = sc.sides.find((x) => x.id === side);
  if (!s) throw new Error(`no side ${side}`);
  const infantry = s.units.filter((u) => !data.vehicles[u.type]);
  const anchor = infantry.find((u) => u.hex && !u.hidden && !u.rides) ?? infantry.find((u) => u.enters) ?? infantry[0] ?? s.units[0]!;
  const entry = {
    type: campaignLeaderType(s.nation, rank),
    names: [campaignLeaderName(name, rank)],
    ...(anchor.hex ? { hex: anchor.hex } : {}),
    ...(anchor.enters ? { enters: anchor.enters } : {}),
  };
  return {
    ...sc,
    id,
    title: `${sc.title} (campaign)`,
    sides: sc.sides.map((x) => (x.id === side ? { ...x, units: [...x.units, entry] } : x)) as unknown as Scenario['sides'],
  };
}

export interface CampaignAward {
  readonly points: number;
  readonly kind: 'elan' | 'cowardice';
  readonly text: string;
  readonly turn: number;
}

export interface CampaignOutcome {
  readonly awards: readonly CampaignAward[];
  readonly elan: number;
  readonly cowardice: number;
  readonly fate: 'survived' | 'kia';
  readonly won: boolean;
}

/** The player's leader in a game, found by side and name. */
export function findCampaignLeader(s: GameState, side: string, fullName: string): string | undefined {
  const u = Object.values(s.units).find((x) => x.side === side && x.name === fullName);
  if (u) return u.id;
  for (const r of s.reserves ?? []) for (const x of r.units) if (x.side === side && x.name === fullName) return x.id;
  return undefined;
}

/**
 * Élan and cowardice points (Campaign Game 4) read off a finished game by
 * comparing the state before and after each action.
 */
export function scoreCampaignGame(states: readonly GameState[], actions: readonly Action[], leaderId: string, side: string, squadTypes: ReadonlySet<string>): CampaignOutcome {
  const awards: CampaignAward[] = [];
  const add = (points: number, text: string, turn: number) => awards.push({ points, kind: points > 0 ? 'elan' : 'cowardice', text, turn });
  const isSquad = (t: string) => squadTypes.has(t);
  let fate: 'survived' | 'kia' = 'survived';
  for (let i = 0; i < actions.length && i + 1 < states.length; i++) {
    const before = states[i]!;
    const after = states[i + 1]!;
    const a = actions[i]!;
    const Lb = before.units[leaderId];
    const La = after.units[leaderId];
    const turn = before.turn;
    if (!Lb) continue;
    // A: leader killed: in a rally (12) or while already broken is "total cowardice".
    if (!La && fate === 'survived') {
      if (a.type === 'rally' && a.unit === leaderId) add(-8, 'Gone in a failed rally (total cowardice)', turn);
      else if (Lb.broken) add(-8, 'Broke again before rallying and was lost', turn);
      fate = 'kia';
      continue;
    }
    if (!La) continue;
    // E, C: broke under enemy fire; squads in the hex broke with him.
    if (!Lb.broken && La.broken) {
      add(-1, 'Broke under enemy fire', turn);
      for (const u of Object.values(after.units)) {
        const ub = before.units[u.id];
        if (u.side === side && u.hex === Lb.hex && isSquad(u.type) && ub && !ub.broken && u.broken) add(-2, 'A squad in his hex broke when he did', turn);
      }
    }
    // Directed fire (E) and malfunctions under his direction (D).
    if (a.type === 'fire' && a.leader === leaderId) {
      const killed = Object.values(before.units).filter((u) => u.side !== side && isSquad(u.type) && !after.units[u.id]).length;
      if (killed) add(killed, `Directed fire that destroyed ${killed} enemy squad${killed > 1 ? 's' : ''}`, turn);
      for (const f of a.firers) for (const w of f.weapons) if (before.weapons[w] && !before.weapons[w]!.malfunctioned && (!after.weapons[w] || after.weapons[w]!.malfunctioned)) add(-1, 'A support weapon under his direction broke down', turn);
    }
    // Rallies in his hex (D), and surrenders on a 12 (B).
    if (a.type === 'rally' && a.unit !== leaderId) {
      const ub = before.units[a.unit];
      if (ub && ub.side === side && ub.hex === Lb.hex && isSquad(ub.type) && ub.broken) {
        const ua = after.units[a.unit];
        if (ua && !ua.broken) add(1, 'Rallied a broken squad', turn);
        else if (!ua) add(-3, 'A squad in his hex surrendered on a failed rally', turn);
      }
    }
    // Anti-tank attacks he led (A, C).
    if (a.type === 'antiTank' && (a.units.includes(leaderId) || a.units.some((id) => before.units[id]?.hex === Lb.hex)) && before.vehicles[a.vehicle] && !after.vehicles[a.vehicle]) {
      if (a.weapon) add(2, 'Destroyed an AFV with an anti-tank weapon', turn);
      else add(6, 'Destroyed an AFV without anti-tank weapons', turn);
    }
    // Close combat that cleared his hex (B), and AFVs destroyed there (A).
    if (before.phase === 'closeCombat' && after.phase !== 'closeCombat') {
      const h = Lb.hex;
      const foesBefore = Object.values(before.units).some((u) => u.side !== side && u.hex === h);
      const foesAfter = Object.values(after.units).some((u) => u.side !== side && u.hex === h);
      if (foesBefore && !foesAfter) add(3, 'Close combat that wiped out the enemy in his hex', turn);
      const afvs = Object.values(before.vehicles).filter((v) => v.side !== side && v.hex === h && !after.vehicles[v.id]).length;
      if (afvs) add(6 * afvs, 'Destroyed an AFV in close combat', turn);
    }
  }
  const last = states[states.length - 1]!;
  const won = last.winner === side;
  if (won && fate === 'survived') add(1, 'Part of the winning side', last.turn);
  const elan = awards.filter((x) => x.points > 0).reduce((t, x) => t + x.points, 0);
  const cowardice = awards.filter((x) => x.points < 0).reduce((t, x) => t + x.points, 0);
  return { awards, elan, cowardice, fate, won };
}

export interface PersonnelChange {
  readonly rank: number;
  readonly total: number;
  readonly change: 'promoted' | 'demoted' | 'same' | 'kia' | 'busted';
}

/** Ten points up or down change rank, one step per scenario (Campaign Game 2.4–2.7). */
export function nextRank(rank: number, total: number, outcome: CampaignOutcome): PersonnelChange {
  if (outcome.fate === 'kia') return { rank: 0, total: 0, change: 'kia' };
  let t = total + outcome.elan + outcome.cowardice;
  if (t >= 10) {
    t -= 10;
    return rank + 1 < CAMPAIGN_RANKS.length ? { rank: rank + 1, total: t, change: 'promoted' } : { rank, total: t, change: 'same' };
  }
  if (t <= -10) {
    t += 10;
    return rank === 0 ? { rank: 0, total: 0, change: 'busted' } : { rank: rank - 1, total: t, change: 'demoted' };
  }
  return { rank, total: t, change: 'same' };
}
