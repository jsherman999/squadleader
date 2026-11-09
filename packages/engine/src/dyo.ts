/**
 * Design Your Own (Game Set IV): random scenario construction. A shuffled
 * 52-card deck decides the defender, the Allied nationality, the defender's
 * board, the game length, the defending force and the victory conditions,
 * as in the rulebook's procedure. The force and victory charts and the point
 * values are this project's own; the attacker's force is bought with points
 * in proportion to the defender's, instead of by secret bids.
 */
import { mulberry32, type HexKey } from '@squadwar/hex';
import { composeMap, type BoardDef, type GameMap, type MapHex } from '@squadwar/terrain';
import { parseScenario, type RulesData, type Scenario } from './data';
import type { Nation } from './types';

export type DyoRules = 'infantry' | 'support' | 'full';
export type DyoTerrain = 'city' | 'country' | 'any';

export interface DyoOptions {
  readonly seed: number;
  /** Rules in force: infantry §1–27, support §1–49 (armour, artillery, night), full §1–63. */
  readonly rules?: DyoRules;
  readonly terrain?: DyoTerrain;
}

export interface DyoCard {
  readonly rank: string;
  readonly suit: '♣' | '♦' | '♥' | '♠';
}

export interface DyoDraw {
  readonly card: DyoCard;
  /** What this card decides. */
  readonly what: string;
  readonly result: string;
}

