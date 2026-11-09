import { useCallback, useMemo, useRef, useState } from 'react';
import { parseHexKey, type HexKey } from '@squadwar/hex';
import { createGame, makeCtx, parseScenario, stackingProblem, type Ctx, type GameState, type Nation, type Scenario } from '@squadwar/engine';
import type { PointerInfo } from '../board/renderer';
import { hexFill, hexOutline } from '../draw/pen';
import { allBoards, mapFor } from '../content';
import { allScenarios, customScenarios, registerScenario, rulesData, scenarioById } from '../game/scenarios';
import { useSession, type Controller } from '../game/session';
import { go, useRoute } from '../router';
import { TopBar } from '../ui/TopBar';
import { MapViews, type OverlayLayers } from '../views/MapViews';

type Draft = Scenario;
type UnitEntry = Draft['sides'][number]['units'][number];
const NATIONS: { id: Nation; name: string; prefix: string }[] = [
  { id: 'german', name: 'German', prefix: 'ger' },
  { id: 'russian', name: 'Soviet', prefix: 'rus' },
  { id: 'american', name: 'American', prefix: 'us' },
];
const LEVELS: [number, string][] = [
  [21, '§1–21 infantry'],
  [27, '§1–27 special infantry rules'],
  [41, '§1–41 armour'],
  [49, '§1–49 countryside, artillery, night'],
  [63, '§1–63 all of Game Set III'],
];
const COLS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].concat(['AA', 'BB', 'CC', 'DD', 'EE', 'FF', 'GG']);
const COVER = ['woods', 'woodBuilding', 'stoneBuilding', 'brush', 'orchard'];

function blank(): Draft {
  return parseScenario({
    format: 'squadwar-scenario@1',
    id: `custom-${Math.random().toString(36).slice(2, 8)}`,
    title: 'New scenario',
    date: 'June 1944',
    location: 'Somewhere in Europe',
    briefing: '',
    rulesLevel: 63,
    layout: [{ board: 'A', x: 0, y: 0 }],
    turns: 6,
    setupFirst: 'ger',
    moveFirst: 'us',
    sides: [
      { id: 'ger', nation: 'german', name: 'German', setup: [{ board: 'A', cols: ['P', 'GG'] }], units: [] },
      { id: 'us', nation: 'american', name: 'American', setup: [{ board: 'A', cols: ['A', 'F'] }], units: [] },
    ],
    victory: { side: 'us', text: '', controlBuildings: { buildings: [], atLeast: 1 } },
  });
}

function copyOf(sc: Scenario): Draft {
  return { ...structuredClone(sc), id: `custom-${Math.random().toString(36).slice(2, 8)}`, title: sc.id.startsWith('custom-') ? sc.title : `${sc.title} (edited)` };
}

/** Checks a playable scenario must pass, in plain words. */
function problems(ctx: Ctx, st: GameState, sc: Scenario): string[] {
  const out: string[] = [];
  const id = (k: HexKey) => ctx.map.hexes[k]!.id;
  for (const side of sc.sides) if (!side.units.length) out.push(`${side.name} has no units.`);
  if (!sc.victory.controlBuildings.buildings.length) out.push('Pick at least one objective building.');
  if (sc.victory.controlBuildings.buildings.length && sc.victory.controlBuildings.atLeast > sc.victory.controlBuildings.buildings.length) out.push('The victory needs more buildings than there are objectives.');
  for (const u of Object.values(st.units)) {
    if (!ctx.zones[u.side]!.has(u.hex)) out.push(`${ctx.data.units[u.type]!.name} at ${id(u.hex)} is outside its setup area.`);
    if (u.hidden && !COVER.includes(ctx.map.hexes[u.hex]!.terrain)) out.push(`Hidden ${ctx.data.units[u.type]!.name} at ${id(u.hex)} needs woods or a building.`);
  }
  for (const v of Object.values(st.vehicles)) {
    const t = ctx.map.hexes[v.hex]!.terrain;
    const kind = ctx.data.vehicles[v.type]!.kind;
    if (!ctx.zones[v.side]!.has(v.hex)) out.push(`${ctx.data.vehicles[v.type]!.name} at ${id(v.hex)} is outside its setup area.`);
    if (t === 'stoneBuilding' || t === 'water' || (t === 'woodBuilding' && kind !== 'gun' && kind !== 'mortar')) out.push(`${ctx.data.vehicles[v.type]!.name} cannot start in ${t} (${id(v.hex)}).`);
  }
  for (const h of new Set(Object.values(st.units).map((u) => u.hex))) for (const side of sc.sides) {
    const p = stackingProblem(ctx, st, h, side.id);
    if (p) out.push(`${side.name} at ${id(h)}: ${p}.`);
  }
  return [...new Set(out)];
}

