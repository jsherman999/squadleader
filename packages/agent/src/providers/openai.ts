/**
 * OpenAI-compatible Chat Completions adapter: OpenAI, OpenRouter and local
 * servers (Ollama, LM Studio, vLLM). Tool calls use the "tools" /
 * "tool_calls" format; results go back as role "tool" messages.
 */
import type { AgentTurn, ChatProvider, Conversation, ConversationOptions, ModelInfo, ProviderId, StopKind, ToolResult } from '../types';

export interface OpenAIOptions {
  readonly id: Extract<ProviderId, 'openai' | 'openrouter' | 'local'>;
  readonly apiKey?: string;
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
}

export const BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  local: 'http://localhost:11434/v1',
} as const;

interface OAToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
type OAMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OAToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

function stopOf(r: string | undefined, hasCalls: boolean): StopKind {
  if (hasCalls || r === 'tool_calls') return 'tool_use';
  if (r === 'length') return 'max_tokens';
  if (r === 'content_filter') return 'refusal';
  return 'end';
}

export function openAIProvider(opts: OpenAIOptions): ChatProvider {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const base = opts.baseUrl.replace(/\/+$/, '');
  const headers = (): Record<string, string> => ({
    'content-type': 'application/json',
    ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
    ...(opts.id === 'openrouter' ? { 'X-Title': 'Squad War' } : {}),
  });
  async function call(path: string, body: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const res = await doFetch(`${base}${path}`, { method: body ? 'POST' : 'GET', headers: headers(), ...(body ? { body: JSON.stringify(body) } : {}), ...(signal ? { signal } : {}) });
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 300);
      try {
        msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? msg;
      } catch {
        // keep the raw text
      }
      throw new Error(`${opts.id} ${res.status}: ${msg}`);
    }
    return JSON.parse(text) as Record<string, unknown>;
  }
  return {
    id: opts.id,
    async listModels(signal) {
      const r = await call('/models', undefined, signal);
      const data = (r.data ?? r.models ?? []) as { id: string; name?: string; supported_parameters?: string[] }[];
      return data
        .filter((m) => !m.supported_parameters || m.supported_parameters.includes('tools'))
        .map((m): ModelInfo => ({ id: m.id, name: m.name ?? m.id }))
        .sort((a, b) => a.id.localeCompare(b.id));
    },
    conversation(c: ConversationOptions): Conversation {
      const messages: OAMessage[] = [{ role: 'system', content: c.system }];
      const tools = c.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      return {
        async send(input, signal): Promise<AgentTurn> {
          if (typeof input === 'string') messages.push({ role: 'user', content: input });
          else for (const r of input as readonly ToolResult[]) messages.push({ role: 'tool', tool_call_id: r.id, content: r.isError ? `ERROR: ${r.content}` : r.content });
          const body: Record<string, unknown> = { model: c.model, messages, tools, tool_choice: 'auto' };
          if (opts.id === 'openai') {
            body.max_completion_tokens = c.maxTokens;
            if (/^(o\d|gpt-5)/.test(c.model)) body.reasoning_effort = c.effort;
          } else body.max_tokens = c.maxTokens;
          if (opts.id === 'openrouter') body.usage = { include: true };
          const r = await call('/chat/completions', body, signal);
          const choice = ((r.choices as unknown[]) ?? [])[0] as { message?: { content?: string | null; tool_calls?: OAToolCall[] }; finish_reason?: string } | undefined;
          const msg = choice?.message ?? {};
          const calls = (msg.tool_calls ?? []).filter((t) => t.type === 'function' || !t.type);
          messages.push({ role: 'assistant', content: msg.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) });
          const usage = (r.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
          const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
          return {
            text: msg.content ?? '',
            toolCalls: calls.map((t) => {
              let input: unknown;
              try {
                input = JSON.parse(t.function.arguments || '{}');
              } catch {
                input = { _unparseable: t.function.arguments };
              }
              return { id: t.id, name: t.function.name, input };
            }),
            stop: stopOf(choice?.finish_reason, calls.length > 0),
            ...(typeof r.model === 'string' ? { model: r.model } : {}),
            usage: { inputTokens: Math.max(0, (usage.prompt_tokens ?? 0) - cached), outputTokens: usage.completion_tokens ?? 0, cachedInputTokens: cached, cacheWriteTokens: 0 },
          };
        },
      };
    },
  };
}