export interface DyoResult {
  readonly scenario: Scenario;
  readonly draws: readonly DyoDraw[];
  /** Point value of each side's force. */
  readonly points: Readonly<Record<string, number>>;
}

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;
const SUITS = ['♣', '♦', '♥', '♠'] as const;
const RULES_LEVEL: Record<DyoRules, number> = { infantry: 27, support: 49, full: 63 };
const PREFIX: Record<Nation, string> = { german: 'ger', russian: 'rus', american: 'us' };
const SIDE_NAME: Record<Nation, string> = { german: 'German', russian: 'Soviet', american: 'American' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SURNAMES: Record<Nation, readonly string[]> = {
  german: ['Brandt', 'Hessler', 'Kranz', 'Lindner', 'Moser', 'Rauch', 'Seidel', 'Thalmann', 'Vogt', 'Wendel'],
  russian: ['Belov', 'Danilov', 'Gromov', 'Ivashin', 'Kotov', 'Lebedev', 'Morozov', 'Pankin', 'Sorokin', 'Zaitsev'],
  american: ['Ames', 'Baxter', 'Cole', 'Dunn', 'Fisher', 'Garrity', 'Hale', 'Keller', 'Novak', 'Reyes'],
};
const RANK_TITLE: Record<Nation, readonly string[]> = {
  german: ['Uffz.', 'Fw.', 'Lt.', 'Oblt.', 'Hptm.'],
  russian: ['Sgt.', 'Sgt.', 'Lt.', 'St. Lt.', 'Kapt.'],
  american: ['Sgt.', 'S/Sgt.', 'Lt.', '1st Lt.', 'Capt.'],
};

/** Defending force by the rank of the fifth card. Columns are generic: a "squad" is a 4-6-7, 4-4-7 or 6-6-6. */
interface ForceRow {
  readonly squads: number;
  readonly elite: number;
  readonly leaders: readonly string[];
  readonly lmg: number;
  readonly mmg: number;
  readonly hmg: number;
  readonly special: number;
  readonly atGun: number;
  readonly tank: number;
  readonly radio: number;
}
const FORCE: readonly ForceRow[] = [
  { squads: 3, elite: 0, leaders: ['L81'], lmg: 1, mmg: 0, hmg: 0, special: 0, atGun: 0, tank: 0, radio: 0 },
  { squads: 3, elite: 0, leaders: ['L81', 'L70'], lmg: 1, mmg: 1, hmg: 0, special: 0, atGun: 0, tank: 0, radio: 0 },
  { squads: 4, elite: 0, leaders: ['L91'], lmg: 1, mmg: 1, hmg: 0, special: 0, atGun: 0, tank: 0, radio: 0 },
  { squads: 4, elite: 1, leaders: ['L91', 'L80'], lmg: 1, mmg: 1, hmg: 0, special: 1, atGun: 0, tank: 0, radio: 0 },
  { squads: 5, elite: 0, leaders: ['L92', 'L80'], lmg: 2, mmg: 1, hmg: 0, special: 0, atGun: 0, tank: 0, radio: 0 },
  { squads: 5, elite: 0, leaders: ['L91', 'L81'], lmg: 1, mmg: 0, hmg: 1, special: 1, atGun: 1, tank: 0, radio: 0 },
  { squads: 6, elite: 0, leaders: ['L102', 'L80'], lmg: 2, mmg: 1, hmg: 0, special: 1, atGun: 0, tank: 0, radio: 0 },
  { squads: 6, elite: 1, leaders: ['L92', 'L81'], lmg: 2, mmg: 0, hmg: 1, special: 1, atGun: 0, tank: 0, radio: 0 },
  { squads: 7, elite: 0, leaders: ['L102', 'L81', 'L70'], lmg: 2, mmg: 1, hmg: 1, special: 0, atGun: 1, tank: 0, radio: 0 },
  { squads: 6, elite: 0, leaders: ['L91', 'L80'], lmg: 1, mmg: 1, hmg: 0, special: 1, atGun: 0, tank: 1, radio: 0 },
  { squads: 7, elite: 0, leaders: ['L102', 'L81'], lmg: 2, mmg: 1, hmg: 0, special: 0, atGun: 0, tank: 0, radio: 1 },
  { squads: 8, elite: 1, leaders: ['L103', 'L91', 'L80'], lmg: 2, mmg: 1, hmg: 1, special: 1, atGun: 1, tank: 0, radio: 0 },
  { squads: 8, elite: 0, leaders: ['L102', 'L92', 'L81'], lmg: 2, mmg: 2, hmg: 0, special: 1, atGun: 1, tank: 1, radio: 1 },
];

type VictoryKind = 'one' | 'largest' | 'two' | 'majority';
/** Victory by the rank of the sixth card: [kind, night]. */
const VICTORY: readonly (readonly [VictoryKind, boolean])[] = [
  ['one', false], ['one', false], ['one', false], ['largest', false], ['largest', false], ['largest', false], ['two', false], ['two', false],
  ['largest', true], ['two', true], ['majority', false], ['majority', false], ['two', false],
];
const RATIO: Record<VictoryKind, number> = { one: 1.5, largest: 1.6, two: 1.8, majority: 2 };
const TURNS: Record<string, number> = { '♣': 4, '♦': 6, '♥': 8, '♠': 10 };

const WEAPON_POINTS: Record<string, number> = { LMG: 6, MMG: 10, HMG: 14, FT: 14, DC: 12, PF: 5, BAZ: 8, RADIO: 40 };
const VEHICLE_POINTS: Record<string, number> = { tank: 75, spg: 60, halftrack: 25, gun: 35, truck: 10, jeep: 8, mortar: 25 };

/** Point value of one unit, weapon or vehicle type. */
export function dyoPoints(data: RulesData, type: string): number {
  const u = data.units[type];
  if (u) return u.kind === 'leader' ? Math.round(u.morale * 1.5 + Math.abs(u.leadership) * 5) : Math.round(2 * u.fp + u.morale + u.range / 2);
  const w = data.weapons[type];
  if (w) return WEAPON_POINTS[w.kind] ?? 5;
  const v = data.vehicles[type];
  return v ? (VEHICLE_POINTS[v.kind] ?? 30) : 0;
}

interface Entry {
  type: string;
  hex?: string;
  weapons?: string[];
  names?: string[];
  facing?: string;
  hidden?: boolean;
}

interface Force {
  /** Infantry stacks: each placed in one hex. */
  readonly stacks: Entry[][];
  /** Vehicles, guns and their crews, each stack placed in one hex. */
  readonly heavy: Entry[][];
}

export function designYourOwn(data: RulesData, boards: Readonly<Record<string, BoardDef>>, opts: DyoOptions): DyoResult {
  const rnd = mulberry32(opts.seed >>> 0 || 1);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const level = RULES_LEVEL[opts.rules ?? 'full'];
  const deck: DyoCard[] = SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  const draws: DyoDraw[] = [];
  const draw = (what: string, result: (c: DyoCard) => string): DyoCard => {
    const card = deck.shift()!;
    draws.push({ card, what, result: result(card) });
    return card;
  };
  const red = (c: DyoCard) => c.suit === '♦' || c.suit === '♥';
  const rankIx = (c: DyoCard) => RANKS.indexOf(c.rank as (typeof RANKS)[number]);

  // 1–2: who defends, and against whom.
  const c1 = draw('Defender', (c) => (red(c) ? 'Allied' : 'Axis'));
  const c2 = draw('Allied nationality', (c) => (red(c) || level < 50 ? 'Russian' : 'American'));
  const allied: Nation = red(c2) || level < 50 ? 'russian' : 'american';
  if (!red(c2) && level < 50) draws[1] = { ...draws[1]!, result: 'Russian (Americans need the full rules)' };
  const defNation: Nation = red(c1) ? allied : 'german';
  const attNation: Nation = red(c1) ? 'german' : allied;

  // 3: the defender's board; the attacker comes from another board to the south.
  const pool = Object.keys(boards)
    .filter((b) => (opts.terrain === 'city' ? boards[b]!.kind === 'city' : opts.terrain === 'country' ? boards[b]!.kind !== 'city' : true))
    .sort();
  const usable = pool.length >= 2 ? pool : Object.keys(boards).sort();
  const c3 = draw('Defender’s board', (c) => usable[SUITS.indexOf(c.suit) % usable.length]!);
  const defBoard = usable[SUITS.indexOf(c3.suit) % usable.length]!;
  const others = usable.filter((b) => b !== defBoard);
  const attBoard = others[Math.floor(rnd() * others.length)]!;
  const layout = [
    { board: defBoard, x: 0, y: 0 },
    { board: attBoard, x: 0, y: 1 },
  ];
  // 4: game length.
  const c4 = draw('Game length', (c) => `${TURNS[c.suit]} turns`);
  const turns = TURNS[c4.suit]!;
  // 5: the defending force.
  const c5 = draw('Defending force', (c) => `line ${c.rank} of the force chart`);
  const row = FORCE[rankIx(c5)]!;
  // 6: victory conditions.
  const c6 = draw('Victory conditions', (c) => {
    const [k, n] = VICTORY[rankIx(c)]!;
    return `${{ one: 'one building', largest: 'the largest building', two: 'two of the three largest buildings', majority: 'three of the five largest buildings' }[k]}${n && level >= 49 ? ', at night' : ''}`;
  });
  const [vKind, nightCard] = VICTORY[rankIx(c6)]!;
  const night = nightCard && level >= 49;

  // Date: Americans fight from 1943; snow in winter with the full rules.
  const year = attNation === 'american' || defNation === 'american' ? 1943 + Math.floor(rnd() * 2) : 1941 + Math.floor(rnd() * 4);
  const month = attNation === 'american' || defNation === 'american' ? (year === 1943 ? 6 + Math.floor(rnd() * 6) : Math.floor(rnd() * 12)) : Math.floor(rnd() * 12);
  const snow = level >= 61 && (month <= 1 || month === 11);
  const date = `${MONTHS[month]} ${year}`;

  const map = composeMap(layout, boards);
  const defSide = PREFIX[defNation];
  const attSide = PREFIX[attNation];

  // Objectives on the defender's board: buildings by size, stone first.
  const blds = Object.values(map.buildings)
    .filter((b) => map.hexes[b.hexes[0]!]!.board === defBoard)
    .sort((a, b) => b.hexes.length - a.hexes.length || (a.material === b.material ? 0 : a.material === 'stone' ? -1 : 1) || a.id.localeCompare(b.id));
  const want = { one: 1, largest: 1, two: 3, majority: 5 }[vKind];
  const chosen = vKind === 'one' ? [blds[Math.floor(rnd() * Math.min(blds.length, 8))]!] : blds.slice(0, want);
  const atLeast = { one: 1, largest: 1, two: Math.min(2, chosen.length), majority: Math.min(3, chosen.length) }[vKind];
  const objHexes = chosen.flatMap((b) => b.hexes);
  const objectives = chosen.map((b, i) => {
    const h = map.hexes[b.hexes[0]!]!;
    return { hex: h.id, name: `${chosen.length > 1 ? `Objective ${'ABCDE'[i]}: ` : ''}${b.hexes.length > 2 ? 'large ' : ''}${b.material} building` };
  });

  // Forces.
  const defForce = buildDefence(data, defNation, row, level, rnd);
  const defPoints = forcePoints(data, defForce);
  const ratio = RATIO[vKind] * ({ 4: 1.2, 6: 1.1, 8: 1, 10: 0.95 } as Record<number, number>)[turns]! * (night ? 0.9 : 1);
  const attForce = buildAttack(data, attNation, Math.round(defPoints * ratio), level, boards[defBoard]!.kind === 'city', rnd);
  const attPoints = forcePoints(data, attForce);
  nameLeaders(defForce, defNation, rnd);
  nameLeaders(attForce, attNation, rnd);

  // Placement: defenders in cover by the objectives, attackers on the far half of their board.
  const defHexes = Object.values(map.hexes).filter((h) => h.board === defBoard && !h.half);
  const attHexes = Object.values(map.hexes).filter((h) => h.board === attBoard && !h.half && localRow(h) >= 4);
  const dist = (a: HexKey, b: HexKey) => hexDist(map, a, b);
  const nearObj = (h: MapHex) => Math.min(...objHexes.map((o) => dist(h.key, o)));
  const cover = (h: MapHex) => ({ stoneBuilding: 3, woodBuilding: 2, woods: 1, brush: 1, orchard: 1 })[h.terrain as string] ?? 0;
  const used = new Set<HexKey>();
  const placeAll = (stacks: Entry[][], hexes: MapHex[], score: (h: MapHex) => number) => {
    const order = [...hexes].sort((a, b) => score(b) - score(a) || a.key.localeCompare(b.key));
    stacks.forEach((st, i) => {
      // Spread out: skip hexes next to an already used hex for every other stack.
      const h = order.find((x) => !used.has(x.key) && (i % 2 === 1 || ![...used].some((u) => dist(u, x.key) <= 1))) ?? order.find((x) => !used.has(x.key));
      if (!h) throw new Error('no room to set up');
      used.add(h.key);
      for (const e of st) e.hex = h.id;
    });
  };
  placeAll(defForce.stacks, defHexes, (h) => cover(h) * 4 - nearObj(h) + (objHexes.includes(h.key) ? 6 : 0) + rnd() * 1.5);
  const southFacing = 'SE-S';
  const northFacing = 'NW-N';
  placeAll(
    defForce.heavy,
    defHexes.filter((h) => h.terrain !== 'stoneBuilding' && h.terrain !== 'water' && h.terrain !== 'woodBuilding'),
    (h) => -nearObj(h) * 0.6 + localRow(h) * 0.8 + (h.terrain === 'woods' ? 1 : 0) + rnd(),
  );
  for (const st of defForce.heavy) for (const e of st) if (data.vehicles[e.type]) e.facing = southFacing;
  if (level >= 42) for (const st of defForce.heavy) if (st.some((e) => data.vehicles[e.type]?.kind === 'gun') && ['woods', 'brush', 'orchard'].includes(map.hexes[map.byId[st[0]!.hex!]!]!.terrain)) for (const e of st) e.hidden = true;
  const objCols = objHexes.map((k) => map.hexes[k]!.hex.q);
  const colScore = (h: MapHex) => -Math.min(...objCols.map((q) => Math.abs(q - h.hex.q))) * 0.4;
  placeAll(attForce.stacks, attHexes, (h) => cover(h) * 2 + colScore(h) - localRow(h) * 0.7 + rnd() * 2);
  placeAll(
    attForce.heavy,
    attHexes.filter((h) => !['stoneBuilding', 'woodBuilding', 'woods', 'water'].includes(h.terrain)),
    (h) => colScore(h) - localRow(h) * 0.5 + rnd(),
  );
  for (const st of attForce.heavy) for (const e of st) if (data.vehicles[e.type]) e.facing = northFacing;

  const defName = SIDE_NAME[defNation];
  const attName = SIDE_NAME[attNation];
  const boardName = (b: string) => boards[b]!.name;
  const vText = {
    one: `the ${objectives[0]!.name} at ${objectives[0]!.hex}`,
    largest: `the largest building on board ${defBoard}, the ${objectives[0]!.name} at ${objectives[0]!.hex}`,
    two: `at least two of the three largest buildings on board ${defBoard}`,
    majority: `at least three of the five largest buildings on board ${defBoard}`,
  }[vKind];
  const title = `${pick(['Clash', 'Fight', 'Action', 'Struggle', 'Assault'])} at ${boardName(defBoard)}`;
  const raw = {
    format: 'squadwar-scenario@1',
    id: `dyo-${opts.seed >>> 0}`,
    title,
    date,
    location: `${boardName(defBoard)} and ${boardName(attBoard)} (Design Your Own)`,
    briefing: `A randomly drawn engagement. ${defName} troops hold board ${defBoard}, ${boardName(defBoard)}. ${attName} forces worth ${attPoints} points against the defenders' ${defPoints} attack from board ${attBoard} to the south and must take ${vText} within ${turns} turns${night ? ', at night' : ''}.`,
    rulesLevel: level,
    layout,
    turns,
    setupFirst: defSide,
    moveFirst: attSide,
    ...(level >= 25 ? { concealment: { [defSide]: 2 } } : {}),
    ...(level >= 24 && attForce.stacks.flat().some((e) => isEngineer(data, e.type)) ? { smoke: { [attSide]: 2 } } : {}),
    ...(night ? { night: true, starshells: { [defSide]: 3, [attSide]: 2 } } : {}),
    ...(snow ? { snow: true } : {}),
    sides: [
      {
        id: defSide,
        nation: defNation,
        name: defName,
        notes: `Sets up first, anywhere on board ${defBoard}. Defends.`,
        setup: [{ board: defBoard, cols: ['A', 'GG'] }],
        units: [...defForce.stacks.flat(), ...defForce.heavy.flat()].map(clean),
      },
      {
        id: attSide,
        nation: attNation,
        name: attName,
        notes: `Sets up second, in rows 4–10 of board ${attBoard} (not next to the defenders' board). Moves first.`,
        setup: [{ board: attBoard, cols: ['A', 'GG'], rows: [4, 10] }],
        units: [...attForce.stacks.flat(), ...attForce.heavy.flat()].map(clean),
      },
    ],
    victory: {
      side: attSide,
      text: `The ${attName}s win if, at the end of turn ${turns}, they control ${vText}. A building is controlled by the side that has an unbroken infantry unit in it and no enemy units in any of its hexes. Otherwise the ${defName}s win.`,
      controlBuildings: { buildings: objectives, atLeast },
    },
    specialRules: [
      `Design Your Own, deal ${opts.seed >>> 0}: rules §1–${level}.`,
      ...(night ? ['Night (§49).'] : []),
      ...(snow ? ['Snow (§61).'] : []),
    ],
  };
  return { scenario: parseScenario(raw), draws, points: { [defSide]: defPoints, [attSide]: attPoints } };
}

function isEngineer(data: RulesData, type: string): boolean {
  const u = data.units[type];
  return !!u && u.kind === 'squad' && !!u.assaultEngineer;
}

function clean(e: Entry): Record<string, unknown> {
  return Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length)));
}

