/**
 * Unit counters on the 2D board: original vector art in the classic
 * counter idiom (silhouette + factor line), nationality colours, broken
 * side, carried weapons as tabs, status badges.
 */
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { dirVector, hexToPixel, parseHexKey, type Direction, type HexKey } from '@squadwar/hex';
import { leaderRating, vehicleType, weaponType, type Ctx, type GameState, type Nation, type Unit, type Vehicle } from '@squadwar/engine';
import { HEX_PX } from './palette';

const CS = 44; // counter size in world px
const NATION: Record<Nation, { bg: number; dark: number; ink: number }> = {
  german: { bg: 0xa9bfcc, dark: 0x4d6574, ink: 0x162028 },
  russian: { bg: 0xcfa36c, dark: 0x7a5530, ink: 0x23170c },
  american: { bg: 0xa8c472, dark: 0x56702f, ink: 0x18200d },
};

const facts = new TextStyle({ fontFamily: 'Roboto Condensed, Arial Narrow, sans-serif', fontSize: 12, fontWeight: '700', fill: 0x111111 });
const small = new TextStyle({ fontFamily: 'Roboto Condensed, Arial Narrow, sans-serif', fontSize: 8, fontWeight: '700', fill: 0xf5f1e3 });
const tiny = new TextStyle({ fontFamily: 'Roboto Condensed, Arial Narrow, sans-serif', fontSize: 7, fontWeight: '700', fill: 0x111111 });

function mix(a: number, b: number, t: number): number {
  const f = (s: number) => [(s >> 16) & 255, (s >> 8) & 255, s & 255];
  const [ar, ag, ab] = f(a);
  const [br, bg, bb] = f(b);
  return (Math.round(ar! + (br! - ar!) * t) << 16) | (Math.round(ag! + (bg! - ag!) * t) << 8) | Math.round(ab! + (bb! - ab!) * t);
}

/** A soldier silhouette: helmet, body, rifle. */
function soldier(g: Graphics, x: number, y: number, s: number, color: number, alpha = 0.9): void {
  g.circle(x, y - 6 * s, 2.6 * s).fill({ color, alpha });
  g.ellipse(x, y - 7.2 * s, 3.6 * s, 1.6 * s).fill({ color, alpha }); // helmet brim
  g.poly([x - 3 * s, y - 3.5 * s, x + 3 * s, y - 3.5 * s, x + 2.4 * s, y + 3 * s, x - 2.4 * s, y + 3 * s]).fill({ color, alpha });
  g.poly([x - 2.2 * s, y + 3 * s, x - 0.4 * s, y + 3 * s, x - 1.6 * s, y + 8 * s, x - 3.2 * s, y + 8 * s]).fill({ color, alpha });
  g.poly([x + 0.4 * s, y + 3 * s, x + 2.2 * s, y + 3 * s, x + 3.6 * s, y + 8 * s, x + 2 * s, y + 8 * s]).fill({ color, alpha });
  g.moveTo(x + 1 * s, y - 1 * s).lineTo(x + 7 * s, y - 6.5 * s).stroke({ width: 1.3 * s, color, alpha });
}

export interface CounterOptions {
  readonly selected: ReadonlySet<string>;
  readonly highlightHexes?: ReadonlySet<HexKey>;
  /** Enemy units the viewer cannot identify: drawn as a concealment counter (§25). */
  readonly hidden?: ReadonlySet<string>;
  /** The selected vehicle. */
  readonly vehicle?: string | undefined;
}

/** Screen angle (radians, y down) of a vehicle's gun: the spine between hexsides f and f+1. */
export function facingAngle(facing: number): number {
  const a = hexToPixel(dirVector(facing as Direction));
  const b = hexToPixel(dirVector(((facing + 1) % 6) as Direction));
  return Math.atan2(a.y + b.y, a.x + b.x);
}

