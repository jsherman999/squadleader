import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { HexKey } from '@squadwar/hex';
import type { GameMap } from '@squadwar/terrain';
import type { LosResult } from '@squadwar/los';
import type { Ctx, GameState } from '@squadwar/engine';
import { BoardView } from '../board/BoardView';
import { drawUnits } from '../board/counters';
import type { BoardRenderer, OverlayLayer, RendererEvents } from '../board/renderer';
import { hexOutline, type Pen } from '../draw/pen';
import { pixiPen } from '../draw/pixiPen';
import type { PovSpec, Quality, Scene3D } from '../scene3d/scene';
import { hexToPixel, parseHexKey } from '@squadwar/hex';
import { playCue, setListener } from '../fx/audio';
import { DiceTray } from '../fx/DiceTray';
import { Fx2D } from '../fx/fx2d';
import { fxPlayer } from '../fx/player';
import type { FxSlide } from '../fx/sample';
import { HEX_PX } from '../board/palette';
import { Container } from 'pixi.js';

// three.js is large: load it the first time the 3D view is shown.
const Scene3DView = lazy(() => import('../scene3d/Scene3DView').then((m) => ({ default: m.Scene3DView })));

export type ViewMode = '2d' | '3d' | 'split';
export type ViewKind = '2d' | '3d';
export type Painter = (pen: Pen, view: ViewKind) => void;

/** Map-space overlays by layer. In 3D all layers drape over the terrain, in order. */
export interface OverlayLayers {
  readonly under?: Painter;
  readonly over?: Painter;
  readonly top?: Painter;
}

export interface MapViewsProps extends RendererEvents {
  map: GameMap;
  mode: ViewMode;
  layers: OverlayLayers;
  units?: { ctx: Ctx; s: GameState; selected: ReadonlySet<string>; hidden?: ReadonlySet<string>; vehicle?: string | undefined } | undefined;
  /** Shown as a ray between eye heights in 3D. */
  los?: LosResult | undefined;
  hover?: HexKey | undefined;
  pov?: (PovSpec & { title: string; detail?: string }) | undefined;
  onPovExit?: () => void;
  onReady2d?: (r: BoardRenderer | undefined) => void;
}

const LAYERS: readonly Exclude<OverlayLayer, 'units'>[] = ['under', 'over', 'top'];

function load<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    // Storage can be blocked; the setting just won't stick.
  }
}

export function loadViewMode(): ViewMode {
  const m = load<ViewMode>('squadwar:view', '2d');
  return m === '3d' || m === 'split' ? m : '2d';
}

export function nextViewMode(m: ViewMode): ViewMode {
  const next: ViewMode = m === '2d' ? '3d' : m === '3d' ? 'split' : '2d';
  store('squadwar:view', next);
  return next;
}

export function setViewMode(m: ViewMode): ViewMode {
  store('squadwar:view', m);
  return m;
}

