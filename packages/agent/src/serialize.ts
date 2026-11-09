/**
 * The game as an LLM sees it: compact text with the same hex ids as the
 * board ("A-X5"), from one side's point of view. All information goes
 * through `visibleUnits`, the single visibility gate, so later rules that
 * hide units (concealment, hidden placement) only need to change it.
 */
import { DIRECTIONS, DIRECTION_NAMES, hexsideKey, type HexKey } from '@squadwar/hex';
import {
  carried,
  hexLabel,
  hexTem,
  mfLeft,
  moveCost,
  objectiveStatus,
  PHASE_NAMES,
  unitLabel,
  weaponType,
  type Ctx,
  type GameState,
  type Unit,
} from '@squadwar/engine';

export const hexId = (ctx: Ctx, h: HexKey): string => hexLabel(ctx, h);

/** Accepts "A-X5", "X5" (first board) or an internal key. */
export function hexKeyOf(ctx: Ctx, id: string): HexKey | undefined {
  const t = id.trim().toUpperCase();
  if (ctx.map.byId[t]) return ctx.map.byId[t];
  const first = ctx.map.boards[0];
  if (first && ctx.map.byId[`${first.board}-${t}`]) return ctx.map.byId[`${first.board}-${t}`];
  return ctx.map.hexes[id] ? id : undefined;
}

/** Enemy units this side knows about. In §1–21 everything on the board is known. */
export function visibleUnits(ctx: Ctx, s: GameState, side: string): Unit[] {
  void ctx;
  return Object.values(s.units).filter((u) => u.side !== side && !u.concealed);
}

/** Hexes holding enemy units the side cannot identify (§25). */
export function concealedHexes(s: GameState, side: string): HexKey[] {
  return [...new Set(Object.values(s.units).filter((u) => u.side !== side && u.concealed).map((u) => u.hex))].sort();
}

function unitLine(ctx: Ctx, s: GameState, u: Unit, own: boolean): string {
  const t = ctx.data.units[u.type]!;
  const kind = t.kind === 'leader' ? 'leader' : t.kind === 'crew' ? 'crew' : 'squad';
  const status = [u.broken ? 'BROKEN' : '', u.berserk ? 'BERSERK' : '', u.dm ? 'DM' : ''].filter(Boolean).join(' ');
  const ws = carried(s, u).map((w) => `${weaponType(ctx, w).kind}${w.malfunctioned ? '(jammed)' : ''}${own ? ` ${w.id}` : ''}`);
  const parts = [`${u.id} ${unitLabel(ctx, u).replace(' (broken)', '')} ${kind}${u.name && !unitLabel(ctx, u).includes(u.name) ? ` ${u.name}` : ''}`, `at ${hexId(ctx, u.hex)}`];
  if (status) parts.push(status);
  if (ws.length) parts.push(`carries ${ws.join(', ')}`);
  if (own) {
    const notes: string[] = [];
    if (s.phase === 'movement' && s.phasing === u.side) {
      if (u.moveDone) notes.push('done moving');
      else notes.push(`${mfLeft(ctx, s, u)} MF left`);
    }
    if (u.firedPhase) notes.push(`fired in ${PHASE_NAMES[u.firedPhase]}`);
    if (u.directed) notes.push('has directed fire');
    if (u.advanced) notes.push('advanced');
    if (u.concealed) notes.push('concealed');
    if (u.smokeMade) notes.push('laid smoke this turn');
    if (notes.length) parts.push(`(${notes.join('; ')})`);
  }
  return parts.join(' · ');
}

