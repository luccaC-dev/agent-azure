import { Agent, Conversation } from './agent/agent';
import { AppConfig } from './config';
import { ApprovalQueue } from './domain/approvals';
import { KnowledgeBase } from './domain/knowledge-base';
import { Store } from './domain/store';
import { TicketDesk } from './domain/tickets';
import { createProvider } from './providers/factory';
import { LlmProvider } from './providers/llm';
import { ToolRunner } from './tools/tools';

export const APP_CONTEXT = Symbol('APP_CONTEXT');

export interface AppContext {
  config: AppConfig;
  store: Store;
  approvals: ApprovalQueue;
  tickets: TicketDesk;
  agent: Agent;
  conversations: Map<string, Conversation>;
  provider: LlmProvider;
}

export function buildContext(
  config: AppConfig,
  overrides: { provider?: LlmProvider; log?: (line: Record<string, unknown>) => void } = {},
): AppContext {
  const { store, asOf } = Store.fromFile();
  const clock = config.CLOCK === 'data' ? () => asOf : () => new Date();
  const approvals = new ApprovalQueue(store, clock);
  const tickets = new TicketDesk(clock);
  const runner = new ToolRunner({ store, kb: KnowledgeBase.fromDir(), approvals, tickets, clock });
  const provider = overrides.provider ?? createProvider(config);
  const agent = new Agent(provider, runner, {
    maxSteps: config.AGENT_MAX_STEPS,
    historyTurns: config.AGENT_HISTORY_TURNS,
    pricing: { inputPer1M: config.PRICE_INPUT_PER_1M, outputPer1M: config.PRICE_OUTPUT_PER_1M },
    clock,
    log: overrides.log ?? ((line) => console.log(JSON.stringify({ ts: new Date().toISOString(), ...line }))),
  });
  return { config, store, approvals, tickets, agent, conversations: new Map(), provider };
}
