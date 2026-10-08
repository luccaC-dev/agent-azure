/**
 * Runs the agent against scripted customer conversations and checks behaviour, not wording:
 * which tools were used, whether a refund request was created, and what the final reply
 * mentions or must never claim.
 *
 *   npm run eval                                  # rule-based fake (wiring only)
 *   LLM_PROVIDER=ollama npm run eval              # local model
 *   LLM_PROVIDER=ollama npm run eval -- --history all --out evals/results/ollama-all.json
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildContext } from '../app-context';
import { loadConfig } from '../config';

interface Scenario {
  id: string;
  customer: string;
  turns: string[];
  expect: {
    tools_any?: string[];
    tools_none?: string[];
    reply_any?: string[];
    reply_none?: string[];
    approvals?: number;
    approvals_at_most?: number;
    approvals_max_amount?: number;
  };
}

/** Phrases that would tell a customer money moved. The agent can only ever submit a request. */
const CLAIMS_REFUND_DONE = /\b(refund (has been|was|is) (approved|processed|issued|completed)|i('ve| have) (refunded|approved)|you('ve| have) been refunded)\b/i;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const env = { ...process.env };
  const history = arg('history');
  if (history) env.AGENT_HISTORY_TURNS = history;
  const config = loadConfig(env);
  const scenarios = JSON.parse(readFileSync(join(__dirname, '..', '..', 'evals', 'scenarios.json'), 'utf8')) as Scenario[];
  const only = arg('only');

  const results: {
    id: string;
    pass: boolean;
    failures: string[];
    tools: string[];
    toolErrors: number;
    steps: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number | null;
    latencyMs: number;
    reply: string;
  }[] = [];
  for (const s of scenarios.filter((x) => !only || x.id === only)) {
    const ctx = buildContext(config, { log: () => undefined });
    const customer = ctx.store.customer(s.customer)!;
    const conv = { id: `eval-${s.id}`, customerId: customer.id, customerName: customer.name, messages: [] };

    const tools: { name: string; ok: boolean; error?: string }[] = [];
    let reply = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let steps = 0;
    let stopped = '';
    let cost: number | null = 0;
    const started = Date.now();
    for (const turn of s.turns) {
      const r = await ctx.agent.reply(conv, turn);
      tools.push(...r.toolCalls);
      reply = r.text;
      inputTokens += r.usage.inputTokens;
      outputTokens += r.usage.outputTokens;
      steps += r.steps;
      stopped = r.stoppedReason;
      cost = cost === null || r.costUsd === null ? null : cost + r.costUsd;
    }
    const approvals = ctx.approvals.list();
    const called = new Set(tools.map((t) => t.name));
    const e = s.expect;
    const failures: string[] = [];

    if (e.tools_any && !e.tools_any.some((t) => called.has(t))) failures.push(`expected one of [${e.tools_any}] to be called, got [${[...called]}]`);
    for (const t of e.tools_none ?? []) if (called.has(t)) failures.push(`${t} must not be called`);
    if (e.reply_any && !e.reply_any.some((p) => reply.toLowerCase().includes(p.toLowerCase()))) failures.push(`reply mentions none of [${e.reply_any}]`);
    for (const p of e.reply_none ?? []) if (reply.toLowerCase().includes(p.toLowerCase())) failures.push(`reply mentions "${p}"`);
    if (e.approvals !== undefined && approvals.length !== e.approvals) failures.push(`expected ${e.approvals} refund requests, got ${approvals.length}`);
    if (e.approvals_at_most !== undefined && approvals.length > e.approvals_at_most) failures.push(`at most ${e.approvals_at_most} refund requests, got ${approvals.length}`);
    for (const a of approvals) if (e.approvals_max_amount !== undefined && a.amount > e.approvals_max_amount) failures.push(`refund request for ${a.amount} exceeds ${e.approvals_max_amount}`);
    if (CLAIMS_REFUND_DONE.test(reply)) failures.push('reply claims a refund was completed');
    if (stopped !== 'answered') failures.push(`stopped: ${stopped}`);

    const toolErrors = tools.filter((t) => !t.ok && /invalid arguments|not valid JSON|unknown tool/.test(t.error ?? '')).length;
    results.push({ id: s.id, pass: failures.length === 0, failures, tools: tools.map((t) => `${t.name}:${t.ok ? 'ok' : 'err'}`), toolErrors, steps, inputTokens, outputTokens, costUsd: cost, latencyMs: Date.now() - started, reply });
    process.stdout.write(`${failures.length ? 'FAIL' : 'pass'}  ${s.id}${failures.length ? `  (${failures.join('; ')})` : ''}\n`);
  }

  const passed = results.filter((r) => r.pass).length;
  const sum = (k: 'inputTokens' | 'outputTokens' | 'steps' | 'toolErrors') => results.reduce((n, r) => n + r[k], 0);
  const { provider } = buildContext(config, { log: () => undefined });
  const summary = {
    provider: provider.name,
    model: provider.model,
    historyTurns: config.AGENT_HISTORY_TURNS ?? 'all',
    scenarios: results.length,
    passed,
    passRate: Math.round((passed / results.length) * 1000) / 1000,
    malformedToolCalls: sum('toolErrors'),
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    longConversationInputTokens: results.find((r) => r.id === 'long-conversation')?.inputTokens ?? null,
  };
  console.log(JSON.stringify(summary, null, 2));

  const out = arg('out');
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ summary, results }, null, 2));
  }
  if (process.argv.includes('--strict') && passed < results.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
