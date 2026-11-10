import { PHASE_NAMES, PLAYER_TURN_PHASES, objectiveStatus, type Ctx, type GameState } from '@squadwar/engine';

/** Shorter phase names for narrow phones. */
const SHORT: Record<string, string> = { defensiveFire: 'Def. Fire', advancingFire: 'Adv. Fire' };

export function PhaseRibbon({ ctx, s, onObjective, focus }: { ctx: Ctx; s: GameState; onObjective?: (name: string) => void; focus?: string | undefined }) {
  const side = (id: string) => s.sides.find((x) => x.id === id)!;
  const objectives = objectiveStatus(ctx, s);
  return (
    <aside className="ribbon">
      <section className="rb-turn">
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
        {/* Phones: who acts now, when it is not the side whose turn it is (Defensive Fire, routs, close combat). */}
        {s.phase !== 'setup' && s.phase !== 'gameOver' && s.awaiting !== s.phasing && (
          <div className={`phasing acting nation-${side(s.awaiting).nation}`}>{side(s.awaiting).name} to act</div>
        )}
      </section>
      <section className="rb-phases">
        <h3 className="panel-h">Phases</h3>
        {s.phase === 'setup' && <div className="phasing">Setup — {side(s.awaiting).name}</div>}
        <ol className="phase-list">
          {PLAYER_TURN_PHASES.map((p) => (
            <li key={p} className={s.phase === p ? 'now' : ''} aria-current={s.phase === p ? 'step' : undefined}>
              <span className={`ph-full ${SHORT[p] ? 'has-short' : ''}`}>{PHASE_NAMES[p].replace(' Phase', '')}</span>
              {SHORT[p] && <span className="ph-short">{SHORT[p]}</span>}
              {s.phase === p && <span className="dim phase-who"> · {side(s.awaiting).name}</span>}
            </li>
          ))}
        </ol>
      </section>
      <section className="rb-obj">
        <h3 className="panel-h">Objectives</h3>
        <ul className="obj-list">
          {objectives.map((o, i) => (
            <li key={o.name}>
              <button className={`obj-item ${focus === o.name ? 'on' : ''}`} onClick={() => onObjective?.(o.name)} title="Show this building on the map" aria-pressed={focus === o.name}>
                <span className="obj-no">{i + 1}</span>
                <span className={`obj-dot ${o.owner ? `nation-${side(o.owner).nation}` : ''}`} />
                {o.name}
                <span className="dim"> {o.owner ? side(o.owner).name : 'contested'}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="faint small obj-help">Each objective is outlined in gold on the map, with its number and name. Pick one here to light it up.</p>
        <p className="faint small">{ctx.scenario.victory.text}</p>
      </section>
      <section className="rb-loss">
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
