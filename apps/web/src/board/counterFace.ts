/**
 * Counter faces drawn on a plain 2D canvas, in a 44-unit square: the 3D
 * standees use them, and so does anything that shows a counter outside the
 * board (the order of battle on the scenario page). They follow the 2D board's
 * counters: nationality colour, the soldier figures, the factors along the
 * bottom, support weapons as chips along the top.
 */
import { leaderRating, type Nation, type UnitType, type VehicleType } from '@squadwar/engine';
import { FIGURE_SPOTS, drawFigureCanvas, figureParts, poseFor } from './figure';

export const FACE_COLORS: Record<Nation, { bg: string; ink: string }> = {
  german: { bg: '#a9bfcc', ink: '#162028' },
  russian: { bg: '#cfa36c', ink: '#23170c' },
  american: { bg: '#a8c472', ink: '#18200d' },
};

const COND = '"Roboto Condensed", "Arial Narrow", sans-serif';

export function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}

export interface UnitFace {
  readonly nation: Nation;
  readonly type: UnitType;
  readonly name?: string | undefined;
  /** Support weapon kinds carried (LMG, MMG…); a trailing "x" marks one that has malfunctioned. */
  readonly weapons?: readonly string[];
  readonly broken?: boolean;
  readonly berserk?: boolean;
  readonly selected?: boolean;
  readonly concealed?: boolean;
}

/** A squad, crew or leader counter. The context must already be scaled so the face is 44 units square. */
export function drawUnitFace(c: CanvasRenderingContext2D, f: UnitFace): void {
  const t = f.type;
  const pal = FACE_COLORS[f.nation];
  c.fillStyle = f.berserk ? '#c75b45' : f.broken ? shade(pal.bg, 0.55) : pal.bg;
  roundRect(c, 1, 1, 42, 42, 4);
  c.fill();
  c.lineWidth = f.selected ? 3 : 1.2;
  c.strokeStyle = f.selected ? '#f0c66b' : 'rgba(0,0,0,0.6)';
  c.stroke();
  const ink = f.broken ? '#ece4cf' : pal.ink;
  const fig = figureParts(poseFor(t.kind), f.nation);
  for (const [fx, fy, fk] of FIGURE_SPOTS[t.kind]) drawFigureCanvas(c, fig, fx, fy, fk, ink);
  c.fillStyle = ink;
  c.font = `bold 12px ${COND}`;
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  const label = t.kind === 'leader' ? leaderRating(t.morale, t.leadership) : f.broken ? `${t.brokenMorale}` : `${t.fp}-${t.range}-${t.morale}`;
  if (t.kind === 'leader') {
    c.fillText(label, 31, 27);
    c.font = `bold 7px ${COND}`;
    c.fillText((f.name ?? '').split(' ').slice(-1)[0]!, 22, 40);
  } else c.fillText(label, 22, 41);
  // Support weapons as chips along the top, each as wide as its name needs (LMG, RADIO).
  let chipX = 2;
  for (const w of f.weapons ?? []) {
    const kind = w.replace(/x$/, '');
    c.font = `bold 7px ${COND}`;
    const wide = Math.max(19, c.measureText(kind).width + 5);
    c.fillStyle = '#262b24';
    roundRect(c, chipX, 1.5, wide, 9, 2);
    c.fill();
    c.fillStyle = w.endsWith('x') ? '#ff8a7a' : '#f5f1e3';
    c.fillText(kind, chipX + wide / 2, 8.5);
    chipX += wide + 1;
  }
  if (f.concealed) {
    c.fillStyle = '#6a5a9e';
    roundRect(c, 33, 12, 9, 10, 2);
    c.fill();
    c.fillStyle = '#f5f1e3';
    c.font = `bold 8px ${COND}`;
    c.fillText('?', 37.5, 20);
  }
}