/** The board as a 2D map, a 3D landscape, or both side by side, sharing overlays and units. */
export function MapViews(p: MapViewsProps) {
  const { map, layers, units, los, hover, pov } = p;
  const mode: ViewMode = pov && p.mode === '2d' ? '3d' : p.mode;
  const show2d = mode !== '3d';
  const show3d = mode !== '2d';
  const [r2, setR2] = useState<BoardRenderer>();
  const [s3, setS3] = useState<Scene3D>();
  // Mount each view the first time it is needed, then keep it (rebuilding 3D is slow).
  const [mounted3d, setMounted3d] = useState(show3d);
  const [mounted2d, setMounted2d] = useState(show2d);
  if (show3d && !mounted3d) setMounted3d(true);
  if (show2d && !mounted2d) setMounted2d(true);
  const [quality, setQuality] = useState<Quality>(() => load<Quality>('squadwar:quality', 'medium'));
  const [exag, setExag] = useState(() => Number(load('squadwar:exaggeration', '1.6')) || 1.6);

  const onReady2d = p.onReady2d;
  const ready2d = (r: BoardRenderer | undefined) => {
    setR2(r);
    onReady2d?.(r);
  };

  // ---- Fire Director: every frame goes to the visible views ----
  const hitRef = useRef<HTMLDivElement>(null);
  /** Units sliding to their new hex: drawn apart from their stacks until they arrive. */
  const [sliding, setSliding] = useState<string>('');
  const slidesRef = useRef<FxSlide[]>([]);
  useEffect(
    () =>
      fxPlayer.onFrame((f) => {
        slidesRef.current = f.slides;
        const key = f.slides.map((x) => x.units.join()).join('|');
        setSliding((k) => (k === key ? k : key));
      }),
    [],
  );
  useEffect(() => {
    if (!r2 || !show2d) return;
    const fx = new Fx2D(r2);
    const off = fxPlayer.onFrame((f) => fx.draw(f));
    return () => {
      off();
      fx.destroy();
    };
  }, [r2, show2d]);
  useEffect(() => {
    if (!s3 || !show3d) return;
    return fxPlayer.onFrame((f) => {
      s3.setFxFrame(f);
      const pv = s3.povHex;
      if (hitRef.current) hitRef.current.style.opacity = String(pv ? Math.min(0.9, (f.hits.get(pv) ?? 0) * 0.9) : 0);
    });
  }, [s3, show3d]);
  // Sound is heard from the POV unit when there is one.
  const povHex = pov?.hex;
  useEffect(() => {
    if (povHex) {
      const c = hexToPixel(parseHexKey(povHex));
      setListener(c.x, c.y, true);
    } else {
      const b = map.bounds;
      setListener((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, false);
    }
    if (!povHex) return;
    return fxPlayer.onCue((c) => {
      if (c.kind === 'hit' && c.hex === povHex) {
        const at = hexToPixel(parseHexKey(povHex));
        playCue({ kind: 'sound', t0: 0, sound: 'whizz', at: { ...at, z: 0 } });
      }
    });
  }, [povHex, map]);

  // ---- 2D ----
  useEffect(() => {
    if (!r2 || !show2d) return;
    for (const layer of LAYERS) {
      const pen = pixiPen(r2.overlay(`paint-${layer}`, layer), r2.container(`paint-${layer}-labels`, 'top'));
      layers[layer]?.(pen, '2d');
    }
  }, [r2, show2d, layers]);

  useEffect(() => {
    if (!r2 || !show2d) return;
    const c = r2.container('units', 'units');
    const sc = r2.container('units-slide', 'units');
    if (!units) return;
    const groups = sliding ? sliding.split('|').map((g) => g.split(',')) : [];
    const moving = new Set(groups.flat());
    const keep = (pred: (id: string) => boolean) => ({ ...units.s, units: Object.fromEntries(Object.entries(units.s.units).filter(([id]) => pred(id))) });
    const opts = { selected: new Set(units.selected), ...(units.hidden ? { hidden: units.hidden } : {}), vehicle: units.vehicle };
    drawUnits(c, units.ctx, moving.size ? keep((id) => !moving.has(id)) : units.s, opts);
    // One container per moving group, shifted every frame from the hex the state puts it in.
    const subs: { box: Container; ids: string[] }[] = [];
    for (const ids of groups) {
      const box = new Container();
      drawUnits(box, units.ctx, { ...keep((id) => ids.includes(id)), vehicles: {}, wrecks: [] }, opts);
      sc.addChild(box);
      subs.push({ box, ids });
    }
    if (!subs.length) return;
    const place = (slides: FxSlide[]) => {
      for (const sb of subs) {
        const sl = slides.find((x) => x.units.join() === sb.ids.join());
        const u = sb.ids.map((id) => units.s.units[id]).find(Boolean);
        if (!sl || !u) {
          sb.box.visible = !sl && !!u;
          sb.box.position.set(0, 0);
          continue;
        }
        const home = hexToPixel(parseHexKey(u.hex));
        sb.box.position.set((sl.at.x - home.x) * HEX_PX, (sl.at.y - home.y) * HEX_PX);
      }
    };
    place(slidesRef.current);
    return fxPlayer.onFrame((f) => place(f.slides));
  }, [r2, show2d, units, sliding]);

  useEffect(() => {
    if (!r2 || !show2d) return;
    const g = r2.overlay('hover', 'top');
    if (hover && map.hexes[hover]) hexOutline(pixiPen(g), map.hexes[hover]!.hex, 0xffffff, 0.75, 2.2);
  }, [r2, show2d, hover, map]);

  // ---- 3D ----
  useEffect(() => {
    if (!s3 || !show3d) return;
    s3.paintOverlay((pen) => {
      for (const layer of LAYERS) layers[layer]?.(pen, '3d');
    });
  }, [s3, show3d, layers]);

  useEffect(() => {
    if (!s3 || !show3d || !units) return;
    s3.setUnits(units.ctx, units.s, units.selected, units.hidden, units.vehicle);
    const place = (slides: FxSlide[]) => {
      const off = new Map<string, { x: number; y: number; hop: number }>();
      for (const sl of slides) {
        for (const id of sl.units) {
          const u = units.s.units[id];
          if (!u) continue;
          const home = hexToPixel(parseHexKey(u.hex));
          const dx = sl.at.x - home.x;
          const dy = sl.at.y - home.y;
          // A little hop that peaks mid-hex.
          const frac = Math.hypot(dx, dy) % Math.sqrt(3);
          off.set(id, { x: dx, y: dy, hop: Math.sin((frac / Math.sqrt(3)) * Math.PI) });
        }
      }
      s3.slideUnits(off);
    };
    place(slidesRef.current);
    return fxPlayer.onFrame((f) => place(f.slides));
  }, [s3, show3d, units]);

  useEffect(() => {
    if (s3 && show3d) s3.setLos(los);
  }, [s3, show3d, los]);

  useEffect(() => {
    if (s3 && show3d && !s3.inPov) s3.setHover(hover);
  }, [s3, show3d, hover]);

  useEffect(() => {
    s3?.setQuality(quality);
  }, [s3, quality]);

  useEffect(() => {
    s3?.setExaggeration(exag);
  }, [s3, exag]);

  useEffect(() => {
    if (!s3) return;
    if (pov) s3.enterPov(pov);
    else s3.exitPov();
  }, [s3, pov]);

  return (
    <div className={`map-views mode-${mode}`}>
      <DiceTray />
      {mounted2d && (
        <div className="map-pane" hidden={!show2d}>
          <BoardView map={map} onReady={ready2d} {...events(p)} />
        </div>
      )}
      {mounted3d && (
        <div className="map-pane" hidden={!show3d}>
          <Suspense fallback={<div className="board-host view-loading small dim">Building the 3D landscape…</div>}>
            <Scene3DView map={map} onReady={setS3} {...events(p)} />
          </Suspense>
          {pov ? (
            <div className="pov-hud">
              <div className="pov-vignette" />
              <div className="pov-hit" ref={hitRef} />
              <div className="pov-reticle" />
              <div className="pov-card panel-card">
                <span className="stencil">{pov.title}</span>
                {pov.detail && <span className="small dim">{pov.detail}</span>}
                <span className="small dim">Drag to look around, wheel to zoom. Enemy units are shown only where the rules give line of sight.</span>
                <button className="btn tiny" onClick={p.onPovExit}>
                  Leave POV <kbd>Esc</kbd>
                </button>
              </div>
            </div>
          ) : (
            <div className="view3d-controls panel-card" onPointerDown={(e) => e.stopPropagation()}>
              <label className="field compact" title="Rendering quality">
                Quality
                <select
                  value={quality}
                  onChange={(e) => {
                    const q = e.target.value as Quality;
                    setQuality(q);
                    store('squadwar:quality', q);
                  }}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label className="field compact" title="Vertical exaggeration of hills and buildings">
                Height ×{exag.toFixed(1)}
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.1}
                  value={exag}
                  onChange={(e) => {
                    const x = Number(e.target.value);
                    setExag(x);
                    store('squadwar:exaggeration', String(x));
                  }}
                />
              </label>
              <button className="btn tiny" onClick={() => s3?.resetView()} title="Reset the camera">
                Reset view
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function events(p: RendererEvents): RendererEvents {
  return {
    ...(p.onHover ? { onHover: p.onHover } : {}),
    ...(p.onClick ? { onClick: p.onClick } : {}),
    ...(p.onContext ? { onContext: p.onContext } : {}),
  };
}
