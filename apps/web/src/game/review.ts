/**
 * Review (tutor) mode: a saved game replayed into every intermediate
 * state, with a cursor over its decisions.
 */
import { create } from 'zustand';
import type { GameState } from '@squadwar/engine';
import { replaySave, type LoggedEvent, type SaveFile } from './session';

interface ReviewState {
  save?: SaveFile;
  states: GameState[];
  events: LoggedEvent[];
  /** Decision index: the board shows states[index]; actions[index] is the decision on show. index = actions.length is the end. */
  index: number;
  open(save: SaveFile, at?: number): void;
  seek(i: number): void;
}

export const useReview = create<ReviewState>((set, get) => ({
  states: [],
  events: [],
  index: 0,
  open(save, at = 0) {
    const { states, events } = replaySave(save);
    set({ save, states, events, index: Math.max(0, Math.min(at, save.actions.length)) });
  },
  seek(i) {
    const n = get().save?.actions.length ?? 0;
    set({ index: Math.max(0, Math.min(n, i)) });
  },
}));
