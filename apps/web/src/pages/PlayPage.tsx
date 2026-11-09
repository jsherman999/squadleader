import { useCallback, useEffect, useRef, useState } from 'react';
import type { SideId } from '@squadwar/engine';
import { leaderRating } from '@squadwar/engine';
import { allScenarios, rulesData } from '../game/scenarios';
import { deleteGame, downloadSave, getGame, listGames, type GameSummary } from '../game/library';
import { useReview } from '../game/review';
import { loadAutosave, useSession, type Controller, type SaveFile } from '../game/session';
import { go } from '../router';
import { useLlm } from '../game/llm';
import { LlmSettings } from '../ui/LlmSettings';
import { TopBar } from '../ui/TopBar';

export function PlayPage() {
  const scenarios = allScenarios();
  const [chosen, setChosen] = useState(scenarios[0]!.id);
  const sc = scenarios.find((s) => s.id === chosen)!;
  const [controllers, setControllers] = useState<Record<SideId, Controller>>(() =>
    Object.fromEntries(sc.sides.map((s) => [s.id, s.id === sc.victory.side ? 'human' : 'bot'])),
  );
  const [error, setError] = useState<string>();
  const auto = loadAutosave();
  const file = useRef<HTMLInputElement>(null);
  const [llmOpen, setLlmOpen] = useState(false);
  const llmCfg = useLlm((l) => l.config);
  const llmKey = useLlm((l) => l.keys[l.config.provider]);
  const usesLlm = Object.values(controllers).includes('llm');
  const start = () => {
    useLlm.getState().reset();
    useSession.getState().start(chosen, controllers);
    go('battle');
  };
  const watch = () => {
    useSession.getState().start(chosen, Object.fromEntries(sc.sides.map((x) => [x.id, 'bot' as Controller])));
    go('battle');
  };
  const [games, setGames] = useState<GameSummary[]>();
  const [libError, setLibError] = useState<string>();
  const refresh = useCallback(() => {
    listGames()
      .then(setGames)
      .catch((e: Error) => setLibError(e.message));
  }, []);
  useEffect(refresh, [refresh]);
  const review = (save: SaveFile) => {
    try {
      useReview.getState().open(save);
      go('review');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const withGame = (id: string, fn: (g: SaveFile) => void) => {
    getGame(id)
      .then((g) => (g ? fn(g) : setLibError('That game is no longer in the library.')))
      .catch((e: Error) => setLibError(e.message));
  };
  const reviewFile = useRef<HTMLInputElement>(null);
  const resume = (save: SaveFile) => {
    try {
      useSession.getState().load(save);
      go('battle');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="page">
      <TopBar title="Choose a scenario" />
      <main className="play">
        <aside className="scenario-list">
          {scenarios.map((s, i) => (
            <button key={s.id} className={`scenario-item ${s.id === chosen ? 'active' : ''}`} onClick={() => setChosen(s.id)}>
              <span className="scenario-no stencil">{i + 1}</span>
              <span>
                <strong>{s.title}</strong>
                <span className="dim small block">
                  {s.location}, {s.date} · {s.turns} turns
                </span>
              </span>
            </button>
          ))}
          <p className="faint small">More scenarios arrive with later milestones (armor, artillery, night…).</p>
        </aside>
        <section className="scenario-card">
          <h1 className="stencil scenario-title">{sc.title}</h1>
          <p className="dim">
            {sc.location} · {sc.date} · rules §1–{sc.rulesLevel}
          </p>
          <p className="briefing">{sc.briefing}</p>
          <h3 className="panel-h">Victory</h3>
          <p>{sc.victory.text}</p>
          <h3 className="panel-h">Forces</h3>
          <div className="forces">
            {sc.sides.map((side) => (
              <div key={side.id} className={`force nation-${side.nation}`}>
                <div className="force-head">
                  <strong>{side.name}</strong>
                  <select value={controllers[side.id]} onChange={(e) => setControllers({ ...controllers, [side.id]: e.target.value as Controller })} aria-label={`${side.name} player`}>
                    <option value="human">Human</option>
                    <option value="bot">Computer (bot)</option>
                    <option value="llm">Computer (LLM)</option>
                  </select>
                </div>
                <div className="small dim">{side.notes}</div>
                <ul className="small">
                  {side.units.map((u, i) => (
                    <li key={i}>
                      {u.count && u.count > 1 ? `${u.count}× ` : ''}
                      {unitName(u.type)}
                      {u.names ? ` (${u.names.join(', ')})` : ''}
                      {u.weapons?.length ? ` with ${u.weapons.map((w) => rulesData().weapons[w]?.name ?? w).join(', ')}` : ''}
                      {u.enters ? <span className="dim"> · enters turn {u.enters.turn}</span> : ''}
                      {u.hidden ? <span className="dim"> · hidden</span> : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {usesLlm && (
            <div className="panel-card small llm-summary">
              <span>
                LLM opponent: <strong>{llmCfg.model || 'no model chosen'}</strong> via {llmCfg.provider}, {llmCfg.persona}, budget ${llmCfg.budgetUsd.toFixed(2)}.{' '}
                {!llmKey && llmCfg.provider !== 'local' && <span className="warn">No API key yet: the scripted AI will play until you add one.</span>}
              </span>
              <button className="btn tiny" onClick={() => setLlmOpen(true)}>
                LLM settings…
              </button>
            </div>
          )}
          {llmOpen && <LlmSettings onClose={() => setLlmOpen(false)} />}
          <div className="play-actions">
            <button className="btn primary big" onClick={start}>
              Start game
            </button>
            <button className="btn big" onClick={watch} title="Both sides played by the computer, with the reasoning behind every move">
              Watch AI vs AI
            </button>
            {auto && auto.scenario === chosen && (
              <button className="btn big" onClick={() => resume(auto)}>
                Continue saved game ({auto.actions.length} actions)
              </button>
            )}
            <button className="btn big" onClick={() => file.current?.click()}>
              Load save file…
            </button>
            <input
              ref={file}
              type="file"
              accept="application/json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) resume(JSON.parse(await f.text()) as SaveFile);
              }}
            />
          </div>
          {error && <p className="warn">{error}</p>}
          <h3 className="panel-h">Saved games</h3>
          <p className="small dim">
            Finished AI vs AI games are saved here automatically; use Save in a game to add others. Review steps through a game move by move, with the reasoning behind each
            computer decision.
          </p>
          {libError && <p className="warn small">{libError}</p>}
          {games && games.length === 0 && <p className="small faint">No saved games yet.</p>}
          {games && games.length > 0 && (
            <table className="library">
              <tbody>
                {games.map((g) => {
                  const scn = scenarios.find((x) => x.id === g.scenario);
                  const vs = Object.values(g.controllers).every((c) => c !== 'human') ? 'AI vs AI' : Object.values(g.controllers).every((c) => c === 'human') ? 'Hot-seat' : 'vs computer';
                  return (
                    <tr key={g.id}>
                      <td>
                        <strong>{scn?.title ?? g.scenario}</strong>
                        <span className="small dim block">
                          {vs} · {new Date(g.savedAt).toLocaleString()} · {g.actions} moves{g.explained ? `, ${g.explained} explained` : ''}
                        </span>
                        <span className="small block">{g.result ?? (g.turn ? `In progress, turn ${g.turn}` : 'In progress')}</span>
                      </td>
                      <td className="library-actions">
                        <button className="btn tiny primary" onClick={() => withGame(g.id, review)}>
                          Review
                        </button>
                        {!g.result && (
                          <button className="btn tiny" onClick={() => withGame(g.id, resume)}>
                            Continue
                          </button>
                        )}
                        <button className="btn tiny" onClick={() => withGame(g.id, (sv) => downloadSave(sv, `squadwar-${sv.scenario}-${g.id}.json`))}>
                          Download
                        </button>
                        <button
                          className="btn tiny"
                          onClick={() => {
                            if (window.confirm('Delete this saved game?')) deleteGame(g.id).then(refresh, (e: Error) => setLibError(e.message));
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="play-actions">
            <button className="btn" onClick={() => reviewFile.current?.click()}>
              Review a save file…
            </button>
            <input
              ref={reviewFile}
              type="file"
              accept="application/json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) review(JSON.parse(await f.text()) as SaveFile);
              }}
            />
          </div>
        </section>
      </main>
    </div>
  );
}

function unitName(type: string): string {
  const t = rulesData().units[type];
  if (!t) return type;
  return t.kind === 'leader' ? `Leader ${leaderRating(t.morale, t.leadership)}` : `${t.fp}-${t.range}-${t.morale} ${t.name.toLowerCase()}`;
}