function localRow(h: MapHex): number {
  return Number(/(\d+)$/.exec(h.localId)![1]);
}

function hexDist(map: GameMap, a: HexKey, b: HexKey): number {
  const x = map.hexes[a]!.hex;
  const y = map.hexes[b]!.hex;
  return Math.max(Math.abs(x.q - y.q), Math.abs(x.r - y.r), Math.abs(x.q + x.r - y.q - y.r));
}

/** Types of a nation, by role. */
function roster(data: RulesData, nation: Nation) {
  const p = PREFIX[nation];
  const has = (id: string) => !!(data.units[id] ?? data.weapons[id] ?? data.vehicles[id]);
  const squad = Object.values(data.units).find((u) => u.nation === nation && u.kind === 'squad' && !isEngineer(data, u.id))!.id;
  const elite = Object.values(data.units).find((u) => u.nation === nation && isEngineer(data, u.id))?.id ?? squad;
  const crew = Object.values(data.units).find((u) => u.nation === nation && u.kind === 'crew')!.id;
  const veh = (kind: string, prefer: readonly string[]) => prefer.find(has) ?? Object.values(data.vehicles).find((v) => v.nation === nation && v.kind === kind)?.id;
  return {
    squad,
    elite,
    crew,
    leader: (r: string) => (has(`${p}-${r}`) ? `${p}-${r}` : `${p}-L81`),
    lmg: has(`${p}-lmg`) ? `${p}-lmg` : undefined,
    mmg: `${p}-mmg`,
    hmg: `${p}-hmg`,
    ft: has(`${p}-ft`) ? `${p}-ft` : undefined,
    dc: has(`${p}-dc`) ? `${p}-dc` : undefined,
    at: has(`${p}-pf`) ? `${p}-pf` : has(`${p}-baz`) ? `${p}-baz` : undefined,
    radio: `${p}-radio`,
    tank: veh('tank', ['ger-pz4f2', 'rus-t34', 'us-m4a4']),
    gun: veh('gun', ['ger-pak40', 'rus-zis3', 'us-57at']),
  };
}