/** Static facts: scenario, side, goal. Sent once per decision. */
export function briefing(ctx: Ctx, side: string): string {
  const sc = ctx.scenario;
  const me = sc.sides.find((x) => x.id === side)!;
  const them = sc.sides.find((x) => x.id !== side)!;
  const attacker = sc.victory.side === side;
  return [
    `SCENARIO: ${sc.title} (${sc.location}, ${sc.date}), ${sc.turns} game turns, rules §1–${sc.rulesLevel}.`,
    sc.briefing,
    `YOU COMMAND: ${me.name} (${attacker ? 'attacker' : 'defender'}). Opponent: ${them.name}.`,
    `VICTORY: ${sc.victory.text}`,
    `OBJECTIVES: ${ctx.objectives.map((o) => `${o.name} (${o.hexes.map((h) => hexId(ctx, h)).join(' ')})`).join('; ')}.`,
    me.notes ? `YOUR NOTES: ${me.notes}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Everything that changes: turn, phase, units, objectives, moving enemies. */
export function situation(ctx: Ctx, s: GameState, side: string): string {
  const sideName = (id: string) => s.sides.find((x) => x.id === id)?.name ?? id;
  const status = objectiveStatus(ctx, s);
  const mine = Object.values(s.units).filter((u) => u.side === side);
  const theirs = visibleUnits(ctx, s, side);
  const lines = [
    `TURN ${s.turn} of ${ctx.scenario.turns} · ${sideName(s.phasing)} player turn · ${PHASE_NAMES[s.phase]} · ${s.awaiting === side ? 'your decision' : 'waiting'}`,
    `OBJECTIVES: ${status.map((o) => `${o.name}: ${o.owner ? sideName(o.owner) : 'contested'}`).join('; ')}.`,
    `LOSSES: ${s.sides.map((x) => `${x.name} ${s.losses[x.id]?.squads ?? 0} squads, ${s.losses[x.id]?.leaders ?? 0} leaders`).join('; ')}.`,
    '',
    `YOUR UNITS (${mine.length}):`,
    ...sortByHex(mine).map((u) => '  ' + unitLine(ctx, s, u, true)),
    '',
    `ENEMY UNITS (${theirs.length}):`,
    ...sortByHex(theirs).map((u) => '  ' + unitLine(ctx, s, u, false)),
  ];
  const hidden = concealedHexes(s, side);
  if (hidden.length) lines.push(`CONCEALED ENEMY STACKS (contents unknown; fire at them is area fire at half FP, §25): ${hidden.map((h) => hexId(ctx, h)).join(', ')}`);
  lines.push(...specialLines(ctx, s, side));
  const loose = Object.values(s.weapons).filter((w) => w.owner === null);
  if (loose.length) lines.push('', 'ABANDONED WEAPONS: ' + loose.map((w) => `${weaponType(ctx, w).kind} ${w.id} at ${hexId(ctx, w.hex)}`).join(', '));
  if (s.phase === 'defensiveFire' && s.phasing !== side) {
    const moved = Object.entries(s.tracks).filter(([id]) => s.units[id]);
    if (moved.length) {
      lines.push('', 'ENEMY MOVES THIS PHASE (you may fire at any hex a unit entered, §16.1; "open" = in the open, −2 DRM):');
      for (const [id, steps] of moved) lines.push(`  ${id}: ${steps.map((st) => `${hexId(ctx, st.hex)}${st.open ? '(open)' : ''}`).join(' → ')}`);
    }
  }
  return lines.join('\n');
}

/** Smoke, charges and sewers in play (§23–27). */
function specialLines(ctx: Ctx, s: GameState, side: string): string[] {
  const out: string[] = [];
  const left = s.smokeLeft[side] ?? 0;
  if (left || s.smoke.length) out.push('', `SMOKE: ${s.smoke.length ? s.smoke.map((x) => hexId(ctx, x.hex)).join(', ') : 'none on the map'}; you have ${left} smoke counter${left === 1 ? '' : 's'} left.`);
  if (s.charges.length) out.push(`DEMOLITION CHARGES: ${s.charges.map((c) => `${c.side === side ? 'yours' : 'enemy'} ${c.weapon} on ${hexId(ctx, c.target)}${c.armed ? ' (armed)' : ''}`).join('; ')}`);
  if (ctx.scenario.sewers) {
    const open = Object.values(ctx.map.hexes).filter((h) => h.sewer && !s.closedSewers.includes(h.key));
    out.push(`SEWER ENTRANCES: ${open.map((h) => h.id).join(' ')}${s.closedSewers.length ? `; blown shut: ${s.closedSewers.map((h) => hexId(ctx, h)).join(' ')}` : ''}`);
    const lost = s.lostInSewers.filter((l) => l.side === side);
    if (lost.length) out.push(`LOST IN THE SEWERS (back next Movement Phase): ${lost.flatMap((l) => l.units.map((u) => u.id)).join(', ')}`);
  }
  return out;
}

function sortByHex(us: Unit[]): Unit[] {
  return [...us].sort((a, b) => a.hex.localeCompare(b.hex) || a.id.localeCompare(b.id));
}

function hexsideNotes(ctx: Ctx, h: HexKey): string {
  const hx = ctx.map.hexes[h]!;
  const out: string[] = [];
  for (const d of DIRECTIONS) {
    const side = ctx.map.hexsides[hexsideKey(hx.hex, d)];
    const what = side?.wall ? 'wall' : side?.hedge ? 'hedge' : side?.cliff ? 'cliff' : undefined;
    if (what) out.push(`${DIRECTION_NAMES[d]} ${what}`);
  }
  return out.join(', ');
}

/** Terrain of some hexes: type, level, TEM, MF cost from a neighbour, occupants. */
export function describeHexes(ctx: Ctx, s: GameState, hexes: readonly HexKey[], viewer: string): string {
  const seen = new Set(visibleUnits(ctx, s, viewer).map((u) => u.id));
  return hexes
    .map((h) => {
      const hx = ctx.map.hexes[h];
      if (!hx) return `${h}: not on the map`;
      const tem = hexTem(ctx, h);
      const bld = hx.building ? ctx.map.buildings[hx.building] : undefined;
      const who = Object.values(s.units)
        .filter((u) => u.hex === h && (u.side === viewer || seen.has(u.id)))
        .map((u) => `${u.id}(${u.side === viewer ? 'own' : 'enemy'} ${unitLabel(ctx, u)})`);
      if (Object.values(s.units).some((u) => u.hex === h && u.side !== viewer && u.concealed)) who.push('a concealed enemy stack');
      const hs = hexsideNotes(ctx, h);
      const sides = hs ? `, hexsides: ${hs}` : '';
      const extra = [hx.sewer ? (s.closedSewers.includes(h) ? 'sewer entrance (blown shut)' : 'sewer entrance') : '', s.smoke.some((x) => x.hex === h) ? 'SMOKE' : ''].filter(Boolean);
      return `${hx.id}: ${tem.label}, level ${hx.level}, TEM ${tem.drm >= 0 ? '+' : ''}${tem.drm}${bld ? `, ${bld.hexes.length}-hex ${bld.material} building` : ''}${sides}${extra.length ? `, ${extra.join(', ')}` : ''}${who.length ? `, units: ${who.join(' ')}` : ''}`;
    })
    .join('\n');
}

/** MF to enter `to` from `from`, for preview tools. */
export function stepCost(ctx: Ctx, from: HexKey, to: HexKey): { mf: number; why: string } {
  const c = moveCost(ctx, from, to);
  return { mf: c.mf, why: c.parts.join(', ') };
}
