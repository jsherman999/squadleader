/**
 * Google Gemini adapter (generateContent REST). Function calls come back
 * as functionCall parts; the model's content is appended unchanged (it can
 * carry thought signatures that must be returned), and results go back as
 * functionResponse parts.
 */
import type { AgentTurn, ChatProvider, Conversation, ConversationOptions, ModelInfo, StopKind, ToolResult } from '../types';

export interface GeminiOptions {
  readonly apiKey: string;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
}

interface Part {
  text?: string;
  functionCall?: { name: string; args?: unknown; id?: string };
  functionResponse?: { name: string; response: unknown; id?: string };
  thoughtSignature?: string;
  thought?: boolean;
}
interface Content {
  role: 'user' | 'model';
  parts: Part[];
}

/** Gemini's schema subset: drop keywords it rejects. */
function cleanSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(cleanSchema);
  if (!s || typeof s !== 'object') return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    if (k === 'additionalProperties' || k === '$schema') continue;
    out[k] = cleanSchema(v);
  }
  if (out.type === 'object' && out.properties && Object.keys(out.properties as object).length === 0) delete out.properties;
  return out;
}

function stopOf(r: string | undefined, hasCalls: boolean): StopKind {
  if (hasCalls) return 'tool_use';
  if (r === 'MAX_TOKENS') return 'max_tokens';
  if (r === 'SAFETY' || r === 'PROHIBITED_CONTENT' || r === 'BLOCKLIST') return 'refusal';
  return 'end';
}

export function geminiProvider(opts: GeminiOptions): ChatProvider {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const base = (opts.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  async function call(path: string, body: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const res = await doFetch(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
      ...(body ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 300);
      try {
        msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? msg;
      } catch {
        // keep the raw text
      }
      throw new Error(`gemini ${res.status}: ${msg}`);
    }
    return JSON.parse(text) as Record<string, unknown>;
  }
  return {
    id: 'gemini',
    async listModels(signal) {
      const r = await call('/models?pageSize=200', undefined, signal);
      const models = (r.models ?? []) as { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
      return models
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent') && m.name.includes('gemini'))
        .map((m): ModelInfo => ({ id: m.name.replace(/^models\//, ''), name: m.displayName ?? m.name }))
        .sort((a, b) => b.id.localeCompare(a.id));
    },
    conversation(c: ConversationOptions): Conversation {
      const contents: Content[] = [];
      const declarations = c.tools.map((t) => ({ name: t.name, description: t.description, parameters: cleanSchema(t.parameters) }));
      return {
        async send(input, signal): Promise<AgentTurn> {
          if (typeof input === 'string') contents.push({ role: 'user', parts: [{ text: input }] });
          else
            contents.push({
              role: 'user',
              parts: (input as readonly ToolResult[]).map((r) => ({ functionResponse: { name: r.name, response: r.isError ? { error: r.content } : { content: r.content }, ...(r.id.startsWith('call_') ? {} : { id: r.id }) } })),
            });
          const r = await call(
            `/models/${encodeURIComponent(c.model)}:generateContent`,
            {
              systemInstruction: { parts: [{ text: c.system }] },
              contents,
              tools: [{ functionDeclarations: declarations }],
              toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
              generationConfig: { maxOutputTokens: c.maxTokens },
            },
            signal,
          );
          const cand = ((r.candidates as unknown[]) ?? [])[0] as { content?: Content; finishReason?: string } | undefined;
          const parts = cand?.content?.parts ?? [];
          contents.push({ role: 'model', parts });
          let n = 0;
          const toolCalls = parts.flatMap((p) => (p.functionCall ? [{ id: p.functionCall.id ?? `call_${contents.length}_${n++}`, name: p.functionCall.name, input: p.functionCall.args ?? {} }] : []));
          const usage = (r.usageMetadata ?? {}) as { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number; thoughtsTokenCount?: number };
          const cached = usage.cachedContentTokenCount ?? 0;
          return {
            text: parts.flatMap((p) => (p.text && !p.thought ? [p.text] : [])).join('\n'),
            toolCalls,
            stop: stopOf(cand?.finishReason, toolCalls.length > 0),
            model: c.model,
            usage: { inputTokens: Math.max(0, (usage.promptTokenCount ?? 0) - cached), outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0), cachedInputTokens: cached, cacheWriteTokens: 0 },
          };
        },
      };
    },
  };
}