function buildDefence(data: RulesData, nation: Nation, row: ForceRow, level: number, rnd: () => number): Force {
  const r = roster(data, nation);
  const squads: Entry[] = [];
  for (let i = 0; i < row.squads; i++) squads.push({ type: r.squad, weapons: [] });
  for (let i = 0; i < (level >= 22 ? row.elite : 0); i++) squads.push({ type: r.elite, weapons: [] });
  // Substitutes for what the rules or the nation lack (equal or lower points).
  let lmg = row.lmg;
  let mmg = row.mmg;
  if (!r.lmg) {
    mmg += Math.floor(lmg / 2);
    lmg = 0;
  }
  const arm = (w: string | undefined) => {
    if (!w) return;
    const s = squads.find((x) => !x.weapons!.length) ?? squads[Math.floor(rnd() * squads.length)]!;
    s.weapons!.push(w);
  };
  for (let i = 0; i < row.hmg; i++) arm(r.hmg);
  for (let i = 0; i < mmg; i++) arm(r.mmg);
  for (let i = 0; i < lmg; i++) arm(r.lmg);
  for (let i = 0; i < row.special; i++) {
    const w = level >= 37 && r.at ? r.at : level >= 22 ? (r.ft ?? r.dc ?? r.lmg ?? r.mmg) : (r.lmg ?? r.mmg);
    arm(w);
  }
  const leaders: Entry[] = row.leaders.map((l) => ({ type: r.leader(l) }));
  if (row.radio && level >= 45) leaders[0]!.weapons = [r.radio];
  else if (row.radio) squads.push({ type: r.squad, weapons: [] });
  const heavy: Entry[][] = [];
  for (let i = 0; i < row.atGun; i++) {
    if (level >= 48 && r.gun) heavy.push([{ type: r.gun }, { type: r.crew }]);
    else squads.push({ type: r.squad, weapons: [] });
  }
  for (let i = 0; i < row.tank; i++) {
    if (level >= 28 && r.tank) heavy.push([{ type: r.tank }]);
    else squads.push({ type: r.squad, weapons: r.lmg ? [r.lmg] : [] });
  }
  return { stacks: stackUp(squads, leaders), heavy };
}

