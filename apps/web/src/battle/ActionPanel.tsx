import { DIRECTIONS, hexKey, neighbor, parseHexKey, type HexKey } from '@squadwar/hex';
import {
  STAIRS_MF,
  floorsOn,
  hasUpper,
  isUpper,
  analyzeFire,
  fireOdds,
  autoPlan,
  canRally,
  canRepair,
  ccHexes,
  carried,
  analyzeAntiTank,
  chance2d6,
  hitChance,
  vehicleLabel,
  isSewerEntrance,
  oddsColumn,
  range,
  squadType,
  tryAction,
  pendingRouts,
  routOptions,
  unitLabel,
  weaponType,
  type Action,
  type Ctx,
  type FireUnit,
  type GameState,
} from '@squadwar/engine';
import { FireCalc } from './FireCalc';
import { defaultFirers } from './firers';

/** Waiting for a hex click: where to put an artillery mark or a starshell, or where reinforcements come on. */
export type MapPick =
  | { kind: 'arty'; battery: string; op: 'request' | 'correct' | 'ffe' | 'move'; smoke?: boolean }
  | { kind: 'starshell'; unit: string }
  | { kind: 'enter'; units: string[] };

export interface ActionPanelProps {
  pick?: MapPick | undefined;
  setPick?: (p: MapPick | undefined) => void;
  ctx: Ctx;
  s: GameState;
  firers: FireUnit[];
  /** Selected units of the side to act. */
  selected?: readonly string[];
  /** Enemy units the viewer cannot identify (§25). */
  hidden?: ReadonlySet<string>;
  /** The selected engineers carry a flamethrower: fire it alone instead of the normal group (§22). */
  flame?: { on: boolean; toggle: () => void } | undefined;
  leader?: string;
  target?: HexKey;
  selectedHex?: HexKey;
  dispatch: (a: Action) => boolean;
  setTarget: (h: HexKey) => void;
  /** Add these units to the selection (forming a fire group with a neighbouring hex). */
  addUnits?: (ids: string[]) => void;
  /** The attacks open to the player now, best first (one per target hex). */
  shots?: readonly Shot[];
  /** Take up a shot: select its firers and its target, ready to confirm. */
  onShot?: (shot: Shot) => void;
}

/** One attack the player could make: a stack, a target hex, and what it should do. */
export interface Shot {
  readonly from: HexKey;
  readonly target: HexKey;
  readonly units: readonly string[];
  /** Expected enemy units broken or worse. */
  readonly score: number;
  /** Defensive Fire: an enemy unit moved through the target hex this phase, and whether it was in the open there. */
  readonly moved: boolean;
  readonly open: boolean;
  /** Enemy units stand in the target hex now. */
  readonly occupied: boolean;
  /** The target is a concealed stack: what is under it, and so the odds, are not known. */
  readonly concealed: boolean;
}

/** Friendly stacks next to the fire group that could join it (§8.6), nearest hex first. */
function groupCandidates(ctx: Ctx, s: GameState, selected: readonly string[]): { hex: HexKey; ids: string[]; label: string }[] {
  const side = s.awaiting;
  const mine = new Set(selected);
  const hexes = new Set(selected.map((id) => s.units[id]?.hex).filter((h): h is HexKey => !!h));
  const seen = new Set<HexKey>();
  const out: { hex: HexKey; ids: string[]; label: string }[] = [];
  for (const h of hexes) {
    for (const n of adjacentHexes(h)) {
      if (hexes.has(n) || seen.has(n) || !ctx.map.hexes[n]) continue;
      seen.add(n);
      const there = Object.values(s.units).filter((u) => u.hex === n && u.side === side && !u.broken && !mine.has(u.id) && !u.riding);
      const firing = defaultFirers(ctx, s, there.map((u) => u.id)).filter((f) => !(s.units[f.unit]!.firedPhase && s.units[f.unit]!.firedPhase !== s.phase));
      if (!firing.length) continue;
      out.push({ hex: n, ids: firing.map((f) => f.unit), label: firing.map((f) => unitLabel(ctx, s.units[f.unit]!)).join(', ') });
    }
  }
  return out;
}

/** How a shot is rated in the lists: the number of enemy units it should leave broken or worse. */
const expectText = (score: number): string => `breaks ≈${score.toFixed(1)}`;

