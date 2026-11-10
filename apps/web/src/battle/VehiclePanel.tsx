import { DIRECTIONS, hexKey, neighbor, parseHexKey, type HexKey } from '@squadwar/hex';
import {
  analyzeVehicleFire,
  enemiesIn,
  FACING_NAMES,
  mpLeft,
  tryAction,
  unitLabel,
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
const KIND_NAMES: Record<string, string> = { tank: 'tank', spg: 'SP gun', halftrack: 'halftrack', gun: 'gun', truck: 'truck', jeep: 'jeep', mortar: 'mortar' };

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
  const isGun = t.kind === 'gun' || t.kind === 'mortar';
  const aboard = Object.values(s.units).filter((u) => u.riding === v.id);
  const status = [v.immobilized ? 'immobilized' : '', v.gun !== 'ok' ? `gun ${v.gun}` : '', v.mg !== 'ok' ? `MGs ${v.mg}` : '', v.ce ? 'crew exposed' : ''].filter(Boolean);
  const head = (
    <div className="vehicle-head">
      <strong>{vehicleLabel(ctx, v)}</strong>
      <span className="dim small">
        {' '}
        {KIND_NAMES[t.kind] ?? t.kind} · {t.gun ? `${t.gun}mm${t.heOnly ? ' HE only' : ''}${t.lowVelocity ? ' *' : ''}${t.heat ? (v.heatOut ? ' · HEAT out' : ' · HEAT') : ''}` : 'no gun'}
        {t.mgCA || t.mg360 ? ` · MG ${t.mgCA}/${t.mg360}` : ''}
        {isGun ? ` · ROF ${t.rof ?? 1}` : ` · ${t.mp} MP`}
        {t.kind === 'mortar' ? ` · range ${t.minRange ?? 10}–${t.maxRange ?? 60}` : ` · arc ${FACING_NAMES[v.facing]}`}
      </span>
      {aboard.length > 0 && <div className="small">Riding: {aboard.map((u) => unitLabel(ctx, u)).join(', ')}</div>}
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
        <p className="small dim">
          Click a hex in your setup area to place it. The covered arc (the shaded wedge) is where its gun points (§29.4): turn it with the buttons below, as often as you like during setup. Click the
          hex again to let go of it.
        </p>
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
  if (s.phase === 'movement') {
    const ok = (a: Action) => tryAction(ctx, s, a).ok;
    const walkers = Object.values(s.units).filter((u) => u.hex === v.hex && u.side === v.side && !u.riding && !u.broken && u.mfSpent === 0 && !u.moveDone);
    const loadable = walkers.filter((u) => ok({ type: 'board', units: [u.id], vehicle: v.id }));
    if (isGun) {
      const pusher = Object.values(s.units).find((u) => u.hex === v.hex && u.side === v.side && !u.broken && u.mfSpent === 0 && ctx.data.units[u.type]?.kind !== 'leader');
      const spots = pusher ? DIRECTIONS.map((d) => hexKey(neighbor(parseHexKey(v.hex), d))).filter((h) => ok({ type: 'push', unit: pusher.id, gun: v.id, to: h })) : [];
      return (
        <div className="actions">
          {head}
          <p className="small dim">
            {t.kind === 'mortar' ? 'A mortar is pushed one hex by its crew or a squad that has not moved (§63.6). It fires in any direction.' : 'An AT gun is turned or pushed one hex by its crew or a squad that has not moved (§48.4–48.5). Turning it means +3 to hit in Advancing Fire.'}
          </p>
          {t.kind !== 'mortar' && facingButtons('')}
          {pusher && spots.length > 0 && (
            <div className="action-btns">
              {spots.map((h) => (
                <button key={h} className="btn tiny" onClick={() => dispatch({ type: 'push', unit: pusher.id, gun: v.id, to: h })}>
                  Push → {ctx.map.hexes[h]?.id}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }
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
        {loadable.length > 0 && (
          <div className="action-row">
            <div>
              Load infantry
              <div className="faint small">Up to 2 units, 1 squad; the vehicle can’t move this turn (§31.1–31.3)</div>
            </div>
            <div className="action-btns">
              {loadable.map((u) => (
                <button key={u.id} className="btn tiny" onClick={() => dispatch({ type: 'board', units: [u.id], vehicle: v.id })}>
                  {unitLabel(ctx, u)}
                </button>
              ))}
            </div>
          </div>
        )}
        {aboard.length > 0 && ok({ type: 'unload', units: aboard.map((u) => u.id), vehicle: v.id }) && (
          <button className="btn tiny" onClick={() => dispatch({ type: 'unload', units: aboard.map((u) => u.id), vehicle: v.id })} title="2 MP; the riders may move one hex more (§31.4)">
            Unload riders
          </button>
        )}
      </div>
    );
  }
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
      if (t.heat && !v.heatOut) reqs.push({ req: { vehicle: v.id, target, weapon: 'main', vs: ev.id, ammo: 'HEAT' }, label: `Gun (HEAT) at ${vehicleLabel(ctx, ev)}` });
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
      {!target && (
        <p className="small dim">
          {t.kind === 'mortar'
            ? 'Click an enemy hex 10 or more hexes away that the crew can see. For targets out of sight, a leader with a radio calls indirect fire in the Rally Phase (§63.4).'
            : 'Click an enemy hex to see this vehicle’s shots. Its main gun fires once per turn; MGs once each (§33.2).'}
        </p>
      )}
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
