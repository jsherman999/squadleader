import { useMemo, useState } from 'react';
import { designYourOwn, type DyoRules, type DyoTerrain } from '@squadwar/engine';
import { allBoards } from '../content';
import { registerScenario, rulesData } from '../game/scenarios';
import { go } from '../router';
import { TopBar } from '../ui/TopBar';

const RULES: { id: DyoRules; label: string }[] = [
  { id: 'full', label: 'Full rules (§1–63): Americans, fortifications, snow' },
  { id: 'support', label: 'Armour and support (§1–49)' },
  { id: 'infantry', label: 'Infantry only (§1–27)' },
];
const TERRAIN: { id: DyoTerrain; label: string }[] = [
  { id: 'any', label: 'Any boards' },
  { id: 'city', label: 'City boards' },
  { id: 'country', label: 'Countryside boards' },
];

const newSeed = () => Math.floor(Math.random() * 1_000_000) + 1;

/** Design Your Own (Game Set IV): deal a random scenario, look it over, re-deal or play it. */
export function DyoPage() {
  const [rules, setRules] = useState<DyoRules>('full');
  const [terrain, setTerrain] = useState<DyoTerrain>('any');
  const [seed, setSeed] = useState(newSeed);
  const deal = useMemo(() => designYourOwn(rulesData(), allBoards(), { seed, rules, terrain }), [seed, rules, terrain]);
  const sc = deal.scenario;
  const data = rulesData();
  const unitName = (t: string) => data.units[t]?.name ?? data.vehicles[t]?.name ?? t;
  const play = () => {
    registerScenario(sc);
    go(`play/${sc.id}`);
  };
  return (
    <div className="page">
      <TopBar title="Design Your Own" />
      <main className="scenario-card dyo">
        <p className="dim">
          A random engagement, dealt from a shuffled deck as in the rulebook&rsquo;s Game Set IV: the cards decide who defends, the Allied nation, the defender&rsquo;s board, the
          length, the defending force and the victory conditions. The attacker gets a force bought with more points than the defender&rsquo;s.
        </p>
        <div className="dyo-options">
          <label>
            Rules
            <select value={rules} onChange={(e) => setRules(e.target.value as DyoRules)} aria-label="Rules in force">
              {RULES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Boards
            <select value={terrain} onChange={(e) => setTerrain(e.target.value as DyoTerrain)} aria-label="Boards">
              {TERRAIN.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" onClick={() => setSeed(newSeed())}>
            Re-deal
          </button>
          <button className="btn primary" onClick={play}>
            Play this deal…
          </button>
        </div>
        <h3 className="panel-h">The cards</h3>
        <div className="dyo-cards">
          {deal.draws.map((d) => (
            <div key={d.what} className="dyo-card">
              <span className={`playing-card ${d.card.suit === '♦' || d.card.suit === '♥' ? 'red' : ''}`} aria-label={`${d.card.rank} of ${d.card.suit}`}>
                <span>{d.card.rank}</span>
                <span className="suit">{d.card.suit}</span>
              </span>
              <span className="small">
                <span className="dim block">{d.what}</span>
                {d.result}
              </span>
            </div>
          ))}
        </div>
        <h1 className="stencil scenario-title">{sc.title}</h1>
        <p className="dim">
          {sc.location} · {sc.date} · {sc.turns} turns · rules §1–{sc.rulesLevel} · deal {seed}
        </p>
        <p className="briefing">{sc.briefing}</p>
        <h3 className="panel-h">Victory</h3>
        <p>{sc.victory.text}</p>
        <h3 className="panel-h">Forces</h3>
        <div className="forces">
          {sc.sides.map((side) => (
            <div key={side.id} className={`force nation-${side.nation}`}>
              <div className="force-head">
                <strong>
                  {side.name} · {deal.points[side.id]} points
                </strong>
              </div>
              <div className="small dim">{side.notes}</div>
              <ul className="small">
                {side.units.map((u, i) => (
                  <li key={i}>
                    {unitName(u.type)}
                    {u.names ? ` (${u.names.join(', ')})` : ''}
                    {u.weapons?.length ? ` with ${u.weapons.map((w) => data.weapons[w]?.name ?? w).join(', ')}` : ''}
                    {u.hidden ? <span className="dim"> · hidden</span> : ''}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="small faint">Choose who plays each side on the next screen. The deal is kept in this browser and in any save of the game.</p>
      </main>
    </div>
  );
}
