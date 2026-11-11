/** Counter faces drawn to canvas for the 3D standees (same idiom as the 2D counters). */
import * as THREE from 'three';
import { weaponType, type Ctx, type GameState, type Unit } from '@squadwar/engine';
import { FACE_COLORS as NATION, drawUnitFace, roundRect, shade } from '../board/counterFace';

const cache = new Map<string, THREE.CanvasTexture>();

/** Texture for one unit's counter face (cached by appearance). */
export function counterTexture(ctx: Ctx, s: GameState, u: Unit, selected: boolean, hidden = false): THREE.CanvasTexture {
  const t = ctx.data.units[u.type]!;
  const nation = s.sides.find((x) => x.id === u.side)?.nation ?? 'german';
  if (hidden) return concealedTexture(nation);
  const weapons = u.weapons.map((id) => s.weapons[id]).filter((w) => !!w).map((w) => `${weaponType(ctx, w!).kind}${w!.malfunctioned ? 'x' : ''}`);
  const key = [u.type, nation, u.broken, u.berserk, selected, u.name ?? '', weapons.join(','), u.firedPhase ? 'f' : '', u.moved ? 'm' : '', u.concealed ? 'c' : ''].join('|');
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const c = cv.getContext('2d')!;
  c.scale(S / 44, S / 44);
  drawUnitFace(c, { nation, type: t, name: u.name, weapons, broken: u.broken, berserk: u.berserk, selected, concealed: u.concealed });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

/** A concealment counter (§25): nationality colour and a question mark. */
function concealedTexture(nation: keyof typeof NATION): THREE.CanvasTexture {
  const key = `?|${nation}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const c = cv.getContext('2d')!;
  const pal = NATION[nation];
  c.scale(S / 44, S / 44);
  c.fillStyle = shade(pal.bg, 0.88);
  roundRect(c, 1, 1, 42, 42, 4);
  c.fill();
  c.lineWidth = 1.2;
  c.strokeStyle = 'rgba(0,0,0,0.6)';
  c.stroke();
  c.fillStyle = pal.ink;
  c.font = 'bold 28px "Roboto Condensed", "Arial Narrow", sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('?', 22, 23);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}


const textCache = new Map<string, THREE.CanvasTexture>();

/** A small text label texture for 3D sprites. */
export function labelTexture(text: string, size: number, color: number): { tex: THREE.CanvasTexture; aspect: number } {
  const key = `${text}|${size}|${color}`;
  let tex = textCache.get(key);
  const px = size * 4;
  const font = `bold ${px}px "Roboto Condensed", "Arial Narrow", sans-serif`;
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = font;
  const w = Math.ceil(probe.measureText(text).width + px * 0.6);
  const h = Math.ceil(px * 1.4);
  if (!tex) {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const c = cv.getContext('2d')!;
    c.font = font;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineWidth = px * 0.22;
    c.strokeStyle = '#000';
    c.strokeText(text, w / 2, h / 2);
    c.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    c.fillText(text, w / 2, h / 2);
    tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    textCache.set(key, tex);
  }
  return { tex, aspect: w / h };
}
