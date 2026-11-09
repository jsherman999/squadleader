import { allScenarios } from '../game/scenarios';
import { useSession } from '../game/session';
import { go } from '../router';

export function HomePage() {
  return (
    <main className="home">
      <div className="home-inner">
        <h1 className="stencil home-title">Squad War</h1>
        <p className="dim home-sub">WWII squad-level tactical hex combat</p>
        <nav className="home-menu">
          <button className="btn primary" onClick={() => go('play')}>
            Play a scenario
          </button>
          <button
            className="btn"
            onClick={() => {
              const sc = allScenarios()[0]!;
              useSession.getState().start(sc.id, Object.fromEntries(sc.sides.map((x) => [x.id, 'bot' as const])));
              go('battle');
            }}
            title="The computer plays both sides and explains every move"
          >
            Watch AI vs AI (tutor)
          </button>
          <button className="btn" onClick={() => go('dyo')} title="Deal a random scenario from the Game Set IV charts">
            Design your own
          </button>
          <button className="btn" onClick={() => go('lab')}>
            Map &amp; line-of-sight lab
          </button>
          <button className="btn" onClick={() => go('editor')}>
            Board editor
          </button>
        </nav>
        <p className="faint home-foot">Rules §1–63 · 12 scenarios, Design Your Own · original boards and scenarios</p>
      </div>
    </main>
  );
}
