import { AppConfig } from '../config';
import { RuleBasedProvider } from './fake';
import { LlmProvider } from './llm';
import { FetchFn, OpenAiCompatibleProvider } from './openai-compatible';

export const AZURE_SCOPE = 'https://cognitiveservices.azure.com/.default';

export interface TokenSource {
  getToken(scope: string): Promise<{ token: string; expiresOnTimestamp: number } | null>;
}

/** Caches an Entra ID token until five minutes before it expires. */
export function bearerFrom(source: TokenSource, now = () => Date.now()): () => Promise<Record<string, string>> {
  let cached: { token: string; expiresOnTimestamp: number } | null = null;
  return async () => {
    if (!cached || cached.expiresOnTimestamp - now() < 5 * 60_000) {
      cached = await source.getToken(AZURE_SCOPE);
      if (!cached) throw new Error('could not get a Microsoft Entra ID token for Azure OpenAI');
    }
    return { authorization: `Bearer ${cached.token}` };
  };
}

export function azureChatUrl(endpoint: string, deployment: string, apiVersion: string): string {
  const base = endpoint.replace(/\/+$/, '');
  return `${base}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
}

export function createProvider(cfg: AppConfig, deps: { fetchFn?: FetchFn; tokenSource?: TokenSource } = {}): LlmProvider {
  switch (cfg.LLM_PROVIDER) {
    case 'fake':
      return new RuleBasedProvider();
    case 'ollama':
      return new OpenAiCompatibleProvider({
        name: 'ollama',
        model: cfg.OLLAMA_MODEL,
        url: `${cfg.OLLAMA_HOST.replace(/\/+$/, '')}/v1/chat/completions`,
        headers: async () => ({}),
        sendModel: true,
        timeoutMs: 180_000,
        fetchFn: deps.fetchFn,
      });
    case 'azure': {
      const key = cfg.AZURE_OPENAI_API_KEY;
      const headers = key
        ? async () => ({ 'api-key': key })
        : bearerFrom(deps.tokenSource ?? defaultAzureCredential());
      return new OpenAiCompatibleProvider({
        name: 'azure-openai',
        model: cfg.AZURE_OPENAI_DEPLOYMENT!,
        url: azureChatUrl(cfg.AZURE_OPENAI_ENDPOINT!, cfg.AZURE_OPENAI_DEPLOYMENT!, cfg.AZURE_OPENAI_API_VERSION!),
        headers,
        sendModel: false,
        fetchFn: deps.fetchFn,
      });
    }
  }
}

function defaultAzureCredential(): TokenSource {
  // Loaded lazily so local runs with the fake or Ollama provider never touch Azure auth.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DefaultAzureCredential } = require('@azure/identity') as typeof import('@azure/identity');
  return new DefaultAzureCredential();
}
