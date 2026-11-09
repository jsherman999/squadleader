/**
 * The 3D landscape view (three.js). Same pointer API as the 2D board, so
 * pages can drive either. Map space maps to world space as x → X, y → Z;
 * heights are levels × LEVEL, scaled by the exaggeration on the root group.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { hexCorners, hexKey, hexToPixel, parseHexKey, pixelToHex, type HexKey, type Vec2 } from '@squadwar/hex';
import type { GameMap } from '@squadwar/terrain';
import { canBeUpper, type LosResult } from '@squadwar/los';
import type { Ctx, GameState } from '@squadwar/engine';
import type { PointerInfo, RendererEvents } from '../board/renderer';
import { canvasPen } from '../draw/canvasPen';
import type { Pen } from '../draw/pen';
import type { FxFrame } from '../fx/sample';
import { counterTexture, labelTexture } from './counters3d';
import { Fx3D } from './fx3d';
import { paintGround } from './ground';
import { buildingLevels, EYE, LEVEL, terrainHeight } from './heights';
import { buildingMeshes, hexsideMeshes, terrainGeometry, treeInstances } from './meshes';

export type Quality = 'low' | 'medium' | 'high';

export interface PovSpec {
  readonly hex: HexKey;
  readonly upper: boolean;
  /** Initial look direction (a map point). */
  readonly lookAt?: Vec2;
  /** Hexes the rules let this unit see; enemy units elsewhere are hidden. */
  readonly visible?: ReadonlySet<HexKey>;
  readonly side?: string;
}

const QUALITY: Record<Quality, { ratio: number; shadows: number; trees: number }> = {
  low: { ratio: 1, shadows: 0, trees: 0.6 },
  medium: { ratio: 1.5, shadows: 1024, trees: 1 },
  high: { ratio: 2, shadows: 2048, trees: 1.3 },
};

