/** Fire Director settings: battle speed, sound, dice tray, reduced motion. Stored per browser. */
import { create } from 'zustand';

export type BattleSpeed = 'cinematic' | 'normal' | 'fast' | 'instant';

export interface FxPrefs {
  readonly speed: BattleSpeed;
  readonly sound: boolean;
  /** 0..1 */
  readonly volume: number;
  readonly dice: boolean;
  readonly reducedMotion: boolean;
}

interface FxSettingsState extends FxPrefs {
  set(p: Partial<FxPrefs>): void;
}

const KEY = 'squadwar:fx';

function defaults(): FxPrefs {
  let reduced = false;
  try {
    reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    // No window (tests).
  }
  return { speed: 'normal', sound: true, volume: 0.6, dice: true, reducedMotion: reduced };
}

function load(): FxPrefs {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const p = JSON.parse(raw) as Partial<FxPrefs>;
    return { ...d, ...p };
  } catch {
    return d;
  }
}

export const useFxSettings = create<FxSettingsState>((set, get) => ({
  ...load(),
  set(p) {
    set(p);
    const { speed, sound, volume, dice, reducedMotion } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ speed, sound, volume, dice, reducedMotion }));
    } catch {
      // Storage blocked: settings last for this visit.
    }
  },
}));

export const SPEED_SCALE: Record<BattleSpeed, number> = { cinematic: 1.6, normal: 1, fast: 0.5, instant: 0 };
