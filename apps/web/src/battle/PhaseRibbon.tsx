import { PHASE_NAMES, PLAYER_TURN_PHASES, objectiveStatus, type Ctx, type GameState } from '@squadwar/engine';

export function PhaseRibbon({ ctx, s }: { ctx: Ctx; s: GameState }) {
  const side = (id: string) => s.sides.find((x) => x.id === id)!;
  const objectives = objectiveStatus(ctx, s);
  return (
    <aside className="ribbon">
      <section>
        <h3 className="panel-h">Turn</h3>
        <div className="turn-track">
          {Array.from({ length: ctx.scenario.turns }, (_, i) => (
            <span key={i} className={`turn-box ${s.turn === i + 1 ? 'now' : s.turn > i + 1 ? 'past' : ''}`}>
              {i + 1}
            </span>
          ))}
        </div>
        {s.phase !== 'setup' && s.phase !== 'gameOver' && (
          <div className={`phasing nation-${side(s.phasing).nation}`}>{side(s.phasing).name} player turn</div>
        )}
      </section>
      <section>
        <h3 className="panel-h">Phases</h3>
        {s.phase === 'setup' && <div className="phasing">Setup — {side(s.awaiting).name}</div>}
        <ol className="phase-list">
          {PLAYER_TURN_PHASES.map((p) => (
            <li key={p} className={s.phase === p ? 'now' : ''}>
              {PHASE_NAMES[p].replace(' Phase', '')}
              {s.phase === p && <span className="dim"> · {side(s.awaiting).name}</span>}
            </li>
          ))}
        </ol>
      </section>
      <section>
        <h3 className="panel-h">Objectives</h3>
        <ul className="obj-list">
          {objectives.map((o) => (
            <li key={o.name}>
              <span className={`obj-dot ${o.owner ? `nation-${side(o.owner).nation}` : ''}`} />
              {o.name}
              <span className="dim"> {o.owner ? side(o.owner).name : 'contested'}</span>
            </li>
          ))}
        </ul>
        <p className="faint small">{ctx.scenario.victory.text}</p>
      </section>
      <section>
        <h3 className="panel-h">Losses</h3>
        {s.sides.map((x) => (
          <div key={x.id} className="small">
            {x.name}: {s.losses[x.id]?.squads ?? 0} squads, {s.losses[x.id]?.leaders ?? 0} leaders
          </div>
        ))}
      </section>
    </aside>
  );
}
