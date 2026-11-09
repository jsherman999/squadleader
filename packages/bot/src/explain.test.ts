import { describe, expect, it } from 'vitest';
import { createGame, tryAction, type GameState } from '@squadwar/engine';
import { decide } from './bot';
import type { Rationale } from './explain';
import { scenarioCtx } from './selfplay';

function playWithNotes(seed: number): { notes: Rationale[]; types: string[] } {
  const ctx = scenarioCtx(0);
  let s: GameState = createGame(ctx, seed).state;
  const notes: Rationale[] = [];
  const types: string[] = [];
  for (let i = 0; i < 4000 && s.phase !== 'gameOver'; i++) {
    const d = decide(ctx, s);
    const r = tryAction(ctx, s, d.action);
    if (!r.ok) throw new Error(`illegal ${d.action.type}: ${r.error}`);
    notes.push(d.why);
    types.push(d.action.type);
    s = r.state;
  }
  return { notes, types };
}

describe('bot rationales', () => {
  const ctx = scenarioCtx(0);
  for (const seed of [3, 8]) {
    it(`explains every decision of game ${seed}`, () => {
      const { notes, types } = playWithNotes(seed);
      expect(notes.length).toBeGreaterThan(50);
      notes.forEach((n, i) => {
        expect(n.goal.length, `goal of decision ${i}`).toBeGreaterThan(3);
        // Saves store rationales as JSON.
        expect(JSON.parse(JSON.stringify(n))).toEqual(n);
        const text = [n.goal, ...n.reasons, ...(n.alternatives ?? []), n.tip ?? ''].join(' ');
        expect(text).not.toMatch(/undefined|NaN|\[object/);
        if (n.weight === 'key') expect(n.reasons.length, `reasons of ${n.goal}`).toBeGreaterThan(0);
        for (const h of [n.focus?.from, n.focus?.to, n.focus?.goal, ...(n.focus?.path ?? [])]) if (h) expect(ctx.map.hexes[h]).toBeDefined();
      });
      // Fire decisions quote firepower and odds.
      const fires = notes.filter((_, i) => types[i] === 'fire');
      expect(fires.length).toBeGreaterThan(0);
      for (const f of fires) {
        expect(f.reasons.join(' ')).toMatch(/FP/);
        expect(f.reasons.join(' ')).toMatch(/%/);
      }
      // A useful share of decisions are key ones.
      expect(notes.filter((n) => n.weight === 'key').length).toBeGreaterThan(10);
    });
  }
});
