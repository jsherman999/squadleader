/**
 * A scripted provider for tests: a function decides each reply from the
 * transcript so far (first message or the latest tool results).
 */
import type { AgentTurn, ChatProvider, Conversation, ConversationOptions, ToolCall, ToolResult, Usage } from '../types';

export interface MockStep {
  readonly text?: string;
  readonly calls?: readonly Omit<ToolCall, 'id'>[];
  readonly refuse?: boolean;
  readonly fail?: string;
}

export type MockBrain = (input: string | readonly ToolResult[], round: number, opts: ConversationOptions) => MockStep;

const USAGE: Usage = { inputTokens: 1000, outputTokens: 200, cachedInputTokens: 3000, cacheWriteTokens: 0 };

export function mockProvider(brain: MockBrain): ChatProvider & { conversations: number } {
  const p = {
    id: 'mock' as const,
    conversations: 0,
    async listModels() {
      return [{ id: 'mock-1', name: 'Mock model' }];
    },
    conversation(opts: ConversationOptions): Conversation {
      p.conversations++;
      let round = 0;
      let n = 0;
      return {
        async send(input): Promise<AgentTurn> {
          const step = brain(input, round++, opts);
          if (step.fail) throw new Error(step.fail);
          const toolCalls = (step.calls ?? []).map((c) => ({ ...c, id: `t${n++}` }));
          return { text: step.text ?? '', toolCalls, stop: step.refuse ? 'refusal' : toolCalls.length ? 'tool_use' : 'end', usage: USAGE, model: opts.model };
        },
      };
    },
  };
  return p;
}
