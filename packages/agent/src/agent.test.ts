import { describe, expect, it } from 'vitest';
import { decide as botDecide, type Rationale } from '@squadwar/bot';
import { createGame, tryAction, type Action, type GameState } from '@squadwar/engine';
import { invariants, scenarioCtx } from '../../bot/src/selfplay';
import { decide, newSpend, type Spend } from './agent';
import { actionToOrder, type GameEnv, type Order } from './orders';
import { anthropicProvider, geminiProvider, mockProvider, openAIProvider, type MockBrain } from './providers';
import { playPhase } from './runner';
import { standingFire } from './standing';
import { newMemory, runTool } from './tools';
import type { LlmConfig, ToolResult } from './types';

const ctx = scenarioCtx(0);

function engineEnv(seed: number): GameEnv & { notes: (Rationale | undefined)[] } {
  let s = createGame(ctx, seed).state;
  const notes: (Rationale | undefined)[] = [];
  return {
    ctx,
    notes,
    state: () => s,
    apply(a: Action, note?: Rationale) {
      const r = tryAction(ctx, s, a);
      if (!r.ok) return { ok: false, error: r.error };
      s = r.state;
      notes.push(note);
      return { ok: true, events: r.events };
    },
  };
}

const CONFIG: LlmConfig = { provider: 'mock', model: 'claude-haiku-5-5', persona: 'balanced', effort: 'low', budgetUsd: 100, economy: false };

/** Advance the game with the bot until `side` must decide in a phase the LLM plays. */
function botUntil(env: GameEnv, pred: (s: GameState) => boolean, limit = 3000): void {
  for (let i = 0; i < limit && !pred(env.state()) && env.state().phase !== 'gameOver'; i++) {
    const d = botDecide(ctx, env.state());
    if (!env.apply(d.action, d.why).ok) env.apply({ type: 'endPhase' });
  }
}

/** A mock "LLM" that plays like the scripted AI: it reads the bot's choices and submits them as orders. */
function botLikeBrain(env: GameEnv, side: string): MockBrain {
  return (input) => {
    if (typeof input !== 'string') {
      // After orders: finish the phase (and keep finishing if refused).
      return { calls: [{ name: 'end_phase', input: { summary: 'Done', radio: 'Moving up.' } }] };
    }
    let sim = env.state();
    const start = sim.phase;
    const orders: Order[] = [];
    for (let i = 0; i < 300 && sim.awaiting === side && sim.phase === start; i++) {
      const d = botDecide(ctx, sim);
      if (d.action.type === 'endPhase') break;
      const r = tryAction(ctx, sim, d.action);
      if (!r.ok) break;
      sim = r.state;
      const o = actionToOrder(ctx, d.action);
      if (!o) continue;
      const last = orders[orders.length - 1];
      const same = (a?: readonly string[], b?: readonly string[]) => !!a && !!b && a.length === b.length && a.every((x) => b.includes(x));
      if (o.type === 'move' && last?.type === 'move' && same(last.units, o.units)) {
        orders[orders.length - 1] = { ...last, path: [...(last.path ?? []), ...(o.path ?? [])] };
        continue;
      }
      if (o.type === 'end_move' && last?.type === 'move' && same(last.units, o.units)) continue;
      orders.push({ ...o, goal: d.why.goal, reason: d.why.reasons[0] ?? '' });
    }
    return {
      text: 'Following the staff plan.',
      calls: [{ name: 'list_options', input: {} }, ...(orders.length ? [{ name: 'submit_orders', input: { orders } }] : [{ name: 'end_phase', input: { summary: 'Nothing to do' } }])],
    };
  };
}

