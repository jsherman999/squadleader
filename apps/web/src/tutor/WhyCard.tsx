import { useState } from 'react';
import { situation, type Rationale } from '@squadwar/bot';
import { PHASE_NAMES, type Ctx, type GameState } from '@squadwar/engine';
import { ICON } from '../battle/LogPanel';
import type { LoggedEvent } from '../game/session';

export interface WhyCardProps {
  ctx: Ctx;
  /** The state the decision was made in. */
  s: GameState;
  note: Rationale | undefined;
  /** "decision 145 of 312" */
  position?: { index: number; total: number } | undefined;
  /** What the decision led to (events of that action). */
  events?: readonly LoggedEvent[] | undefined;
  /** Who made the decision. */
  actor: 'bot' | 'human';
  title?: string;
  /** "wide" splits the card into two boxes side by side: the decision, then the lesson and result. */
  variant?: 'stack' | 'wide';
}

/** The tutor's explanation of one decision: goal, reasons, options weighed, lesson and result. */
export function WhyCard({ ctx, s, note, position, events, actor, title, variant = 'stack' }: WhyCardProps) {
  const [open, setOpen] = useState<number | undefined>();
  const side = s.sides.find((x) => x.id === s.awaiting);
  const wide = variant === 'wide';
  const decision = (
    <>
      <div className="why-head">
        {title && <span className="panel-h why-title">{title}</span>}
        <span className={`side-chip nation-${side?.nation ?? 'german'}`}>{side?.name ?? s.awaiting}</span>
        <span className="small dim">
          Turn {s.turn} · {PHASE_NAMES[s.phase]}
          {position ? ` · decision ${position.index + 1} of ${position.total}` : ''}
        </span>
      </div>
      {s.phase !== 'setup' && s.phase !== 'gameOver' && <div className="why-situation small dim">{situation(ctx, s, s.awaiting)}</div>}
      {note ? (
        <>
          <h4 className="why-goal">
            {note.goal}
            {note.weight === 'key' && <span className="why-key">key</span>}
          </h4>
          {note.reasons.length > 0 && (
            <ul className="why-reasons">
              {note.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="small dim">{actor === 'human' ? 'A human player made this move; no reasoning was recorded.' : 'No reasoning was recorded for this move (older save).'}</p>
      )}
    </>
  );
  const rest = (
    <>
      {note && (
        <>
          {note.alternatives && note.alternatives.length > 0 && (
            <details className="why-alt" open>
              <summary>Also considered</summary>
              <ul>
                {note.alternatives.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </details>
          )}
          {note.tip && (
            <div className="why-tip">
              <strong>Lesson</strong> {note.tip}
            </div>
          )}
        </>
      )}
      {events && events.length > 0 && (
        <div className="why-result">
          <div className="why-result-h">What happened</div>
          {events.map((e) => (
            <div key={e.n} className={`log-row kind-${e.kind}`}>
              <button className="log-line" onClick={() => setOpen(open === e.n ? undefined : e.n)} aria-expanded={open === e.n}>
                <span className="log-icon">{ICON[e.kind] ?? '·'}</span>
                <span className="log-text">{e.text}</span>
                {e.dice && <span className="log-dice mono">{e.dice.join('+')}</span>}
                {e.trace && <span className="log-more">{open === e.n ? '▾' : '▸'}</span>}
              </button>
              {open === e.n && e.trace && (
                <ul className="log-trace">
                  {e.trace.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
  // A new decision, and then its result, print out afresh: the keys restart the teletype animation.
  const kDecision = `${s.turn}|${s.phase}|${s.awaiting}|${position?.index ?? ''}|${note?.goal ?? ''}|${note?.reasons[0] ?? ''}`;
  const kRest = `${kDecision}|${events?.length ?? 0}`;
  if (!wide)
    return (
      <div className="why-card" aria-live="polite">
        <div key={kDecision} className="printout">
          {decision}
        </div>
        <div key={kRest} className="printout">
          {rest}
        </div>
      </div>
    );
  const hasRest = !!(note?.alternatives?.length || note?.tip || events?.length);
  return (
    <div className="why-wide" aria-live="polite">
      <div className="why-card dock-box">
        <div key={kDecision} className="printout">
          {decision}
        </div>
      </div>
      <div className="why-card dock-box why-rest">
        <div key={kRest} className="printout">
          {hasRest ? rest : <p className="small faint">No lesson or result for this decision yet.</p>}
        </div>
      </div>
    </div>
  );
}
