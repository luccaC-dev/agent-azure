import { join } from 'node:path';
import { ApprovalQueue } from '../src/domain/approvals';
import { KnowledgeBase } from '../src/domain/knowledge-base';
import { Store } from '../src/domain/store';
import { TicketDesk } from '../src/domain/tickets';
import { ToolDeps, ToolRunner } from '../src/tools/tools';

export const DATA = join(__dirname, '..', 'data');

export function fixture(): ToolDeps & { runner: ToolRunner } {
  const { store, asOf } = Store.fromFile(join(DATA, 'store.json'));
  const clock = () => asOf;
  const deps: ToolDeps = {
    store,
    kb: KnowledgeBase.fromDir(join(DATA, 'kb')),
    approvals: new ApprovalQueue(store, clock),
    tickets: new TicketDesk(clock),
    clock,
  };
  return { ...deps, runner: new ToolRunner(deps) };
}

export const MAYA = { customerId: 'C-100', conversationId: 'test-maya' };
export const SAM = { customerId: 'C-200', conversationId: 'test-sam' };
