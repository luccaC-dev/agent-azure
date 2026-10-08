import { Agent, Conversation, FALLBACK_TEXT, trimHistory } from '../src/agent/agent';
import { ScriptedProvider } from '../src/providers/fake';
import { ChatMessage, LlmResponse } from '../src/providers/llm';
import { fixture } from './helpers';

const usage = { inputTokens: 1000, outputTokens: 100 };
const toolCall = (name: string, args: unknown, id = 'c1'): LlmResponse => ({
  content: null,
  toolCalls: [{ id, name, arguments: typeof args === 'string' ? args : JSON.stringify(args) }],
  usage,
});
const answer = (text: string): LlmResponse => ({ content: text, toolCalls: [], usage });
const conv = (): Conversation => ({ id: 'conv-1', customerId: 'C-100', customerName: 'Maya', messages: [] });

function agentWith(script: ConstructorParameters<typeof ScriptedProvider>[0], over: Partial<ConstructorParameters<typeof Agent>[2]> = {}) {
  const f = fixture();
  const provider = new ScriptedProvider(script);
  const logs: Record<string, unknown>[] = [];
  const agent = new Agent(provider, f.runner, {
    maxSteps: 4,
    historyTurns: 2,
    pricing: { inputPer1M: 2, outputPer1M: 8 },
    log: (l) => logs.push(l),
    clock: f.clock,
    ...over,
  });
  return { f, provider, agent, logs };
}

describe('agent loop', () => {
  it('runs a tool, feeds the result back, and answers', async () => {
    const { agent, provider } = agentWith([toolCall('lookup_order', { order_id: 'RG-1043' }), answer('It shipped with UPS on Oct 6.')]);
    const c = conv();
    const r = await agent.reply(c, 'Where is RG-1043?');

    expect(r.text).toBe('It shipped with UPS on Oct 6.');
    expect(r.stoppedReason).toBe('answered');
    expect(r.toolCalls).toEqual([{ name: 'lookup_order', ok: true }]);
    expect(r.usage).toEqual({ inputTokens: 2000, outputTokens: 200 });
    expect(r.costUsd).toBeCloseTo((2000 * 2 + 200 * 8) / 1e6, 9);

    const second = provider.calls[1];
    const toolMsg = second[second.length - 1] as Extract<ChatMessage, { role: 'tool' }>;
    expect(toolMsg.role).toBe('tool');
    expect(toolMsg.toolCallId).toBe('c1');
    expect(toolMsg.content).toContain('1Z-DEMO-0001043');
    expect(c.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
  });

  it('returns tool errors to the model instead of failing', async () => {
    const { agent, provider } = agentWith([
      toolCall('lookup_order', '{"order_id": '),
      toolCall('cancel_everything', {}, 'c2'),
      answer('Could you confirm the order number?'),
    ]);
    const r = await agent.reply(conv(), 'help');
    expect(r.toolCalls).toEqual([
      { name: 'lookup_order', ok: false, error: 'arguments were not valid JSON' },
      { name: 'cancel_everything', ok: false, error: expect.stringContaining('unknown tool') },
    ]);
    const third = provider.calls[2];
    expect(third[third.length - 1].content).toContain('unknown tool');
    expect(r.stoppedReason).toBe('answered');
  });

  it('stops at maxSteps with a safe fallback', async () => {
    const { agent } = agentWith([toolCall('list_my_orders', {})], { maxSteps: 3 });
    const r = await agent.reply(conv(), 'loop forever');
    expect(r.steps).toBe(3);
    expect(r.stoppedReason).toBe('max_steps');
    expect(r.text).toBe(FALLBACK_TEXT);
  });

  it('survives a provider outage', async () => {
    const f = fixture();
    const agent = new Agent({ name: 'down', model: 'x', complete: async () => { throw new Error('503'); } }, f.runner, {
      maxSteps: 3,
      historyTurns: null,
      pricing: {},
    });
    const r = await agent.reply(conv(), 'hi');
    expect(r.stoppedReason).toBe('provider_error');
    expect(r.costUsd).toBeNull();
  });

  it('a refund conversation ends in a pending approval, never an executed refund', async () => {
    const { agent, f } = agentWith([
      toolCall('request_refund', { order_id: 'RG-1042', amount: 189, reason: 'unused' }),
      answer('I sent your refund request for review.'),
    ]);
    await agent.reply(conv(), 'refund RG-1042');
    expect(f.approvals.list('pending')).toHaveLength(1);
    expect(f.store.orderFor('C-100', 'RG-1042')!.refunded).toBe(0);
  });

  it('only exposes read, ticket and request tools; nothing can approve', () => {
    const { f } = agentWith([]);
    expect(f.runner.specs().map((s) => s.name).sort()).toEqual(
      ['create_ticket', 'list_my_orders', 'lookup_order', 'request_refund', 'search_kb'].sort(),
    );
  });

  it('sends only the last N user turns back to the model', async () => {
    const { agent, provider } = agentWith([answer('ok')], { historyTurns: 2 });
    const c = conv();
    for (const q of ['first', 'second', 'third', 'fourth']) await agent.reply(c, q);
    const sent = provider.calls[3].filter((m) => m.role === 'user').map((m) => m.content);
    expect(sent).toEqual(['second', 'third', 'fourth']);
    expect(c.messages.filter((m) => m.role === 'user')).toHaveLength(4);
  });

  it('logs metrics but never message text or raw conversation ids', async () => {
    const { agent, logs } = agentWith([answer('hello there')]);
    await agent.reply({ ...conv(), id: '+15550100100' }, 'my secret question');
    const line = JSON.stringify(logs);
    expect(line).not.toContain('secret');
    expect(line).not.toContain('+15550100100');
    expect(logs[0]).toMatchObject({ event: 'agent_turn', steps: 1, input_tokens: 1000 });
  });
});

describe('trimHistory', () => {
  const m = (role: 'user' | 'assistant', content: string): ChatMessage => ({ role, content });
  const history: ChatMessage[] = [
    m('user', 'a'),
    { role: 'assistant', content: null, toolCalls: [{ id: 't', name: 'x', arguments: '{}' }] },
    { role: 'tool', toolCallId: 't', content: '{}' },
    m('assistant', 'A'),
    m('user', 'b'),
    m('assistant', 'B'),
  ];
  it('cuts on user boundaries', () => {
    expect(trimHistory(history, 1).map((x) => x.content)).toEqual(['b', 'B']);
    expect(trimHistory(history, 2)).toHaveLength(6);
    expect(trimHistory(history, 0)).toEqual([]);
    expect(trimHistory(history, null)).toBe(history);
  });
});
