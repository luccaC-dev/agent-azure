import { Order, round2 } from './store';

export const RETURN_WINDOW_DAYS = 30;

export type RefundDecision = { ok: true; maxAmount: number } | { ok: false; reason: string };

/**
 * Deterministic refund rules. The model can ask for a refund; only this function decides
 * whether the request is even eligible to reach a human. Nothing the user or a document
 * says can change these checks.
 */
export function evaluateRefund(order: Order, amount: number, now: Date): RefundDecision {
  if (order.status !== 'delivered' || !order.deliveredAt) {
    return { ok: false, reason: `order ${order.id} has not been delivered yet (status: ${order.status})` };
  }
  const days = Math.floor((now.getTime() - new Date(order.deliveredAt).getTime()) / 86_400_000);
  if (days > RETURN_WINDOW_DAYS) {
    return { ok: false, reason: `order ${order.id} was delivered ${days} days ago; the return window is ${RETURN_WINDOW_DAYS} days` };
  }
  const maxAmount = round2(order.total - order.refunded);
  if (maxAmount <= 0) {
    return { ok: false, reason: `order ${order.id} has already been fully refunded` };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: 'refund amount must be a positive number' };
  }
  if (round2(amount) > maxAmount) {
    return { ok: false, reason: `requested ${round2(amount)} but at most ${maxAmount} can be refunded on order ${order.id}` };
  }
  return { ok: true, maxAmount };
}