/** Scenario editor v2: orders of battle, setup areas, reinforcements, special rules and victory, with a live map. */
export function ScenarioEditorPage() {
  const [, from] = useRoute();
  const [draft, setDraftRaw] = useState<Draft>(() => {
    const base = from ? scenarioById(from) : undefined;
    return base ? copyOf(base) : blank();
  });
  const [mode, setMode] = useState<{ kind: 'place'; side: number; unit: number } | { kind: 'objective' } | undefined>();
  const [notice, setNotice] = useState<string>();
  const file = useRef<HTMLInputElement>(null);
  const data = rulesData();
  const boards = allBoards();
  const update = useCallback((f: (d: Draft) => void) => {
    setDraftRaw((d) => {
      const next = structuredClone(d);
      f(next);
      return next;
    });
  }, []);

  const map = useMemo(() => mapFor(draft.layout), [draft.layout]);
  const built = useMemo(() => {
    try {
      const sc = parseScenario(draft);
      const ctx = makeCtx(sc, data, boards);
      const st = createGame(ctx, 1).state;
      return { sc, ctx, st, problems: problems(ctx, st, sc) };
    } catch (e) {
      return { error: (e as Error).message.split('\n').slice(0, 3).join(' ') };
    }
  }, [draft, data, boards]);

  const zoneOf = useCallback(
    (i: number): Set<HexKey> => {
      if ('ctx' in built && built.ctx) return new Set(built.ctx.zones[draft.sides[i]!.id]);
      return new Set();
    },
    [built, draft.sides],
  );
  const objectiveHexes = useMemo(() => {
    const out: HexKey[] = [];
    for (const b of draft.victory.controlBuildings.buildings) {
      const k = map.byId[b.hex];
      const bid = k ? map.hexes[k]?.building : undefined;
      if (bid) out.push(...map.buildings[bid]!.hexes);
    }
    return out;
  }, [draft.victory, map]);

  const layers: OverlayLayers = useMemo(
    () => ({
      under: (pen) => {
        const colors = [0x5a8fd8, 0xd8784a];
        draft.sides.forEach((_, i) => {
          for (const h of zoneOf(i)) hexFill(pen, parseHexKey(h), colors[i]!, 0.13, 0.05);
        });
        for (const h of objectiveHexes) hexOutline(pen, parseHexKey(h), 0xf0c66b, 0.95, 3, 0.08);
      },
    }),
    [draft.sides, zoneOf, objectiveHexes],
  );

  const onClick = useCallback(
    (p: PointerInfo) => {
      const h = p.hex;
      if (!h || !mode) return;
      const mh = map.hexes[h]!;
      if (mode.kind === 'place') {
        update((d) => {
          const u = d.sides[mode.side]!.units[mode.unit];
          if (!u) return;
          u.hex = mh.id;
          delete u.enters;
        });
        setMode(undefined);
      } else if (mode.kind === 'objective') {
        if (!mh.building) {
          setNotice('That hex is not part of a building.');
          return;
        }
        update((d) => {
          const list = d.victory.controlBuildings.buildings;
          const i = list.findIndex((b) => map.hexes[map.byId[b.hex]!]?.building === mh.building);
          if (i >= 0) list.splice(i, 1);
          else list.push({ hex: mh.id, name: `${map.buildings[mh.building!]!.material === 'stone' ? 'Stone' : 'Wooden'} building ${mh.id}` });
          d.victory.controlBuildings.atLeast = Math.max(1, Math.min(d.victory.controlBuildings.atLeast, Math.max(1, list.length)));
        });
      }
    },
    [mode, map, update],
  );

  const scenario = 'sc' in built ? built.sc : undefined;
  const ok = !!scenario && !('problems' in built && built.problems?.length);
  const save = () => {
    if (!scenario) return;
    registerScenario(scenario);
    setNotice(`Saved “${scenario.title}” to your scenarios.`);
  };
  const playAs = (controllers: (sc: Scenario) => Record<string, Controller>) => {
    if (!scenario) return;
    registerScenario(scenario);
    useSession.getState().start(scenario.id, controllers(scenario));
    go('battle');
  };
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${draft.title.replace(/[^\w-]+/g, '-').toLowerCase() || 'scenario'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const sideIds = (nations: Nation[]) => {
    const p = nations.map((n) => NATIONS.find((x) => x.id === n)!.prefix);
    return p[0] === p[1] ? [p[0]!, `${p[1]!}2`] : p;
  };
  const setNation = (i: number, n: Nation) =>
    update((d) => {
      const nations = d.sides.map((s, j) => (j === i ? n : s.nation)) as Nation[];
      const ids = sideIds(nations);
      const old = d.sides.map((s) => s.id);
      d.sides.forEach((s, j) => {
        s.id = ids[j]!;
        s.nation = nations[j]!;
        if (j === i) {
          s.name = NATIONS.find((x) => x.id === n)!.name;
          s.units = [];
        }
      });
      const map2 = (id: string) => ids[old.indexOf(id)] ?? id;
      d.setupFirst = map2(d.setupFirst);
      d.moveFirst = map2(d.moveFirst);
      d.victory.side = map2(d.victory.side);
      for (const k of ['smoke', 'concealment', 'starshells'] as const) if (d[k]) d[k] = Object.fromEntries(Object.entries(d[k]!).map(([s, v]) => [map2(s), v]));
      if (d.artillery) d.artillery = d.artillery.map((a) => ({ ...a, side: map2(a.side) }));
    });
  const setBoards = (b1: string, b2: string) =>
    update((d) => {
      d.layout = [{ board: b1, x: 0, y: 0 }, ...(b2 ? [{ board: b2, x: 0, y: 1 }] : [])];
      const ok2 = new Set(d.layout.map((l) => l.board));
      for (const s of d.sides) {
        s.setup = s.setup.filter((z) => ok2.has(z.board));
        if (!s.setup.length) s.setup = [{ board: b1, cols: ['A', 'GG'] }];
        for (const u of s.units) if (u.hex && !ok2.has(u.hex.split('-')[0]!)) delete u.hex;
      }
      d.victory.controlBuildings.buildings = d.victory.controlBuildings.buildings.filter((b) => ok2.has(b.hex.split('-')[0]!));
    });

  const typesFor = (n: Nation) => [
    ...Object.values(data.units)
      .filter((u) => u.nation === n)
      .map((u) => ({ id: u.id, name: u.name })),
    ...Object.values(data.vehicles)
      .filter((v) => v.nation === n)
      .map((v) => ({ id: v.id, name: v.name })),
  ];
  const weaponsFor = (n: Nation) => Object.values(data.weapons).filter((w) => w.nation === n);
  const unitName = (t: string) => data.units[t]?.name ?? data.vehicles[t]?.name ?? t;

  const field = (label: string, el: React.ReactNode) => (
    <label className="sced-field">
      <span>{label}</span>
      {el}
    </label>
  );

  return (
    <div className="page">
      <TopBar title="Scenario editor">
        <button className="btn" onClick={() => setDraftRaw(blank())}>
          New
        </button>
        <select
          className="auto-select"
          value=""
          aria-label="Start from a scenario"
          onChange={(e) => {
            const sc = scenarioById(e.target.value);
            if (sc) setDraftRaw(copyOf(sc));
          }}
        >
          <option value="">Start from…</option>
          {[...allScenarios(), ...customScenarios()].map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => file.current?.click()}>
          Import…
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              setDraftRaw(parseScenario(JSON.parse(await f.text())));
              setNotice(`Imported ${f.name}.`);
            } catch (err) {
              setNotice(`Not a scenario file: ${(err as Error).message.slice(0, 160)}`);
            }
          }}
        />
        <button className="btn" onClick={exportJson}>
          Export
        </button>
      </TopBar>
      <div className="sced">
        <aside className="sced-form">
          <h3 className="panel-h">Scenario</h3>
          {field('Title', <input className="text-input" value={draft.title} onChange={(e) => update((d) => void (d.title = e.target.value))} />)}
          <div className="sced-row">
            {field('Date', <input className="text-input" value={draft.date} onChange={(e) => update((d) => void (d.date = e.target.value))} />)}
            {field('Turns', <input className="text-input narrow" type="number" min={1} max={20} value={draft.turns} onChange={(e) => update((d) => void (d.turns = Math.max(1, Number(e.target.value) || 1)))} />)}
          </div>
          {field('Location', <input className="text-input" value={draft.location} onChange={(e) => update((d) => void (d.location = e.target.value))} />)}
          {field('Briefing', <textarea className="text-input" rows={3} value={draft.briefing} onChange={(e) => update((d) => void (d.briefing = e.target.value))} />)}
          {field(
            'Rules',
            <select className="text-input" value={draft.rulesLevel} onChange={(e) => update((d) => void (d.rulesLevel = Number(e.target.value)))}>
              {LEVELS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>,
          )}
          <div className="sced-row">
            {field(
              'North board',
              <select className="text-input" value={draft.layout[0]!.board} onChange={(e) => setBoards(e.target.value, draft.layout[1]?.board ?? '')}>
                {Object.values(boards).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.id}: {b.name}
                  </option>
                ))}
              </select>,
            )}
            {field(
              'South board',
              <select className="text-input" value={draft.layout[1]?.board ?? ''} onChange={(e) => setBoards(draft.layout[0]!.board, e.target.value)}>
                <option value="">None</option>
                {Object.values(boards).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.id}: {b.name}
                  </option>
                ))}
              </select>,
            )}
          </div>
          <h3 className="panel-h">Special rules</h3>
          <div className="sced-checks">
            {(
              [
                ['night', 'Night (§49)'],
                ['snow', 'Snow (§61)'],
                ['sewers', 'Sewers (§27)'],
              ] as const
            ).map(([k, l]) => (
              <label key={k} className="check">
                <input type="checkbox" checked={!!draft[k]} onChange={(e) => update((d) => void (e.target.checked ? (d[k] = true) : delete d[k]))} />
                {l}
              </label>
            ))}
          </div>
          {draft.sides.map((side, i) => (
            <section key={i} className={`sced-side nation-${side.nation}`}>
              <h3 className="panel-h">
                Side {i + 1}: {side.name}
              </h3>
              <div className="sced-row">
                {field(
                  'Nation',
                  <select className="text-input" value={side.nation} onChange={(e) => setNation(i, e.target.value as Nation)}>
                    {NATIONS.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name}
                      </option>
                    ))}
                  </select>,
                )}
                <label className="check">
                  <input type="radio" checked={draft.setupFirst === side.id} onChange={() => update((d) => void (d.setupFirst = side.id))} /> sets up first
                </label>
                <label className="check">
                  <input type="radio" checked={draft.moveFirst === side.id} onChange={() => update((d) => void (d.moveFirst = side.id))} /> moves first
                </label>
              </div>
              <div className="sced-row">
                {field(
                  'Setup board',
                  <select className="text-input" value={side.setup[0]!.board} onChange={(e) => update((d) => void (d.sides[i]!.setup[0]!.board = e.target.value))}>
                    {draft.layout.map((l) => (
                      <option key={l.board}>{l.board}</option>
                    ))}
                  </select>,
                )}
                {field(
                  'Columns',
                  <span className="sced-range">
                    {[0, 1].map((k) => (
                      <select key={k} className="text-input narrow" value={side.setup[0]!.cols[k]} onChange={(e) => update((d) => void (d.sides[i]!.setup[0]!.cols[k] = e.target.value))}>
                        {COLS.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    ))}
                  </span>,
                )}
                {field(
                  'Rows',
                  <span className="sced-range">
                    {[0, 1].map((k) => (
                      <input
                        key={k}
                        className="text-input narrow"
                        type="number"
                        min={0}
                        max={10}
                        value={side.setup[0]!.rows?.[k] ?? (k ? 10 : 0)}
                        onChange={(e) =>
                          update((d) => {
                            const z = d.sides[i]!.setup[0]!;
                            const r: [number, number] = [...(z.rows ?? [0, 10])] as [number, number];
                            r[k] = Number(e.target.value);
                            z.rows = r;
                          })
                        }
                      />
                    ))}
                  </span>,
                )}
              </div>
              <div className="sced-row">
                {field(
                  'Concealment',
                  <input className="text-input narrow" type="number" min={0} max={9} value={draft.concealment?.[side.id] ?? 0} onChange={(e) => update((d) => void (d.concealment = { ...d.concealment, [side.id]: Number(e.target.value) }))} />,
                )}
                {field('Smoke', <input className="text-input narrow" type="number" min={0} max={9} value={draft.smoke?.[side.id] ?? 0} onChange={(e) => update((d) => void (d.smoke = { ...d.smoke, [side.id]: Number(e.target.value) }))} />)}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={!!draft.artillery?.some((a) => a.side === side.id)}
                    onChange={(e) =>
                      update((d) => {
                        const rest = (d.artillery ?? []).filter((a) => a.side !== side.id);
                        d.artillery = e.target.checked ? [...rest, { side: side.id }] : rest;
                        if (!d.artillery.length) delete d.artillery;
                      })
                    }
                  />
                  Artillery
                </label>
              </div>
              <table className="sced-units">
                <tbody>
                  {side.units.map((u, j) => (
                    <UnitRow
                      key={j}
                      u={u}
                      name={unitName(u.type)}
                      weapons={weaponsFor(side.nation)}
                      placing={mode?.kind === 'place' && mode.side === i && mode.unit === j}
                      onPlace={() => setMode(mode?.kind === 'place' && mode.side === i && mode.unit === j ? undefined : { kind: 'place', side: i, unit: j })}
                      onChange={(f) => update((d) => f(d.sides[i]!.units[j]!))}
                      onRemove={() => update((d) => void d.sides[i]!.units.splice(j, 1))}
                      boards={draft.layout.map((l) => l.board)}
                    />
                  ))}
                </tbody>
              </table>
              <select
                className="text-input"
                value=""
                aria-label={`Add a unit to ${side.name}`}
                onChange={(e) => {
                  const t = e.target.value;
                  if (!t) return;
                  update((d) => void d.sides[i]!.units.push({ type: t }));
                  setMode({ kind: 'place', side: i, unit: side.units.length });
                }}
              >
                <option value="">Add a unit…</option>
                {typesFor(side.nation).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </section>
          ))}
          <h3 className="panel-h">Victory</h3>
          <div className="sced-row">
            {field(
              'Wins if it holds them',
              <select className="text-input" value={draft.victory.side} onChange={(e) => update((d) => void (d.victory.side = e.target.value))}>
                {draft.sides.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>,
            )}
            {field(
              'At least',
              <input
                className="text-input narrow"
                type="number"
                min={1}
                max={Math.max(1, draft.victory.controlBuildings.buildings.length)}
                value={draft.victory.controlBuildings.atLeast}
                onChange={(e) => update((d) => void (d.victory.controlBuildings.atLeast = Math.max(1, Number(e.target.value) || 1)))}
              />,
            )}
          </div>
          <button className={`btn tiny ${mode?.kind === 'objective' ? 'primary' : ''}`} onClick={() => setMode(mode?.kind === 'objective' ? undefined : { kind: 'objective' })}>
            {mode?.kind === 'objective' ? 'Done picking' : 'Pick objective buildings on the map…'}
          </button>
          <ul className="small sced-objectives">
            {draft.victory.controlBuildings.buildings.map((b, i) => (
              <li key={b.hex}>
                <input className="text-input" value={b.name} onChange={(e) => update((d) => void (d.victory.controlBuildings.buildings[i]!.name = e.target.value))} aria-label={`Name of objective ${b.hex}`} />
                <span className="dim"> {b.hex}</span>
              </li>
            ))}
          </ul>
          {field(
            'Victory text',
            <textarea
              className="text-input"
              rows={3}
              value={draft.victory.text}
              placeholder="Leave empty to have it written for you."
              onChange={(e) => update((d) => void (d.victory.text = e.target.value))}
            />,
          )}
          <button
            className="btn tiny"
            onClick={() =>
              update((d) => {
                const winner = d.sides.find((s) => s.id === d.victory.side)!;
                const loser = d.sides.find((s) => s.id !== d.victory.side)!;
                const v = d.victory.controlBuildings;
                d.victory.text = `The ${winner.name}s win if, at the end of turn ${d.turns}, they control at least ${v.atLeast} of the ${v.buildings.length} objective buildings (${v.buildings.map((b) => b.name.toLowerCase()).join(', ')}). A building is controlled by the side that has an unbroken infantry unit in it and no enemy units in any of its hexes. Otherwise the ${loser.name}s win.`;
              })
            }
          >
            Write the victory text
          </button>
        </aside>
        <div className="sced-map">
          <MapViews
            map={map}
            mode="2d"
            layers={layers}
            units={'st' in built && built.st ? { ctx: built.ctx!, s: built.st, selected: new Set() } : undefined}
            onClick={onClick}
          />
          <div className="sced-status panel-card small">
            {mode?.kind === 'place' && <p>Click a hex to place the unit.</p>}
            {mode?.kind === 'objective' && <p>Click buildings to add or remove them as objectives.</p>}
            {'error' in built && <p className="warn">Not valid yet: {built.error}</p>}
            {'problems' in built && built.problems && built.problems.length > 0 && (
              <ul className="warn">
                {built.problems.slice(0, 6).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {ok && <p className="good">Ready to play.</p>}
            {notice && <p className="dim">{notice}</p>}
            <div className="play-actions">
              <button className="btn" disabled={!scenario} onClick={save}>
                Save to my scenarios
              </button>
              <button className="btn" disabled={!ok} onClick={() => playAs((sc) => Object.fromEntries(sc.sides.map((s) => [s.id, 'bot'])))} title="The computer plays both sides">
                Test-play
              </button>
              <button
                className="btn primary"
                disabled={!ok}
                onClick={() => {
                  registerScenario(scenario!);
                  go(`play/${scenario!.id}`);
                }}
              >
                Play…
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function UnitRow({
  u,
  name,
  weapons,
  placing,
  boards,
  onPlace,
  onChange,
  onRemove,
}: {
  u: UnitEntry;
  name: string;
  weapons: { id: string; name: string }[];
  placing: boolean;
  boards: string[];
  onPlace: () => void;
  onChange: (f: (u: UnitEntry) => void) => void;
  onRemove: () => void;
}) {
  return (
    <tr className={placing ? 'placing' : ''}>
      <td>
        <strong className="small">{name}</strong>
        {(u.weapons ?? []).map((w, k) => (
          <button key={k} className="chip" title="Remove" onClick={() => onChange((x) => void x.weapons!.splice(k, 1))}>
            {weapons.find((x) => x.id === w)?.name ?? w} ✕
          </button>
        ))}
        <select className="chip-add" value="" aria-label={`Give ${name} a weapon`} onChange={(e) => e.target.value && onChange((x) => void (x.weapons = [...(x.weapons ?? []), e.target.value]))}>
          <option value="">+ weapon</option>
          {weapons.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input className="text-input narrow" type="number" min={1} max={6} value={u.count ?? 1} aria-label="How many" onChange={(e) => onChange((x) => void (Number(e.target.value) > 1 ? (x.count = Number(e.target.value)) : delete x.count))} />
      </td>
      <td>
        <button className={`btn tiny ${placing ? 'primary' : ''}`} onClick={onPlace} title="Click, then click a hex on the map">
          {u.enters ? `Turn ${u.enters.turn}` : (u.hex ?? 'Place')}
        </button>
      </td>
      <td>
        <select
          className="chip-add"
          value={u.enters ? `${u.enters.turn}-${u.enters.edge}` : ''}
          aria-label="Reinforcements"
          title="Arrives later along a board edge"
          onChange={(e) =>
            onChange((x) => {
              if (!e.target.value) {
                delete x.enters;
                return;
              }
              const [turn, edge] = e.target.value.split('-');
              x.enters = { turn: Number(turn), board: edge === 'S' && boards[1] ? boards[1] : boards[0]!, edge: edge as 'N' | 'S' | 'E' | 'W' };
              delete x.hex;
            })
          }
        >
          <option value="">on map</option>
          {[1, 2, 3, 4, 5].flatMap((t) =>
            (['W', 'E', 'N', 'S'] as const).map((edge) => (
              <option key={`${t}${edge}`} value={`${t}-${edge}`}>
                turn {t}, {edge} edge
              </option>
            )),
          )}
        </select>
      </td>
      <td>
        <label className="check" title="Hidden set-up (§42)">
          <input type="checkbox" checked={!!u.hidden} onChange={(e) => onChange((x) => void (e.target.checked ? (x.hidden = true) : delete x.hidden))} />H
        </label>
      </td>
      <td>
        <button className="btn tiny ghost" onClick={onRemove} aria-label={`Remove ${name}`}>
          ✕
        </button>
      </td>
    </tr>
  );
}
