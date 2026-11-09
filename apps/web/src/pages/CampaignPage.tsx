import { useMemo, useState } from 'react';
import { CAMPAIGN_RANKS, type SideId } from '@squadwar/engine';
import { loadCampaign, newCampaign, rankLabel, recordEntry, saveCampaign, scoreEntry, startEntry, victoryPoints, type CampaignFile } from '../game/campaign';
import { allScenarios, customScenarios, scenarioById } from '../game/scenarios';
import { useSession, type Controller } from '../game/session';
import { useLlm } from '../game/llm';
import { go } from '../router';
import { TopBar } from '../ui/TopBar';

const CHANGE: Record<string, string> = { promoted: 'Promoted', demoted: 'Demoted', same: '—', kia: 'Killed in action', busted: 'Busted' };

/** The Campaign Game: one leader through six scenarios, promoted or broken by how he fights. */
export function CampaignPage() {
  const [c, setC] = useState<CampaignFile | undefined>(loadCampaign);
  return (
    <div className="page">
      <TopBar title="Campaign" />
      <main className="scenario-card campaign">{c ? <CampaignView c={c} setC={setC} /> : <NewCampaign onStart={setC} />}</main>
    </div>
  );
}

function NewCampaign({ onStart }: { onStart: (c: CampaignFile) => void }) {
  const scenarios = [...allScenarios(), ...customScenarios()];
  const [name, setName] = useState('Wetzel');
  const [opponent, setOpponent] = useState<Controller>('bot');
  const [plan, setPlan] = useState(() => scenarios.slice(0, 6).map((s) => ({ scenario: s.id, side: s.victory.side as SideId })));
  const set = (i: number, scenario: string) => {
    const sc = scenarioById(scenario)!;
    setPlan(plan.map((p, j) => (j === i ? { scenario, side: sc.victory.side } : p)));
  };
  return (
    <>
      <h1 className="stencil scenario-title">A new campaign</h1>
      <p className="briefing">
        You take the place of one leader and carry him through six scenarios. He starts as a corporal (7-0). Élan earns points and cowardice costs them: ten points up and
        he is promoted one rank, ten down and he is demoted, at most one step a scenario. Killed in action, he is replaced by a new corporal. At the end you score one
        victory point per scenario won and one per rank above corporal, if your leader lives through the last battle.
      </p>
      <div className="dyo-options">
        <label>
          Your leader&rsquo;s name
          <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} aria-label="Leader name" />
        </label>
        <label>
          Opponent
          <select value={opponent} onChange={(e) => setOpponent(e.target.value as Controller)} aria-label="Opponent">
            <option value="bot">Computer (bot)</option>
            <option value="llm">Computer (LLM)</option>
            <option value="human">Human (hot-seat)</option>
          </select>
        </label>
      </div>
      <h3 className="panel-h">The six scenarios</h3>
      <table className="library campaign-plan">
        <tbody>
          {plan.map((p, i) => {
            const sc = scenarioById(p.scenario)!;
            return (
              <tr key={i}>
                <td className="stencil">{i + 1}</td>
                <td>
                  <select value={p.scenario} onChange={(e) => set(i, e.target.value)} aria-label={`Scenario ${i + 1}`}>
                    {scenarios.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select value={p.side} onChange={(e) => setPlan(plan.map((q, j) => (j === i ? { ...q, side: e.target.value } : q)))} aria-label={`Your side in scenario ${i + 1}`}>
                    {sc.sides.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.id === sc.victory.side ? ' (attacking)' : ''}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="play-actions">
        <button
          className="btn primary big"
          onClick={() => {
            const c = newCampaign(name, plan, opponent);
            saveCampaign(c);
            onStart(c);
          }}
        >
          Begin the campaign
        </button>
      </div>
    </>
  );
}

function CampaignView({ c, setC }: { c: CampaignFile; setC: (c: CampaignFile | undefined) => void }) {
  const session = useSession();
  const entry = c.entries[c.current];
  const done = c.current >= c.entries.length;
  const last = session.states[session.states.length - 1];
  const inSession = !!entry?.game && session.scenarioId === entry.game;
  const finished = inSession && last?.phase === 'gameOver';
  const [startError, setError] = useState<string>();
  const scored = useMemo(() => {
    if (!finished) return undefined;
    try {
      return { outcome: scoreEntry(c, session.states, session.actions) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [finished, c, session.states, session.actions]);
  const outcome = scored?.outcome;
  const error = startError ?? scored?.error;
  const play = () => {
    try {
      const r = startEntry(c);
      setC(r.campaign);
      useLlm.getState().reset();
      session.start(r.scenario, r.controllers);
      go('battle');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const title = (id: string) => scenarioById(id)?.title ?? id;
  const sideName = (id: string, side: string) => scenarioById(id)?.sides.find((s) => s.id === side)?.name ?? side;
  return (
    <>
      <h1 className="stencil scenario-title">
        {CAMPAIGN_RANKS[c.rank]!.title} {c.identity}
      </h1>
      <p className="dim">
        Personnel file · rank {rankLabel(c.rank)} · performance total {c.total >= 0 ? '+' : ''}
        {c.total} · campaign victory points {victoryPoints(c)}
      </p>
      {c.fallen.length > 0 && <p className="small warn">Fallen: {c.fallen.map((f) => `${f.name} (${title(f.scenario)})`).join(', ')}</p>}
      <table className="library personnel">
        <thead>
          <tr>
            <th>#</th>
            <th>Scenario</th>
            <th>Starting rank</th>
            <th>Élan</th>
            <th>Cowardice</th>
            <th>Total</th>
            <th>Ending rank</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {c.entries.map((e, i) => (
            <tr key={i} className={i === c.current ? 'current' : ''}>
              <td className="stencil">{i + 1}</td>
              <td>
                <strong>{title(e.scenario)}</strong>
                <span className="dim small block">{sideName(e.scenario, e.side)}</span>
              </td>
              <td>{e.startRank !== undefined ? `${CAMPAIGN_RANKS[e.startRank]!.title} ${e.identity ?? ''}` : ''}</td>
              <td>{e.elan !== undefined ? `+${e.elan}` : ''}</td>
              <td>{e.cowardice ?? ''}</td>
              <td>{e.total ?? ''}</td>
              <td>{e.endRank !== undefined ? CAMPAIGN_RANKS[e.endRank]!.title : ''}</td>
              <td>{e.fate ? `${e.won ? 'Won' : 'Lost'} · ${CHANGE[e.change ?? 'same']}` : i === c.current ? 'Next' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!done && entry && (
        <div className="panel-card campaign-next">
          <h3 className="panel-h">
            Scenario {c.current + 1}: {title(entry.scenario)}
          </h3>
          {!finished && (
            <>
              <p className="small">
                {CAMPAIGN_RANKS[c.rank]!.title} {c.identity} ({CAMPAIGN_RANKS[c.rank]!.morale}-{-CAMPAIGN_RANKS[c.rank]!.leadership}) joins the {sideName(entry.scenario, entry.side)} side.
              </p>
              <div className="play-actions">
                {inSession && last?.phase !== 'gameOver' && (
                  <button className="btn primary" onClick={() => go('battle')}>
                    Back to the battle
                  </button>
                )}
                <button className={`btn ${inSession ? '' : 'primary'}`} onClick={play}>
                  {inSession ? 'Start the scenario again' : 'Play this scenario'}
                </button>
              </div>
            </>
          )}
          {finished && outcome && (
            <>
              <p>
                {outcome.won ? 'Your side won.' : 'Your side lost.'} {outcome.fate === 'kia' ? `${c.identity} was killed in action.` : `${c.identity} came through.`}
              </p>
              {outcome.awards.length ? (
                <ul className="small">
                  {outcome.awards.map((a, i) => (
                    <li key={i} className={a.points < 0 ? 'warn' : ''}>
                      Turn {a.turn}: {a.text} ({a.points > 0 ? '+' : ''}
                      {a.points})
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="small dim">Nothing to note in his file this time.</p>
              )}
              <button className="btn primary" onClick={() => setC(recordEntry(c, outcome))}>
                Record in the personnel file
              </button>
            </>
          )}
        </div>
      )}
      {done && (
        <div className="panel-card campaign-next">
          <h3 className="panel-h">Campaign over</h3>
          <p>
            {victoryPoints(c)} victory points: {c.entries.filter((e) => e.won).length} scenarios won
            {[...c.entries].reverse().find((e) => e.fate)?.fate === 'survived' ? ` and ${c.rank} ranks above corporal` : ', and your last leader did not survive'}.
          </p>
        </div>
      )}
      {error && <p className="warn">{error}</p>}
      <div className="play-actions">
        <button
          className="btn"
          onClick={() => {
            if (!window.confirm('Abandon this campaign and start a new one?')) return;
            saveCampaign(undefined);
            setC(undefined);
          }}
        >
          New campaign…
        </button>
      </div>
    </>
  );
}
