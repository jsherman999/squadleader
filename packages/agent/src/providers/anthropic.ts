/**
 * Anthropic adapter (official SDK, called straight from the browser).
 * - The tool definitions and system prompt are a stable prefix with a cache
 *   breakpoint; the growing conversation is cached automatically.
 * - Each response's full content is appended unchanged (thinking blocks
 *   must be passed back as they came), so the transcript is append-only.
 * - tool_choice stays "auto" (forced tool use is rejected by current models).
 * - Effort is sent explicitly; models that support it get server-side
 *   refusal fallbacks ("default" routing).
 */
import Anthropic from '@anthropic-ai/sdk';
import { RECOMMENDED } from '../pricing';
import type { AgentTurn, ChatProvider, Conversation, ConversationOptions, ModelInfo, StopKind, ToolResult } from '../types';

/** Models that accept output_config.effort (Claude 4.6 and later). */
const EFFORT = /^claude-(opus|sonnet|fable|haiku|mythos)-(5|4-[6-9])/;
/** Models that accept server-side fallbacks with "default" routing. */
const FALLBACKS = /^claude-(opus-5|opus-5-5|fable-5-1|sonnet-5-5)$/;

export interface AnthropicOptions {
  readonly apiKey: string;
  /** For tests: a fetch to use instead of the global one. */
  readonly fetch?: typeof fetch;
  readonly baseURL?: string;
}

function stopOf(r: string | null | undefined): StopKind {
  switch (r) {
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'end';
  }
}

export function anthropicProvider(opts: AnthropicOptions): ChatProvider {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    dangerouslyAllowBrowser: true,
    maxRetries: 2,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
  });
  return {
    id: 'anthropic',
    async listModels(signal) {
      const out: ModelInfo[] = [];
      for await (const m of client.models.list({}, { ...(signal ? { signal } : {}) })) {
        if (!m.id.startsWith('claude-')) continue;
        out.push({ id: m.id, name: m.display_name ?? m.id, ...(RECOMMENDED.anthropic?.includes(m.id) ? { note: 'recommended' } : {}) });
      }
      const rank = (id: string) => {
        const i = RECOMMENDED.anthropic?.indexOf(id) ?? -1;
        return i < 0 ? 99 : i;
      };
      return out.sort((a, b) => rank(a.id) - rank(b.id));
    },
    conversation(c: ConversationOptions): Conversation {
      const messages: Anthropic.Beta.BetaMessageParam[] = [];
      const tools: Anthropic.Beta.BetaTool[] = c.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema }));
      return {
        async send(input, signal): Promise<AgentTurn> {
          if (typeof input === 'string') messages.push({ role: 'user', content: input });
          else
            messages.push({
              role: 'user',
              content: (input as readonly ToolResult[]).map((r) => ({ type: 'tool_result' as const, tool_use_id: r.id, content: r.content, ...(r.isError ? { is_error: true } : {}) })),
            });
          const fallbacks = FALLBACKS.test(c.model);
          const res = await client.beta.messages.create(
            {
              model: c.model,
              max_tokens: c.maxTokens,
              system: [{ type: 'text', text: c.system, cache_control: { type: 'ephemeral' } }],
              tools,
              tool_choice: { type: 'auto' },
              messages,
              cache_control: { type: 'ephemeral' },
              ...(EFFORT.test(c.model) ? { output_config: { effort: c.effort } } : {}),
              ...(fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
            },
            { ...(signal ? { signal } : {}) },
          );
          // Append the whole response, unchanged.
          messages.push({ role: 'assistant', content: res.content as Anthropic.Beta.BetaContentBlockParam[] });
          const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
          const toolCalls = res.content.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: b.input }] : []));
          const u = res.usage;
          return {
            text,
            toolCalls,
            stop: stopOf(res.stop_reason),
            model: res.model,
            usage: {
              inputTokens: u.input_tokens ?? 0,
              outputTokens: u.output_tokens ?? 0,
              cachedInputTokens: u.cache_read_input_tokens ?? 0,
              cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
            },
          };
        },
      };
    },
  };
}

/** A readable message for an API error. */
export function anthropicError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'The API key was not accepted.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'This key may not use that model.';
  if (e instanceof Anthropic.NotFoundError) return 'Model not found.';
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited; try again shortly.';
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API.';
  if (e instanceof Anthropic.APIError) return `API error ${e.status ?? ''}: ${e.message}`;
  return (e as Error).message;
}
