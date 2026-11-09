import { useCallback, useMemo, useRef, useState } from 'react';
import {
  DIRECTIONS,
  DIRECTION_NAMES,
  hexKey,
  hexToPixel,
  neighbor,
  oppositeDir,
  type Direction,
  type HexKey,
} from '@squadwar/hex';
import {
  composeMap,
  lintBoard,
  parseBoard,
  type BoardDef,
  type BoardHex,
  type BoardHexside,
  type HexTerrain,
  type MapHex,
} from '@squadwar/terrain';
import { BoardView } from '../board/BoardView';
import type { BoardRenderer, PointerInfo } from '../board/renderer';
import { drawHexOutline } from '../board/overlays';
import { HEX_PX } from '../board/palette';
import { allBoards } from '../content';
import { describeHex, TERRAIN_NAMES } from '../ui/describe';
import { HexCard } from '../ui/HexCard';
import { TopBar } from '../ui/TopBar';

type Tool =
  | { kind: 'terrain'; terrain: HexTerrain }
  | { kind: 'level'; level: number }
  | { kind: 'shellhole' }
  | { kind: 'sewer' }
  | { kind: 'side'; feature: 'wall' | 'hedge' | 'cliff' | 'paved' | 'dirt' };

const blank = (): BoardDef => ({ format: 'squadwar-board@1', id: 'X', name: 'New board', kind: 'city', seed: 1, hexes: {}, hexsides: {} });

