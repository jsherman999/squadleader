import { analyzeFire, fireOdds, resultText, iftLookup, unitLabel, type Ctx, type FireUnit, type GameState } from '@squadwar/engine';
import type { HexKey } from '@squadwar/hex';

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function FireCalc({
  ctx,
  s,
  firers,
  target,
  leader,
  hidden,
  onFire,
}: {
  ctx: Ctx;
  s: GameState;
  firers: FireUnit[];
  target: HexKey;
  leader?: string;
  hidden?: ReadonlySet<string> | undefined;
  onFire: () => void;
}) {
  let a;
  try {
    a = analyzeFire(ctx, s, firers, target, leader);
  } catch (e) {
    return <div className="calc error">{(e as Error).message}</div>;
  }
  const odds = fireOdds(ctx, s, a);
  return (
    <div className="calc">
      <div className="calc-head">
        <span className="calc-fp">{Number.isInteger(a.totalFp) ? a.totalFp : a.totalFp.toFixed(1)} FP</span>
        <span>→ column {a.column >= 0 ? a.columnFp : '—'}</span>
        {a.leaderDrm !== 0 && <span className="dim">leader {a.leaderDrm}</span>}
      </div>
      <ul className="calc-trace">
        {a.trace.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
      <table className="odds">
        <thead>
          <tr>
            <th>Target</th>
            <th>DRM</th>
            <th>KIA</th>
            <th>MC</th>
            <th title="Broken or worse">Break+</th>
          </tr>
        </thead>
        <tbody>
          {odds.units.map((o) => {
            const u = s.units[o.unit]!;
            const enemy = u.side !== a.side;
            return (
              <tr key={o.unit} className={enemy ? '' : 'friendly'}>
                <td>
                  {hidden?.has(u.id) ? 'Concealed unit' : unitLabel(ctx, u)}
                  {!enemy && ' (yours)'}
                  {o.hex !== target && <span className="dim"> · {ctx.map.hexes[o.hex]?.id}</span>}
                </td>
                <td className="mono">{o.drm > 0 ? `+${o.drm}` : o.drm}</td>
                <td>
                  <Bar p={o.kia} />
                </td>
                <td>
                  <Bar p={o.mc} />
                </td>
                <td>
                  <Bar p={o.breakOrWorse} strong />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="dim small">
        On a 7: {resultText(iftLookup(ctx, a.column, 7 + (a.targets[0]?.units[0]?.drm ?? 0)))}
        {odds.breakdown > 0 && <> · weapon malfunction {pct(odds.breakdown)}</>}
      </div>
      <button className="btn primary fire-btn" onClick={onFire}>
        Fire
      </button>
    </div>
  );
}

function Bar({ p, strong }: { p: number; strong?: boolean }) {
  return (
    <span className="bar" title={pct(p)}>
      <span className={`bar-fill ${strong ? 'strong' : ''}`} style={{ width: pct(p) }} />
      <span className="bar-label">{pct(p)}</span>
    </span>
  );
}