/** Tanks, SP guns and wrecks, drawn under the infantry in their hex. */
export function drawVehicles(layer: Container, ctx: Ctx, s: GameState, opts: CounterOptions): void {
  const nationOf = (side: string): Nation => s.sides.find((x) => x.id === side)?.nation ?? 'german';
  const wrecksAt = new Map<HexKey, number>();
  for (const w of s.wrecks) {
    const n = wrecksAt.get(w.hex) ?? 0;
    wrecksAt.set(w.hex, n + 1);
    const c = hexToPixel(parseHexKey(w.hex));
    const box = new Container();
    const g = new Graphics();
    g.roundRect(2.5, 3, CS, CS, 4).fill({ color: 0x000000, alpha: 0.35 });
    g.roundRect(0, 0, CS, CS, 4).fill(0x3a3631).stroke({ width: 1, color: 0x161412 });
    g.roundRect(9, 15, 26, 14, 2).fill(0x24211e);
    g.circle(22, 22, 5).fill(0x1b1917);
    g.moveTo(6, 6).lineTo(CS - 6, CS - 6).moveTo(CS - 6, 6).lineTo(6, CS - 6).stroke({ width: 2, color: 0xa04a2a, alpha: 0.8 });
    box.addChild(g);
    const t = new Text({ text: 'WRECK', style: { ...tiny, fill: 0xc9c0ad }, resolution: 4 });
    t.anchor.set(0.5, 1);
    t.position.set(CS / 2, CS - 2);
    box.addChild(t);
    box.position.set(c.x * HEX_PX - CS / 2 + 10 + n * 4, c.y * HEX_PX - CS / 2 + 10 - n * 4);
    layer.addChild(box);
  }
  for (const v of Object.values(s.vehicles)) {
    const c = hexToPixel(parseHexKey(v.hex));
    const box = drawVehicle(ctx, v, nationOf(v.side), opts.vehicle === v.id);
    const shift = (wrecksAt.get(v.hex) ?? 0) * 4;
    const withInfantry = Object.values(s.units).some((u) => u.hex === v.hex);
    box.position.set(c.x * HEX_PX - CS / 2 + (withInfantry ? 12 : 0) + shift, c.y * HEX_PX - CS / 2 + (withInfantry ? 12 : 0) - shift);
    layer.addChild(box);
  }
}

function drawVehicle(ctx: Ctx, v: Vehicle, nation: Nation, selected: boolean): Container {
  const t = vehicleType(ctx, v);
  const pal = NATION[nation];
  const box = new Container();
  const g = new Graphics();
  g.roundRect(2.5, 3, CS, CS, 4).fill({ color: 0x000000, alpha: 0.35 });
  g.roundRect(0, 0, CS, CS, 4).fill(mix(pal.bg, 0x000000, 0.25));
  g.roundRect(0, 0, CS - 1.5, CS - 1.5, 4).fill(mix(pal.bg, 0xffffff, 0.12));
  if (selected) g.roundRect(-3, -3, CS + 4, CS + 4, 6).stroke({ width: 3, color: 0xf0c66b });
  else g.roundRect(0, 0, CS - 1.5, CS - 1.5, 4).stroke({ width: 1, color: mix(pal.bg, 0x000000, 0.5) });
  box.addChild(g);
  // The vehicle seen from above, turned to its facing.
  const body = new Graphics();
  const ink = pal.ink;
  body.roundRect(-11, -7.5, 22, 15, 2).fill({ color: ink, alpha: 0.85 });
  body.rect(-12, -9, 24, 3).fill({ color: ink, alpha: 0.95 });
  body.rect(-12, 6, 24, 3).fill({ color: ink, alpha: 0.95 });
  if (t.turret) body.circle(-1, 0, 5.2).fill(mix(pal.bg, 0x000000, 0.35)).stroke({ width: 1, color: ink });
  else body.rect(-6, -5, 9, 10).fill(mix(pal.bg, 0x000000, 0.35));
  body.moveTo(t.turret ? 3 : 3, 0).lineTo(t.turret ? 17 : 14, 0).stroke({ width: t.gun && t.gun >= 100 ? 3 : 2.2, color: ink });
  body.rotation = facingAngle(v.facing);
  body.position.set(CS / 2, CS / 2 - 3);
  box.addChild(body);
  const label = `${t.gun ?? '—'}${t.heOnly ? 'ᴴᴱ' : ''}${t.lowVelocity ? '*' : ''} · ${t.mp}`;
  const txt = new Text({ text: label, style: { ...tiny, fontSize: 8, fill: ink }, resolution: 4 });
  txt.anchor.set(0.5, 1);
  txt.position.set(CS / 2, CS - 2);
  box.addChild(txt);
  const badges: [string, number][] = [];
  if (v.immobilized) badges.push(['IM', 0xb02a1e]);
  if (v.gun !== 'ok') badges.push([v.gun === 'disabled' ? 'G✕' : 'G!', 0xb02a1e]);
  if (v.mg !== 'ok') badges.push(['MG!', 0xb02a1e]);
  if (v.ce) badges.push(['CE', 0x6a5a9e]);
  if (v.firedPhase) badges.push(['F', 0xd8893a]);
  if (v.moved) badges.push(['M', 0x4f86b3]);
  badges.forEach(([b, color], i) => {
    const bg2 = new Graphics();
    bg2.roundRect(CS - 7, 2 + i * 11, b.length > 1 ? 17 : 10, 10, 2).fill(color);
    box.addChild(bg2);
    const tt = new Text({ text: b, style: small, resolution: 4 });
    tt.position.set(CS - 5, 2.5 + i * 11);
    box.addChild(tt);
  });
  return box;
}