function buildAttack(data: RulesData, nation: Nation, budget: number, level: number, city: boolean, rnd: () => number): Force {
  const r = roster(data, nation);
  const pts = (t: string | undefined) => (t ? dyoPoints(data, t) : 0);
  const squads: Entry[] = [];
  const leaders: Entry[] = [];
  const heavy: Entry[][] = [];
  let spent = 0;
  // Armour first when the rules allow it and the budget is big enough.
  if (level >= 28 && r.tank && budget >= 260) {
    const n = budget >= 420 ? 2 : 1;
    for (let i = 0; i < n; i++) heavy.push([{ type: r.tank }]);
    spent += n * pts(r.tank);
  }
  const ladder = ['L102', 'L91', 'L81', 'L92', 'L80', 'L91', 'L81'];
  if (level >= 45 && budget - spent >= 300 && rnd() < 0.5) {
    leaders.push({ type: r.leader('L91'), weapons: [r.radio] });
    spent += pts(r.leader('L91')) + pts(r.radio);
  }
  while (spent < budget) {
    const engineers = level >= 22 && (city ? 3 : 5);
    const elite = engineers && squads.length % engineers === engineers - 1 && r.elite !== r.squad;
    const s: Entry = { type: elite ? r.elite : r.squad, weapons: [] };
    if (elite && level >= 22) s.weapons!.push(city && r.ft && rnd() < 0.5 ? r.ft : (r.dc ?? r.ft ?? r.mmg));
    else if (squads.length % 2 === 0) s.weapons!.push(squads.length % 4 === 0 ? r.mmg : (r.lmg ?? r.mmg));
    else if (level >= 37 && r.at && heavy.length === 0 && squads.length % 3 === 1) s.weapons!.push(r.at);
    squads.push(s);
    spent += pts(s.type) + s.weapons!.reduce((a, w) => a + pts(w), 0);
    if (squads.length % 3 === 1) {
      const l = r.leader(ladder[leaders.length % ladder.length]!);
      leaders.push({ type: l });
      spent += pts(l);
    }
  }
  return { stacks: stackUp(squads, leaders), heavy };
}

