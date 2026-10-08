import { randomUUID } from 'node:crypto';
import { Store } from './store';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface RefundApproval {
  id: string;
  orderId: string;
  customerId: string;
  amount: number;
  reason: string;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
}

/**
 * Refunds are never executed by the agent. It can only create a pending request here;
 * a human approves it through the admin API, which is the only path that moves money.
 */
export class ApprovalQueue {
  private readonly items = new Map<string, RefundApproval>();

  constructor(private readonly store: Store, private readonly clock: () => Date) {}

  pendingFor(orderId: string): RefundApproval | undefined {
    return [...this.items.values()].find((a) => a.orderId === orderId && a.status === 'pending');
  }

  request(input: { orderId: string; customerId: string; amount: number; reason: string }): RefundApproval {
    const approval: RefundApproval = {
      id: randomUUID(),
      ...input,
      status: 'pending',
      createdAt: this.clock().toISOString(),
    };
    this.items.set(approval.id, approval);
    return approval;
  }

  list(status?: ApprovalStatus): RefundApproval[] {
    return [...this.items.values()].filter((a) => !status || a.status === status);
  }

  get(id: string): RefundApproval | undefined {
    return this.items.get(id);
  }

  decide(id: string, approve: boolean, actor: string): RefundApproval {
    const approval = this.items.get(id);
    if (!approval) throw new NotFoundError(`approval ${id} not found`);
    if (approval.status !== 'pending') throw new ConflictError(`approval ${id} is already ${approval.status}`);
    approval.status = approve ? 'approved' : 'rejected';
    approval.decidedAt = this.clock().toISOString();
    approval.decidedBy = actor;
    if (approve) this.store.recordRefund(approval.orderId, approval.amount);
    return approval;
  }
}

export class NotFoundError extends Error {}
export class ConflictError extends Error {}
