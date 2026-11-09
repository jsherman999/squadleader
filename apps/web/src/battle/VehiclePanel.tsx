import type { HexKey } from '@squadwar/hex';
import {
  analyzeVehicleFire,
  enemiesIn,
  FACING_NAMES,
  mpLeft,
  vehicleFireOdds,
  vehicleLabel,
  vehicleType,
  type Action,
  type Ctx,
  type GameState,
  type VehicleFireRequest,
} from '@squadwar/engine';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const FIRE = new Set(['prepFire', 'defensiveFire', 'advancingFire']);

/** Orders for the selected tank or SP gun: facing, movement, gun and MG fire, repairs (§28–41). */
export function VehiclePanel({
  ctx,
  s,
  vehicle,
  target,
  hidden,
  dispatch,
}: {
  ctx: Ctx;
  s: GameState;
  vehicle: string;
  target?: HexKey | undefined;
  hidden?: ReadonlySet<string>;
  dispatch: (a: Action) => boolean;
}) {
  const v = s.vehicles[vehicle];
  if (!v) return null;
  const t = vehicleType(ctx, v);
  const hexId = (h: HexKey) => ctx.map.hexes[h]?.id ?? h;
  const turn = (d: number) => dispatch({ type: 'face', vehicle: v.id, facing: (v.facing + d + 6) % 6 });
  const status = [v.immobilized ? 'immobilized' : '', v.gun !== 'ok' ? `gun ${v.gun}` : '', v.mg !== 'ok' ? `MGs ${v.mg}` : '', v.ce ? 'crew exposed' : ''].filter(Boolean);
  const head = (
    <div className="vehicle-head">
      <strong>{vehicleLabel(ctx, v)}</strong>
      <span className="dim small">
        {' '}
        {t.kind === 'tank' ? 'tank' : 'SP gun'} · {t.gun ? `${t.gun}mm${t.heOnly ? ' HE only' : ''}${t.lowVelocity ? ' *' : ''}` : 'no gun'} · MG {t.mgCA}/{t.mg360} · {t.mp} MP · arc {FACING_NAMES[v.facing]}
      </span>
      {status.length > 0 && <div className="small warn">{status.join(' · ')}</div>}
    </div>
  );
  const facingButtons = (cost: string) => (
    <div className="action-btns">
      <button className="btn tiny" onClick={() => turn(-1)} title="Turn left">
        ↺ Turn left{cost}
      </button>
      <button className="btn tiny" onClick={() => turn(1)} title="Turn right">
        Turn right ↻{cost}
      </button>
    </div>
  );
  if (s.phase === 'setup')
    return (
      <div className="actions">
        {head}
        <p className="small dim">Click a hex in your setup area to place it. The covered arc (shaded) is where its gun points (§29.4).</p>
        {facingButtons('')}
      </div>
    );
  if (s.phase === 'rally')
    return (
      <div className="actions">
        {head}
        {(v.gun === 'malfunctioned' || v.mg === 'malfunctioned') && !v.repairTried ? (
          <button className="btn tiny" onClick={() => dispatch({ type: 'vrepair', vehicle: v.id })}>
            Repair (1 fixes, 6 disables)
          </button>
        ) : (
          <p className="small dim">Nothing to repair.</p>
        )}
      </div>
    );
  if (s.phase === 'movement')
    return (
      <div className="actions">
        {head}
        <p className="small dim">
          {v.immobilized ? 'Immobilized: it cannot move or pivot (§39).' : v.moveDone ? 'Finished moving.' : `${mpLeft(ctx, v)} of ${t.mp} MP left. Click a hex to drive there. Turning is free once it has moved; in its starting hex it costs 2 MP (§30.5). Woods and wooden buildings risk a breakdown (§39.1).`}
        </p>
        {!v.immobilized && !v.moveDone && (
          <>
            {facingButtons(v.moved ? '' : ' (2 MP)')}
            <button className="btn tiny" onClick={() => dispatch({ type: 'vstop', vehicle: v.id })}>
              Done moving
            </button>
          </>
        )}
      </div>
    );
  if (!FIRE.has(s.phase)) return <div className="actions">{head}</div>;
  // Fire phases.
  const opts: { req: VehicleFireRequest; label: string; odds: string; why: string[] }[] = [];
  const errors: string[] = [];
  if (target) {
    const reqs: { req: VehicleFireRequest; label: string }[] = [];
    for (const ev of Object.values(s.vehicles)) {
      if (ev.side === v.side || ev.hex !== target) continue;
      if (!t.heOnly) reqs.push({ req: { vehicle: v.id, target, weapon: 'main', vs: ev.id, ammo: 'AP' }, label: `Gun (AP) at ${vehicleLabel(ctx, ev)}` });
      reqs.push({ req: { vehicle: v.id, target, weapon: 'main', vs: ev.id, ammo: 'HE' }, label: `Gun (HE) at ${vehicleLabel(ctx, ev)}` });
    }
    if (enemiesIn(s, target, v.side).length || (s.phase === 'defensiveFire' && Object.entries(s.tracks).some(([id, st]) => s.units[id]?.side !== v.side && st.some((x) => x.hex === target)))) {
      reqs.push({ req: { vehicle: v.id, target, weapon: 'main' }, label: 'Gun (HE) at the infantry' });
      reqs.push({ req: { vehicle: v.id, target, weapon: 'mg', mgs: ['ca'] }, label: 'Covered-arc MG' });
      if (t.mg360) reqs.push({ req: { vehicle: v.id, target, weapon: 'mg' }, label: 'All MGs (crew exposed)' });
    }
    for (const { req, label } of reqs) {
      try {
        const a = analyzeVehicleFire(ctx, s, req);
        const o = vehicleFireOdds(ctx, s, a);
        const odds = req.vs
          ? `hit ${pct(o.hit)} · kill ${pct(o.kill!)}`
          : `${req.weapon === 'main' ? `hit ${pct(o.hit)} · ` : ''}break+ ${(o.units ?? []).map((x) => (hidden?.has(x.unit) ? '?' : pct(x.breakOrWorse))).join(' / ')}`;
        opts.push({ req, label, odds, why: a.trace });
      } catch (e) {
        errors.push(`${label}: ${(e as Error).message}`);
      }
    }
  }
  return (
    <div className="actions">
      {head}
      {!target && <p className="small dim">Click an enemy hex to see this vehicle’s shots. Its main gun fires once per turn; MGs once each (§33.2).</p>}
      {target && <p className="small">Target {hexId(target)}</p>}
      {opts.map((o) => (
        <div key={o.label} className="action-row">
          <div>
            {o.label}
            <div className="faint small" title={o.why.join('\n')}>
              {o.odds}
            </div>
          </div>
          <div className="action-btns">
            <button className="btn tiny primary" onClick={() => dispatch({ type: 'vfire', ...o.req } as Action)}>
              Fire
            </button>
          </div>
        </div>
      ))}
      {target && !opts.length && <p className="small warn">{errors[0] ?? 'No shot at that hex.'}</p>}
      {t.smokeDischarger && !v.smokeUsed && (
        <button className="btn tiny" onClick={() => dispatch({ type: 'discharge', vehicle: v.id })} title="Smoke in its own hex, once per game; counts as firing the gun (§41.4)">
          Smoke dischargers
        </button>
      )}
    </div>
  );
}
