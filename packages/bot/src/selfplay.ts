import { rawBoards, rawRules, rawScenarios } from '@squadwar/content';
import { parseBoard } from '@squadwar/terrain';
import {
  DEFAULT_OPTIONS,
  allUnits,
  createGame,
  makeCtx,
  parseRulesData,
  parseScenario,
  stackingProblem,
  tryAction,
  type Action,
  type Ctx,
  type GameOptions,
  type GameState,
} from '@squadwar/engine';
import { chooseAction } from './bot';

export function scenarioCtx(index = 0): Ctx {
  const sc = parseScenario(rawScenarios[index]);
  const boards = Object.fromEntries(Object.entries(rawBoards).map(([k, v]) => [k, parseBoard(v)]));
  return makeCtx(sc, parseRulesData(rawRules), boards);
}

/** Consistency checks that must hold after every action. */
export function invariants(ctx: Ctx, s: GameState): string[] {
  const out: string[] = [];
  for (const u of Object.values(s.units)) {
    if (!ctx.map.hexes[u.hex]) out.push(`${u.id} off map`);
    for (const wid of u.weapons) {
      const w = s.weapons[wid];
      if (!w) out.push(`${u.id} carries missing weapon ${wid}`);
      else if (w.owner !== u.id || w.hex !== u.hex) out.push(`${wid} owner/hex mismatch`);
    }
    if (u.broken && u.weapons.length) out.push(`${u.id} broken but carries weapons`);
  }
  for (const w of Object.values(s.weapons)) {
    if (w.owner && !s.units[w.owner]?.weapons.includes(w.id)) out.push(`${w.id} owner does not list it`);
  }
  if (s.phase === 'defensiveFire') {
    for (const side of s.sides) {
      for (const h of new Set(allUnits(s, side.id).map((u) => u.hex))) {
        if (side.id === s.phasing && stackingProblem(ctx, s, h, side.id)) out.push(`${side.id} overstacked after movement in ${h}`);
      }
    }
  }
  return out;
}

export interface SelfPlayResult {
  readonly winner?: string;
  readonly result?: string;
  readonly turns: number;
  readonly actions: number;
  readonly problems: string[];
  readonly log: Action[];
}

/** Bot vs bot to the end of the game. */
export function selfPlay(ctx: Ctx, seed: number, maxActions = 6000, options: GameOptions = DEFAULT_OPTIONS): SelfPlayResult {
  let s = createGame(ctx, seed, options).state;
  const log: Action[] = [];
  const problems: string[] = [];
  for (let i = 0; i < maxActions && s.phase !== 'gameOver'; i++) {
    let a = chooseAction(ctx, s);
    let r = tryAction(ctx, s, a);
    if (!r.ok) {
      problems.push(`bot chose an illegal action in ${s.phase}: ${r.error}`);
      a = { type: 'endPhase' };
      r = tryAction(ctx, s, a);
      if (!r.ok) {
        problems.push(`cannot end ${s.phase}: ${r.error}`);
        break;
      }
    }
    log.push(a);
    s = r.state;
    const inv = invariants(ctx, s);
    if (inv.length) {
      problems.push(...inv.map((x) => `after ${a.type}: ${x}`));
      break;
    }
  }
  if (s.phase !== 'gameOver') problems.push('game did not finish');
  return { ...(s.winner ? { winner: s.winner } : {}), ...(s.result ? { result: s.result } : {}), turns: s.turn, actions: log.length, problems, log };
}
