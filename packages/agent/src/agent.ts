/**
 * The LLM opponent's decision loop (PLAN.md §7.7). One call sequence per
 * phase in which its side has choices: the model looks with tools, acts
 * with submit_orders and finishes with end_phase. Illegal orders come back
 * with the rule that refused them so the model can repair them; too many
 * failures, provider errors, a refusal or the budget hand the phase to the
 * scripted AI.
 */
import { PHASE_NAMES, type Phase } from '@squadwar/engine';
import type { GameEnv } from './orders';
import { costOf } from './pricing';
import { PHASE_GUIDE, systemPrompt } from './prompt';
import { situation } from './serialize';
import { runTool, TOOLS, type AgentMemory } from './tools';
import { addUsage, NO_USAGE, type ChatProvider, type LlmConfig, type ToolResult, type Usage } from './types';

/** Phases the LLM decides; the rest (rally, rout, close combat, setup) are routine and go to the scripted AI. */
export const LLM_PHASES: ReadonlySet<Phase> = new Set(['prepFire', 'movement', 'defensiveFire', 'advancingFire', 'advance']);

export interface Spend {
  usage: Usage;
  /** Undefined while the model's price is unknown. */
  usd: number | undefined;
  calls: number;
}

export function newSpend(): Spend {
  return { usage: NO_USAGE, usd: 0, calls: 0 };
}

export type FallbackReason = 'budget' | 'error' | 'refusal' | 'repairs' | 'rounds' | 'aborted';

export interface DecisionResult {
  /** The model ended the phase itself. */
  readonly ended: boolean;
  /** Why the scripted AI must take over the rest of this phase. */
  readonly fallback?: FallbackReason;
  readonly message?: string;
  /** The model's free text this decision (its visible reasoning, if any). */
  readonly thoughts: string;
}

export interface DecideOptions {
  readonly provider: ChatProvider;
  readonly config: LlmConfig;
  readonly env: GameEnv;
  readonly side: string;
  readonly memory: AgentMemory;
  readonly spend: Spend;
  readonly signal?: AbortSignal;
  readonly maxRounds?: number;
  readonly maxRepairs?: number;
  /** Progress for the UI: "previewing fire", "submitting orders"... */
  readonly onProgress?: (text: string) => void;
}

const VERB: Record<string, string> = {
  get_situation: 'reading the situation',
  describe_hexes: 'studying the terrain',
  check_los: 'checking lines of sight',
  preview_fire: 'weighing an attack',
  preview_move: 'planning a route',
  list_options: 'asking the staff for options',
  submit_orders: 'giving orders',
  set_standing_orders: 'setting standing orders',
  notebook_write: 'making notes',
  notebook_read: 'reading notes',
  end_phase: 'ending the phase',
};

function firstMessage(opts: DecideOptions): string {
  const s = opts.env.state();
  const notes = opts.memory.notebook.length ? `\n\nYOUR NOTES:\n${opts.memory.notebook.slice(-4).join('\n')}` : '';
  return [
    situation(opts.env.ctx, s, opts.side),
    notes,
    '',
    `IT IS YOUR ${PHASE_NAMES[s.phase].toUpperCase()}. ${PHASE_GUIDE[s.phase] ?? ''}`,
    s.phasing !== opts.side && s.phase !== 'defensiveFire' ? 'Before you finish, you may set standing orders for your next Defensive Fire.' : '',
    'Act with submit_orders, then call end_phase.',
  ]
    .filter((x) => x !== undefined)
    .join('\n');
}

export async function decide(opts: DecideOptions): Promise<DecisionResult> {
  const { provider, config, env, side, memory, spend } = opts;
  const maxRounds = opts.maxRounds ?? 12;
  const maxRepairs = opts.maxRepairs ?? 3;
  const conv = provider.conversation({
    model: config.model,
    system: systemPrompt(env.ctx, side, config.persona),
    tools: TOOLS,
    effort: config.effort,
    maxTokens: 16000,
  });
  let input: string | ToolResult[] = firstMessage(opts);
  let repairs = 0;
  let nudged = false;
  let thoughts = '';
  const startPhase = env.state().phase;
  const startTurn = env.state().turn;
  const stillMine = () => {
    const s = env.state();
    return s.awaiting === side && s.phase === startPhase && s.turn === startTurn && s.phase !== 'gameOver';
  };

  for (let round = 0; round < maxRounds; round++) {
    if (opts.signal?.aborted) return { ended: false, fallback: 'aborted', thoughts };
    if (spend.usd !== undefined && spend.usd >= config.budgetUsd) return { ended: false, fallback: 'budget', message: `Budget of $${config.budgetUsd.toFixed(2)} reached.`, thoughts };
    let turn;
    try {
      opts.onProgress?.(round === 0 ? 'thinking' : 'thinking it over');
      turn = await conv.send(input, opts.signal);
    } catch (e) {
      if (opts.signal?.aborted) return { ended: false, fallback: 'aborted', thoughts };
      return { ended: false, fallback: 'error', message: (e as Error).message, thoughts };
    }
    spend.calls++;
    spend.usage = addUsage(spend.usage, turn.usage);
    const c = costOf(turn.model ?? config.model, turn.usage);
    spend.usd = c === undefined || spend.usd === undefined ? undefined : spend.usd + c;
    if (turn.text.trim()) thoughts += (thoughts ? '\n' : '') + turn.text.trim();
    if (turn.stop === 'refusal') return { ended: false, fallback: 'refusal', message: 'The model declined to continue.', thoughts };

    if (!turn.toolCalls.length) {
      if (!stillMine()) return { ended: true, thoughts };
      if (nudged) return { ended: false, fallback: 'rounds', message: 'The model stopped without ending the phase.', thoughts };
      nudged = true;
      input = 'Please act using the tools: submit_orders for your orders, then end_phase.';
      continue;
    }

    const results: ToolResult[] = [];
    let ended = false;
    let anyOk = false;
    let anyFail = false;
    for (const call of turn.toolCalls) {
      opts.onProgress?.(VERB[call.name] ?? call.name);
      if (ended || !stillMine()) {
        results.push({ id: call.id, name: call.name, content: 'The phase is already over.' });
        ended = true;
        continue;
      }
      const out = runTool(env, side, memory, call);
      results.push({ id: call.id, name: call.name, content: out.content, ...(out.isError ? { isError: true } : {}) });
      if (out.ordersOk) anyOk = true;
      if (out.ordersFailed) anyFail = true;
      if (out.ended) ended = true;
    }
    if (ended || !stillMine()) return { ended: true, thoughts };
    if (anyFail && !anyOk) {
      repairs++;
      if (repairs > maxRepairs) return { ended: false, fallback: 'repairs', message: 'Too many refused orders.', thoughts };
    } else if (anyOk) repairs = 0;
    input = results;
  }
  return { ended: false, fallback: 'rounds', message: `No end_phase after ${maxRounds} rounds.`, thoughts };
}
