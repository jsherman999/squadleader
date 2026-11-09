/**
 * The game as an LLM sees it: compact text with the same hex ids as the
 * board ("A-X5"), from one side's point of view. All information goes
 * through `visibleUnits`, the single visibility gate, so later rules that
 * hide units (concealment, hidden placement) only need to change it.
 */
import { DIRECTIONS, DIRECTION_NAMES, hexKey, hexsideHexes, hexsideKey, type HexKey } from '@squadwar/hex';
import {
  FACING_NAMES,
  mpLeft as vehicleMpLeft,
  vehicleType,
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
  return Object.values(s.units).filter((u) => u.side !== side && !u.concealed && !u.hidden);
}

/** Hexes holding enemy units the side cannot identify (§25). */
export function concealedHexes(s: GameState, side: string): HexKey[] {
  return [...new Set(Object.values(s.units).filter((u) => u.side !== side && u.concealed && !u.hidden).map((u) => u.hex))].sort();
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
    if (u.hidden) notes.push('hidden: the enemy has not seen it yet');
    if (u.riding) notes.push(`riding ${u.riding}`);
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
  lines.push(...vehicleLines(ctx, s, side));
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

/** Tanks, SP guns and wrecks (§28–41). */
function vehicleLines(ctx: Ctx, s: GameState, side: string): string[] {
  const vs = Object.values(s.vehicles);
  if (!vs.length && !s.wrecks.length) return [];
  const line = (v: (typeof vs)[number], own: boolean) => {
    const t = vehicleType(ctx, v);
    const bits = [
      `${v.id} ${t.name}${v.name ? ` "${v.name}"` : ''} (${t.kind === 'tank' ? 'tank, turret' : 'SP gun, fixed gun'}; ${t.gun ? `${t.gun}mm${t.heOnly ? ' HE only' : ''}${t.lowVelocity ? ' low velocity' : ''}` : 'no gun'}; MG ${t.mgCA}/${t.mg360}; armour ${t.armor >= 0 ? '+' : ''}${t.armor})`,
      `at ${hexId(ctx, v.hex)} arc ${FACING_NAMES[v.facing]}`,
    ];
    const st = [v.immobilized ? 'IMMOBILIZED' : '', v.gun !== 'ok' ? `gun ${v.gun}` : '', v.mg !== 'ok' ? `MGs ${v.mg}` : '', v.ce ? 'crew exposed' : ''].filter(Boolean);
    if (st.length) bits.push(st.join(' '));
    if (own) {
      const notes = [s.phase === 'movement' && s.phasing === v.side ? (v.moveDone ? 'done moving' : `${vehicleMpLeft(ctx, v)} MP left`) : '', v.firedPhase ? `fired in ${PHASE_NAMES[v.firedPhase]}` : '', v.moved ? 'moved' : ''].filter(Boolean);
      if (notes.length) bits.push(`(${notes.join('; ')})`);
    }
    return '  ' + bits.join(' · ');
  };
  const mine = vs.filter((v) => v.side === side);
  const theirs = vs.filter((v) => v.side !== side && !v.hidden);
  const out = ['', `YOUR VEHICLES (${mine.length}):`, ...mine.map((v) => line(v, true)), `ENEMY VEHICLES (${theirs.length}):`, ...theirs.map((v) => line(v, false))];
  if (s.wrecks.length) out.push(`WRECKS: ${s.wrecks.map((w) => hexId(ctx, w.hex)).join(', ')}`);
  return out;
}

/** Smoke, charges and sewers in play (§23–27). */
function specialLines(ctx: Ctx, s: GameState, side: string): string[] {
  const out: string[] = [];
  const left = s.smokeLeft[side] ?? 0;
  if (left || s.smoke.length) out.push('', `SMOKE: ${s.smoke.length ? s.smoke.map((x) => hexId(ctx, x.hex)).join(', ') : 'none on the map'}; you have ${left} smoke counter${left === 1 ? '' : 's'} left.`);
  if (s.charges.length) out.push(`DEMOLITION CHARGES: ${s.charges.map((c) => `${c.side === side ? 'yours' : 'enemy'} ${c.weapon} on ${hexId(ctx, c.target)}${c.armed ? ' (armed)' : ''}`).join('; ')}`);
  for (const b of (s.batteries ?? []).filter((x) => x.side === side)) {
    out.push(`ARTILLERY ${b.id}: ${b.mm}mm, ${b.missions - b.used} of ${b.missions} fire missions left; radio contact ${b.contact ? `held by ${b.leader}` : 'none'}${b.tried ? ' (tried this Rally Phase)' : ''}; ${b.mode === 'idle' ? 'nothing on the map' : `${b.mode === 'request' ? 'request' : b.mode === 'sr' ? 'spotting round' : 'fire for effect'} at ${b.hex ? hexId(ctx, b.hex) : '?'}`}.`);
  }
  for (const b of (s.batteries ?? []).filter((x) => x.side !== side && (x.mode === 'sr' || x.mode === 'ffe') && x.hex)) out.push(`ENEMY ARTILLERY: ${b.mode === 'sr' ? 'spotting round' : 'fire for effect'} at ${hexId(ctx, b.hex!)}.`);
  if (ctx.scenario.night) out.push(`NIGHT: visibility ${s.nightVis ?? '?'} hexes this turn (+3 for moving vehicles); starshells lit at ${(s.starshells ?? []).map((x) => hexId(ctx, x.hex)).join(', ') || 'none'}; you have ${s.starshellsLeft?.[side] ?? 0} starshells.`);
  out.push(...westernLines(ctx, s, side));
  if (ctx.scenario.sewers) {
    const open = Object.values(ctx.map.hexes).filter((h) => h.sewer && !s.closedSewers.includes(h.key));
    out.push(`SEWER ENTRANCES: ${open.map((h) => h.id).join(' ')}${s.closedSewers.length ? `; blown shut: ${s.closedSewers.map((h) => hexId(ctx, h)).join(' ')}` : ''}`);
    const lost = s.lostInSewers.filter((l) => l.side === side);
    if (lost.length) out.push(`LOST IN THE SEWERS (back next Movement Phase): ${lost.flatMap((l) => l.units.map((u) => u.id)).join(', ')}`);
  }
  return out;
}

/** Fortifications, ruins, fires, weather and reinforcements (§50–63). Enemy minefields only once found. */
function westernLines(ctx: Ctx, s: GameState, side: string): string[] {
  const out: string[] = [];
  const ids = (hs: readonly HexKey[]) => hs.map((h) => hexId(ctx, h)).join(', ');
  const f = s.forts;
  if (f) {
    if (f.wire.length) out.push(`WIRE: ${ids(f.wire)} (infantry may enter only in the Advance Phase; leaving costs a die roll of MF, one hex is always possible; a squad in it that does nothing else in Prep Fire may cut it, dig work=wire; tanks flatten it).`);
    if (f.trenches.length) out.push(`ENTRENCHMENTS: ${ids(f.trenches)} (+2 vs fire and charges, +4 vs artillery and overruns, +0 vs flamethrowers; +1 MF to enter).`);
    for (const b of f.bunkers) out.push(`BUNKER at ${hexId(ctx, b.hex)} (${b.side === side ? 'yours' : 'enemy'}): holds ${b.capacity} squad${b.capacity === 1 ? '' : 's'}, +${b.ca} against fire from its covered arc (${FACING_NAMES[b.facing]}), +${b.nca} from elsewhere.`);
    const mines = f.mines.filter((m) => m.side === side || m.known);
    if (mines.length) out.push(`MINEFIELDS: ${mines.map((m) => `${hexId(ctx, m.hex)} (${m.side === side ? 'yours' : 'enemy, found'}, ${m.factors} factors)`).join('; ')}. Units entering or leaving are attacked; a squad next to it may clear it in Prep Fire (dig work=mines).`);
    const side2 = (k: string) => {
      const { a, da } = hexsideHexes(k);
      return `${hexId(ctx, hexKey(a))}/${DIRECTION_NAMES[da]}`;
    };
    if (f.roadblocks.length) out.push(`ROADBLOCKS on hexsides: ${f.roadblocks.map(side2).join(', ')} (vehicles cannot cross; infantry +1 MF).`);
  }
  if (s.rubble?.length) out.push(`RUBBLE (fights as a stone building, +3): ${ids(s.rubble)}.`);
  if (s.fires?.length) out.push(`ON FIRE (blocks sight and entry; units inside must get out in the Rout Phase): ${ids(s.fires)}.`);
  if (ctx.scenario.snow) out.push('SNOW: movement costs double except along roads; entrenching is harder; mines attack at +1.');
  const mist = s.smoke.filter((x) => x.side === '__mist');
  if (mist.length) out.push(`RIVER MIST on the bank (as smoke) until a 1 is rolled at the start of a turn: ${mist.length} hexes along the edge.`);
  for (const r of (s.reserves ?? []).filter((x) => x.side === side)) {
    const when = r.turn > s.turn ? `arrive on turn ${r.turn}` : 'may enter now';
    const limit = s.landing?.[side];
    out.push(
      `${r.endsMove ? 'IN THE BOATS' : 'REINFORCEMENTS'} (${when}): ${r.units.map((u) => `${u.id}(${unitLabel(ctx, u)})`).join(' ')}. Order enter with units and an entry hex on the edge, e.g. ${hexId(ctx, r.hexes[0]!)}${r.hexes.length > 1 ? `…${hexId(ctx, r.hexes[r.hexes.length - 1]!)}` : ''}.${r.endsMove ? ' Landing ends their move.' : ''}${limit !== undefined && r.turn <= s.turn ? ` The boats can land ${limit} more squads this turn (leaders extra).` : ''}`,
    );
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
      for (const v of Object.values(s.vehicles)) if (v.hex === h) who.push(`${v.id}(${v.side === viewer ? 'own' : 'enemy'} ${vehicleType(ctx, v).name})`);
      const wr = s.wrecks.filter((w) => w.hex === h).length;
      if (wr) who.push(`${wr} wreck${wr > 1 ? 's' : ''}`);
      const hs = hexsideNotes(ctx, h);
      const sides = hs ? `, hexsides: ${hs}` : '';
      const f = s.forts;
      const extra = [
        hx.sewer ? (s.closedSewers.includes(h) ? 'sewer entrance (blown shut)' : 'sewer entrance') : '',
        s.smoke.some((x) => x.hex === h) ? 'SMOKE' : '',
        f?.wire.includes(h) ? 'WIRE' : '',
        f?.trenches.includes(h) ? 'ENTRENCHMENT' : '',
        f?.bunkers.some((b) => b.hex === h) ? 'BUNKER' : '',
        f?.mines.some((m) => m.hex === h && (m.side === viewer || m.known)) ? 'MINEFIELD' : '',
        s.rubble?.includes(h) ? 'RUBBLE' : '',
        s.fires?.includes(h) ? 'ON FIRE' : '',
      ].filter(Boolean);
      return `${hx.id}: ${tem.label}, level ${hx.level}, TEM ${tem.drm >= 0 ? '+' : ''}${tem.drm}${bld ? `, ${bld.hexes.length}-hex ${bld.material} building` : ''}${sides}${extra.length ? `, ${extra.join(', ')}` : ''}${who.length ? `, units: ${who.join(' ')}` : ''}`;
    })
    .join('\n');
}

/** MF to enter `to` from `from`, for preview tools. */
export function stepCost(ctx: Ctx, from: HexKey, to: HexKey): { mf: number; why: string } {
  const c = moveCost(ctx, from, to);
  return { mf: c.mf, why: c.parts.join(', ') };
}
