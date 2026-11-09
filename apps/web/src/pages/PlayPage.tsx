import { useRef, useState } from 'react';
import type { SideId } from '@squadwar/engine';
import { leaderRating } from '@squadwar/engine';
import { allScenarios, rulesData } from '../game/scenarios';
import { loadAutosave, useSession, type Controller, type SaveFile } from '../game/session';
import { go } from '../router';
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
  const start = () => {
    useSession.getState().start(chosen, controllers);
    go('battle');
  };
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
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="play-actions">
            <button className="btn primary big" onClick={start}>
              Start game
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
