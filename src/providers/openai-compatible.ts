import { ToolSpec } from '../tools/tools';
import { ChatMessage, LlmProvider, LlmResponse } from './llm';

export type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

interface WireToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string | Record<string, unknown> };
}

interface WireResponse {
  choices: { message: { content: string | null; tool_calls?: WireToolCall[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface OpenAiCompatibleOptions {
  name: string;
  model: string;
  url: string;
  /** Called per request so short-lived tokens (managed identity) are refreshed. */
  headers: () => Promise<Record<string, string>>;
  /** Some backends (Ollama) need the model in the body; Azure routes by deployment in the URL. */
  sendModel: boolean;
  temperature?: number;
  timeoutMs?: number;
  fetchFn?: FetchFn;
}

/** Chat Completions with tools. Azure OpenAI and Ollama both speak this wire format. */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name: string;
  readonly model: string;

  constructor(private readonly opts: OpenAiCompatibleOptions) {
    this.name = opts.name;
    this.model = opts.model;
  }

  async complete(messages: ChatMessage[], tools: ToolSpec[]): Promise<LlmResponse> {
    const body: Record<string, unknown> = {
      messages: messages.map(toWire),
      tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
      tool_choice: 'auto',
      temperature: this.opts.temperature ?? 0,
    };
    if (this.opts.sendModel) body.model = this.model;

    const fetchFn = this.opts.fetchFn ?? (fetch as unknown as FetchFn);
    const res = await fetchFn(this.opts.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await this.opts.headers()) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 60_000),
    });
    if (!res.ok) {
      throw new Error(`${this.name} returned HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const data = (await res.json()) as WireResponse;
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error(`${this.name} returned no choices`);
    return {
      content: msg.content ?? null,
      toolCalls: (msg.tool_calls ?? []).map((c) => ({
        id: c.id,
        name: c.function.name,
        arguments: typeof c.function.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function.arguments),
      })),
      usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
    };
  }
}

function toWire(m: ChatMessage): Record<string, unknown> {
  switch (m.role) {
    case 'tool':
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    case 'assistant':
      return {
        role: 'assistant',
        content: m.content,
        ...(m.toolCalls?.length
          ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) }
          : {}),
      };
    default:
      return { role: m.role, content: m.content };
  }
}