/** The text along the bottom of a vehicle or gun counter: gun calibre and movement points, or what it is. */
export function vehicleFaceLabel(t: VehicleType): string {
  if (t.kind === 'gun' || t.kind === 'mortar') return `${t.gun}${t.kind === 'mortar' ? ' MTR' : ''} · ROF ${t.rof ?? 1}`;
  if (t.kind === 'halftrack') return `HT · ${t.mp}`;
  if (t.kind === 'truck') return `TRK · ${t.mp}`;
  if (t.kind === 'jeep') return `JEEP · ${t.mp}`;
  return `${t.gun ?? '—'}${t.heOnly ? 'ᴴᴱ' : ''}${t.lowVelocity ? '*' : ''} · ${t.mp}`;
}

/** A tank, SP gun, gun, mortar or soft vehicle counter, seen from above and pointing along `angle` (radians, 0 = right). */
export function drawVehicleFace(c: CanvasRenderingContext2D, nation: Nation, t: VehicleType, angle = 0): void {
  const pal = FACE_COLORS[nation];
  const ink = pal.ink;
  const dark = shade(pal.bg, 0.65);
  const light = 'rgba(255,255,255,0.32)';
  c.fillStyle = pal.bg;
  roundRect(c, 1, 1, 42, 42, 4);
  c.fill();
  c.lineWidth = 1.2;
  c.strokeStyle = 'rgba(0,0,0,0.6)';
  c.stroke();
  const rect = (x: number, y: number, w: number, h: number, fill: string, r = 0) => {
    c.fillStyle = fill;
    if (r) {
      roundRect(c, x, y, w, h, r);
      c.fill();
    } else c.fillRect(x, y, w, h);
  };
  const line = (pts: readonly (readonly [number, number])[], width: number) => {
    c.strokeStyle = ink;
    c.lineWidth = width;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.stroke();
  };
  const disc = (x: number, y: number, r: number, fill: string, ring = false) => {
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = fill;
    c.fill();
    if (ring) {
      c.strokeStyle = ink;
      c.lineWidth = 1;
      c.stroke();
    }
  };
  c.save();
  c.translate(22, 19);
  c.rotate(angle);
  if (t.kind === 'gun') {
    // Split trail, wheels, shield and barrel.
    line([[-12, -6], [0, 0], [-12, 6]], 2);
    rect(-3, -9, 5, 4, ink, 1);
    rect(-3, 5, 5, 4, ink, 1);
    rect(1, -7, 2.5, 14, dark);
    line([[3, 0], [16, 0]], 2.2);
  } else if (t.kind === 'mortar') {
    disc(-5, 0, 5, ink);
    line([[6, -6], [1, 0], [6, 6]], 1.6);
    line([[-5, 0], [10, 0]], 3.2);
  } else if (t.kind === 'truck' || t.kind === 'jeep') {
    const truck = t.kind === 'truck';
    const L = truck ? 26 : 18;
    rect(-L / 2, -6.5, L, 13, ink, 2);
    if (truck) rect(-L / 2 + 1.5, -5, 15, 10, light, 1);
    else rect(-L / 2 + 2, -4.5, 9, 9, light, 1);
    for (const x of truck ? [-9, -3, 9] : [-5, 6]) for (const y of [-7.5, 7.5]) rect(x - 2.2, y - 1.3, 4.4, 2.6, ink, 1);
  } else if (t.kind === 'halftrack') {
    rect(-12, -7, 24, 14, ink, 2);
    rect(-12, -8.5, 13, 3, ink);
    rect(-12, 5.5, 13, 3, ink);
    rect(-9, -4.5, 13, 9, light, 1);
    disc(9, -7, 2.4, ink);
    disc(9, 7, 2.4, ink);
  } else {
    rect(-11, -7.5, 22, 15, ink, 2);
    rect(-12, -9, 24, 3, ink);
    rect(-12, 6, 24, 3, ink);
    if (t.turret) disc(-1, 0, 5.2, dark, true);
    else rect(-6, -5, 9, 10, dark);
    line([[3, 0], [t.turret ? 17 : 14, 0]], t.gun && t.gun >= 100 ? 3 : 2.2);
  }
  c.restore();
  c.fillStyle = ink;
  c.font = `bold 8px ${COND}`;
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  c.fillText(vehicleFaceLabel(t), 22, 41);
}
