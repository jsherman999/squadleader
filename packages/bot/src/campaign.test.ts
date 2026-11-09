import { describe, expect, it } from 'vitest';
import { rawBoards, rawRules, rawScenarios } from '@squadwar/content';
import { parseBoard } from '@squadwar/terrain';
import {
  CAMPAIGN_RANKS,
  addCampaignLeader,
  applyAction,
  campaignLeaderName,
  createGame,
  findCampaignLeader,
  makeCtx,
  nextRank,
  parseRulesData,
  parseScenario,
  scoreCampaignGame,
  type Action,
  type GameState,
} from '@squadwar/engine';
import { chooseAction } from './bot';

const data = parseRulesData(rawRules);
const boards = Object.fromEntries(Object.entries(rawBoards).map(([k, v]) => [k, parseBoard(v)]));
const squads = new Set(Object.values(data.units).filter((u) => u.kind === 'squad').map((u) => u.id));

describe('Campaign Game', () => {
  it('adds the personal leader with the right rating, with the side or its reinforcements', () => {
    const s1 = parseScenario(rawScenarios[0]);
    const sc = addCampaignLeader(data, s1, 'ger', 3, 'Hillen', 's1~camp');
    const ctx = makeCtx(sc, data, boards);
    const st = createGame(ctx, 1).state;
    const id = findCampaignLeader(st, 'ger', campaignLeaderName('Hillen', 3))!;
    expect(st.units[id]!.type).toBe('ger-L91');
    expect(ctx.zones.ger!.has(st.units[id]!.hex)).toBe(true);
    const s11 = parseScenario(rawScenarios[10]);
    const boats = createGame(makeCtx(addCampaignLeader(data, s11, 'us', 0, 'Wetzel', 's11~camp'), data, boards), 1).state;
    expect(findCampaignLeader(boats, 'us', 'Cpl. Wetzel')).toBeDefined();
    expect(boats.reserves!.some((r) => r.units.some((u) => u.name === 'Cpl. Wetzel'))).toBe(true);
  });

  it('scores a played game from its record', () => {
    for (const seed of [11, 12]) {
      const sc = addCampaignLeader(data, parseScenario(rawScenarios[0]), 'rus', 4, 'Orlov', 's1~camp');
      const ctx = makeCtx(sc, data, boards);
      let s = createGame(ctx, seed).state;
      const states: GameState[] = [s];
      const actions: Action[] = [];
      for (let i = 0; i < 6000 && s.phase !== 'gameOver'; i++) {
        let a = chooseAction(ctx, s);
        let r;
        try {
          r = applyAction(ctx, s, a);
        } catch {
          a = { type: 'endPhase' };
          r = applyAction(ctx, s, a);
        }
        actions.push(a);
        s = r.state;
        states.push(s);
      }
      const L = findCampaignLeader(states[0]!, 'rus', 'Lt. Orlov') ?? findCampaignLeader(states[0]!, 'rus', campaignLeaderName('Orlov', 4))!;
      const out = scoreCampaignGame(states, actions, L, 'rus', squads);
      expect(out.won).toBe(s.winner === 'rus');
      expect(out.fate).toBe(s.units[L] ? 'survived' : 'kia');
      expect(out.elan).toBe(out.awards.filter((x) => x.points > 0).reduce((t, x) => t + x.points, 0));
      for (const a of out.awards) expect(a.text.length).toBeGreaterThan(0);
    }
  }, 60_000);

  it('promotes and demotes one rank at a time, carrying points over', () => {
    const o = (elan: number, cowardice: number, fate: 'survived' | 'kia' = 'survived') => ({ awards: [], elan, cowardice, fate, won: false });
    expect(nextRank(1, 4, o(9, -1))).toEqual({ rank: 2, total: 2, change: 'promoted' });
    expect(nextRank(1, 0, o(25, 0))).toEqual({ rank: 2, total: 15, change: 'promoted' });
    expect(nextRank(3, -2, o(0, -9))).toEqual({ rank: 2, total: -1, change: 'demoted' });
    expect(nextRank(0, -5, o(0, -6))).toEqual({ rank: 0, total: 0, change: 'busted' });
    expect(nextRank(4, 8, o(5, 0, 'kia'))).toEqual({ rank: 0, total: 0, change: 'kia' });
    expect(nextRank(CAMPAIGN_RANKS.length - 1, 9, o(3, 0)).rank).toBe(CAMPAIGN_RANKS.length - 1);
  });
});