export class Scene3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.03, 500);
  private controls?: OrbitControls;
  private root = new THREE.Group();
  private landscape = new THREE.Group();
  private units = new THREE.Group();
  private labels = new THREE.Group();
  private losGroup = new THREE.Group();
  private hoverLine?: THREE.LineLoop;
  private ground?: THREE.Mesh;
  private overlayCanvas?: HTMLCanvasElement;
  private overlayTex?: THREE.CanvasTexture;
  private overlayPpu = 32;
  private sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  private map?: GameMap;
  private host?: HTMLElement;
  private events: RendererEvents = {};
  private raf = 0;
  private quality: Quality = 'medium';
  private exaggeration = 1.6;
  private down?: { x: number; y: number };
  private ray = new THREE.Raycaster();
  private resize?: ResizeObserver;
  private pov?: { spec: PovSpec; yaw: number; pitch: number; saved: { pos: THREE.Vector3; target: THREE.Vector3; fov: number } };
  private lastUnits?: () => void;
  private userMoved = false;
  private fx = new Fx3D();
  private shake = 0;
  private povBase?: THREE.Vector3;
  private buildingGroup?: THREE.Group;
  private excluded?: string;
  private focusAnim?: { from: THREE.Vector3; to: THREE.Vector3; fromPos: THREE.Vector3; toPos: THREE.Vector3; t: number };
  onPovExit?: () => void;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color(0xaebcc4);
    this.scene.add(this.root);
    this.root.add(this.landscape, this.units, this.labels, this.losGroup, this.fx.group);
    this.root.scale.y = this.exaggeration;
    this.scene.add(new THREE.HemisphereLight(0xdfe7ec, 0x4d4630, 1.1));
    this.sun.position.set(-18, 30, -12);
    this.scene.add(this.sun, this.sun.target);
  }

  init(host: HTMLElement): void {
    this.host = host;
    host.appendChild(this.renderer.domElement);
    const el = this.renderer.domElement;
    el.style.display = 'block';
    el.style.touchAction = 'none';
    this.controls = new OrbitControls(this.camera, el);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = 1.48;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 90;
    this.controls.screenSpacePanning = false;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener('start', () => (this.userMoved = true));
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('dblclick', this.onDbl);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', this.onWheel, { passive: false });
    this.resize = new ResizeObserver(() => this.fitSize());
    this.resize.observe(host);
    this.setQuality(this.quality);
    this.fitSize();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    loop();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.fx.dispose();
    this.resize?.disconnect();
    this.controls?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  setEvents(e: RendererEvents): void {
    this.events = e;
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const cfg = QUALITY[q];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg.ratio));
    this.renderer.shadowMap.enabled = cfg.shadows > 0;
    this.sun.castShadow = cfg.shadows > 0;
    if (cfg.shadows) this.sun.shadow.mapSize.set(cfg.shadows, cfg.shadows);
    this.sun.shadow.map?.dispose();
    (this.sun.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
    if (this.map) this.buildLandscape(this.map);
  }

  setExaggeration(x: number): void {
    this.exaggeration = x;
    this.root.scale.y = x;
    this.lastUnits?.();
  }

  private fitSize(): void {
    if (!this.host) return;
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    if (w <= 1 || h <= 1) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Until the user moves the camera, keep the whole board framed.
    if (!this.userMoved && !this.pov) this.resetView();
  }

  // ---- Map ------------------------------------------------------------------

  setMap(map: GameMap): void {
    if (this.map === map) return;
    this.map = map;
    this.buildLandscape(map);
    this.resetView();
  }

  private buildLandscape(map: GameMap): void {
    for (const c of [...this.landscape.children]) {
      this.landscape.remove(c);
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose?.();
      });
    }
    const cfg = QUALITY[this.quality];
    const shadows = cfg.shadows > 0;

    const geo = terrainGeometry(map);
    const groundTex = new THREE.CanvasTexture(paintGround(map));
    groundTex.colorSpace = THREE.SRGBColorSpace;
    groundTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.96, metalness: 0 }));
    this.ground.receiveShadow = shadows;
    this.landscape.add(this.ground);

    // Draped overlay for selections, paths, viewsheds.
    const { x0, y0, x1, y1 } = map.bounds;
    this.overlayPpu = Math.min(32, 2048 / Math.max(x1 - x0, y1 - y0));
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.width = Math.ceil((x1 - x0) * this.overlayPpu);
    this.overlayCanvas.height = Math.ceil((y1 - y0) * this.overlayPpu);
    this.overlayTex = new THREE.CanvasTexture(this.overlayCanvas);
    this.overlayTex.colorSpace = THREE.SRGBColorSpace;
    const overlay = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ map: this.overlayTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    );
    overlay.renderOrder = 2;
    this.landscape.add(overlay);

    // Board base: a slab under the ground for a tabletop look.
    const slab = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.3, 0.6, y1 - y0 + 0.3), new THREE.MeshStandardMaterial({ color: 0x2b2a24, roughness: 1 }));
    slab.position.set((x0 + x1) / 2, -0.36, (y0 + y1) / 2); // top 0.06 below the ground: no z-fighting from afar
    this.landscape.add(slab);

    this.buildingGroup = new THREE.Group();
    this.landscape.add(this.buildingGroup);
    this.buildBuildings(map, this.pov ? map.hexes[this.pov.spec.hex]?.building : undefined);

    const t = treeInstances(map, cfg.trees);
    const inst = (g: THREE.BufferGeometry, mats: THREE.Matrix4[], colors: THREE.Color[] | undefined, color: number) => {
      if (!mats.length) return;
      const m = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: colors ? 0xffffff : color, roughness: 0.95, flatShading: true }), mats.length);
      mats.forEach((x, i) => {
        m.setMatrixAt(i, x);
        if (colors) m.setColorAt(i, colors[i]!);
      });
      m.castShadow = shadows;
      m.receiveShadow = shadows;
      this.landscape.add(m);
    };
    inst(new THREE.ConeGeometry(1, 1, 7), t.conifers, t.colors, 0x3c5a30);
    inst(new THREE.IcosahedronGeometry(1, 1), t.broadleaf, t.broadColors, 0x5a7a3b);
    inst(new THREE.CylinderGeometry(1, 1, 1, 5), t.trunks, undefined, 0x4a3a2a);

    const hs = hexsideMeshes(map);
    inst(new THREE.BoxGeometry(1, 1, 1), hs.walls, undefined, 0x8d8a82);
    inst(new THREE.IcosahedronGeometry(1, 0), hs.hedges, undefined, 0x41632f);
    inst(new THREE.BoxGeometry(1, 1, 1), hs.cliffs, undefined, 0x3d362c);

    // Shadow camera covers the map.
    const cx = (x0 + x1) / 2;
    const cz = (y0 + y1) / 2;
    const half = Math.max(x1 - x0, y1 - y0) / 2 + 2;
    this.sun.position.set(cx - 16, 26, cz - 14);
    this.sun.target.position.set(cx, 0, cz);
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -half;
    sc.right = half;
    sc.top = half;
    sc.bottom = -half;
    sc.near = 1;
    sc.far = 90;
    sc.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.scene.fog = new THREE.Fog(0xaebcc4, half * 2.2, half * 6);

    // Hover ring.
    this.hoverLine = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }));
    this.hoverLine.renderOrder = 5;
    this.hoverLine.visible = false;
    this.landscape.add(this.hoverLine);
  }

  /** (Re)build the buildings, optionally leaving one out. */
  private buildBuildings(map: GameMap, exclude?: string): void {
    const g = this.buildingGroup;
    if (!g) return;
    for (const c of [...g.children]) {
      g.remove(c);
      const m = c as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    const shadows = QUALITY[this.quality].shadows > 0;
    const b = buildingMeshes(map, exclude);
    const walls = new THREE.Mesh(b.walls, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }));
    const roofs = new THREE.Mesh(b.roofs, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, flatShading: true, side: THREE.DoubleSide }));
    for (const m of [walls, roofs]) {
      m.castShadow = shadows;
      m.receiveShadow = shadows;
      g.add(m);
    }
    if (b.chimneys.length) {
      const ch = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.09, 1.6 * LEVEL, 10), new THREE.MeshStandardMaterial({ color: 0x5b4a3d, roughness: 0.9 }), b.chimneys.length);
      b.chimneys.forEach((c, i) => ch.setMatrixAt(i, new THREE.Matrix4().makeTranslation(c.x, c.y + 0.8 * LEVEL, c.z)));
      ch.castShadow = shadows;
      g.add(ch);
    }
    this.excluded = exclude;
  }

  resetView(): void {
    if (!this.map || !this.controls) return;
    this.userMoved = false;
    const { x0, y0, x1, y1 } = this.map.bounds;
    const cx = (x0 + x1) / 2;
    const cz = (y0 + y1) / 2;
    // Fit the board's width (and depth) in view from about 50° above the horizon.
    const vf = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const hf = Math.atan(Math.tan(vf) * this.camera.aspect);
    const fitWidth = ((x1 - x0) / 2 / Math.tan(hf)) * 1.14;
    const fitDepth = ((y1 - y0) / 2 / Math.tan(vf)) * 1.5;
    // Portrait screens: frame the middle of the board instead of shrinking it to a sliver.
    const dist = this.camera.aspect < 1 ? Math.max(fitDepth * 1.3, fitWidth * 0.45) : Math.max(fitWidth, fitDepth);
    const elev = 0.88;
    this.controls.target.set(cx, 0, cz + (y1 - y0) * 0.04);
    this.camera.position.set(cx, dist * Math.sin(elev), cz + dist * Math.cos(elev));
    this.controls.update();
  }

  /** Fly the camera to look at a hex. */
  focus(hex: HexKey): void {
    if (!this.map || !this.controls) return;
    const h = this.map.hexes[hex];
    if (!h) return;
    const c = hexToPixel(h.hex);
    const to = new THREE.Vector3(c.x, h.level * LEVEL * this.exaggeration, c.y);
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.setLength(Math.min(offset.length(), 9));
    this.userMoved = true;
    this.focusAnim = { from: this.controls.target.clone(), to, fromPos: this.camera.position.clone(), toPos: to.clone().add(offset), t: 0 };
  }

  // ---- Overlays and units ------------------------------------------------------

  /** Redraw the draped overlay; texts become 3D labels. */
  paintOverlay(draw: (pen: Pen) => void): void {
    if (!this.map || !this.overlayCanvas || !this.overlayTex) return;
    const c = this.overlayCanvas.getContext('2d')!;
    const { x0, y0 } = this.map.bounds;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    c.setTransform(this.overlayPpu, 0, 0, this.overlayPpu, -x0 * this.overlayPpu, -y0 * this.overlayPpu);
    for (const l of [...this.labels.children]) {
      this.labels.remove(l);
      ((l as THREE.Sprite).material as THREE.Material).dispose();
    }
    const map = this.map;
    draw(
      canvasPen(c, this.overlayPpu, (p, s, size, color, lift) => {
        const { tex, aspect } = labelTexture(s, size, color);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
        const hgt = 0.16 * (size / 11);
        sp.scale.set(hgt * aspect, hgt / this.exaggeration, 1);
        sp.position.set(p.x, (terrainHeight(map, p) + 0.25) * LEVEL + lift * 0.12, p.y);
        sp.renderOrder = 6;
        this.labels.add(sp);
      }),
    );
    this.overlayTex.needsUpdate = true;
  }

  setHover(hex: HexKey | undefined): void {
    if (!this.hoverLine || !this.map) return;
    const h = hex ? this.map.hexes[hex] : undefined;
    if (!h) {
      this.hoverLine.visible = false;
      return;
    }
    const pts = hexCorners(h.hex).map((p) => new THREE.Vector3(p.x, (terrainHeight(this.map!, p) + 0.04) * LEVEL, p.y));
    this.hoverLine.geometry.dispose();
    this.hoverLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.hoverLine.visible = true;
  }

  /** Counter standees for the units, floating above roofs in building hexes. */
  setUnits(ctx: Ctx, s: GameState, selected: ReadonlySet<string>): void {
    this.lastUnits = () => this.setUnits(ctx, s, selected);
    for (const c of [...this.units.children]) {
      this.units.remove(c);
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    }
    const map = ctx.map;
    const byHex = new Map<HexKey, typeof s.units[string][]>();
    for (const u of Object.values(s.units)) (byHex.get(u.hex) ?? byHex.set(u.hex, []).get(u.hex)!).push(u);
    const pov = this.pov?.spec;
    const plane = new THREE.PlaneGeometry(1, 1);
    for (const [hex, us] of byHex) {
      const h = map.hexes[hex]!;
      if (pov && pov.hex === hex) continue;
      const c = hexToPixel(h.hex);
      const b = h.building ? map.buildings[h.building] : undefined;
      const top = h.level + (b ? buildingLevels(b).ridge : 0);
      const order = [...us].sort((a, c2) => Number(ctx.data.units[a.type]!.kind === 'leader') - Number(ctx.data.units[c2.type]!.kind === 'leader'));
      order.forEach((u, i) => {
        if (pov?.visible && pov.side && u.side !== pov.side && !pov.visible.has(hex)) return;
        const n = order.length;
        const ang = (i / Math.max(1, n)) * Math.PI * 2 + 0.6;
        const r = n > 1 ? 0.3 : 0;
        const size = pov ? 0.36 : 0.56;
        const mesh = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map: counterTexture(ctx, s, u, selected.has(u.id)), transparent: true, side: THREE.DoubleSide }));
        mesh.scale.set(size, size / this.exaggeration, 1);
        mesh.position.set(c.x + Math.cos(ang) * r, top * LEVEL + (size * 0.62) / this.exaggeration + 0.02, c.y + Math.sin(ang) * r);
        mesh.userData = { hex, standee: true };
        mesh.renderOrder = 4;
        this.units.add(mesh);
        const base = new THREE.Mesh(new THREE.CircleGeometry(size * 0.38, 18), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.45, depthWrite: false }));
        base.rotation.x = -Math.PI / 2;
        base.position.set(mesh.position.x, top * LEVEL + 0.006, mesh.position.z);
        this.units.add(base);
      });
    }
  }

  /** A 3D line of sight between the two units' eyes. */
  setLos(r: LosResult | undefined): void {
    for (const c of [...this.losGroup.children]) this.losGroup.remove(c);
    if (!r) return;
    const a = new THREE.Vector3(r.a.x, (r.fromHeight + EYE) * LEVEL, r.a.y);
    const b = new THREE.Vector3(r.b.x, (r.toHeight + EYE) * LEVEL, r.b.y);
    const stopT = r.blockedBy?.t ?? 1;
    const stop = a.clone().lerp(b, stopT);
    const tube = (p: THREE.Vector3, q: THREE.Vector3, color: number, opacity = 1) => {
      if (p.distanceTo(q) < 1e-4) return;
      const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(p, q), 8, 0.025, 6), new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: false }));
      m.renderOrder = 7;
      this.losGroup.add(m);
    };
    tube(a, stop, 0x6fe06a);
    if (r.blockedBy) tube(stop, b, 0xff5a46, 0.55);
    const ball = (p: THREE.Vector3, color: number, rad: number) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(rad, 14, 10), new THREE.MeshBasicMaterial({ color, depthTest: false }));
      m.position.copy(p);
      m.renderOrder = 8;
      this.losGroup.add(m);
    };
    ball(a, 0xf0c66b, 0.07);
    ball(b, 0xf0c66b, 0.07);
    if (r.blockedBy) ball(stop, 0xff5a46, 0.08);
  }

  // ---- Fire Director ---------------------------------------------------------------

  /** Draw one frame of fire effects; `povHit` (0..1) shakes the POV camera. */
  setFxFrame(f: FxFrame): void {
    const px = this.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    this.fx.update(f, px, this.exaggeration);
    if (this.pov) this.shake = Math.max(this.shake, f.hits.get(this.pov.spec.hex) ?? 0);
  }

  /** The POV unit's hex, if in POV. */
  get povHex(): HexKey | undefined {
    return this.pov?.spec.hex;
  }

  // ---- Point of view ---------------------------------------------------------------

  enterPov(spec: PovSpec): void {
    if (!this.map || !this.controls) return;
    const h = this.map.hexes[spec.hex];
    if (!h) return;
    const saved = this.pov?.saved ?? { pos: this.camera.position.clone(), target: this.controls.target.clone(), fov: this.camera.fov };
    const c = hexToPixel(h.hex);
    const look = spec.lookAt ?? { x: (this.map.bounds.x0 + this.map.bounds.x1) / 2, y: (this.map.bounds.y0 + this.map.bounds.y1) / 2 };
    // Same eyes again (units changed): keep where the viewer is looking.
    const same = this.pov && this.pov.spec.hex === spec.hex;
    const yaw = same ? this.pov!.yaw : Math.atan2(look.x - c.x, look.y - c.y);
    const pitch = same ? this.pov!.pitch : -0.05;
    this.pov = { spec, yaw, pitch, saved };
    this.controls.enabled = false;
    if (!same) this.camera.fov = 55;
    this.camera.updateProjectionMatrix();
    // From inside a building, leave that building out so the view isn't its own walls.
    if (this.excluded !== h.building) this.buildBuildings(this.map, h.building);
    const upper = spec.upper && canBeUpper(this.map, spec.hex) ? 2 : 0;
    this.camera.position.set(c.x, (h.level + upper + EYE) * LEVEL * this.exaggeration + 0.02, c.y);
    this.povBase = this.camera.position.clone();
    this.applyPov();
    this.lastUnits?.();
    if (this.hoverLine) this.hoverLine.visible = false;
  }

  exitPov(): void {
    if (!this.pov || !this.controls) return;
    const { saved } = this.pov;
    this.pov = undefined;
    this.povBase = undefined;
    this.shake = 0;
    if (this.excluded && this.map) this.buildBuildings(this.map);
    this.camera.position.copy(saved.pos);
    this.controls.target.copy(saved.target);
    this.camera.fov = saved.fov;
    this.camera.updateProjectionMatrix();
    this.controls.enabled = true;
    this.lastUnits?.();
  }

  get inPov(): boolean {
    return !!this.pov;
  }

  private applyPov(): void {
    if (!this.pov) return;
    const { yaw, pitch } = this.pov;
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    this.camera.lookAt(this.camera.position.clone().add(dir));
  }

  // ---- Frame and input ---------------------------------------------------------------

  private frame(): void {
    // Hidden (another view mode is showing): skip the work.
    if (this.host && this.host.clientWidth === 0) return;
    if (this.focusAnim && this.controls) {
      const f = this.focusAnim;
      f.t = Math.min(1, f.t + 0.06);
      const e = 1 - (1 - f.t) ** 3;
      this.controls.target.lerpVectors(f.from, f.to, e);
      this.camera.position.lerpVectors(f.fromPos, f.toPos, e);
      if (f.t >= 1) this.focusAnim = undefined;
    }
    if (!this.pov && this.controls) {
      this.controls.update();
      // Depth precision: push the near plane out when the camera is far away.
      const near = Math.min(0.5, Math.max(0.03, this.camera.position.distanceTo(this.controls.target) / 300));
      if (Math.abs(near - this.camera.near) > 0.005) {
        this.camera.near = near;
        this.camera.updateProjectionMatrix();
      }
    } else if (this.pov && this.camera.near !== 0.03) {
      this.camera.near = 0.03;
      this.camera.updateProjectionMatrix();
    }
    // Incoming fire shakes the POV camera.
    if (this.pov && this.povBase) {
      this.camera.position.copy(this.povBase);
      if (this.shake > 0.01) {
        const a = this.shake * 0.025;
        this.camera.position.x += (Math.random() - 0.5) * a;
        this.camera.position.y += (Math.random() - 0.5) * a;
        this.camera.position.z += (Math.random() - 0.5) * a;
        this.shake *= 0.9;
      }
    }
    // Standees turn to face the camera (yaw only).
    for (const o of this.units.children) {
      if (!(o.userData as { standee?: boolean }).standee) continue;
      o.rotation.y = Math.atan2(this.camera.position.x - o.position.x, this.camera.position.z - o.position.z);
    }
    this.renderer.render(this.scene, this.camera);
  }

  private pick(e: PointerEvent | MouseEvent): PointerInfo {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    let world: Vec2 = { x: 0, y: 0 };
    let hex: HexKey | undefined;
    const standees = this.ray.intersectObjects(this.units.children.filter((o) => (o.userData as { standee?: boolean }).standee), false);
    if (standees.length) hex = (standees[0]!.object.userData as { hex: HexKey }).hex;
    if (this.ground) {
      const hits = this.ray.intersectObject(this.ground, false);
      if (hits.length) {
        world = { x: hits[0]!.point.x, y: hits[0]!.point.z };
        hex ??= hexKey(pixelToHex(world));
      }
    }
    if (hex && !this.map?.hexes[hex]) hex = undefined;
    if (hex && !standees.length) world = world.x === 0 && world.y === 0 ? hexToPixel(parseHexKey(hex)) : world;
    return { hex, world, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, button: (e as PointerEvent).button ?? 0 };
  }

  private onDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY };
    if (this.pov) this.renderer.domElement.setPointerCapture(e.pointerId);
  };

  private onMove = (e: PointerEvent) => {
    if (this.pov) {
      if (this.down && e.buttons) {
        const k = 0.004 * (this.camera.fov / 55);
        this.pov.yaw -= (e.clientX - this.down.x) * k;
        this.pov.pitch = Math.max(-1.2, Math.min(1.2, this.pov.pitch - (e.clientY - this.down.y) * k));
        this.down = { x: e.clientX, y: e.clientY };
        this.applyPov();
      }
      return;
    }
    if (e.buttons) return;
    const p = this.pick(e);
    this.setHover(p.hex);
    this.events.onHover?.(p);
  };

  private onUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = undefined;
    if (this.pov) return;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
    const p = this.pick(e);
    if (e.button === 0) this.events.onClick?.(p);
    else if (e.button === 2) this.events.onContext?.(p);
  };

  private onDbl = (e: MouseEvent) => {
    if (this.pov) return;
    const p = this.pick(e);
    if (p.hex) this.focus(p.hex);
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.pov) return;
    e.preventDefault();
    this.camera.fov = Math.max(12, Math.min(70, this.camera.fov * Math.pow(1.0015, e.deltaY)));
    this.camera.updateProjectionMatrix();
  };
}
