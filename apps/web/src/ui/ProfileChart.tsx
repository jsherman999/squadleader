import type { GameMap } from '@squadwar/terrain';
import { losProfile, type LosResult } from '@squadwar/los';

const W = 300;
const H = 120;
const PAD = { l: 26, r: 8, t: 10, b: 20 };

/** Side view of the LOS: ground, obstacle tops, the sight line (§43.9). */
export function ProfileChart({ map, r }: { map: GameMap; r: LosResult }) {
  const prof = losProfile(map, r);
  const maxLevel = Math.max(3, r.fromHeight + 1, r.toHeight + 1, ...prof.map((p) => (p.top ?? p.ground) + 1));
  const x = (t: number) => PAD.l + t * (W - PAD.l - PAD.r);
  const y = (lv: number) => H - PAD.b - (lv / maxLevel) * (H - PAD.t - PAD.b);
  const blockT = r.blockedBy?.t;
  const eye = 0.35; // drawn eye height so the line sits above the ground
  return (
    <svg className="profile" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Elevation profile along the line of sight">
      {Array.from({ length: maxLevel + 1 }, (_, lv) => (
        <g key={lv}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(lv)} y2={y(lv)} className="profile-grid" />
          <text x={4} y={y(lv) + 3} className="profile-axis">
            L{lv}
          </text>
        </g>
      ))}
      {prof.map((p, i) => (
        <rect key={`g${i}`} x={x(p.t0)} width={Math.max(0.5, x(p.t1) - x(p.t0))} y={y(p.ground)} height={y(0) - y(p.ground) + 1} className="profile-ground" />
      ))}
      {prof
        .filter((p) => p.top !== undefined)
        .map((p, i) => (
          <rect
            key={`o${i}`}
            x={x(p.t0)}
            width={Math.max(1, x(p.t1) - x(p.t0))}
            y={y(p.top!)}
            height={y(p.ground) - y(p.top!)}
            className={`profile-${p.kind} ${r.blockedBy?.hex === p.hex ? 'profile-hit' : ''}`}
          />
        ))}
      {r.obstacles
        .filter((o) => o.kind === 'wall' || o.kind === 'hedge')
        .map((o, i) => (
          <rect key={`w${i}`} x={x(o.t) - 1.5} width={3} y={y(o.height)} height={y(o.height - 0.5) - y(o.height)} className={`profile-${o.kind} ${r.blockedBy === o ? 'profile-hit' : ''}`} />
        ))}
      <line x1={x(0)} y1={y(r.fromHeight + eye)} x2={x(1)} y2={y(r.toHeight + eye)} className={r.clear ? 'profile-sight' : 'profile-sight blocked'} />
      {blockT !== undefined && <circle cx={x(blockT)} cy={y(r.fromHeight + eye + (r.toHeight - r.fromHeight) * blockT)} r={3.5} className="profile-stop" />}
      <circle cx={x(0)} cy={y(r.fromHeight + eye)} r={3.5} className="profile-end" />
      <circle cx={x(1)} cy={y(r.toHeight + eye)} r={3.5} className="profile-end" />
      <text x={x(0)} y={H - 5} className="profile-axis">
        {map.hexes[r.from.hex]?.localId}
      </text>
      <text x={x(1)} y={H - 5} textAnchor="end" className="profile-axis">
        {map.hexes[r.to.hex]?.localId}
      </text>
    </svg>
  );
}
