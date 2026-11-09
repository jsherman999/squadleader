import type { GameState } from './types';

/** Next uniform number in [0, 1) from the state's PRNG (mulberry32). Mutates state.rng. */
export function nextRandom(s: GameState): number {
  const a = (s.rng + 0x6d2b79f5) >>> 0;
  s.rng = a;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function d6(s: GameState): number {
  if (s.diceQueue?.length) return s.diceQueue.shift()!;
  return 1 + Math.floor(nextRandom(s) * 6);
}

export function roll2d6(s: GameState): [number, number] {
  return [d6(s), d6(s)];
}
