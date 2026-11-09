import { DIRECTIONS, hexKey, neighbor, parseHexKey, type HexKey } from '@squadwar/hex';
import {
  analyzeFire,
  fireOdds,
  autoPlan,
  canRally,
  canRepair,
  ccHexes,
  oddsColumn,
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

export function ActionPanel({ ctx, s, firers, leader, target, selectedHex, dispatch, setTarget }: ActionPanelProps) {
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
      return <FireCalc ctx={ctx} s={s} firers={firers} target={target} {...(leader ? { leader } : {})} onFire={() => dispatch({ type: 'fire', firers, target, ...(leader ? { leader } : {}) })} />;
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
