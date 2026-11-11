import type { HexKey } from '@squadwar/hex';
import { floorsOn, hasUpper, isUpper, leaderRating, mfAllowance, mpLeft, unitsIn, vehicleLabel, vehicleType, weaponType, weaponsIn, type Ctx, type GameState } from '@squadwar/engine';

export function StackPanel({
  ctx,
  s,
  hex,
  hidden,
  selected,
  onToggle,
  onTransfer,
  vehicle,
  onVehicle,
}: {
  ctx: Ctx;
  s: GameState;
  hex: HexKey;
  /** Enemy units the viewer cannot identify (§25). */
  hidden?: ReadonlySet<string>;
  selected: readonly string[];
  onToggle: (id: string) => void;
  onTransfer?: (weapon: string, to: string | null) => void;
  /** The selected vehicle, and picking one. */
  vehicle?: string | undefined;
  onVehicle?: (id: string | undefined) => void;
}) {
  const units = unitsIn(s, hex);
  // A building of three or more hexes has two floors (§57): each unit is on one of them.
  const floors = floorsOn(s) && hasUpper(ctx, s, hex);
  const loose = weaponsIn(s, hex).filter((w) => w.owner === null);
  // Units of the side to act that could pick up a weapon lying here (§5.7).
  const carriers = units.filter((u) => u.side === s.awaiting && !u.broken && !u.riding);
  const vehicles = Object.values(s.vehicles).filter((v) => v.hex === hex);
  const wrecks = s.wrecks.filter((w) => w.hex === hex).length;
  const sideName = (id: string) => s.sides.find((x) => x.id === id)?.name ?? id;
  if (!units.length && !loose.length && !vehicles.length && !wrecks) return null;
  return (
    <div className="stack">
      {vehicles.map((v) => {
        const t = vehicleType(ctx, v);
        const mine = v.side === s.awaiting;
        return (
          <label key={v.id} className={`stack-row ${mine ? '' : 'enemy'}`}>
            {mine && onVehicle && <input type="checkbox" checked={vehicle === v.id} onChange={() => onVehicle(vehicle === v.id ? undefined : v.id)} />}
            <span className={`chip nation-${s.sides.find((x) => x.id === v.side)?.nation}`}>{sideName(v.side)}</span>
            <span className="stack-name">
              {vehicleLabel(ctx, v)} <span className="dim small">{t.gun ? `${t.gun}mm` : ''}</span>
              {v.immobilized && <span className="tag bad">immobilized</span>}
              {v.gun !== 'ok' && <span className="tag bad">gun {v.gun}</span>}
              {v.ce && <span className="tag">CE</span>}
              {v.firedPhase && <span className="tag">fired</span>}
              {v.moved && <span className="tag">moved</span>}
            </span>
            {mine && s.phase === 'movement' && <span className="dim small mono">{mpLeft(ctx, v)}/{t.mp} MP</span>}
          </label>
        );
      })}
      {wrecks > 0 && <div className="stack-row loose dim small">{wrecks} wreck{wrecks > 1 ? 's' : ''}: cover +1 for infantry here (§40.5)</div>}
      {units.map((u) => {
        const t = ctx.data.units[u.type]!;
        const mine = u.side === s.awaiting;
        if (hidden?.has(u.id)) {
          return (
            <div key={u.id} className="stack-row enemy">
              <span className={`chip nation-${s.sides.find((x) => x.id === u.side)?.nation}`}>{sideName(u.side)}</span>
              <span className="stack-name">
                Concealed <span className="tag">?</span>
                <span className="dim small"> strength unknown until it fires, moves or is hit (§25)</span>
              </span>
            </div>
          );
        }
        const al = s.phase === 'movement' && mine ? mfAllowance(ctx, s, u) : undefined;
        return (
          <label key={u.id} className={`stack-row ${mine ? '' : 'enemy'} ${u.broken ? 'broken' : ''}`}>
            {mine && <input type="checkbox" checked={selected.includes(u.id)} onChange={() => onToggle(u.id)} />}
            <span className={`chip nation-${s.sides.find((x) => x.id === u.side)?.nation}`}>{sideName(u.side)}</span>
            <span className="stack-name">
              {t.kind === 'leader' ? `${u.name ?? 'Leader'} ${leaderRating(t.morale, t.leadership)}` : `${t.name} ${t.fp}-${t.range}-${t.morale}`}
              {u.broken && <span className="tag bad">broken{u.dm ? ' · DM' : ''}</span>}
              {u.berserk && <span className="tag bad">berserk</span>}
              {u.firedPhase && <span className="tag">fired</span>}
              {u.moved && <span className="tag">moved {u.mfSpent} MF</span>}
              {u.concealed && <span className="tag">concealed</span>}
              {floors && <span className={`tag ${isUpper(ctx, s, u) ? 'floor-up' : ''}`}>{isUpper(ctx, s, u) ? '▲ upstairs' : 'ground floor'}</span>}
            </span>
            {al && <span className="dim small mono" title={al.parts.join('\n')}>{Math.max(0, al.mf - u.mfSpent)}/{al.mf} MF</span>}
            {u.weapons.map((wid) => {
              const w = s.weapons[wid]!;
              return (
                <span key={wid} className={`tag weapon ${w.malfunctioned ? 'bad' : ''}`}>
                  {weaponType(ctx, w).kind}
                  {w.malfunctioned ? ' ✕' : ''}
                  {mine && onTransfer && (
                    <button className="tag-btn" title="Drop" onClick={(e) => (e.preventDefault(), onTransfer(wid, null))}>
                      ↓
                    </button>
                  )}
                </span>
              );
            })}
          </label>
        );
      })}
      {loose.map((w) => (
        <div key={w.id} className="stack-row loose">
          <span className="tag weapon">{weaponType(ctx, w).name}</span>
          <span className="dim small">lying here{w.malfunctioned ? ', malfunctioned' : ''}</span>
          {/* One unit ticked: it picks the weapon up. Otherwise a button for each unit that could. */}
          {onTransfer && (s.phase === 'setup' || s.phase === 'movement') ? (
            carriers.length === 0 ? (
              <span className="dim small">· move one of your units here to pick it up</span>
            ) : (
              (selected.length === 1 && carriers.some((u) => u.id === selected[0]) ? carriers.filter((u) => u.id === selected[0]) : carriers).map((u) => {
                const ut = ctx.data.units[u.type]!;
                return (
                  <button key={u.id} className="btn tiny" onClick={() => onTransfer(w.id, u.id)}>
                    Pick up: {ut.kind === 'leader' ? (u.name ?? 'leader') : `${ut.fp}-${ut.range}-${ut.morale}`}
                  </button>
                );
              })
            )
          ) : (
            <span className="dim small">· can be picked up in your Movement Phase</span>
          )}
        </div>
      ))}
    </div>
  );
}