/** The best few targets for a fire group, by expected broken-or-worse results. */
function bestTargets(ctx: Ctx, s: GameState, firers: FireUnit[], leader?: string): { hex: HexKey; score: number }[] {
  const side = s.awaiting;
  const cands = new Set(Object.values(s.units).filter((u) => u.side !== side && !u.hidden).map((u) => u.hex));
  if (s.phase === 'defensiveFire') for (const steps of Object.values(s.tracks)) for (const st of steps) cands.add(st.hex);
  const out: { hex: HexKey; score: number }[] = [];
  for (const h of cands) {
    try {
      const a = analyzeFire(ctx, s, firers, h, leader);
      const odds = fireOdds(ctx, s, a);
      let score = 0;
      for (const o of odds.units) {
        const u = s.units[o.unit]!;
        score += u.side === side ? -o.breakOrWorse : u.broken ? o.mc : o.breakOrWorse;
      }
      out.push({ hex: h, score });
    } catch {
      // Not attackable from here.
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3);
}

export function ActionPanel(props: ActionPanelProps) {
  const extra = <Specials {...props} />;
  const main = <PhaseActions {...props} />;
  return (
    <>
      {extra}
      {main}
    </>
  );
}

/** Smoke, flamethrowers, demolition charges and sewers (§22–27), when the selection allows them. */
function Specials({ ctx, s, selected = [], flame, selectedHex, dispatch, pick, setPick }: ActionPanelProps) {
  const side = s.awaiting;
  const hexId = (h: HexKey) => ctx.map.hexes[h]?.id ?? h;
  const ok = (a: Action) => tryAction(ctx, s, a).ok;
  const units = selected.map((id) => s.units[id]!).filter((u) => u && u.side === side);
  const rows: React.ReactNode[] = [];
  // Units waiting off the map are chosen below and stay chosen until they come on or are dropped.
  if (pick && setPick && pick.kind !== 'enter') {
    const text =
      pick.kind === 'starshell'
        ? 'Click the hex for the starshell (within 5 hexes)'
        : `Click the hex for the ${pick.op === 'request' ? 'artillery request' : pick.op === 'correct' ? 'corrected spotting round' : pick.op === 'move' ? 'moved fire for effect' : 'fire for effect'}`;
    rows.push(
      <Row key="pick" text={text}>
        <button className="btn tiny" onClick={() => setPick(undefined)}>
          Cancel
        </button>
      </Row>,
    );
  }
  // Building floors (§57): the selected units go up or down the stairs.
  if (floorsOn(s) && units.length > 0 && (s.phase === 'setup' || s.phase === 'movement' || s.phase === 'advance') && units.every((u) => u.hex === units[0]!.hex) && hasUpper(ctx, s, units[0]!.hex)) {
    const up = units.filter((u) => isUpper(ctx, s, u));
    const down = units.filter((u) => !isUpper(ctx, s, u));
    const cost = s.phase === 'setup' ? 'free' : s.phase === 'movement' ? `${STAIRS_MF} MF` : 'their advance';
    const errors: string[] = [];
    const stairs = (list: typeof units, upper: boolean) => {
      const a: Action = { type: 'floor', units: list.map((u) => u.id), upper };
      const r = tryAction(ctx, s, a);
      if (!r.ok) errors.push(r.error);
      return (
        <button key={String(upper)} className="btn tiny" disabled={!r.ok} title={r.ok ? undefined : r.error} onClick={() => dispatch(a)}>
          {upper ? '▲ Go upstairs' : '▼ Go downstairs'}
          {list.length < units.length ? ` (${list.length})` : ''} · {cost}
        </button>
      );
    };
    const btns = [down.length > 0 && stairs(down, true), up.length > 0 && stairs(up, false)];
    rows.push(
      <Row
        key="floor"
        stacked
        text={`Floors in ${hexId(units[0]!.hex)}: ${up.length ? `${up.length} upstairs` : ''}${up.length && down.length ? ', ' : ''}${down.length ? `${down.length} on the ground floor` : ''}`}
        why={
          errors[0] ??
          (s.phase === 'setup'
            ? 'This building has two floors. Upstairs, units see over the walls, hedges, woods and small buildings around it, and are seen from as far; on the ground floor they are out of that view.'
            : s.phase === 'movement'
              ? `The stairs cost ${STAIRS_MF} MF. A unit that uses them counts as moving on that floor: if the enemy can see it, he may fire on the unit there in his Defensive Fire. Leaving the hex from upstairs costs the stairs too.`
              : 'Taking the stairs is these units’ advance. It draws no defensive fire.')
        }
      >
        {btns}
      </Row>,
    );
  }
  // Offboard artillery (§45–46) and starshells (§49.6) in the Rally Phase.
  if (s.phase === 'rally') {
    for (const b of (s.batteries ?? []).filter((x) => x.side === side)) {
      const left = b.missions - b.used;
      const leaders = Object.values(s.units).filter(
        (u) => u.side === side && ctx.data.units[u.type]?.kind === 'leader' && !u.broken && Object.values(s.units).some((x) => x.hex === u.hex && x.side === side && carried(s, x).some((w) => weaponType(ctx, w).kind === 'RADIO' && !w.malfunctioned)),
      );
      const mark = b.mode === 'idle' ? 'nothing on the map' : `${b.mode === 'request' ? 'request' : b.mode === 'sr' ? 'spotting round' : 'fire for effect'} at ${b.hex ? hexId(b.hex) : '?'}`;
      rows.push(
        <Row
          key={`bat-${b.id}`}
          text={b.onboard ? `${s.vehicles[b.onboard] ? vehicleLabel(ctx, s.vehicles[b.onboard]!) : `${b.mm}mm`} · indirect fire (§63.4)` : `${b.mm}mm artillery · ${left} mission${left === 1 ? '' : 's'} left`}
          why={`Contact: ${b.contact && b.tried ? 'yes' : b.tried ? 'failed' : 'not tried'} · ${mark}${b.onboard ? ' · one-hex blast' : ''}`}
        >
          {!b.tried &&
            leaders.map((L) => (
              <button key={L.id} className="btn tiny primary" onClick={() => dispatch({ type: 'radio', battery: b.id, unit: L.id })} title="Roll for radio contact (§46.11)">
                Radio ({unitLabel(ctx, L)})
              </button>
            ))}
          {b.tried && b.contact && !b.acted && setPick && (
            <>
              {(b.mode === 'idle' || b.mode === 'request') && (
                <button className="btn tiny" onClick={() => setPick({ kind: 'arty', battery: b.id, op: 'request' })}>
                  Request…
                </button>
              )}
              {b.mode === 'sr' && (
                <>
                  <button className="btn tiny" onClick={() => setPick({ kind: 'arty', battery: b.id, op: 'correct' })}>
                    Correct…
                  </button>
                  <button className="btn tiny primary" onClick={() => setPick({ kind: 'arty', battery: b.id, op: 'ffe' })}>
                    Fire for effect…
                  </button>
                  <button className="btn tiny" onClick={() => setPick({ kind: 'arty', battery: b.id, op: 'ffe', smoke: true })}>
                    Smoke…
                  </button>
                </>
              )}
              {b.mode === 'ffe' && (
                <button className="btn tiny" onClick={() => setPick({ kind: 'arty', battery: b.id, op: 'move' })}>
                  Move FFE…
                </button>
              )}
              {b.mode !== 'idle' && (
                <button className="btn tiny" onClick={() => dispatch({ type: 'arty', battery: b.id, op: 'cancel' })}>
                  Call off
                </button>
              )}
            </>
          )}
        </Row>,
      );
    }
    const shells = s.starshellsLeft?.[side] ?? 0;
    if (ctx.scenario.night && shells > 0 && setPick) {
      for (const L of units.filter((u) => ctx.data.units[u.type]?.kind === 'leader' && !u.broken)) {
        rows.push(
          <Row key={`ss-${L.id}`} text={`Starshell · ${shells} left`} why="Lights everything within 3 hexes until after Close Combat (§49.6–49.7).">
            <button className="btn tiny" onClick={() => setPick({ kind: 'starshell', unit: L.id })}>
              Fire starshell…
            </button>
          </Row>,
        );
        break;
      }
    }
  }
  if (s.phase === 'prepFire' && (s.smokeLeft[side] ?? 0) > 0) {
    for (const u of units) {
      if (!squadType(ctx, u)?.assaultEngineer || u.smokeMade) continue;
      const spots = [u.hex, ...adjacentHexes(u.hex)].filter((h) => ctx.map.hexes[h] && ok({ type: 'smoke', unit: u.id, hex: h }));
      if (!spots.length) continue;
      rows.push(
        <Row key={`smoke-${u.id}`} text={`Smoke · ${s.smokeLeft[side]} left`} why="Only first thing in Prep Fire. Fire through it adds a die (§24).">
          {spots.map((h) => (
            <button key={h} className="btn tiny" onClick={() => dispatch({ type: 'smoke', unit: u.id, hex: h })}>
              {h === u.hex ? 'Here' : hexId(h)}
            </button>
          ))}
        </Row>,
      );
      break;
    }
  }
  // Digging in, cutting wire and clearing mines instead of firing (§53.5, §54.2, §55.5).
  if (s.phase === 'prepFire' && ctx.scenario.rulesLevel >= 53) {
    for (const u of units) {
      if (!squadType(ctx, u) || u.broken || u.firedPhase || u.riding) continue;
      const btns: React.ReactNode[] = [];
      if (ok({ type: 'dig', unit: u.id, work: 'entrench' }))
        btns.push(
          <button key="dig" className="btn tiny" title="2d6 (+2 in snow) of 5 or less, leader modifier applies (§54.2)" onClick={() => dispatch({ type: 'dig', unit: u.id, work: 'entrench' })}>
            Dig in
          </button>,
        );
      if (ok({ type: 'dig', unit: u.id, work: 'wire' }))
        btns.push(
          <button key="wire" className="btn tiny" title="2d6 at or under the squad's firepower clears it (§53.5)" onClick={() => dispatch({ type: 'dig', unit: u.id, work: 'wire' })}>
            Cut wire
          </button>,
        );
      if (ctx.scenario.rulesLevel >= 55) {
        const seen = new Set((s.forts?.mines ?? []).filter((m) => m.side === side || m.known).map((m) => m.hex));
        for (const h of [u.hex, ...adjacentHexes(u.hex)]) {
          if (!ctx.map.hexes[h] || (h !== u.hex && !seen.has(h)) || !ok({ type: 'dig', unit: u.id, work: 'mines', hex: h })) continue;
          btns.push(
            <button key={`m-${h}`} className="btn tiny" title="2d6 at or under the squad's firepower clears a minefield there (§55.5)" onClick={() => dispatch({ type: 'dig', unit: u.id, work: 'mines', hex: h })}>
              {h === u.hex ? 'Probe for mines' : `Clear mines ${hexId(h)}`}
            </button>,
          );
        }
      }
      if (!btns.length) continue;
      rows.push(
        <Row key={`dig-${u.id}`} text={`Field work (${unitLabel(ctx, u)})`} why="Takes the squad's whole Prep Fire; it may not move afterwards.">
          {btns}
        </Row>,
      );
    }
  }
  // Reinforcements and river landings (§60).
  if (s.phase === 'movement' && setPick) {
    for (const r of (s.reserves ?? []).filter((x) => x.side === side)) {
      if (r.turn > s.turn) {
        rows.push(<Row key={`res-${r.turn}`} text={`Reinforcements: ${r.units.length} units`} why={`They arrive on turn ${r.turn}.`} />);
        continue;
      }
      const limit = s.landing?.[side];
      const pickHere = (pick?.kind === 'enter' ? pick.units : []).filter((id) => r.units.some((u) => u.id === id));
      const squadsPicked = pickHere.filter((id) => ctx.data.units[r.units.find((u) => u.id === id)!.type]?.kind !== 'leader').length;
      const over = limit !== undefined && squadsPicked > limit;
      const toggle = (id: string) => {
        const next = pickHere.includes(id) ? pickHere.filter((x) => x !== id) : [...pickHere, id];
        setPick(next.length ? { kind: 'enter', units: next } : undefined);
      };
      const where = r.endsMove ? 'blue hex on the bank' : 'blue hex on the board edge';
      rows.push(
        <Row
          key={`res-${r.turn}-${r.units[0]!.id}`}
          stacked
          text={`${r.endsMove ? 'In the boats' : 'Reinforcements'}: ${r.units.length} unit${r.units.length === 1 ? '' : 's'}${limit !== undefined ? ` · boats land ${limit} more squad${limit === 1 ? '' : 's'} this turn` : ''}`}
          why={
            over
              ? `Only ${limit} more squad${limit === 1 ? '' : 's'} can land this turn: you have picked ${squadsPicked}.`
              : pickHere.length
                ? `${pickHere.length} picked: now click a ${where}. ${r.endsMove ? 'Landing ends their move (§60.2).' : 'They may keep moving.'}`
                : `1. Pick the units that come on together (up to three squads, and leaders, to a hex). 2. Click a ${where}.`
          }
        >
          {r.units.map((u) => (
            <button key={u.id} className={`btn tiny ${pickHere.includes(u.id) ? 'primary' : ''}`} aria-pressed={pickHere.includes(u.id)} onClick={() => toggle(u.id)}>
              {unitLabel(ctx, u)}
            </button>
          ))}
          {pickHere.length > 0 && (
            <button className="btn tiny ghost" onClick={() => setPick(undefined)}>
              Clear
            </button>
          )}
        </Row>,
      );
    }
  }
  if (flame && (s.phase === 'prepFire' || s.phase === 'defensiveFire' || s.phase === 'advancingFire')) {
    rows.push(
      <Row key="flame" text={flame.on ? 'Flamethrower selected' : 'Flamethrower ready'} why="20 FP up to 2 hexes, no modifiers; always fires alone. Out of fuel on 9+ (§22).">
        <button className={`btn tiny ${flame.on ? 'primary' : ''}`} onClick={flame.toggle}>
          {flame.on ? 'Back to normal fire' : 'Use flamethrower'}
        </button>
      </Row>,
    );
  }
  // Infantry against AFVs (§36–37).
  if (s.phase === 'prepFire' || s.phase === 'defensiveFire' || s.phase === 'advancingFire') {
    for (const u of units) {
      for (const w of carried(s, u)) {
        const kind = weaponType(ctx, w).kind;
        if (kind !== 'PF' && kind !== 'BAZ' && kind !== 'FT') continue;
        for (const v of Object.values(s.vehicles)) {
          if (v.side === side) continue;
          try {
            const a = analyzeAntiTank(ctx, s, [u.id], v.id, w.id);
            const p = (a.hit === undefined ? 1 : hitChance(a.hit, a.hitDrm ?? 0)) * chance2d6(a.kill!, a.killDrm ?? 0);
            rows.push(
              <Row key={`at-${w.id}-${v.id}`} text={`${weaponType(ctx, w).name} → ${vehicleLabel(ctx, v)} (${hexId(v.hex)})`} why={`${a.aspect} armour · about ${Math.round(p * 100)}% to knock it out`}>
                <button className="btn tiny primary" title={a.trace.join('\n')} onClick={() => dispatch({ type: 'antiTank', units: [u.id], vehicle: v.id, weapon: w.id })}>
                  Fire
                </button>
              </Row>,
            );
          } catch {
            // out of range or not possible
          }
        }
      }
    }
    if (s.phase === 'defensiveFire' && units.length && units.every((u) => u.hex === units[0]!.hex)) {
      for (const v of Object.values(s.vehicles)) {
        if (v.side === side || !v.moved || v.immobilized) continue;
        try {
          const a = analyzeAntiTank(ctx, s, units.map((u) => u.id), v.id);
          rows.push(
            <Row key={`imm-${v.id}`} text={`Grenade bundles on ${vehicleLabel(ctx, v)}`} why={`Each unit: pre-attack morale check, then ${a.immobilizeOn} or less immobilizes it (§36.1)`}>
              <button className="btn tiny primary" onClick={() => dispatch({ type: 'antiTank', units: units.map((u) => u.id), vehicle: v.id })}>
                Attack
              </button>
            </Row>,
          );
        } catch {
          // not adjacent to its path, or in the open
        }
      }
    }
  }
  if (s.phase === 'advancingFire') {
    for (const c of s.charges.filter((x) => x.side === side && x.armed)) {
      rows.push(
        <Row key={`dc-${c.weapon}`} text={`Charge on ${hexId(c.target)}`} why="30 FP on the IFT; terrain counts, smoke does not (§23).">
          <button className="btn tiny primary" onClick={() => dispatch({ type: 'detonate', weapon: c.weapon })}>
            Detonate
          </button>
        </Row>,
      );
    }
  }
  if (s.phase === 'movement') {
    for (const u of units) {
      const dc = carried(s, u).find((w) => weaponType(ctx, w).kind === 'DC');
      if (!dc) continue;
      const spots = adjacentHexes(u.hex).filter((h) => ctx.map.hexes[h] && ok({ type: 'placeCharge', unit: u.id, weapon: dc.id, target: h }));
      if (!spots.length) continue;
      rows.push(
        <Row key={`place-${u.id}`} text={`Demolition charge (${unitLabel(ctx, u)})`} why="Goes off in Advancing Fire if the engineers survive Defensive Fire unbroken (§23.3).">
          {spots.map((h) => (
            <button key={h} className="btn tiny" onClick={() => dispatch({ type: 'placeCharge', unit: u.id, weapon: dc.id, target: h })}>
              On {hexId(h)}
            </button>
          ))}
        </Row>,
      );
    }
    if (ctx.scenario.sewers && selectedHex && units.length && units.every((u) => u.hex === selectedHex) && isSewerEntrance(ctx, s, selectedHex)) {
      const ids = units.map((u) => u.id);
      const exits = Object.values(ctx.map.hexes)
        .filter((h) => h.key !== selectedHex && range(selectedHex, h.key) <= 3 && isSewerEntrance(ctx, s, h.key))
        .map((h) => h.key)
        .filter((h) => ok({ type: 'sewer', units: ids, to: h }));
      rows.push(
        <Row
          key="sewer"
          text="Sewer movement"
          why={exits.length ? 'A leader must go with squads. 1–4 gets through; 5–6 lost for a turn (§27).' : 'No usable entrance within 3 hexes for this group (it needs a leader and must not have moved).'}
        >
          {exits.map((h) => (
            <button key={h} className="btn tiny" onClick={() => dispatch({ type: 'sewer', units: ids, to: h })}>
              → {hexId(h)}
            </button>
          ))}
        </Row>,
      );
    }
  }
  if (!rows.length) return null;
  return <div className="actions specials">{rows}</div>;
}

function PhaseActions({ ctx, s, firers, leader, target, selectedHex, selected = [], hidden, dispatch, setTarget, addUnits, shots = [], onShot }: ActionPanelProps) {
  const side = s.awaiting;
  const label = (id: string) => (s.units[id] ? unitLabel(ctx, s.units[id]!) : id);
  const hexId = (h: HexKey) => ctx.map.hexes[h]?.id ?? h;
  switch (s.phase) {
    case 'setup': {
      const notes = ctx.scenario.sides.find((x) => x.id === side)?.notes;
      const onMap = Object.values(s.units).some((u) => u.side === side) || Object.values(s.vehicles).some((v) => v.side === side);
      if (!onMap) {
        // A force that arrives during play (boats, reinforcements) has nothing to place.
        const waiting = (s.reserves ?? []).filter((r) => r.side === side);
        const n = waiting.reduce((a, r) => a + r.units.length, 0);
        const first = waiting.length ? Math.min(...waiting.map((r) => r.turn)) : 1;
        const boats = waiting.some((r) => r.endsMove);
        return (
          <Hint>
            <span className="shots-note">
              <strong>Nothing to set up.</strong>{' '}
              {n > 0
                ? `Your ${n} units start ${boats ? 'in the boats' : 'off the map'}. They come on in your Movement Phase${first > 1 ? `, from turn ${first}` : ''}: this panel will list them then, for you to pick who ${boats ? 'lands' : 'enters'} and where.`
                : 'You have no units on the map.'}
            </span>
            {notes && <span className="faint">{notes}</span>}
            <button className="btn primary" onClick={() => dispatch({ type: 'endPhase' })}>
              End setup
            </button>
          </Hint>
        );
      }
      return (
        <Hint>
          Select units, then click a hex in your setup area (shaded) to place them. End the phase when ready.
          {floorsOn(s) && Object.values(s.units).some((u) => u.side === side && hasUpper(ctx, s, u.hex)) && (
            <span>
              Buildings of three or more hexes have two floors. Units start on the ground floor: select them and use Go upstairs to give them the upper floor’s view (and let the enemy see them from
              as far).
            </span>
          )}
          {Object.values(s.vehicles).some((v) => v.side === side) && (
            <span>
              To turn a gun or vehicle, click its hex a second time (or tick it in the list for that hex), then use Turn left and Turn right. The shaded wedge on the map is where it points. A
              further click lets go of the hex.
            </span>
          )}
          {notes && <span className="faint">{notes}</span>}
        </Hint>
      );
    }
    case 'rally': {
      const broken = Object.values(s.units).filter((u) => u.side === side && u.broken);
      const weapons = Object.values(s.weapons).filter((w) => w.side === side && w.malfunctioned);
      if (!broken.length && !weapons.length) return <Hint>Nothing to rally or repair.</Hint>;
      return (
        <div className="actions">
          {weapons.map((w) => {
            const why = canRepair(ctx, s, w.id);
            return (
              <Row key={w.id} text={`${weaponType(ctx, w).name} in ${hexId(w.hex)}`} why={why}>
                <button className="btn tiny" disabled={!!why} onClick={() => dispatch({ type: 'repair', weapon: w.id })}>
                  Repair (1 fixes, 6 lost)
                </button>
              </Row>
            );
          })}
          {broken.map((u) => {
            const why = canRally(ctx, s, u.id);
            return (
              <Row key={u.id} text={`${label(u.id)} in ${hexId(u.hex)}`} why={why}>
                <button className="btn tiny" disabled={!!why} onClick={() => dispatch({ type: 'rally', unit: u.id })}>
                  Rally{u.dm ? ' (DM −4)' : ''}
                </button>
              </Row>
            );
          })}
        </div>
      );
    }
    case 'prepFire':
    case 'defensiveFire':
    case 'advancingFire':
      if (!firers.length) {
        const movedHexes = new Set(Object.values(s.tracks).flatMap((steps) => steps.map((st) => st.hex)));
        const movedHit = shots.filter((x) => x.moved).length;
        return (
          <Hint>
            {s.phase === 'defensiveFire' && movedHexes.size > 0 && (
              <span className="shots-note">
                The enemy moved through {movedHexes.size} {movedHexes.size === 1 ? 'hex' : 'hexes'} this phase.{' '}
                {movedHit > 0
                  ? `You have a shot at ${movedHit} of them: they are ringed on the map, red where a unit was caught in the open (−2 on the dice).`
                  : 'None of them is in range and line of sight of a unit that can still fire.'}
              </span>
            )}
            {shots.length > 0 && onShot && (
              <span className="suggest shots">
                Your best shots, by enemy units expected broken:
                {shots.slice(0, 6).map((x) => (
                  <button key={`${x.from}>${x.target}`} className="btn tiny" title="Select these firers and this target; you still confirm the shot" onClick={() => onShot(x)}>
                    {hexId(x.from)} → {hexId(x.target)}
                    {x.open ? ' (in the open)' : x.moved && !x.occupied ? ' (moved through)' : ''} · {x.concealed ? 'concealed' : expectText(x.score)}
                  </button>
                ))}
              </span>
            )}
            {!shots.length && <span className="faint shots-note">No enemy is in range and line of sight right now.</span>}
            Select one of your stacks to fire with, then click a target hex. To fire together with a neighbouring hex, add it with the buttons that appear here, or shift-click it (on a touch
            screen, press and hold it).
          </Hint>
        );
      }
      if (!target) {
        const best = bestTargets(ctx, s, firers, leader);
        const more = addUnits ? groupCandidates(ctx, s, selected) : [];
        return (
          <Hint>
            Click an enemy hex{s.phase === 'defensiveFire' ? ' (or a ringed hex an enemy moved through)' : ''} to see the odds.
            {more.length > 0 && (
              <span className="suggest">
                Add to the fire group:
                {more.map((m) => (
                  <button key={m.hex} className="btn tiny" title={`${m.label} fire together with the selected units (§8.6)`} onClick={() => addUnits!(m.ids)}>
                    + {hexId(m.hex)} · {m.label}
                  </button>
                ))}
              </span>
            )}
            {best.length > 0 && (
              <span className="suggest">
                Suggested:
                {best.map((b) => (
                  <button key={b.hex} className="btn tiny" onClick={() => setTarget(b.hex)}>
                    {hexId(b.hex)} · {expectText(b.score)}
                  </button>
                ))}
              </span>
            )}
            {!best.length && <span className="faint">No target in line of sight and range.</span>}
          </Hint>
        );
      }
      return <FireCalc ctx={ctx} s={s} firers={firers} target={target} hidden={hidden} {...(leader ? { leader } : {})} onFire={() => dispatch({ type: 'fire', firers, target, ...(leader ? { leader } : {}) })} />;
    case 'movement':
      return (
        <Hint>
          Select units in one hex, then click where to go. The path shows MF used; squads moving with a leader the whole way get +2 MF. To move onto a hex that already holds your units,
          shift-click it (on a touch screen, press and hold it). To let go of a stack without moving it, click it again or use Deselect.
          {selectedHex && (
            <button className="btn tiny" onClick={() => dispatch({ type: 'endMove', units: Object.values(s.units).filter((u) => u.hex === selectedHex && u.side === side).map((u) => u.id) })}>
              Done moving here
            </button>
          )}
        </Hint>
      );
    case 'rout': {
      const pending = pendingRouts(ctx, s, side);
      if (!pending.length) return <Hint>No broken units need to rout.</Hint>;
      return (
        <div className="actions">
          <p className="small dim">Broken units must rout to cover (§13). Ending the phase routs the rest by the shortest legal route.</p>
          {pending.map((u) => {
            const plans = routOptions(ctx, s, u);
            return (
              <Row key={u.id} text={`${label(u.id)} in ${hexId(u.hex)}`} why={plans.length ? undefined : 'No legal route: will be eliminated (§13.47)'}>
                {plans.map((p) => (
                  <button key={p.dest} className="btn tiny" onClick={() => dispatch({ type: 'rout', unit: u.id, to: p.dest })}>
                    → {hexId(p.stop)}
                  </button>
                ))}
                {!plans.length && (
                  <button className="btn tiny" onClick={() => dispatch({ type: 'rout', unit: u.id })}>
                    Eliminate
                  </button>
                )}
              </Row>
            );
          })}
        </div>
      );
    }
    case 'advance':
      return <Hint>Select unbroken units and click an adjacent hex to advance one hex — into an enemy hex to start close combat.</Hint>;
    case 'closeCombat': {
      const hexes = ccHexes(s);
      return (
        <div className="actions">
          <p className="small dim">Close combat is resolved for both sides together (§20). Each side attacks with everything at its best odds unless you plan otherwise.</p>
          {hexes.map((h) => {
            const plan = autoPlan(ctx, s, side, h);
            return (
              <Row key={h} text={`${hexId(h)}`}>
                {plan.map((p, i) => {
                  const A = p.attackers.reduce((a, id) => a + (ctx.data.units[s.units[id]!.type] as { fp?: number }).fp! || 1, 0);
                  const D = p.defenders.reduce((a, id) => a + ((ctx.data.units[s.units[id]!.type] as { fp?: number }).fp ?? 1), 0);
                  return (
                    <span key={i} className="small">
                      {p.attackers.map(label).join(' + ')} vs {p.defenders.map(label).join(' + ')} · {ctx.data.tables.closeCombat.labels[oddsColumn(ctx, A, D)]}
                    </span>
                  );
                })}
              </Row>
            );
          })}
        </div>
      );
    }
    default:
      return null;
  }
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div className="hint small">{children}</div>;
}

/** One action with its buttons; `stacked` puts the buttons under the text, for a long list of them. */
function Row({ text, why, children, stacked }: { text: string; why?: string | undefined; children?: React.ReactNode; stacked?: boolean }) {
  return (
    <div className={`action-row ${stacked ? 'stacked' : ''}`}>
      <div>
        {text}
        {why && <div className="faint small">{why}</div>}
      </div>
      <div className="action-btns">{children}</div>
    </div>
  );
}

export function adjacentHexes(h: HexKey): HexKey[] {
  return DIRECTIONS.map((d) => hexKey(neighbor(parseHexKey(h), d)));
}