export function drawUnits(layer: Container, ctx: Ctx, s: GameState, opts: CounterOptions): void {
  drawVehicles(layer, ctx, s, opts);
  const byHex = new Map<HexKey, Unit[]>();
  for (const u of Object.values(s.units)) (byHex.get(u.hex) ?? byHex.set(u.hex, []).get(u.hex)!).push(u);
  const nationOf = (side: string): Nation => s.sides.find((x) => x.id === side)?.nation ?? 'german';

  for (const [hex, units] of byHex) {
    const c = hexToPixel(parseHexKey(hex));
    const sides = [...new Set(units.map((u) => u.side))];
    sides.forEach((side, si) => {
      const mine = units
        .filter((u) => u.side === side)
        .sort((a, b) => rank(ctx, a) - rank(ctx, b));
      const melee = sides.length > 1;
      const baseX = c.x * HEX_PX + (melee ? (si === 0 ? -12 : 12) : 0) - CS / 2 - Math.min(mine.length - 1, 3) * 3;
      const baseY = c.y * HEX_PX + (melee ? (si === 0 ? -6 : 6) : 0) - CS / 2 + Math.min(mine.length - 1, 3) * 3;
      mine.forEach((u, i) => {
        const k = Math.min(i, 4);
        const box = opts.hidden?.has(u.id) ? drawConcealed(nationOf(side)) : drawCounter(ctx, s, u, nationOf(side), opts.selected.has(u.id));
        box.position.set(baseX + k * 6, baseY - k * 6);
        layer.addChild(box);
      });
      if (mine.length > 5) {
        const t = new Text({ text: `+${mine.length - 5}`, style: small, resolution: 3 });
        t.position.set(baseX + 30, baseY - 30);
        layer.addChild(t);
      }
    });
    if (sides.length > 1) {
      const tag = new Graphics();
      tag.roundRect(c.x * HEX_PX - 18, c.y * HEX_PX + 20, 36, 11, 3).fill(0x8b1e16);
      layer.addChild(tag);
      const t = new Text({ text: 'MELEE', style: small, resolution: 3 });
      t.anchor.set(0.5, 0);
      t.position.set(c.x * HEX_PX, c.y * HEX_PX + 21);
      layer.addChild(t);
    }
  }

  // Abandoned weapons lying in hexes.
  const loose = Object.values(s.weapons).filter((w) => w.owner === null);
  const looseByHex = new Map<HexKey, typeof loose>();
  for (const w of loose) (looseByHex.get(w.hex) ?? looseByHex.set(w.hex, []).get(w.hex)!).push(w);
  for (const [hex, ws] of looseByHex) {
    const c = hexToPixel(parseHexKey(hex));
    ws.forEach((w, i) => {
      const box = new Container();
      const g = new Graphics();
      const n = NATION[nationOf(w.side)];
      g.roundRect(0, 0, 26, 14, 2).fill(n.bg).stroke({ width: 1, color: 0x222222 });
      if (w.malfunctioned) g.moveTo(2, 2).lineTo(24, 12).moveTo(24, 2).lineTo(2, 12).stroke({ width: 1.5, color: 0xb02a1e });
      box.addChild(g);
      const t = new Text({ text: weaponType(ctx, w).kind, style: tiny, resolution: 3 });
      t.anchor.set(0.5);
      t.position.set(13, 7);
      box.addChild(t);
      box.position.set(c.x * HEX_PX - 34 + i * 4, c.y * HEX_PX + 12 + i * 4);
      layer.addChild(box);
    });
  }
}

/** A concealment counter: nationality colour, a question mark, nothing else. */
function drawConcealed(nation: Nation): Container {
  const box = new Container();
  const pal = NATION[nation];
  const g = new Graphics();
  g.roundRect(2.5, 3, CS, CS, 4).fill({ color: 0x000000, alpha: 0.35 });
  g.roundRect(0, 0, CS, CS, 4).fill(mix(pal.bg, 0x000000, 0.35));
  g.roundRect(0, 0, CS - 1.5, CS - 1.5, 4).fill(mix(pal.bg, 0x000000, 0.12));
  g.roundRect(4, 4, CS - 9.5, CS - 9.5, 3).stroke({ width: 1.2, color: pal.dark, alpha: 0.8 });
  box.addChild(g);
  const q = new Text({ text: '?', style: { ...facts, fontSize: 26, fill: pal.ink }, resolution: 4 });
  q.anchor.set(0.5);
  q.position.set(CS / 2 - 0.75, CS / 2 - 1);
  box.addChild(q);
  return box;
}

