import type { HexKey } from '@squadwar/hex';
import { leaderRating, mfAllowance, unitsIn, weaponType, weaponsIn, type Ctx, type GameState } from '@squadwar/engine';

export function StackPanel({
  ctx,
  s,
  hex,
  selected,
  onToggle,
  onTransfer,
}: {
  ctx: Ctx;
  s: GameState;
  hex: HexKey;
  selected: readonly string[];
  onToggle: (id: string) => void;
  onTransfer?: (weapon: string, to: string | null) => void;
}) {
  const units = unitsIn(s, hex);
  const loose = weaponsIn(s, hex).filter((w) => w.owner === null);
  const sideName = (id: string) => s.sides.find((x) => x.id === id)?.name ?? id;
  if (!units.length && !loose.length) return null;
  return (
    <div className="stack">
      {units.map((u) => {
        const t = ctx.data.units[u.type]!;
        const mine = u.side === s.awaiting;
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
