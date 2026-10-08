import { loadConfig } from '../src/config';
import { azureChatUrl, bearerFrom, createProvider } from '../src/providers/factory';
import { ChatMessage } from '../src/providers/llm';
import { FetchFn } from '../src/providers/openai-compatible';
import { fixture } from './helpers';

function stubFetch(response: unknown, status = 200) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return { ok: status < 400, status, json: async () => response, text: async () => JSON.stringify(response) };
  };
  return { calls, fetchFn };
}

const wireReply = {
  choices: [
    {
      message: {
        content: null,
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup_order', arguments: '{"order_id":"RG-1042"}' } }],
      },
    },
  ],
  usage: { prompt_tokens: 321, completion_tokens: 12 },
};

const history: ChatMessage[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'where is RG-1042' },
  { role: 'assistant', content: null, toolCalls: [{ id: 'call_0', name: 'list_my_orders', arguments: '{}' }] },
  { role: 'tool', toolCallId: 'call_0', content: '{"ok":true}' },
];

const azureEnv = {
  LLM_PROVIDER: 'azure',
  AZURE_OPENAI_ENDPOINT: 'https://my-aoai.openai.azure.com/',
  AZURE_OPENAI_DEPLOYMENT: 'support-agent',
  AZURE_OPENAI_API_VERSION: '2024-10-21',
};

describe('Azure OpenAI provider', () => {
  it('calls the deployment URL with an api-key and the OpenAI tools wire format', async () => {
    const { calls, fetchFn } = stubFetch(wireReply);
    const provider = createProvider(loadConfig({ ...azureEnv, AZURE_OPENAI_API_KEY: 'k-123' }), { fetchFn });
    const r = await provider.complete(history, fixture().runner.specs());

    expect(calls[0].url).toBe('https://my-aoai.openai.azure.com/openai/deployments/support-agent/chat/completions?api-version=2024-10-21');
    expect(calls[0].headers['api-key']).toBe('k-123');
    expect(calls[0].headers.authorization).toBeUndefined();
    expect(calls[0].body.model).toBeUndefined();
    expect(calls[0].body.temperature).toBe(0);
    expect((calls[0].body.tools as { function: { name: string } }[]).map((t) => t.function.name)).toContain('request_refund');
    expect(calls[0].body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'where is RG-1042' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_0', type: 'function', function: { name: 'list_my_orders', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_0', content: '{"ok":true}' },
    ]);
    expect(r).toEqual({
      content: null,
      toolCalls: [{ id: 'call_1', name: 'lookup_order', arguments: '{"order_id":"RG-1042"}' }],
      usage: { inputTokens: 321, outputTokens: 12 },
    });
  });

  it('uses a cached Entra ID token when no api-key is configured', async () => {
    const { calls, fetchFn } = stubFetch(wireReply);
    let issued = 0;
    const tokenSource = {
      getToken: async (scope: string) => {
        expect(scope).toBe('https://cognitiveservices.azure.com/.default');
        issued++;
        return { token: `tok-${issued}`, expiresOnTimestamp: Date.now() + 60 * 60_000 };
      },
    };
    const provider = createProvider(loadConfig(azureEnv), { fetchFn, tokenSource });
    await provider.complete(history, []);
    await provider.complete(history, []);
    expect(issued).toBe(1);
    expect(calls.map((c) => c.headers.authorization)).toEqual(['Bearer tok-1', 'Bearer tok-1']);
    expect(calls[0].headers['api-key']).toBeUndefined();
  });

  it('refreshes the token shortly before it expires', async () => {
    let t = 0;
    let issued = 0;
    const headers = bearerFrom(
      { getToken: async () => ({ token: `tok-${++issued}`, expiresOnTimestamp: t + 10 * 60_000 }) },
      () => t,
    );
    await headers();
    t += 4 * 60_000;
    expect(await headers()).toEqual({ authorization: 'Bearer tok-1' });
    t += 2 * 60_000;
    expect(await headers()).toEqual({ authorization: 'Bearer tok-2' });
  });

  it('surfaces HTTP errors with the status code', async () => {
    const { fetchFn } = stubFetch({ error: { message: 'content filter' } }, 400);
    const provider = createProvider(loadConfig({ ...azureEnv, AZURE_OPENAI_API_KEY: 'k' }), { fetchFn });
    await expect(provider.complete(history, [])).rejects.toThrow('HTTP 400');
  });

  it('builds the URL without double slashes and escapes the deployment', () => {
    expect(azureChatUrl('https://x.openai.azure.com//', 'gpt 4o', '2024-10-21')).toBe(
      'https://x.openai.azure.com/openai/deployments/gpt%204o/chat/completions?api-version=2024-10-21',
    );
  });
});

describe('Ollama provider', () => {
  it('sends the model name and normalizes object arguments to JSON strings', async () => {
    const reply = {
      choices: [{ message: { content: '', tool_calls: [{ id: 'c', type: 'function', function: { name: 'search_kb', arguments: { query: 'ship' } } }] } }],
    };
    const { calls, fetchFn } = stubFetch(reply);
    const provider = createProvider(loadConfig({ LLM_PROVIDER: 'ollama' }), { fetchFn });
    const r = await provider.complete(history, []);
    expect(calls[0].url).toBe('http://localhost:11434/v1/chat/completions');
    expect(calls[0].body.model).toBe('qwen2.5:7b');
    expect(r.toolCalls[0].arguments).toBe('{"query":"ship"}');
    expect(r.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

describe('config', () => {
  it('requires the Azure settings when the azure provider is selected', () => {
    expect(() => loadConfig({ LLM_PROVIDER: 'azure' })).toThrow('AZURE_OPENAI_ENDPOINT');
  });

  it('parses history and prices', () => {
    expect(loadConfig({ AGENT_HISTORY_TURNS: 'all' }).AGENT_HISTORY_TURNS).toBeNull();
    expect(loadConfig({}).AGENT_HISTORY_TURNS).toBe(6);
    expect(loadConfig({ PRICE_INPUT_PER_1M: '2.5' }).PRICE_INPUT_PER_1M).toBe(2.5);
    expect(loadConfig({}).PRICE_INPUT_PER_1M).toBeUndefined();
    expect(() => loadConfig({ PRICE_INPUT_PER_1M: '-1' })).toThrow('invalid configuration');
    expect(() => loadConfig({ ADMIN_API_KEY: 'short' })).toThrow('invalid configuration');
  });
});
