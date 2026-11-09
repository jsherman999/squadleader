/**
 * Plays a Fire Director timeline: one clock, frames for the map views,
 * cue events for sound and the dice tray, and a commit hook so the board
 * switches to the new state when the results land. Never blocks the
 * engine: the state has already changed; this only delays showing it.
 */
import { EMPTY_FRAME, sampleFx, type FxFrame } from './sample';
import type { Cue, Timeline } from './timeline';

export interface PlayHooks {
  onCommit?: () => void;
  onDone?: () => void;
}

type FrameListener = (f: FxFrame) => void;
type CueListener = (c: Cue) => void;

class FxPlayer {
  private tl?: Timeline;
  private hooks: PlayHooks = {};
  private start = 0;
  private fired = 0;
  private committed = false;
  private raf = 0;
  private frameListeners = new Set<FrameListener>();
  private cueListeners = new Set<CueListener>();
  private stateListeners = new Set<() => void>();
  private sorted: Cue[] = [];
  /** Development only: freeze the clock at a time (seconds) to inspect a frame. */
  debugTime?: number;

  get busy(): boolean {
    return !!this.tl;
  }

  play(tl: Timeline, hooks: PlayHooks = {}): void {
    if (this.tl) this.skip();
    this.tl = tl;
    this.hooks = hooks;
    this.start = performance.now();
    this.fired = 0;
    this.committed = false;
    this.sorted = [...tl.cues].sort((a, b) => a.t0 - b.t0);
    this.notifyState();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  /** Jump to the end: results show at once. */
  skip(): void {
    if (!this.tl) return;
    cancelAnimationFrame(this.raf);
    this.finish();
  }

  onFrame(fn: FrameListener): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  onCue(fn: CueListener): () => void {
    this.cueListeners.add(fn);
    return () => this.cueListeners.delete(fn);
  }

  /** For useSyncExternalStore. */
  subscribe = (fn: () => void): (() => void) => {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  };

  private notifyState(): void {
    for (const fn of this.stateListeners) fn();
  }

  private finish(): void {
    const hooks = this.hooks;
    this.tl = undefined;
    this.hooks = {};
    if (!this.committed) {
      this.committed = true;
      hooks.onCommit?.();
    }
    for (const fn of this.frameListeners) fn(EMPTY_FRAME);
    this.notifyState();
    hooks.onDone?.();
  }

  private tick = (): void => {
    const tl = this.tl;
    if (!tl) return;
    const t = this.debugTime ?? (performance.now() - this.start) / 1000;
    while (this.fired < this.sorted.length && this.sorted[this.fired]!.t0 <= t) {
      const c = this.sorted[this.fired++]!;
      for (const fn of this.cueListeners) fn(c);
    }
    if (!this.committed && t >= tl.commitAt) {
      this.committed = true;
      this.hooks.onCommit?.();
    }
    if (t >= tl.duration) {
      this.finish();
      return;
    }
    const frame = sampleFx(tl.cues, t);
    for (const fn of this.frameListeners) fn(frame);
    this.raf = requestAnimationFrame(this.tick);
  };
}

export const fxPlayer = new FxPlayer();
