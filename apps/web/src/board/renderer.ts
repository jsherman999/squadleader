/**
 * Imperative PixiJS scene for the 2D board: camera (pan, zoom, pinch),
 * semantic zoom, named overlay layers and pointer events in hex terms.
 */
import { Application, Container, Graphics, type FederatedPointerEvent } from 'pixi.js';
import { hexKey, pixelToHex, type HexKey, type Vec2 } from '@squadwar/hex';
import type { GameMap } from '@squadwar/terrain';
import { paintBoard, type PaintedBoard } from './paint';
import { HEX_PX } from './palette';

export interface PointerInfo {
  hex: HexKey | undefined;
  /** Point in map units (hex circumradius = 1). */
  world: Vec2;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  button: number;
}

export interface RendererEvents {
  onHover?: (p: PointerInfo) => void;
  onClick?: (p: PointerInfo) => void;
  onContext?: (p: PointerInfo) => void;
}

export type OverlayLayer = 'under' | 'over' | 'units' | 'top';

export class BoardRenderer {
  readonly app = new Application();
  readonly world = new Container();
  private terrainLayer = new Container();
  private underLayer = new Container();
  private gridLayer = new Container();
  private labelLayer = new Container();
  private overLayer = new Container();
  private unitLayer = new Container();
  private topLayer = new Container();
  private overlays = new Map<string, Graphics | Container>();
  private painted?: PaintedBoard;
  private map?: GameMap;
  private events: RendererEvents = {};
  private destroyed = false;
  private ready = false;
  private pointers = new Map<number, Vec2>();
  private drag?: { start: Vec2; worldStart: Vec2; moved: boolean };
  private pinch?: { dist: number; scale: number; mid: Vec2 };
  private resizeObserver?: ResizeObserver;
  /** True while the camera shows the fitted board (no pan or zoom since). */
  private fitted = false;
  onCameraChange?: (scale: number) => void;

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: host,
      antialias: true,
      background: 0x15181a,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    host.appendChild(this.app.canvas);
    this.app.canvas.style.display = 'block';
    this.app.canvas.style.touchAction = 'none';
    this.world.addChild(
      this.terrainLayer,
      this.underLayer,
      this.gridLayer,
      this.labelLayer,
      this.overLayer,
      this.unitLayer,
      this.topLayer,
    );
    this.app.stage.addChild(this.world);
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.bindPointer();
    this.app.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.app.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // Pixi only follows window resizes; split view changes the host alone.
    this.resizeObserver = new ResizeObserver(() => {
      if (this.destroyed) return;
      const before = { w: this.app.screen.width, h: this.app.screen.height };
      const centre = this.toWorld({ x: before.w / 2, y: before.h / 2 });
      this.app.resize();
      this.app.stage.hitArea = this.app.screen;
      const { width: w, height: h } = this.app.screen;
      if (!w || !h || !before.w || !before.h || (w === before.w && h === before.h)) return;
      // Keep the same spot centred; refit if the board no longer fits sensibly.
      if (this.fitted) this.fit();
      else this.centerOn(centre);
    });
    this.resizeObserver.observe(host);
    this.ready = true;
    if (this.map) this.setMap(this.map, true);
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    if (this.ready) this.app.destroy(true, { children: true });
  }

  setEvents(e: RendererEvents): void {
    this.events = e;
  }

  setMap(map: GameMap, fit = false): void {
    const changed = this.map !== map;
    this.map = map;
    if (!this.ready) return;
    if (changed || !this.painted) {
      this.terrainLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
      this.gridLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
      this.labelLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
      this.painted = paintBoard(map);
      this.terrainLayer.addChild(this.painted.terrain);
      this.gridLayer.addChild(this.painted.grid);
      this.labelLayer.addChild(this.painted.labels);
      // Clip map-space overlays (shading, viewsheds) to the board outline.
      for (const layer of [this.underLayer, this.overLayer]) {
        const old = layer.mask;
        if (old instanceof Graphics) old.destroy();
        const m = new Graphics();
        for (const r of map.boards) m.rect(r.x0 * HEX_PX, r.y0 * HEX_PX, (r.x1 - r.x0) * HEX_PX, (r.y1 - r.y0) * HEX_PX).fill(0xffffff);
        this.world.addChild(m);
        layer.mask = m;
      }
    }
    if (fit) this.fit();
    this.applySemanticZoom();
  }

  /** A named Graphics overlay; calling again returns the same object (cleared). */
  overlay(name: string, layer: OverlayLayer = 'over'): Graphics {
    const existing = this.overlays.get(name);
    if (existing instanceof Graphics) {
      existing.clear();
      return existing;
    }
    existing?.destroy({ children: true });
    const g = new Graphics();
    this.overlays.set(name, g);
    this.layerFor(layer).addChild(g);
    return g;
  }

  /** A named Container overlay (for sprites and text); emptied on each call. */
  container(name: string, layer: OverlayLayer = 'units'): Container {
    let c = this.overlays.get(name);
    if (!c || c instanceof Graphics) {
      c?.destroy({ children: true });
      c = new Container();
      this.overlays.set(name, c);
      this.layerFor(layer).addChild(c);
    }
    c.removeChildren().forEach((ch) => ch.destroy({ children: true }));
    return c;
  }

  clearOverlay(name: string): void {
    const g = this.overlays.get(name);
    if (g instanceof Graphics) g.clear();
    else g?.removeChildren().forEach((ch) => ch.destroy({ children: true }));
  }

  private layerFor(layer: OverlayLayer): Container {
    return layer === 'under' ? this.underLayer : layer === 'units' ? this.unitLayer : layer === 'top' ? this.topLayer : this.overLayer;
  }

  get scale(): number {
    return this.world.scale.x;
  }

  fit(): void {
    if (!this.map || !this.ready) return;
    const b = this.map.bounds;
    const w = (b.x1 - b.x0) * HEX_PX;
    const h = (b.y1 - b.y0) * HEX_PX;
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    const s = Math.min((sw - 40) / w, (sh - 40) / h);
    this.world.scale.set(s);
    this.world.position.set((sw - w * s) / 2 - b.x0 * HEX_PX * s, (sh - h * s) / 2 - b.y0 * HEX_PX * s);
    this.applySemanticZoom();
    this.fitted = true;
  }

  /** Centre the camera on a map-unit point, optionally zooming. */
  centerOn(p: Vec2, scale?: number): void {
    this.fitted = false;
    if (scale) this.world.scale.set(scale);
    const s = this.world.scale.x;
    this.world.position.set(this.app.screen.width / 2 - p.x * HEX_PX * s, this.app.screen.height / 2 - p.y * HEX_PX * s);
    this.applySemanticZoom();
  }

  zoomBy(factor: number, at?: Vec2): void {
    this.fitted = false;
    const pt = at ?? { x: this.app.screen.width / 2, y: this.app.screen.height / 2 };
    const minS = this.minScale();
    const s0 = this.world.scale.x;
    const s1 = Math.max(minS, Math.min(4, s0 * factor));
    const wx = (pt.x - this.world.position.x) / s0;
    const wy = (pt.y - this.world.position.y) / s0;
    this.world.scale.set(s1);
    this.world.position.set(pt.x - wx * s1, pt.y - wy * s1);
    this.applySemanticZoom();
  }

  panBy(dx: number, dy: number): void {
    this.fitted = false;
    this.world.position.set(this.world.position.x + dx, this.world.position.y + dy);
  }

  private minScale(): number {
    if (!this.map) return 0.1;
    const b = this.map.bounds;
    const w = (b.x1 - b.x0) * HEX_PX;
    const h = (b.y1 - b.y0) * HEX_PX;
    return Math.min(this.app.screen.width / w, this.app.screen.height / h) * 0.5;
  }

  private applySemanticZoom(): void {
    const s = this.world.scale.x;
    this.labelLayer.alpha = Math.max(0, Math.min(1, (s - 0.42) / 0.25));
    this.onCameraChange?.(s);
  }

  /** Screen point → map units. */
  toWorld(screen: Vec2): Vec2 {
    const s = this.world.scale.x;
    return {
      x: (screen.x - this.world.position.x) / s / HEX_PX,
      y: (screen.y - this.world.position.y) / s / HEX_PX,
    };
  }

  /** Map units → screen point (CSS pixels within the canvas). */
  toScreen(p: Vec2): Vec2 {
    const s = this.world.scale.x;
    return { x: p.x * HEX_PX * s + this.world.position.x, y: p.y * HEX_PX * s + this.world.position.y };
  }

  private info(e: FederatedPointerEvent): PointerInfo {
    const world = this.toWorld({ x: e.global.x, y: e.global.y });
    const k = hexKey(pixelToHex(world));
    return {
      hex: this.map?.hexes[k] ? k : undefined,
      world,
      shift: e.shiftKey,
      alt: e.altKey,
      ctrl: e.ctrlKey || e.metaKey,
      button: e.button,
    };
  }

  private bindPointer(): void {
    const stage = this.app.stage;
    stage.on('pointerdown', (e) => {
      this.pointers.set(e.pointerId, { x: e.global.x, y: e.global.y });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()] as [Vec2, Vec2];
        this.pinch = {
          dist: Math.hypot(a.x - b.x, a.y - b.y),
          scale: this.world.scale.x,
          mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        };
        this.drag = undefined;
        return;
      }
      if (e.button === 2) {
        this.events.onContext?.(this.info(e));
        return;
      }
      this.drag = {
        start: { x: e.global.x, y: e.global.y },
        worldStart: { x: this.world.position.x, y: this.world.position.y },
        moved: false,
      };
    });
    stage.on('pointermove', (e) => {
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.global.x, y: e.global.y });
      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()] as [Vec2, Vec2];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const target = (this.pinch.scale * d) / this.pinch.dist;
        this.zoomBy(target / this.world.scale.x, this.pinch.mid);
        return;
      }
      if (this.drag) {
        const dx = e.global.x - this.drag.start.x;
        const dy = e.global.y - this.drag.start.y;
        if (!this.drag.moved && Math.hypot(dx, dy) > 5) this.drag.moved = true;
        if (this.drag.moved) {
          this.fitted = false;
          this.world.position.set(this.drag.worldStart.x + dx, this.drag.worldStart.y + dy);
          return;
        }
      }
      this.events.onHover?.(this.info(e));
    });
    const up = (e: FederatedPointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = undefined;
      const d = this.drag;
      this.drag = undefined;
      if (d && !d.moved && e.button === 0) this.events.onClick?.(this.info(e));
    };
    stage.on('pointerup', up);
    stage.on('pointerupoutside', up);
    stage.on('pointerleave', () => this.events.onHover?.({ hex: undefined, world: { x: 0, y: 0 }, shift: false, alt: false, ctrl: false, button: 0 }));
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = this.app.canvas.getBoundingClientRect();
    const factor = Math.pow(1.0018, -e.deltaY * (e.deltaMode === 1 ? 30 : 1));
    this.zoomBy(factor, { x: e.clientX - rect.left, y: e.clientY - rect.top });
  };
}
