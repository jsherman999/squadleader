/**
 * Fire Director frames in 3D: tracer lines, soft point sprites for
 * flashes, sparks and dust, and billboard labels. Lives inside the scene's
 * root group, so heights follow the exaggeration like the terrain.
 */
import * as THREE from 'three';
import type { FxFrame } from '../fx/sample';
import type { Pt } from '../fx/timeline';
import { labelTexture } from './counters3d';
import { LEVEL } from './heights';

const MAX_SEG = 600;
const MAX_PTS = 700;

const VERT = /* glsl */ `
attribute float size;
attribute vec4 rgba;
uniform float scale;
varying vec4 vC;
void main() {
  vC = rgba;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(size * scale / -mv.z, 1.0, 256.0);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
varying vec4 vC;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, r);
  gl_FragColor = vec4(vC.rgb, vC.a * a * a);
}`;

const v3 = (p: Pt, out: THREE.Vector3) => out.set(p.x, p.z * LEVEL, p.y);

class PointLayer {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX_PTS * 3);
  private col = new Float32Array(MAX_PTS * 4);
  private size = new Float32Array(MAX_PTS);
  readonly material: THREE.ShaderMaterial;
  n = 0;
  constructor(additive: boolean) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('rgba', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 1 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 9 : 8;
  }
  begin(): void {
    this.n = 0;
  }
  add(p: THREE.Vector3, color: number, alpha: number, size: number): void {
    if (this.n >= MAX_PTS) return;
    const i = this.n++;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.col.set([((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255, alpha], i * 4);
    this.size[i] = size;
  }
  end(): void {
    const g = this.points.geometry;
    g.setDrawRange(0, this.n);
    for (const k of ['position', 'rgba', 'size']) (g.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
  }
}

class SegLayer {
  readonly lines: THREE.LineSegments;
  private pos = new Float32Array(MAX_SEG * 6);
  private col = new Float32Array(MAX_SEG * 6);
  n = 0;
  constructor(additive: boolean) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 9;
  }
  begin(): void {
    this.n = 0;
  }
  add(a: THREE.Vector3, b: THREE.Vector3, color: number, k: number): void {
    if (this.n >= MAX_SEG) return;
    const i = this.n++;
    const r = (((color >> 16) & 255) / 255) * k;
    const g = (((color >> 8) & 255) / 255) * k;
    const bl = ((color & 255) / 255) * k;
    this.pos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
    this.col.set([r * 0.5, g * 0.5, bl * 0.5, r, g, bl], i * 6);
  }
  end(): void {
    const g = this.lines.geometry;
    g.setDrawRange(0, this.n * 2);
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}

export class Fx3D {
  readonly group = new THREE.Group();
  private lights = new PointLayer(true);
  private matte = new PointLayer(false);
  private tracers = new SegLayer(true);
  private plain = new SegLayer(false);
  private labels = new Map<string, { sprite: THREE.Sprite; text: string; color: number }>();
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();

  constructor() {
    this.group.add(this.matte.points, this.lights.points, this.tracers.lines, this.plain.lines);
  }

  /** `pxPerUnit`: screen pixels per world unit at distance 1; `exaggeration` undoes the root's y scale for sprite sizes. */
  update(f: FxFrame, pxPerUnit: number, exaggeration: number): void {
    this.lights.material.uniforms.scale!.value = pxPerUnit;
    this.matte.material.uniforms.scale!.value = pxPerUnit;
    this.lights.begin();
    this.matte.begin();
    this.tracers.begin();
    this.plain.begin();
    for (const s of f.streaks) {
      v3(s.a, this.a);
      v3(s.b, this.b);
      this.tracers.add(this.a, this.b, s.color, s.alpha);
      // A glow along the tracer gives it thickness.
      for (let i = 1; i <= 5; i++) this.lights.add(this.a.clone().lerp(this.b, i / 5), s.color, (0.25 + 0.12 * i) * s.alpha, 0.1 + s.width * 0.025);
      this.lights.add(this.b, 0xfff6d8, s.alpha, 0.09);
    }
    for (const g of f.glows) (g.light ? this.lights : this.matte).add(v3(g.at, this.a), g.color, g.alpha, g.r * 2.2);
    for (const ln of f.lines) this.plain.add(v3(ln.a, this.a), v3(ln.b, this.b), ln.color, ln.alpha);
    for (const g of f.ghosts) this.matte.add(v3(g.at, this.a), 0xdedad0, g.alpha * 0.5, 0.7);
    this.lights.end();
    this.matte.end();
    this.tracers.end();
    this.plain.end();

    const seen = new Set<string>();
    const items = [...f.labels, ...f.ghosts.map((g, i) => ({ id: `ghost${i}`, at: g.at, text: g.text, color: 0xe7e3d6, alpha: g.alpha, stack: 0, rise: 0 }))];
    for (const it of items) {
      seen.add(it.id);
      let l = this.labels.get(it.id);
      if (!l || l.text !== it.text || l.color !== it.color) {
        if (l) this.dropLabel(it.id);
        const { tex, aspect } = labelTexture(it.text, 15, it.color);
        // Constant size on screen, so results stay readable at any zoom.
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, sizeAttenuation: false }));
        sprite.renderOrder = 10;
        sprite.userData.aspect = aspect;
        this.group.add(sprite);
        l = { sprite, text: it.text, color: it.color };
        this.labels.set(it.id, l);
      }
      const h = 0.042;
      l.sprite.scale.set(h * (l.sprite.userData.aspect as number), h / exaggeration, 1);
      v3(it.at, l.sprite.position);
      (l.sprite.material as THREE.SpriteMaterial).opacity = it.alpha;
    }
    for (const id of [...this.labels.keys()]) if (!seen.has(id)) this.dropLabel(id);
  }

  private dropLabel(id: string): void {
    const l = this.labels.get(id);
    if (!l) return;
    this.group.remove(l.sprite);
    l.sprite.material.dispose();
    this.labels.delete(id);
  }

  dispose(): void {
    for (const id of [...this.labels.keys()]) this.dropLabel(id);
    for (const o of [this.lights.points, this.matte.points]) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
    for (const o of [this.tracers.lines, this.plain.lines]) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  }
}
