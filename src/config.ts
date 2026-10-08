import { z } from 'zod';

const optionalNumber = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : Number(v)))
  .refine((v) => v === undefined || (Number.isFinite(v) && v >= 0), 'must be a non-negative number');

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  LLM_PROVIDER: z.enum(['fake', 'ollama', 'azure']).default('fake'),

  OLLAMA_HOST: z.string().url().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('qwen2.5:7b'),

  AZURE_OPENAI_ENDPOINT: z.string().url().optional(),
  AZURE_OPENAI_DEPLOYMENT: z.string().optional(),
  AZURE_OPENAI_API_VERSION: z.string().optional(),
  /** If unset, the app authenticates with Microsoft Entra ID (managed identity in Azure, az login locally). */
  AZURE_OPENAI_API_KEY: z.string().optional(),

  /** USD per 1M tokens for your model. Unset = cost reported as null. */
  PRICE_INPUT_PER_1M: optionalNumber,
  PRICE_OUTPUT_PER_1M: optionalNumber,

  AGENT_MAX_STEPS: z.coerce.number().int().min(1).max(20).default(6),
  /** Past user turns sent back to the model, or "all". */
  AGENT_HISTORY_TURNS: z
    .string()
    .default('6')
    .transform((v) => (v === 'all' ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0), 'must be a non-negative integer or "all"'),

  /** Required on /v1/conversations if set. The caller is a trusted backend that identifies the customer. */
  CHAT_API_KEY: z.string().optional(),
  /** Admin routes (refund approvals) are disabled until this is set. */
  ADMIN_API_KEY: z.string().min(16).optional(),

  TWILIO_AUTH_TOKEN: z.string().optional(),
  /** Public URL Twilio calls, e.g. https://agent.example.com. Used to verify signatures behind a proxy. */
  PUBLIC_BASE_URL: z.string().url().optional(),

  /** "data" pins "today" to the dataset's asOf date so the demo orders stay inside the return window. */
  CLOCK: z.enum(['data', 'system']).default('data'),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // An empty variable means "not set" (common with docker -e FOO= and CI templates).
  const parsed = schema.safeParse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '')));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`invalid configuration: ${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.LLM_PROVIDER === 'azure') {
    const missing = (['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_DEPLOYMENT', 'AZURE_OPENAI_API_VERSION'] as const).filter((k) => !cfg[k]);
    if (missing.length) throw new Error(`LLM_PROVIDER=azure needs ${missing.join(', ')}`);
  }
  return cfg;
}
