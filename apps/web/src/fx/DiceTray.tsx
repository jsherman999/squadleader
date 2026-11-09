import { useEffect, useState } from 'react';
import { fxPlayer } from './player';
import { useFxSettings } from './settings';
import { TONE_COLOR, type Cue } from './timeline';

type DiceCue = Extract<Cue, { kind: 'dice' }>;

/** Rotation that brings each face to the front (1 front, 6 back, 3 right, 4 left, 2 top, 5 bottom). */
const FACE: Record<number, [number, number]> = { 1: [0, 0], 6: [0, 180], 3: [0, -90], 4: [0, 90], 2: [-90, 0], 5: [90, 0] };
const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

function Face({ n, cls }: { n: number; cls: string }) {
  return (
    <div className={`die-face ${cls}`}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={PIPS[n]!.includes(i) ? 'pip' : ''} />
      ))}
    </div>
  );
}

function Die({ value, seed, still, red }: { value: number; seed: number; still: boolean; red: boolean }) {
  const [rx, ry] = FACE[value] ?? [0, 0];
  const spinX = 360 * (2 + (seed % 2));
  const spinY = 360 * (1 + ((seed >> 1) % 2));
  const style = {
    '--to': `rotateX(${rx}deg) rotateY(${ry}deg)`,
    '--from': `rotateX(${rx + spinX + 37}deg) rotateY(${ry - spinY - 53}deg)`,
  } as React.CSSProperties;
  return (
    <div className={`die ${red ? 'red' : ''}`} aria-label={`die ${value}`}>
      <div className={`die-cube ${still ? 'still' : ''}`} style={style}>
        <Face n={1} cls="f1" />
        <Face n={6} cls="f6" />
        <Face n={3} cls="f3" />
        <Face n={4} cls="f4" />
        <Face n={2} cls="f2" />
        <Face n={5} cls="f5" />
      </div>
    </div>
  );
}

/** Shows each roll as it happens: the dice tumble and land on the faces the engine already rolled. */
export function DiceTray() {
  const { dice: on, reducedMotion } = useFxSettings();
  const [roll, setRoll] = useState<{ cue: DiceCue; id: number }>();
  useEffect(() => {
    let id = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = fxPlayer.onCue((c) => {
      if (c.kind !== 'dice') return;
      setRoll({ cue: c, id: ++id });
      clearTimeout(timer);
      timer = setTimeout(() => setRoll(undefined), Math.max(1800, c.dur * 1000 + 900));
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);
  if (!on || !roll) return null;
  const { cue, id } = roll;
  const total = cue.dice.reduce((a, b) => a + b, 0);
  return (
    <div className="dice-tray" key={id} role="status" aria-label={`${cue.text} = ${total}`}>
      <div className="dice-row">
        {cue.dice.map((v, i) => (
          <Die key={i} value={v} seed={id * 7 + i * 3} still={reducedMotion} red={i === 1} />
        ))}
      </div>
      <div className="dice-text" style={{ color: `#${TONE_COLOR[cue.tone].toString(16).padStart(6, '0')}` }}>
        {cue.text} = <strong>{total}</strong>
      </div>
    </div>
  );
}
