import { rawRules } from '@squadwar/content';
import { parseBoard, type BoardHex } from '@squadwar/terrain';
import { makeCtx, parseRulesData, parseScenario, type Ctx } from '../index';
import { createGame } from '../engine';
import type { GameState, Unit } from '../types';

export const data = parseRulesData(rawRules);

/** A test board "T" (open ground unless given) and a two-side scenario. */
export function testCtx(hexes: Record<string, BoardHex> = {}, hexsides: Record<string, object> = {}, extra: Record<string, unknown> = {}): Ctx {
  const board = parseBoard({ format: 'squadwar-board@1', id: 'T', name: 'Test', kind: 'city', seed: 1, hexes, hexsides });
  const sc = parseScenario({
    format: 'squadwar-scenario@1',
    id: 'test',
    title: 'Test',
    date: '1942',
    location: 'Testville',
    briefing: '',
    rulesLevel: 21,
    layout: [{ board: 'T', x: 0, y: 0 }],
    turns: 2,
    setupFirst: 'rus',
    moveFirst: 'ger',
    sides: [
      { id: 'rus', nation: 'russian', name: 'Soviet', setup: [{ board: 'T', cols: ['A', 'P'] }], units: [{ type: 'rus-447', hex: 'T-B2' }] },
      { id: 'ger', nation: 'german', name: 'German', setup: [{ board: 'T', cols: ['Q', 'GG'] }], units: [{ type: 'ger-467', hex: 'T-Z2' }] },
    ],
    victory: { side: 'ger', text: 'x', controlBuildings: { buildings: [], atLeast: 0 } },
    ...extra,
  });
  return makeCtx(sc, data, { T: board });
}

let next = 1000;

/** A bare state at the start of a German player turn with no units; tests add units. */
export function blankState(ctx: Ctx, phase: GameState['phase'] = 'prepFire'): GameState {
  const s = structuredClone(createGame(ctx, 1).state);
  s.units = {};
  s.weapons = {};
  s.phase = phase;
  s.turn = 1;
  s.half = 0;
  s.phasing = 'ger';
  s.awaiting = phase === 'defensiveFire' ? 'rus' : 'ger';
  s.setupDone = ['rus', 'ger'];
  return s;
}

export function put(ctx: Ctx, s: GameState, type: string, at: string, opts: Partial<Unit> & { weapons?: string[] } = {}): Unit {
  const id = `t${next++}`;
  const side = type.startsWith('ger') ? 'ger' : type.startsWith('rus') ? 'rus' : 'us';
  const hex = ctx.map.byId[`T-${at}`];
  if (!hex) throw new Error(`bad hex ${at}`);
  const u: Unit = {
    id,
    type,
    side,
    hex,
    broken: false,
    berserk: false,
    weapons: [],
    firedPhase: null,
    usedInherent: false,
    moved: false,
    mfSpent: 0,
    ppUsed: 0,
    withLeader: null,
    moveDone: false,
    directed: false,
    dm: false,
    rallyTried: false,
    routed: false,
    advanced: false,
    concealed: false,
    noConceal: false,
    smokeMade: false,
    sewerAssault: false,
    ...opts,
  } as Unit;
  u.weapons = [];
  s.units[id] = u;
  for (const wt of opts.weapons ?? []) {
    const wid = `w${next++}`;
    s.weapons[wid] = { id: wid, type: wt, side, hex, owner: id, malfunctioned: false, usedThisTurn: false, repairTried: false };
    u.weapons.push(wid);
  }
  return u;
}

export const hexOf = (ctx: Ctx, at: string) => ctx.map.byId[`T-${at}`]!;