describe('LLM opponent with a mock provider', () => {
  it('plays a full game of scenario 1 against the scripted AI', async () => {
    const env = engineEnv(21);
    const side = 'ger';
    const provider = mockProvider(botLikeBrain(env, side));
    const memory = newMemory();
    const spend = newSpend();
    let llmPhases = 0;
    let fallbacks = 0;
    for (let i = 0; i < 5000 && env.state().phase !== 'gameOver'; i++) {
      const s = env.state();
      if (s.awaiting === side) {
        const r = await playPhase({ provider, config: CONFIG, env, side, memory, spend });
        if (r.by === 'llm') llmPhases++;
        if (r.fallback) fallbacks++;
      } else {
        const d = botDecide(ctx, s);
        if (!env.apply(d.action, d.why).ok) env.apply({ type: 'endPhase' });
      }
      expect(invariants(ctx, env.state())).toEqual([]);
    }
    expect(env.state().phase).toBe('gameOver');
    expect(llmPhases).toBeGreaterThan(15);
    expect(fallbacks).toBeLessThan(llmPhases / 3);
    expect(spend.calls).toBeGreaterThan(llmPhases);
    expect(spend.usd).toBeGreaterThan(0);
    // Orders carry the model's goals, for the tutor.
    expect(env.notes.filter((n) => n?.weight === 'key').length).toBeGreaterThan(20);
    expect(memory.radio.length).toBeGreaterThan(0);
  });

  it('repairs refused orders: the error names the rule, the model retries', async () => {
    const env = engineEnv(5);
    botUntil(env, (s) => s.awaiting === 'ger' && s.phase === 'prepFire');
    const side = 'ger';
    const seen: string[] = [];
    const good = botLikeBrain(env, side);
    const provider = mockProvider((input, round, opts) => {
      if (round === 0) return { calls: [{ name: 'submit_orders', input: { orders: [{ type: 'fire', units: ['nope'], target: 'A-ZZ99', goal: 'test' }] } }] };
      if (round === 1) {
        seen.push((input as readonly ToolResult[])[0]!.content);
        return { calls: [{ name: 'submit_orders', input: { orders: [{ type: 'move', units: Object.values(env.state().units).filter((u) => u.side === side).map((u) => u.id).slice(0, 1), path: ['A-A1'], goal: 'move in prep fire' }] } }] };
      }
      if (round === 2) {
        seen.push((input as readonly ToolResult[])[0]!.content);
        return good('start', 0, opts);
      }
      return good(input, round, opts);
    });
    const r = await decide({ provider, config: CONFIG, env, side, memory: newMemory(), spend: newSpend() });
    expect(seen[0]).toMatch(/REFUSED.*not your units/);
    expect(seen[1]).toMatch(/REFUSED/);
    expect(seen[1]).toMatch(/§/); // the engine's rule reference comes back
    expect(r.ended).toBe(true);
    expect(r.fallback).toBeUndefined();
  });

  it('hands the phase to the scripted AI after too many refusals, on errors, refusals and over budget', async () => {
    for (const [brain, reason] of [
      [() => ({ calls: [{ name: 'submit_orders', input: { orders: [{ type: 'rally', unit: 'x', goal: 'bad' }] } }] }), 'repairs'],
      [() => ({ fail: 'network down' }), 'error'],
      [() => ({ refuse: true }), 'refusal'],
    ] as [MockBrain, string][]) {
      const env = engineEnv(6);
      botUntil(env, (s) => s.awaiting === 'ger' && s.phase === 'prepFire');
      const before = env.state().phase;
      const r = await playPhase({ provider: mockProvider(brain), config: CONFIG, env, side: 'ger', memory: newMemory(), spend: newSpend() });
      expect(r.fallback).toBe(reason);
      expect(r.by).toBe('bot');
      // The game moved on anyway.
      expect(env.state().phase !== before || env.state().awaiting !== 'ger').toBe(true);
    }
    const env = engineEnv(6);
    botUntil(env, (s) => s.awaiting === 'ger' && s.phase === 'prepFire');
    const spend: Spend = { ...newSpend(), usd: 5 };
    const r = await playPhase({ provider: mockProvider(() => ({})), config: { ...CONFIG, budgetUsd: 5 }, env, side: 'ger', memory: newMemory(), spend });
    expect(r.fallback).toBe('budget');
  });

  it('runs Defensive Fire from standing orders without calling the model (economy)', async () => {
    const env = engineEnv(8);
    // Soviets defend: get to their Defensive Fire after German movement.
    botUntil(env, (s) => s.awaiting === 'rus' && s.phase === 'defensiveFire');
    const memory = newMemory();
    memory.standing = [{ units: 'all', openOnly: false, maxRange: 16, minExpected: 0.1, normalRangeOnly: false }];
    const provider = mockProvider(() => ({ fail: 'should not be called' }));
    const expected = standingFire(ctx, env.state(), 'rus', memory.standing);
    const r = await playPhase({ provider, config: { ...CONFIG, economy: true }, env, side: 'rus', memory, spend: newSpend() });
    expect(r.by).toBe('standing');
    expect(provider.conversations).toBe(0);
    if (expected) expect(env.notes.some((n) => n?.goal.startsWith('Standing order'))).toBe(true);
    expect(env.state().phase).not.toBe('defensiveFire');
  });

  it('tools describe the game from the side’s point of view', () => {
    const env = engineEnv(3);
    botUntil(env, (s) => s.awaiting === 'ger' && s.phase === 'movement');
    const mem = newMemory();
    const sit = runTool(env, 'ger', mem, { id: '1', name: 'get_situation', input: {} }).content;
    expect(sit).toMatch(/YOUR UNITS/);
    expect(sit).toMatch(/ENEMY UNITS/);
    expect(sit).toMatch(/A-[A-Z]+\d/);
    const mine = Object.values(env.state().units).find((u) => u.side === 'ger')!;
    const pv = runTool(env, 'ger', mem, { id: '2', name: 'preview_move', input: { units: [mine.id], path: [] } });
    expect(pv.content).toMatch(/MF/);
    const los = runTool(env, 'ger', mem, { id: '3', name: 'check_los', input: { from: 'A-X5', to: 'A-Y2' } });
    expect(los.content).toMatch(/CLEAR|BLOCKED/);
    const opts = runTool(env, 'ger', mem, { id: '4', name: 'list_options', input: {} });
    expect(opts.content).toMatch(/SCRIPTED AI WOULD/);
  });
});