/** Stacks of up to two squads, each leader with the strongest stacks. */
function stackUp(squads: Entry[], leaders: Entry[]): Entry[][] {
  const stacks: Entry[][] = [];
  for (let i = 0; i < squads.length; i += 2) stacks.push(squads.slice(i, i + 2));
  const byLeadership = [...leaders];
  byLeadership.forEach((l, i) => {
    if (stacks[i]) stacks[i]!.push(l);
    else stacks.push([l]);
  });
  return stacks;
}

function forcePoints(data: RulesData, f: Force): number {
  let p = 0;
  for (const e of [...f.stacks.flat(), ...f.heavy.flat()]) {
    p += dyoPoints(data, e.type);
    for (const w of e.weapons ?? []) p += dyoPoints(data, w);
  }
  return p;
}

function nameLeaders(f: Force, nation: Nation, rnd: () => number): void {
  const names = [...SURNAMES[nation]];
  for (const e of f.stacks.flat()) {
    if (!/-L\d+$/.test(e.type)) continue;
    const r = Number(/-L(\d+)$/.exec(e.type)![1]);
    const morale = Math.floor(r / 10);
    const title = RANK_TITLE[nation][Math.min(4, Math.max(0, morale - 7 + (r % 10 >= 2 ? 1 : 0)))]!;
    const i = Math.floor(rnd() * names.length);
    e.names = [`${title} ${names.splice(i, 1)[0] ?? 'Doe'}`];
  }
}