export function EditorPage() {
  const [board, setBoard] = useState<BoardDef>(() => structuredClone(allBoards().A!));
  const [tool, setTool] = useState<Tool>({ kind: 'terrain', terrain: 'woods' });
  const [renderer, setRenderer] = useState<BoardRenderer>();
  const [hover, setHover] = useState<HexKey>();
  const [message, setMessage] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);

  const map = useMemo(() => composeMap([{ board: board.id, x: 0, y: 0 }], { [board.id]: board }), [board]);
  const issues = useMemo(() => lintBoard(board), [board]);

  const nearestSide = useCallback(
    (h: MapHex, world: { x: number; y: number }): Direction => {
      const c = hexToPixel(h.hex);
      const ang = (Math.atan2(world.y - c.y, world.x - c.x) * 180) / Math.PI;
      const mids = [-90, -30, 30, 90, 150, -150];
      let best: Direction = 0;
      let bestD = 999;
      for (const d of DIRECTIONS) {
        const diff = Math.abs(((ang - mids[d]! + 540) % 360) - 180);
        if (diff < bestD) {
          bestD = diff;
          best = d;
        }
      }
      return best;
    },
    [],
  );

  const onHover = useCallback(
    (p: PointerInfo) => {
      setHover(p.hex);
      if (!renderer) return;
      const g = renderer.overlay('hover', 'top');
      if (!p.hex) return;
      const h = map.hexes[p.hex]!;
      drawHexOutline(g, h.hex, 0xffffff, 0.9, 3);
      if (tool.kind === 'side') {
        const d = nearestSide(h, p.world);
        const c = hexToPixel(h.hex);
        const n = hexToPixel(neighbor(h.hex, d));
        const mid = { x: (c.x + n.x) / 2, y: (c.y + n.y) / 2 };
        g.circle(mid.x * HEX_PX, mid.y * HEX_PX, 7).fill({ color: 0xc9a75d, alpha: 0.9 });
      }
    },
    [renderer, map, tool, nearestSide],
  );

  const onClick = useCallback(
    (p: PointerInfo) => {
      if (!p.hex) return;
      const h = map.hexes[p.hex]!;
      const id = h.localId;
      setBoard((prev) => {
        const next: BoardDef = structuredClone(prev);
        const cur: BoardHex = { ...(next.hexes[id] ?? {}) };
        if (tool.kind === 'terrain') {
          delete cur.b;
          if (tool.terrain === 'open') delete cur.t;
          else cur.t = tool.terrain;
          if (tool.terrain === 'woodBuilding' || tool.terrain === 'stoneBuilding') {
            cur.b = p.shift ? newBuildingId(next) : joinBuildingId(next, map, h, tool.terrain) ?? newBuildingId(next);
          }
        } else if (tool.kind === 'level') {
          if (tool.level === 0) delete cur.lv;
          else cur.lv = tool.level;
        } else if (tool.kind === 'shellhole') {
          if (cur.sh) delete cur.sh;
          else cur.sh = true;
        } else if (tool.kind === 'sewer') {
          if (cur.sw) delete cur.sw;
          else cur.sw = true;
        } else {
          toggleSide(next, map, h, nearestSide(h, p.world), tool.feature);
          return next;
        }
        if (Object.keys(cur).length) next.hexes[id] = cur;
        else delete next.hexes[id];
        return next;
      });
    },
    [map, tool, nearestSide],
  );

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(board, null, 1) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${board.id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (f: File) => {
    try {
      setBoard(parseBoard(JSON.parse(await f.text())));
      setMessage(`Loaded ${f.name}`);
    } catch (e) {
      setMessage(String(e instanceof Error ? e.message : e));
    }
  };

  const terrains: HexTerrain[] = ['open', 'woods', 'woodBuilding', 'stoneBuilding', 'wheat', 'water'];
  const is = (t: Tool) => JSON.stringify(t) === JSON.stringify(tool);

  return (
    <div className="page">
      <TopBar title="Board editor">
        <button className="btn" onClick={() => setBoard(blank())}>
          New
        </button>
        <button className="btn" onClick={() => setBoard(structuredClone(allBoards().A!))}>
          Load City A
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          Import…
        </button>
        <button className="btn primary" onClick={exportJson}>
          Export JSON
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => e.target.files?.[0] && void importJson(e.target.files[0])}
        />
      </TopBar>
      <div className="editor">
        <aside className="side-panel">
          <section>
            <h3 className="panel-h">Board</h3>
            <label className="field">
              Id
              <input value={board.id} maxLength={1} onChange={(e) => setBoard({ ...board, id: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') || 'X' })} />
            </label>
            <label className="field">
              Name
              <input value={board.name} onChange={(e) => setBoard({ ...board, name: e.target.value })} />
            </label>
            <label className="field">
              Kind
              <select value={board.kind} onChange={(e) => setBoard({ ...board, kind: e.target.value as 'city' | 'country' })}>
                <option value="city">City</option>
                <option value="country">Country</option>
              </select>
            </label>
          </section>
          <section>
            <h3 className="panel-h">Terrain</h3>
            <div className="tool-grid">
              {terrains.map((t) => (
                <button key={t} className={`btn ${is({ kind: 'terrain', terrain: t }) ? 'active' : ''}`} onClick={() => setTool({ kind: 'terrain', terrain: t })}>
                  {TERRAIN_NAMES[t]}
                </button>
              ))}
            </div>
            <p className="faint small">Buildings join the adjacent building of the same material. Shift-click starts a new building.</p>
          </section>
          <section>
            <h3 className="panel-h">Elevation</h3>
            <div className="tool-grid four">
              {[0, 1, 2, 3].map((l) => (
                <button key={l} className={`btn ${is({ kind: 'level', level: l }) ? 'active' : ''}`} onClick={() => setTool({ kind: 'level', level: l })}>
                  {l === 0 ? 'Ground' : `L${l}`}
                </button>
              ))}
            </div>
          </section>
          <section>
            <h3 className="panel-h">Features</h3>
            <div className="tool-grid">
              <button className={`btn ${is({ kind: 'shellhole' }) ? 'active' : ''}`} onClick={() => setTool({ kind: 'shellhole' })}>
                Shellholes
              </button>
              <button className={`btn ${is({ kind: 'sewer' }) ? 'active' : ''}`} onClick={() => setTool({ kind: 'sewer' })}>
                Sewer
              </button>
            </div>
          </section>
          <section>
            <h3 className="panel-h">Hexsides</h3>
            <div className="tool-grid">
              {(['wall', 'hedge', 'cliff', 'paved', 'dirt'] as const).map((f) => (
                <button key={f} className={`btn ${is({ kind: 'side', feature: f }) ? 'active' : ''}`} onClick={() => setTool({ kind: 'side', feature: f })}>
                  {f === 'paved' ? 'Paved road' : f === 'dirt' ? 'Dirt road' : f[0]!.toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            <p className="faint small">Click near a hexside to toggle it. Roads run from hex centre to hexside.</p>
          </section>
          <section>
            <h3 className="panel-h">Checks</h3>
            {issues.length === 0 ? <p className="dim small">No issues.</p> : issues.map((i) => <p key={i.where + i.message} className="small warn">{i.where}: {i.message}</p>)}
            {message && <p className="small dim">{message}</p>}
          </section>
        </aside>
        <div className="board-wrap">
          <BoardView map={map} onReady={setRenderer} onHover={onHover} onClick={onClick} />
          <div className="hud-bottom-left">
            <HexCard d={hover ? describeHex(map, hover) : undefined} />
          </div>
        </div>
      </div>
    </div>
  );
}

function newBuildingId(b: BoardDef): string {
  const used = new Set(Object.values(b.hexes).map((h) => h.b));
  let i = 1;
  while (used.has(`b${i}`)) i++;
  return `b${i}`;
}

function joinBuildingId(b: BoardDef, map: ReturnType<typeof composeMap>, h: MapHex, t: HexTerrain): string | undefined {
  for (const d of DIRECTIONS) {
    const n = map.hexes[hexKey(neighbor(h.hex, d))];
    if (!n) continue;
    const def = b.hexes[n.localId];
    if (def?.t === t && def.b) return def.b;
  }
  return undefined;
}

function toggleSide(b: BoardDef, map: ReturnType<typeof composeMap>, h: MapHex, d: Direction, feature: 'wall' | 'hedge' | 'cliff' | 'paved' | 'dirt') {
  const n = map.hexes[hexKey(neighbor(h.hex, d))];
  const ids = [`${h.localId}/${DIRECTION_NAMES[d]}`];
  if (n && n.board === h.board) ids.push(`${n.localId}/${DIRECTION_NAMES[oppositeDir(d)]}`);
  const existingId = ids.find((i) => b.hexsides[i]);
  const id = existingId ?? ids[0]!;
  const side: BoardHexside = { ...(b.hexsides[id] ?? {}) };
  if (feature === 'paved' || feature === 'dirt') {
    if (side.road === feature) delete side.road;
    else side.road = feature;
  } else if (side[feature]) delete side[feature];
  else side[feature] = true;
  if (Object.keys(side).length) b.hexsides[id] = side;
  else delete b.hexsides[id];
}
