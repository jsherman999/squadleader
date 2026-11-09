/**
 * Miniatures style for the 3D view: small low-poly figure groups instead of
 * counter standees. Squads show three figures, crews two, leaders one with
 * binoculars; a machine gun shows on its tripod; broken units lie down.
 * Geometry and materials are shared, so rebuilding the units is cheap.
 */
import * as THREE from 'three';
import { weaponType, type Ctx, type GameState, type Nation, type Unit } from '@squadwar/engine';

const UNIFORM: Record<Nation, number> = { german: 0x8d978a, russian: 0xb19b66, american: 0x949058 };
const HELMET: Record<Nation, number> = { german: 0x5a6258, russian: 0x6c7448, american: 0x66663f };
const SKIN = 0xc9a07c;
const DARK = 0x262622;

const mats = new Map<number, THREE.Material>();
function mat(color: number): THREE.Material {
  let m = mats.get(color);
  if (!m) mats.set(color, (m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true })));
  return m;
}
const GEO = {
  body: new THREE.CylinderGeometry(0.022, 0.028, 0.07, 6),
  legs: new THREE.BoxGeometry(0.04, 0.05, 0.024),
  head: new THREE.SphereGeometry(0.017, 8, 6),
  helmet: new THREE.SphereGeometry(0.021, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
  rifle: new THREE.BoxGeometry(0.006, 0.006, 0.09),
  glasses: new THREE.BoxGeometry(0.03, 0.012, 0.014),
  barrel: new THREE.CylinderGeometry(0.006, 0.006, 0.1, 6),
  tripod: new THREE.CylinderGeometry(0.003, 0.003, 0.05, 4),
  base: new THREE.CircleGeometry(0.12, 20),
  ring: new THREE.RingGeometry(0.125, 0.15, 24),
};
const baseMat = new THREE.MeshBasicMaterial({ color: 0x1a1a16, transparent: true, opacity: 0.3, depthWrite: false });
const ringMat = new THREE.MeshBasicMaterial({ color: 0xf0c66b, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide });

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}

/** One soldier, standing on y = 0 and facing +z. */
function figure(nation: Nation, leader: boolean, tone: number): THREE.Group {
  const g = new THREE.Group();
  const uni = mat(tone === 1 ? UNIFORM[nation] : new THREE.Color(UNIFORM[nation]).multiplyScalar(tone).getHex());
  g.add(mesh(GEO.legs, mat(DARK), 0, 0.025, 0));
  g.add(mesh(GEO.body, uni, 0, 0.085, 0));
  g.add(mesh(GEO.head, mat(SKIN), 0, 0.137, 0));
  g.add(mesh(GEO.helmet, mat(HELMET[nation]), 0, 0.142, 0));
  if (leader) {
    g.add(mesh(GEO.glasses, mat(DARK), 0, 0.14, 0.02));
  } else {
    const r = mesh(GEO.rifle, mat(DARK), 0.026, 0.09, 0.01);
    r.rotation.x = -0.9;
    g.add(r);
  }
  return g;
}

/** A figure group for one unit, its base centred on the origin. */
export function miniature(ctx: Ctx, s: GameState, u: Unit, selected: boolean): THREE.Group {
  const t = ctx.data.units[u.type]!;
  const nation = s.sides.find((x) => x.id === u.side)?.nation ?? 'german';
  const leader = t.kind === 'leader';
  const n = leader ? 1 : t.kind === 'crew' ? 2 : 3;
  const g = new THREE.Group();
  const base = new THREE.Mesh(GEO.base, baseMat);
  base.rotation.x = -Math.PI / 2;
  base.position.y = 0.004;
  g.add(base);
  if (selected) {
    const ring = new THREE.Mesh(GEO.ring, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.006;
    g.add(ring);
  }
  const tone = u.broken ? 0.7 : 1;
  for (let i = 0; i < n; i++) {
    const f = figure(nation, leader, tone);
    const a = (i / n) * Math.PI * 2 + 0.4;
    const r = n === 1 ? 0 : 0.075;
    f.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    f.rotation.y = 0.3 * i;
    if (u.broken) {
      f.rotation.z = Math.PI / 2;
      f.position.y = 0.02;
    }
    g.add(f);
  }
  const mg = u.weapons.map((id) => s.weapons[id]).find((w) => w && ['LMG', 'MMG', 'HMG'].includes(weaponType(ctx, w).kind));
  if (mg && !u.broken) {
    const heavy = weaponType(ctx, mg).kind !== 'LMG';
    const gun = new THREE.Group();
    const barrel = mesh(GEO.barrel, mat(DARK), 0, 0.045, 0.03);
    barrel.rotation.x = Math.PI / 2;
    gun.add(barrel);
    if (heavy) for (const a of [0, 2.1, 4.2]) {
      const leg = mesh(GEO.tripod, mat(DARK), Math.cos(a) * 0.012, 0.02, Math.sin(a) * 0.012);
      leg.rotation.z = Math.cos(a) * 0.4;
      leg.rotation.x = Math.sin(a) * 0.4;
      gun.add(leg);
    }
    gun.position.set(0.09, 0, 0.06);
    g.add(gun);
  }
  return g;
}
