/** Low-poly tanks, SP guns and wrecks for the 3D landscape, turned to their facing. */
import * as THREE from 'three';
import type { Nation, VehicleType } from '@squadwar/engine';
import { facingAngle } from '../board/counters';

const PAINT: Record<Nation, number> = { german: 0x6f7468, russian: 0x4f5a37, american: 0x5d6142 };
const mats = new Map<string, THREE.Material>();
function mat(color: number, rough = 0.85): THREE.Material {
  const k = `${color}|${rough}`;
  let m = mats.get(k);
  if (!m) mats.set(k, (m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.15 })));
  return m;
}

/** One vehicle model, about 0.7 map units long, sitting on y = 0 and facing +x before rotation. */
export function vehicleModel(t: VehicleType, nation: Nation, facing: number, wreck = false): THREE.Group {
  const g = new THREE.Group();
  const paint = wreck ? 0x2b2723 : PAINT[nation];
  const dark = wreck ? 0x1c1a17 : 0x2c2c28;
  if (t.kind === 'gun') {
    const m = (geo: THREE.BufferGeometry, mt: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(geo, mt);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      g.add(mesh);
      return mesh;
    };
    for (const z of [-0.1, 0.1]) {
      const w = m(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12), mat(dark), 0, 0.05, z);
      w.rotation.x = Math.PI / 2;
    }
    m(new THREE.BoxGeometry(0.02, 0.09, 0.22), mat(paint), 0.03, 0.09, 0);
    const barrel = m(new THREE.CylinderGeometry(0.012, 0.016, 0.34, 8), mat(dark), 0.18, 0.08, 0);
    barrel.rotation.z = Math.PI / 2;
    for (const z of [-0.06, 0.06]) {
      const trail = m(new THREE.BoxGeometry(0.28, 0.015, 0.02), mat(dark), -0.15, 0.03, z * 1.6);
      trail.rotation.y = z > 0 ? -0.25 : 0.25;
    }
    g.rotation.y = -facingAngle(facing);
    return g;
  }
  const hullH = 0.075;
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  // Tracks and hull.
  add(new THREE.BoxGeometry(0.66, 0.06, 0.12), mat(dark, 0.95), 0, 0.03, 0.17);
  add(new THREE.BoxGeometry(0.66, 0.06, 0.12), mat(dark, 0.95), 0, 0.03, -0.17);
  add(new THREE.BoxGeometry(0.6, hullH, 0.36), mat(paint), 0, 0.06 + hullH / 2, 0);
  const top = 0.06 + hullH;
  if (t.kind === 'halftrack') {
    // Open fighting compartment: low side walls around an empty bed.
    add(new THREE.BoxGeometry(0.4, 0.05, 0.03), mat(paint), -0.06, top + 0.025, 0.165);
    add(new THREE.BoxGeometry(0.4, 0.05, 0.03), mat(paint), -0.06, top + 0.025, -0.165);
    add(new THREE.BoxGeometry(0.16, 0.06, 0.32), mat(paint), 0.2, top + 0.03, 0);
  } else if (t.turret) {
    const turret = add(new THREE.CylinderGeometry(0.11, 0.13, 0.07, 10), mat(paint), -0.02, top + 0.035, 0);
    if (wreck) turret.rotation.z = 0.5;
    if (!wreck) {
      const gun = add(new THREE.CylinderGeometry(0.018, 0.022, 0.38, 8), mat(dark), 0.25, top + 0.04, 0);
      gun.rotation.z = Math.PI / 2;
    }
  } else {
    // Casemate SP gun: a sloped superstructure and a short, thick gun.
    add(new THREE.BoxGeometry(0.34, 0.07, 0.3), mat(paint), 0.02, top + 0.035, 0);
    if (!wreck) {
      const big = (t.gun ?? 75) >= 100;
      const gun = add(new THREE.CylinderGeometry(big ? 0.03 : 0.02, big ? 0.035 : 0.025, big ? 0.22 : 0.3, 8), mat(dark), 0.3, top + 0.035, 0);
      gun.rotation.z = Math.PI / 2;
    }
  }
  if (wreck) {
    g.rotation.z = 0.06;
    g.rotation.x = -0.05;
  }
  g.rotation.y = -facingAngle(facing);
  return g;
}

/** A pale ring under the selected vehicle. */
export function selectionRing(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 32), new THREE.MeshBasicMaterial({ color: 0xf0c66b, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2;
  return m;
}
