import type { HexKey } from '@squadwar/hex';
import { leaderRating, mfAllowance, mpLeft, unitsIn, vehicleLabel, vehicleType, weaponType, weaponsIn, type Ctx, type GameState } from '@squadwar/engine';

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
  const loose = weaponsIn(s, hex).filter((w) => w.owner === null);
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
          {onTransfer && selected.length === 1 && (
            <button className="btn tiny" onClick={() => onTransfer(w.id, selected[0]!)}>
              Pick up
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
