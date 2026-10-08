import { ToolSpec } from '../tools/tools';
import { ChatMessage, LlmProvider, LlmResponse } from './llm';

/** Replays a fixed list of responses and records what it was sent. For unit tests. */
export class ScriptedProvider implements LlmProvider {
  readonly name = 'scripted';
  readonly model = 'scripted';
  readonly calls: ChatMessage[][] = [];
  private i = 0;

  constructor(private readonly script: (LlmResponse | ((messages: ChatMessage[]) => LlmResponse))[]) {}

  async complete(messages: ChatMessage[]): Promise<LlmResponse> {
    this.calls.push(structuredClone(messages));
    const step = this.script[Math.min(this.i++, this.script.length - 1)];
    return typeof step === 'function' ? step(messages) : step;
  }
}

const ORDER_ID = /\bRG-\d{3,5}\b/i;
const AMOUNT = /\$\s?(\d+(?:\.\d{1,2})?)/;

/**
 * Keyword rules that imitate a tool-calling model, so the app and the eval harness run with
 * no model at all. It is a baseline for the wiring, not a stand-in for real model behaviour.
 */
export class RuleBasedProvider implements LlmProvider {
  readonly name = 'fake';
  readonly model = 'rule-based';

  async complete(messages: ChatMessage[], _tools: ToolSpec[]): Promise<LlmResponse> {
    const last = messages[messages.length - 1];
    const usage = { inputTokens: messages.reduce((n, m) => n + Math.ceil((m.content ?? '').length / 4), 0), outputTokens: 20 };

    if (last.role === 'tool') {
      const results = trailingToolResults(messages);
      const failed = results.find((r) => !r.ok);
      const text = failed
        ? `I couldn't complete that: ${failed.error}`
        : `Done. ${results.map((r) => summarize(r.data)).join(' ')}`;
      return { content: text, toolCalls: [], usage };
    }

    const user = last.role === 'user' ? last.content : '';
    const order = user.match(ORDER_ID)?.[0]?.toUpperCase();
    const call = (name: string, args: Record<string, unknown>): LlmResponse => ({
      content: null,
      toolCalls: [{ id: `fake-${messages.length}`, name, arguments: JSON.stringify(args) }],
      usage,
    });

    if (/\b(refund|money back|return)\b/i.test(user) && order) {
      const amount = Number(user.match(AMOUNT)?.[1] ?? NaN);
      if (Number.isFinite(amount)) return call('request_refund', { order_id: order, amount, reason: user.slice(0, 200) });
      return call('lookup_order', { order_id: order });
    }
    if (/\b(broken|defect|warranty|lost|never arrived)\b/i.test(user)) {
      return call('create_ticket', { category: /lost|never arrived/i.test(user) ? 'shipping' : 'warranty', summary: user.slice(0, 200), ...(order ? { order_id: order } : {}) });
    }
    if (order) return call('lookup_order', { order_id: order });
    if (/\bmy orders\b/i.test(user)) return call('list_my_orders', {});
    if (/\b(policy|ship|shipping|warranty|password|return|canada|express)\b/i.test(user)) return call('search_kb', { query: user });
    return { content: 'Could you share your order number (it looks like RG-1234)?', toolCalls: [], usage };
  }
}

function trailingToolResults(messages: ChatMessage[]): { ok: boolean; data?: unknown; error?: string }[] {
  const out = [];
  for (let i = messages.length - 1; i >= 0 && messages[i].role === 'tool'; i--) {
    try {
      out.unshift(JSON.parse(messages[i].content as string));
    } catch {
      out.unshift({ ok: false, error: 'unreadable tool result' });
    }
  }
  return out;
}

function summarize(data: unknown): string {
  const s = JSON.stringify(data);
  return s.length > 300 ? `${s.slice(0, 300)}…` : s;
}
