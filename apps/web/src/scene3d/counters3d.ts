/** Counter faces drawn to canvas for the 3D standees (same idiom as the 2D counters). */
import * as THREE from 'three';
import { leaderRating, weaponType, type Ctx, type GameState, type Nation, type Unit } from '@squadwar/engine';
import { FIGURE_SPOTS, drawFigureCanvas, figureParts, poseFor } from '../board/figure';

const NATION: Record<Nation, { bg: string; ink: string }> = {
  german: { bg: '#a9bfcc', ink: '#162028' },
  russian: { bg: '#cfa36c', ink: '#23170c' },
  american: { bg: '#a8c472', ink: '#18200d' },
};

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
  const pal = NATION[nation];
  const k = S / 44;
  c.scale(k, k);
  c.fillStyle = u.berserk ? '#c75b45' : u.broken ? shade(pal.bg, 0.55) : pal.bg;
  roundRect(c, 1, 1, 42, 42, 4);
  c.fill();
  c.lineWidth = selected ? 3 : 1.2;
  c.strokeStyle = selected ? '#f0c66b' : 'rgba(0,0,0,0.6)';
  c.stroke();
  const ink = u.broken ? '#ece4cf' : pal.ink;
  const fig = figureParts(poseFor(t.kind), nation);
  for (const [fx, fy, fk] of FIGURE_SPOTS[t.kind]) drawFigureCanvas(c, fig, fx, fy, fk, ink);
  c.fillStyle = ink;
  c.font = 'bold 12px "Roboto Condensed", "Arial Narrow", sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  const label = t.kind === 'leader' ? leaderRating(t.morale, t.leadership) : u.broken ? `${t.brokenMorale}` : `${t.fp}-${t.range}-${t.morale}`;
  if (t.kind === 'leader') {
    c.fillText(label, 31, 27);
    c.font = 'bold 7px "Roboto Condensed", sans-serif';
    c.fillText((u.name ?? '').split(' ').slice(-1)[0]!, 22, 40);
  } else c.fillText(label, 22, 41);
  weapons.forEach((w, i) => {
    c.fillStyle = '#262b24';
    roundRect(c, 2 + i * 20, 1.5, 19, 9, 2);
    c.fill();
    c.fillStyle = w.endsWith('x') ? '#ff8a7a' : '#f5f1e3';
    c.font = 'bold 7px "Roboto Condensed", sans-serif';
    c.fillText(w.replace(/x$/, ''), 11.5 + i * 20, 8.5);
  });
  if (u.concealed) {
    c.fillStyle = '#6a5a9e';
    roundRect(c, 33, 12, 9, 10, 2);
    c.fill();
    c.fillStyle = '#f5f1e3';
    c.font = 'bold 8px "Roboto Condensed", sans-serif';
    c.fillText('?', 37.5, 20);
  }
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

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
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
