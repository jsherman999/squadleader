/**
 * Provider-neutral types for the LLM opponent (PLAN.md §7.7). Each provider
 * adapter keeps its own native transcript (so things like Anthropic
 * thinking blocks are passed back unchanged) behind `Conversation`.
 */

/** A tool the model may call. `parameters` is JSON Schema. */
export interface ToolDef {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export interface ToolResult {
  readonly id: string;
  readonly name: string;
  readonly content: string;
  readonly isError?: boolean;
}

export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheWriteTokens: number;
}

export const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

export type StopKind = 'tool_use' | 'end' | 'max_tokens' | 'refusal';

/** One model response. */
export interface AgentTurn {
  readonly text: string;
  readonly toolCalls: readonly ToolCall[];
  readonly stop: StopKind;
  readonly usage: Usage;
  /** The model that actually answered (fallbacks can change it). */
  readonly model?: string;
}

export interface Conversation {
  /** Send the first user message, or tool results for the last turn's calls. */
  send(input: string | readonly ToolResult[], signal?: AbortSignal): Promise<AgentTurn>;
}

export interface ModelInfo {
  readonly id: string;
  readonly name: string;
  /** Short note, e.g. "recommended" or a price hint. */
  readonly note?: string;
}

export type Effort = 'low' | 'medium' | 'high';

export interface ConversationOptions {
  readonly model: string;
  readonly system: string;
  readonly tools: readonly ToolDef[];
  readonly effort: Effort;
  readonly maxTokens: number;
}

export interface ChatProvider {
  readonly id: ProviderId;
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
  conversation(opts: ConversationOptions): Conversation;
}

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'local' | 'mock';

export type Persona = 'cautious' | 'balanced' | 'aggressive';

/** What the player picks in the settings panel. The API key is never part of this. */
export interface LlmConfig {
  readonly provider: ProviderId;
  readonly model: string;
  readonly persona: Persona;
  readonly effort: Effort;
  /** Spend cap for the whole game, in US dollars. */
  readonly budgetUsd: number;
  /** Base URL for a local OpenAI-compatible server (Ollama, LM Studio, vLLM). */
  readonly baseUrl?: string;
  /** Defensive Fire by standing orders instead of a model call (cheaper). */
  readonly economy: boolean;
}
