/**
 * The Campaign Game record (Game Set IV), kept in this browser: the
 * player's personnel file, the planned scenarios and how each went.
 */
import {
  CAMPAIGN_RANKS,
  addCampaignLeader,
  campaignLeaderName,
  findCampaignLeader,
  nextRank,
  scoreCampaignGame,
  type Action,
  type CampaignAward,
  type GameState,
  type SideId,
} from '@squadwar/engine';
import { registerScenario, rulesData, scenarioById } from './scenarios';
import type { Controller } from './session';

export interface CampaignEntry {
  readonly scenario: string;
  readonly side: SideId;
  /** The scenario with the personal leader added, once started. */
  readonly game?: string;
  readonly identity?: string;
  readonly startRank?: number;
  readonly startTotal?: number;
  readonly elan?: number;
  readonly cowardice?: number;
  readonly total?: number;
  readonly endRank?: number;
  readonly won?: boolean;
  readonly fate?: 'survived' | 'kia';
  readonly change?: 'promoted' | 'demoted' | 'same' | 'kia' | 'busted';
  readonly awards?: readonly CampaignAward[];
}

export interface CampaignFile {
  readonly format: 'squadwar-campaign@1';
  readonly id: string;
  /** The current identity (surname); a new one after a KIA. */
  readonly identity: string;
  readonly rank: number;
  readonly total: number;
  readonly opponent: Controller;
  readonly entries: readonly CampaignEntry[];
  readonly current: number;
  readonly fallen: readonly { readonly name: string; readonly scenario: string }[];
  readonly createdAt: string;
}

const KEY = 'squadwar:campaign';
const SURNAMES = ['Adler', 'Barlow', 'Corin', 'Deane', 'Ellis', 'Farrow', 'Grant', 'Hollis', 'Ivers', 'Janek', 'Kerr', 'Lowell', 'Marek', 'Nolan', 'Orme', 'Prior'];

export function loadCampaign(): CampaignFile | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    const c = raw ? (JSON.parse(raw) as CampaignFile) : undefined;
    return c?.format === 'squadwar-campaign@1' ? c : undefined;
  } catch {
    return undefined;
  }
}

export function saveCampaign(c: CampaignFile | undefined): void {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: the campaign lasts this session only.
  }
}

export function newCampaign(identity: string, plan: readonly { scenario: string; side: SideId }[], opponent: Controller): CampaignFile {
  return {
    format: 'squadwar-campaign@1',
    id: Math.random().toString(36).slice(2, 8),
    identity: identity.trim() || 'Wetzel',
    rank: 0,
    total: 0,
    opponent,
    entries: plan.map((p) => ({ scenario: p.scenario, side: p.side })),
    current: 0,
    fallen: [],
    createdAt: new Date().toISOString(),
  };
}

export function rankLabel(rank: number): string {
  const r = CAMPAIGN_RANKS[rank]!;
  return `${r.title} (${r.morale}-${-r.leadership})`;
}

/** Prepare the current scenario with the personal leader in it; returns the scenario id and controllers. */
export function startEntry(c: CampaignFile): { campaign: CampaignFile; scenario: string; controllers: Record<SideId, Controller> } {
  const e = c.entries[c.current]!;
  const base = scenarioById(e.scenario);
  if (!base) throw new Error('That scenario is no longer available.');
  const id = `${base.id}~camp-${c.id}-${c.current + 1}`;
  registerScenario(addCampaignLeader(rulesData(), base, e.side, c.rank, c.identity, id));
  const entries = c.entries.map((x, i) => (i === c.current ? { ...x, game: id, identity: c.identity, startRank: c.rank, startTotal: c.total } : x));
  const next = { ...c, entries };
  saveCampaign(next);
  return { campaign: next, scenario: id, controllers: Object.fromEntries(base.sides.map((s) => [s.id, s.id === e.side ? 'human' : c.opponent])) };
}

/** Score a finished game of the current entry. */
export function scoreEntry(c: CampaignFile, states: readonly GameState[], actions: readonly Action[]) {
  const e = c.entries[c.current]!;
  const leader = findCampaignLeader(states[0]!, e.side, campaignLeaderName(e.identity ?? c.identity, e.startRank ?? c.rank));
  if (!leader) throw new Error('Your leader is not in this game.');
  const squads = new Set(Object.values(rulesData().units).filter((u) => u.kind === 'squad').map((u) => u.id));
  return scoreCampaignGame(states, actions, leader, e.side, squads);
}

/** Write the result into the personnel file and move to the next scenario. */
export function recordEntry(c: CampaignFile, outcome: ReturnType<typeof scoreEntry>): CampaignFile {
  const e = c.entries[c.current]!;
  const ch = nextRank(c.rank, c.total, outcome);
  const entries = c.entries.map((x, i) =>
    i === c.current ? { ...x, elan: outcome.elan, cowardice: outcome.cowardice, total: ch.total, endRank: ch.rank, won: outcome.won, fate: outcome.fate, change: ch.change, awards: outcome.awards } : x,
  );
  const dead = ch.change === 'kia' || ch.change === 'busted';
  const used = new Set([c.identity, ...c.fallen.map((f) => f.name)]);
  const fresh = SURNAMES.find((n) => !used.has(n)) ?? `${c.identity} II`;
  const next: CampaignFile = {
    ...c,
    entries,
    current: c.current + 1,
    rank: ch.rank,
    total: ch.total,
    identity: dead ? fresh : c.identity,
    fallen: dead ? [...c.fallen, { name: campaignLeaderName(c.identity, e.startRank ?? c.rank), scenario: e.scenario }] : c.fallen,
  };
  saveCampaign(next);
  return next;
}

/** Campaign victory points: one per scenario won, one per rank above corporal if the leader came through the last scenario (5.1). */
export function victoryPoints(c: CampaignFile): number {
  const wins = c.entries.filter((e) => e.won).length;
  const last = [...c.entries].reverse().find((e) => e.fate);
  return wins + (last?.fate === 'survived' ? c.rank : 0);
}
