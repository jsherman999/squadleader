import type { GameMap } from '@squadwar/terrain';
import type { LosResult } from '@squadwar/los';
import { ProfileChart } from './ProfileChart';

const level = (r: LosResult, which: 'from' | 'to') => {
  const e = r[which];
  const h = which === 'from' ? r.fromHeight : r.toHeight;
  return `${e.upper ? 'upper level, ' : ''}height ${h}`;
};

export function LosPanel({ map, r }: { map: GameMap; r: LosResult }) {
  const fromId = map.hexes[r.from.hex]?.id;
  const toId = map.hexes[r.to.hex]?.id;
  return (
    <div className="panel-card">
      <div className="los-head">
        <span className={`los-badge ${r.clear ? 'ok' : 'bad'}`}>{r.clear ? 'CLEAR' : 'BLOCKED'}</span>
        <span className="mono">
          {fromId} → {toId}
        </span>
      </div>
      <p className="los-reason">{r.reason}</p>
      <div className="los-meta dim">
        <div>
          Firer: {level(r, 'from')} · Target: {level(r, 'to')}
        </div>
        {r.targetHexside && (
          <div>
            Crosses a {r.targetHexside.wall ? 'wall' : 'hedge'} on the target hexside: +{r.targetHexside.wall ? 2 : 1} to the fire roll (§11.53).
          </div>
        )}
        {r.marginal && <div className="warn">Marginal: the line only clips a symbol edge (§7.1).</div>}
      </div>
      <ProfileChart map={map} r={r} />
    </div>
  );
}
