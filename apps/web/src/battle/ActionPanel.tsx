import { DIRECTIONS, hexKey, neighbor, parseHexKey, type HexKey } from '@squadwar/hex';
import {
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

export interface ActionPanelProps {
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
}

/** The best few targets for a fire group, by expected broken-or-worse results. */
function bestTargets(ctx: Ctx, s: GameState, firers: FireUnit[], leader?: string): { hex: HexKey; score: number }[] {
  const side = s.awaiting;
  const cands = new Set(Object.values(s.units).filter((u) => u.side !== side).map((u) => u.hex));
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
function Specials({ ctx, s, selected = [], flame, selectedHex, dispatch }: ActionPanelProps) {
  const side = s.awaiting;
  const hexId = (h: HexKey) => ctx.map.hexes[h]?.id ?? h;
  const ok = (a: Action) => tryAction(ctx, s, a).ok;
  const units = selected.map((id) => s.units[id]!).filter((u) => u && u.side === side);
  const rows: React.ReactNode[] = [];
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

function PhaseActions({ ctx, s, firers, leader, target, selectedHex, hidden, dispatch, setTarget }: ActionPanelProps) {
  const side = s.awaiting;
  const label = (id: string) => (s.units[id] ? unitLabel(ctx, s.units[id]!) : id);
  const hexId = (h: HexKey) => ctx.map.hexes[h]?.id ?? h;
  switch (s.phase) {
    case 'setup':
      return <Hint>Select units, then click a hex in your setup area (shaded) to place them. End the phase when ready.</Hint>;
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
      if (!firers.length) return <Hint>Select your firing units (shift-click adjacent hexes to form a fire group), then click a target hex.</Hint>;
      if (!target) {
        const best = bestTargets(ctx, s, firers, leader);
        return (
          <Hint>
            Click an enemy hex{s.phase === 'defensiveFire' ? ' (or a hex an enemy moved through, marked with dots)' : ''} to see the odds.
            {best.length > 0 && (
              <span className="suggest">
                Suggested:
                {best.map((b) => (
                  <button key={b.hex} className="btn tiny" onClick={() => setTarget(b.hex)}>
                    {hexId(b.hex)} · {Math.round(b.score * 100)}%
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
          Select units in one hex, then click where to go. The path shows MF used; squads moving with a leader the whole way get +2 MF.
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

function Row({ text, why, children }: { text: string; why?: string | undefined; children?: React.ReactNode }) {
  return (
    <div className="action-row">
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
