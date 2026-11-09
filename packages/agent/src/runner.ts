/**
 * Plays one phase for an LLM-controlled side:
 * - decision phases go to the model (`decide`);
 * - Defensive Fire in economy mode runs the standing orders instead;
 * - routine phases (rally, rout, close combat, setup) and every fallback go
 *   to the scripted AI, so the game always moves on.
 */
import { decide as botDecide } from '@squadwar/bot';
import type { GameEnv } from './orders';
import { decide, LLM_PHASES, type FallbackReason, type Spend } from './agent';
import { standingFire } from './standing';
import type { AgentMemory } from './tools';
import type { ChatProvider, LlmConfig } from './types';

export interface TurnOptions {
  readonly provider: ChatProvider;
  readonly config: LlmConfig;
  readonly env: GameEnv;
  readonly side: string;
  readonly memory: AgentMemory;
  readonly spend: Spend;
  readonly signal?: AbortSignal;
  readonly onProgress?: (text: string) => void;
}

export interface TurnResult {
  /** Who played the phase. */
  readonly by: 'llm' | 'standing' | 'bot';
  readonly fallback?: FallbackReason;
  readonly message?: string;
  readonly thoughts?: string;
}

/** Let the scripted AI finish the current phase for `side`. */
export function botFinishPhase(env: GameEnv, side: string, limit = 400): void {
  const start = env.state();
  const same = () => {
    const s = env.state();
    return s.awaiting === side && s.phase === start.phase && s.turn === start.turn && s.half === start.half && s.phase !== 'gameOver';
  };
  for (let i = 0; i < limit && same(); i++) {
    const d = botDecide(env.ctx, env.state());
    const r = env.apply(d.action, d.why);
    if (!r.ok && !env.apply({ type: 'endPhase' }).ok) break;
  }
}

export async function playPhase(o: TurnOptions): Promise<TurnResult> {
  const s = o.env.state();
  if (s.awaiting !== o.side || s.phase === 'gameOver') return { by: 'bot' };
  if (s.phase === 'defensiveFire' && o.config.economy && o.memory.standing.length) {
    o.onProgress?.('following standing orders');
    for (let i = 0; i < 40; i++) {
      const d = standingFire(o.env.ctx, o.env.state(), o.side, o.memory.standing);
      if (!d || !o.env.apply(d.action, d.why).ok) break;
    }
    if (o.env.state().awaiting === o.side && o.env.state().phase === 'defensiveFire') o.env.apply({ type: 'endPhase' }, { goal: 'Standing orders carried out', reasons: [], weight: 'routine' });
    return { by: 'standing' };
  }
  if (!LLM_PHASES.has(s.phase)) {
    botFinishPhase(o.env, o.side);
    return { by: 'bot' };
  }
  const r = await decide(o);
  if (!r.ended) botFinishPhase(o.env, o.side);
  return { by: r.ended ? 'llm' : 'bot', ...(r.fallback ? { fallback: r.fallback } : {}), ...(r.message ? { message: r.message } : {}), thoughts: r.thoughts };
}