function rank(ctx: Ctx, u: Unit): number {
  const t = ctx.data.units[u.type]!;
  return (t.kind === 'leader' ? 10 : t.kind === 'crew' ? 5 : 0) + (u.broken ? -3 : 0);
}

function drawCounter(ctx: Ctx, s: GameState, u: Unit, nation: Nation, selected: boolean): Container {
  const box = new Container();
  const t = ctx.data.units[u.type]!;
  const pal = NATION[nation];
  const bg = u.berserk ? 0xc75b45 : u.broken ? mix(pal.bg, 0x000000, 0.45) : pal.bg;
  const ink = u.broken ? 0xe8e2cf : pal.ink;
  const g = new Graphics();
  // Shadow, cardboard edge, face.
  g.roundRect(2.5, 3, CS, CS, 4).fill({ color: 0x000000, alpha: 0.35 });
  g.roundRect(0, 0, CS, CS, 4).fill(mix(bg, 0x000000, 0.25));
  g.roundRect(0, 0, CS - 1.5, CS - 1.5, 4).fill(bg);
  if (selected) g.roundRect(-3, -3, CS + 4, CS + 4, 6).stroke({ width: 3, color: 0xf0c66b });
  else g.roundRect(0, 0, CS - 1.5, CS - 1.5, 4).stroke({ width: 1, color: mix(bg, 0x000000, 0.5) });
  if (u.broken) {
    // Broken side: diagonal band.
    g.poly([0, CS * 0.62, CS * 0.62, 0, CS * 0.8, 0, 0, CS * 0.8]).fill({ color: 0xffffff, alpha: 0.12 });
  }
  if (t.kind === 'leader') soldier(g, CS * 0.32, CS * 0.42, 1.25, ink);
  else if (t.kind === 'crew') soldier(g, CS * 0.5, CS * 0.4, 1.1, ink);
  else {
    soldier(g, CS * 0.34, CS * 0.42, 1.05, ink);
    soldier(g, CS * 0.64, CS * 0.42, 1.05, ink);
  }
  box.addChild(g);

  const label =
    t.kind === 'leader'
      ? leaderRating(t.morale, t.leadership)
      : u.broken
        ? `${t.brokenMorale}`
        : `${t.fp}-${t.range}-${t.morale}`;
  const txt = new Text({ text: label, style: { ...facts, fill: ink }, resolution: 4 });
  txt.anchor.set(0.5, 1);
  txt.position.set(t.kind === 'leader' ? CS * 0.7 : CS / 2, CS - 2);
  if (t.kind === 'leader') txt.position.y = CS * 0.62;
  box.addChild(txt);
  if (t.kind === 'leader' && u.name) {
    const nm = new Text({ text: u.name.split(' ').slice(-1)[0]!, style: { ...tiny, fill: ink }, resolution: 4 });
    nm.anchor.set(0.5, 1);
    nm.position.set(CS / 2, CS - 3);
    box.addChild(nm);
  }

  // Carried weapons: tabs along the top edge.
  u.weapons.forEach((wid, i) => {
    const w = s.weapons[wid];
    if (!w) return;
    const tab = new Graphics();
    tab.roundRect(2 + i * 20, -9, 19, 10, 2).fill(0x262b24).stroke({ width: 0.8, color: 0x000000 });
    if (w.malfunctioned) tab.moveTo(3 + i * 20, -8).lineTo(20 + i * 20, 0).stroke({ width: 1.5, color: 0xd0604d });
    box.addChild(tab);
    const tt = new Text({ text: weaponType(ctx, w).kind, style: small, resolution: 4 });
    tt.anchor.set(0.5);
    tt.position.set(11.5 + i * 20, -4);
    box.addChild(tt);
  });

  // Status badges along the right edge.
  const badges: [string, number][] = [];
  if (u.firedPhase) badges.push([u.firedPhase === 'prepFire' ? 'P' : 'F', 0xd8893a]);
  if (u.moved) badges.push(['M', 0x4f86b3]);
  if (u.dm && u.broken) badges.push(['DM', 0xb02a1e]);
  if (u.concealed) badges.push(['?', 0x6a5a9e]);
  badges.forEach(([b, color], i) => {
    const bg2 = new Graphics();
    bg2.roundRect(CS - 6, 4 + i * 11, b.length > 1 ? 15 : 10, 10, 2).fill(color);
    box.addChild(bg2);
    const tt = new Text({ text: b, style: small, resolution: 4 });
    tt.position.set(CS - 4, 4.5 + i * 11);
    box.addChild(tt);
  });
  return box;
}
