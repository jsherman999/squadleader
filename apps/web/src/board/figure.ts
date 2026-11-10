/**
 * The soldier silhouettes on the counters, as plain shapes so the 2D board
 * (Pixi) and the 3D counter faces (canvas) draw exactly the same figures.
 *
 * Figures are seen from the side, facing right, about 18 units tall
 * (helmet top at -9, boots at +9) and centred on x = 0. Limbs are thick
 * round-ended strokes; the head, helmet and boots are filled shapes.
 */
import type { Nation } from '@squadwar/engine';

export type FigurePose = 'rifleman' | 'leader' | 'crew';
type Pt = readonly [number, number];
/** Path commands: move, line, cubic curve, close. */
export type FigCmd = readonly ['M', number, number] | readonly ['L', number, number] | readonly ['C', number, number, number, number, number, number] | readonly ['Z'];
export type FigPart =
  | { readonly kind: 'stroke'; readonly pts: readonly Pt[]; readonly width: number }
  | { readonly kind: 'fill'; readonly d: readonly FigCmd[] }
  | { readonly kind: 'dot'; readonly x: number; readonly y: number; readonly r: number };

const limb = (width: number, ...pts: Pt[]): FigPart => ({ kind: 'stroke', pts, width });

/**
 * Head and steel helmet, the head centred on (x, y). The helmet sits low at
 * the back and has a short peak over the eyes; the German one flares into a
 * skirt over the ears and neck.
 */
function head(x: number, y: number, nation: Nation): FigPart[] {
  const german = nation === 'german';
  return [
    { kind: 'dot', x, y, r: 1.45 },
    // Neck.
    limb(1.3, [x - 0.3, y + 1.0], [x - 0.5, y + 2.0]),
    {
      kind: 'fill',
      d: [
        // Bowl: from the nape, over the crown, down to the brow.
        ['M', x - 2.0, y + 0.35],
        ['C', x - 2.5, y - 3.3, x + 2.2, y - 3.5, x + 2.0, y - 0.45],
        // Peak.
        ['L', x + 2.6, y - 0.05],
        ['L', x + 1.2, y - 0.05],
        ...(german
          ? ([
              ['L', x - 0.5, y - 0.05],
              ['L', x - 0.7, y + 1.05],
              ['L', x - 2.7, y + 1.2],
            ] as FigCmd[])
          : ([['L', x - 1.1, y + 0.2]] as FigCmd[])),
        ['Z'],
      ],
    },
  ];
}

/** A boot: the foot at (x, y), toe pointing right. */
function boot(x: number, y: number, tilt = 0): FigPart {
  return limb(1.25, [x - 0.2, y], [x + 1.55, y + 0.15 - tilt]);
}

/** A rifle from butt to muzzle: a thick stock for the first part, a thin barrel beyond it. */
function rifle(butt: Pt, muzzle: Pt, stock = 0.55): FigPart[] {
  const at = (t: number): Pt => [butt[0] + (muzzle[0] - butt[0]) * t, butt[1] + (muzzle[1] - butt[1]) * t];
  // The butt widens downwards behind the grip.
  const heel: Pt = [butt[0] + 0.15, butt[1] + 0.75];
  return [limb(1.15, butt, at(stock)), limb(0.95, heel, at(0.2)), limb(0.65, at(stock), muzzle)];
}

const cache = new Map<string, FigPart[]>();

