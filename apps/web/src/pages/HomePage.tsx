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
          <button className="btn" onClick={() => go('lab')}>
            Map &amp; line-of-sight lab
          </button>
          <button className="btn" onClick={() => go('editor')}>
            Board editor
          </button>
        </nav>
        <p className="faint home-foot">Milestone build · rules §1–21 · original boards and scenarios</p>
      </div>
    </main>
  );
}