/** A fake fetch that records requests and replies in turn. */
function fakeFetch(replies: unknown[]) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const f = async (url: string | URL | Request, init?: RequestInit) => {
    const h: Record<string, string> = {};
    new Headers(init?.headers as HeadersInit).forEach((v, k) => (h[k] = v));
    calls.push({ url: String(url), headers: h, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {} });
    return new Response(JSON.stringify(replies[Math.min(calls.length - 1, replies.length - 1)]), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: f as unknown as typeof fetch, calls };
}

const TOOLS_FOR_TEST = [{ name: 'get_situation', description: 'x', parameters: { type: 'object', properties: {}, required: [] } }];
const CONV = { model: 'claude-opus-5-5', system: 'SYSTEM', tools: TOOLS_FOR_TEST, effort: 'high' as const, maxTokens: 1000 };

describe('provider adapters', () => {
  it('Anthropic: cached prefix, explicit effort, fallbacks, append-only tool loop', async () => {
    const reply = {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'tool_use', id: 'toolu_1', name: 'get_situation', input: {} },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 },
    };
    const ff = fakeFetch([reply, { ...reply, content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' }]);
    const p = anthropicProvider({ apiKey: 'test', fetch: ff.fetch });
    const conv = p.conversation(CONV);
    const t1 = await conv.send('hello');
    expect(t1.toolCalls).toEqual([{ id: 'toolu_1', name: 'get_situation', input: {} }]);
    expect(t1.usage).toEqual({ inputTokens: 100, outputTokens: 20, cachedInputTokens: 50, cacheWriteTokens: 10 });
    const b1 = ff.calls[0]!.body;
    expect(b1.model).toBe('claude-opus-5-5');
    expect((b1.system as { cache_control?: unknown }[])[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(b1.output_config).toEqual({ effort: 'high' });
    expect(b1.fallbacks).toBe('default');
    expect(b1.tool_choice).toEqual({ type: 'auto' });
    expect(b1.thinking).toBeUndefined();
    expect(ff.calls[0]!.headers['anthropic-beta']).toMatch(/server-side-fallback-2026-07-01/);
    const t2 = await conv.send([{ id: 'toolu_1', name: 'get_situation', content: 'SIT' }]);
    expect(t2.stop).toBe('end');
    const msgs = ff.calls[1]!.body.messages as { role: string; content: { type: string }[] }[];
    // The assistant turn went back unchanged (thinking block included), then the tool result.
    expect(msgs[1]!.content.map((c) => c.type)).toEqual(['thinking', 'tool_use']);
    expect(msgs[2]!.content[0]!.type).toBe('tool_result');
  });

  it('OpenAI-compatible: tool_calls out, role "tool" results back, cached tokens split', async () => {
    const ff = fakeFetch([
      {
        model: 'gpt-x',
        choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_situation', arguments: '{}' } }] }, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 120, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 100 } },
      },
      { model: 'gpt-x', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } },
    ]);
    const p = openAIProvider({ id: 'openrouter', apiKey: 'k', baseUrl: 'https://example.test/v1', fetch: ff.fetch });
    const conv = p.conversation({ ...CONV, model: 'some/model' });
    const t1 = await conv.send('hi');
    expect(t1.toolCalls[0]).toEqual({ id: 'c1', name: 'get_situation', input: {} });
    expect(t1.usage.inputTokens).toBe(20);
    expect(t1.usage.cachedInputTokens).toBe(100);
    expect(ff.calls[0]!.headers.authorization).toBe('Bearer k');
    await conv.send([{ id: 'c1', name: 'get_situation', content: 'SIT' }]);
    const msgs = ff.calls[1]!.body.messages as { role: string; tool_call_id?: string }[];
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(msgs[3]!.tool_call_id).toBe('c1');
  });

  it('Gemini: functionCall parts out, functionResponse back, model content kept', async () => {
    const ff = fakeFetch([
      { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'get_situation', args: {} }, thoughtSignature: 'abc' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 5 } },
      { candidates: [{ content: { role: 'model', parts: [{ text: 'done' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 60, candidatesTokenCount: 2 } },
    ]);
    const p = geminiProvider({ apiKey: 'g', fetch: ff.fetch });
    const conv = p.conversation({ ...CONV, model: 'gemini-x' });
    const t1 = await conv.send('hi');
    expect(t1.toolCalls[0]!.name).toBe('get_situation');
    expect(ff.calls[0]!.url).toMatch(/models\/gemini-x:generateContent$/);
    expect(ff.calls[0]!.headers['x-goog-api-key']).toBe('g');
    await conv.send([{ id: t1.toolCalls[0]!.id, name: 'get_situation', content: 'SIT' }]);
    const contents = ff.calls[1]!.body.contents as { role: string; parts: Record<string, unknown>[] }[];
    expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(contents[1]!.parts[0]!.thoughtSignature).toBe('abc');
    expect(contents[2]!.parts[0]!.functionResponse).toBeDefined();
  });
});