/** The shapes of one figure, back to front. */
export function figureParts(pose: FigurePose, nation: Nation): readonly FigPart[] {
  const key = `${pose}|${nation}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let parts: FigPart[];
  if (pose === 'leader') {
    // Standing, waving the men on: one arm raised and pointing ahead, a pistol held low in the other hand.
    parts = [
      // Far leg, then the near leg.
      limb(1.75, [-0.3, 1.4], [-1.5, 5.0], [-2.3, 8.4]),
      boot(-2.3, 8.4),
      limb(1.75, [0.3, 1.4], [1.3, 5.0], [1.2, 8.4]),
      boot(1.2, 8.4),
      // Body.
      limb(3.7, [0.15, -3.3], [0, 1.0]),
      // Arm down, pistol in hand.
      limb(1.3, [-0.5, -3.7], [-1.9, -0.9], [-1.5, 1.3]),
      limb(0.7, [-1.5, 1.5], [-0.2, 1.9]),
      // Arm up, pointing forward.
      limb(1.3, [0.7, -3.8], [3.3, -4.9], [5.9, -7.3]),
      ...head(0.55, -6.6, nation),
    ];
  } else if (pose === 'crew') {
    // Kneeling on the rear knee, rifle at the shoulder.
    parts = [
      // Rear leg: thigh down to the knee on the ground, shin back along it.
      limb(1.75, [-0.9, 4.2], [-0.7, 8.3], [-4.3, 8.5]),
      // Front leg: thigh forward, shin down.
      limb(1.75, [-0.5, 4.2], [3.1, 4.0], [3.0, 8.4]),
      boot(3.0, 8.4),
      // Body, leaning into the rifle.
      limb(3.7, [0.6, -1.3], [-0.6, 3.4]),
      ...rifle([-1.3, -0.75], [8.4, -2.4], 0.5),
      // Arms: trigger hand at the stock, the other under the barrel.
      limb(1.3, [0.3, -1.6], [1.0, 0.6], [2.2, -1.0]),
      limb(1.3, [0.9, -1.8], [3.0, 0.2], [4.7, -1.6]),
      ...head(1.1, -4.6, nation),
    ];
  } else {
    // Advancing at the walk, rifle carried across the body ready to fire.
    parts = [
      // Rear leg trailing, heel lifting.
      limb(1.75, [-0.9, 1.2], [-1.7, 5.0], [-4.0, 7.9]),
      limb(1.25, [-4.0, 7.9], [-2.9, 8.9]),
      // Front leg striding out.
      limb(1.75, [-0.2, 1.2], [2.3, 4.7], [2.0, 8.4]),
      boot(2.0, 8.4),
      // Body, leaning forward.
      limb(3.7, [0.75, -3.3], [-0.55, 1.0]),
      ...rifle([-2.7, 1.0], [8.3, -4.2]),
      // Trigger arm, then the arm under the fore-end.
      limb(1.3, [0.3, -3.6], [-1.0, -1.1], [0.9, -0.75]),
      limb(1.3, [1.1, -3.7], [2.8, -1.4], [4.4, -2.45]),
      ...head(1.45, -6.6, nation),
    ];
  }
  cache.set(key, parts);
  return parts;
}

/** Where the figures stand on a 44-unit counter face: [x, y, scale] for each. */
export const FIGURE_SPOTS: Readonly<Record<'squad' | 'crew' | 'leader', readonly (readonly [number, number, number])[]>> = {
  squad: [
    [12.5, 18, 1],
    [26.5, 18, 1],
  ],
  crew: [[19, 16.5, 1.12]],
  leader: [[13, 18.5, 1.22]],
};

/** The pose for a unit kind. */
export function poseFor(kind: 'squad' | 'crew' | 'leader'): FigurePose {
  return kind === 'leader' ? 'leader' : kind === 'crew' ? 'crew' : 'rifleman';
}

/** Draw a figure on a 2D canvas, centred on (x, y) at scale s. */
export function drawFigureCanvas(c: CanvasRenderingContext2D, parts: readonly FigPart[], x: number, y: number, s: number, ink: string): void {
  c.save();
  c.translate(x, y);
  c.scale(s, s);
  c.fillStyle = ink;
  c.strokeStyle = ink;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  for (const p of parts) {
    c.beginPath();
    if (p.kind === 'dot') {
      c.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      c.fill();
    } else if (p.kind === 'stroke') {
      c.lineWidth = p.width;
      p.pts.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)));
      c.stroke();
    } else {
      for (const cmd of p.d) {
        if (cmd[0] === 'M') c.moveTo(cmd[1], cmd[2]);
        else if (cmd[0] === 'L') c.lineTo(cmd[1], cmd[2]);
        else if (cmd[0] === 'C') c.bezierCurveTo(cmd[1], cmd[2], cmd[3], cmd[4], cmd[5], cmd[6]);
        else c.closePath();
      }
      c.fill();
    }
  }
  c.restore();
}
