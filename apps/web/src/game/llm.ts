/**
 * LLM opponent state in the browser: settings per side (no keys), API keys
 * (in memory unless the player opts in), the agent's memory and spend, and
 * the runner that plays a phase through the session.
 *
 * Keys never go into saves, replays or logs.
 */
import { create } from 'zustand';
import {
  botFinishPhase,
  DEFAULT_MODEL,
  newMemory,
  newSpend,
  playPhase,
  type AgentMemory,
  type GameEnv,
  type LlmConfig,
  type ProviderId,
  type Spend,
} from '@squadwar/agent';
import type { SideId } from '@squadwar/engine';
import { ctxFor } from './scenarios';
import { useSession } from './session';

const CONFIG_KEY = 'squadwar:llm';
const KEYS_KEY = 'squadwar:keys';

export const DEFAULT_CONFIG: LlmConfig = {
  provider: 'anthropic',
  model: DEFAULT_MODEL.anthropic ?? 'claude-opus-5-5',
  persona: 'balanced',
  effort: 'medium',
  budgetUsd: 5,
  economy: true,
};

interface SideRun {
  status: 'idle' | 'thinking';
  progress?: string;
  /** Last fallback or error, for a notice. */
  notice?: string;
  thoughts?: string;
  memory: AgentMemory;
  spend: Spend;
}

interface LlmState {
  config: LlmConfig;
  keys: Partial<Record<ProviderId, string>>;
  remember: boolean;
  runs: Record<SideId, SideRun>;
  showThinking: boolean;
  setConfig(c: Partial<LlmConfig>): void;
  setKey(p: ProviderId, key: string, remember: boolean): void;
  forgetKeys(): void;
  setShowThinking(v: boolean): void;
  /** Start fresh memory and spend for a new game. */
  reset(): void;
  run(side: SideId): SideRun;
  patch(side: SideId, p: Partial<SideRun>): void;
}

function loadConfig(): LlmConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<LlmConfig>) } : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

function loadKeys(): Partial<Record<ProviderId, string>> {
  try {
    const raw = localStorage.getItem(KEYS_KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<ProviderId, string>>) : {};
  } catch {
    return {};
  }
}

const freshRun = (): SideRun => ({ status: 'idle', memory: newMemory(), spend: newSpend() });

export const useLlm = create<LlmState>((set, get) => ({
  config: loadConfig(),
  keys: loadKeys(),
  remember: Object.keys(loadKeys()).length > 0,
  runs: {},
  showThinking: false,
  setConfig(c) {
    const config = { ...get().config, ...c };
    set({ config });
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    } catch {
      // settings last for this visit
    }
  },
  setKey(p, key, remember) {
    const keys = { ...get().keys, [p]: key };
    set({ keys, remember });
    try {
      if (remember) localStorage.setItem(KEYS_KEY, JSON.stringify(keys));
      else localStorage.removeItem(KEYS_KEY);
    } catch {
      // storage blocked: the key stays in memory only
    }
  },
  forgetKeys() {
    set({ keys: {}, remember: false });
    try {
      localStorage.removeItem(KEYS_KEY);
    } catch {
      // nothing stored
    }
  },
  setShowThinking(v) {
    set({ showThinking: v });
  },
  reset() {
    set({ runs: {} });
  },
  run(side) {
    return get().runs[side] ?? freshRun();
  },
  patch(side, p) {
    set({ runs: { ...get().runs, [side]: { ...(get().runs[side] ?? freshRun()), ...p } } });
  },
}));

/** The live game as the agent's environment: actions go through the session (log, animation, saves). */
function sessionEnv(): GameEnv {
  const st = useSession.getState();
  const ctx = ctxFor(st.scenarioId!);
  return {
    ctx,
    state: () => {
      const s = useSession.getState().states;
      return s[s.length - 1]!;
    },
    apply(a, note) {
      const before = useSession.getState().actions.length;
      if (!useSession.getState().dispatch(a, note)) {
        const error = useSession.getState().error ?? 'refused';
        useSession.getState().clearError();
        return { ok: false, error };
      }
      return { ok: true, events: useSession.getState().events.filter((e) => e.action === before) };
    },
  };
}

const running = new Map<SideId, AbortController>();

export function llmBusy(side: SideId): boolean {
  return running.has(side);
}

export function cancelLlm(side: SideId): void {
  running.get(side)?.abort();
}

/** Play the current phase for an LLM side. Without a key the scripted AI plays it. */
export async function runLlmPhase(side: SideId): Promise<void> {
  if (running.has(side)) return;
  const llm = useLlm.getState();
  const cfg = llm.config;
  const key = llm.keys[cfg.provider] ?? '';
  const ac = new AbortController();
  running.set(side, ac);
  const run = llm.run(side);
  llm.patch(side, { status: 'thinking', progress: 'thinking', notice: undefined });
  try {
    const env = sessionEnv();
    if (!key && cfg.provider !== 'local') {
      botFinishPhase(env, side);
      useLlm.getState().patch(side, { notice: 'No API key: the scripted AI is playing this side. Add a key in LLM settings.' });
      return;
    }
    // Provider adapters (and the Anthropic SDK) load only when an LLM plays.
    const { makeProvider } = await import('@squadwar/agent/providers');
    const provider = makeProvider(cfg, key);
    const r = await playPhase({
      provider,
      config: cfg,
      env,
      side,
      memory: run.memory,
      spend: run.spend,
      signal: ac.signal,
      onProgress: (p) => useLlm.getState().patch(side, { progress: p }),
    });
    const why: Record<string, string> = {
      budget: 'Budget reached: the scripted AI finished this phase.',
      error: 'The model could not be reached: the scripted AI finished this phase.',
      refusal: 'The model declined: the scripted AI finished this phase.',
      repairs: 'Too many refused orders: the scripted AI finished this phase.',
      rounds: 'The model did not finish: the scripted AI finished this phase.',
      aborted: 'Cancelled: the scripted AI finished this phase.',
    };
    useLlm.getState().patch(side, {
      ...(r.fallback ? { notice: `${why[r.fallback]}${r.message && r.fallback === 'error' ? ` (${r.message})` : ''}` } : {}),
      ...(r.thoughts ? { thoughts: r.thoughts } : {}),
      spend: { ...run.spend },
      memory: run.memory,
    });
  } finally {
    running.delete(side);
    useLlm.getState().patch(side, { status: 'idle', progress: undefined });
  }
}
