import { UniqueConstraintError } from 'sequelize';
import { razorpayOrderProvider } from '../../integrations/payment/razorpay.provider';
import type { ListedProviderOrder } from '../../integrations/payment/payment.interface';
import { InternalServerError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { assignProviderOrderId, findPaymentById, OrderIdPersistError } from './payments.data-access';

type BackfillPayment = NonNullable<Awaited<ReturnType<typeof findPaymentById>>>;

/**
 * Operational precaution only. 15-second provider timeout plus a 60-second buffer.
 * It does not prove that an earlier provider request has finished, or that an Order
 * cannot appear later.
 */
export const MIN_RECOVERY_AGE_MS = 75_000;

/** One second on each side. The installed SDK does not say whether `from`/`to` are inclusive. */
export const WINDOW_BOUNDARY_PAD_SECONDS = 1;

/**
 * Lower-bound allowance when this process clock is ahead of Razorpay.
 * This is not a measured skew bound. A larger skew can still place the Order before `from`.
 */
export const WINDOW_CLOCK_SKEW_PAD_SECONDS = 60;

export type OrderIdBackfillUnchangedReason =
  | 'no_match'
  | 'ambiguous'
  | 'incomplete'
  | 'uncertain_window'
  | 'malformed'
  | 'receipt_mismatch'
  | 'note_mismatch'
  | 'amount_mismatch'
  | 'currency_mismatch'
  | 'conflict';

export type OrderIdBackfillResult =
  | { outcome: 'assigned'; providerOrderId: string }
  | { outcome: 'already_assigned'; providerOrderId: string }
  | { outcome: 'ineligible' }
  | { outcome: 'unchanged'; reason: OrderIdBackfillUnchangedReason };

function providerNotConfigured(): InternalServerError {
  return new InternalServerError('Payment provider is not configured.', [], 'PAYMENT_NOT_CONFIGURED', true);
}

function isPresentId(value: string | null): boolean {
  return typeof value === 'string' && value.length > 0;
}

function isCaptureBillingInterval(value: BackfillPayment['billingInterval']): value is 'MONTH' | 'YEAR' {
  return value === 'MONTH' || value === 'YEAR';
}

function isBackfillCandidate(payment: BackfillPayment): boolean {
  return (
    payment.provider === 'RAZORPAY' &&
    payment.paymentType === 'SUBSCRIPTION_INITIAL' &&
    payment.status === 'INITIATED' &&
    Number.isInteger(payment.amountInCents) &&
    payment.amountInCents > 0 &&
    payment.currency.length > 0 &&
    isPresentId(payment.userId) &&
    isPresentId(payment.planId) &&
    isCaptureBillingInterval(payment.billingInterval)
  );
}

function mismatchReason(payment: BackfillPayment, order: {
  receipt: string | null;
  notesPaymentId: string | null;
  amountInCents: number | null;
  currency: string | null;
}): OrderIdBackfillUnchangedReason | null {
  if (order.receipt !== payment.id) {
    return 'receipt_mismatch';
  }
  if (order.notesPaymentId !== payment.id) {
    return 'note_mismatch';
  }
  if (order.amountInCents !== payment.amountInCents) {
    return 'amount_mismatch';
  }
  if (order.currency !== payment.currency) {
    return 'currency_mismatch';
  }
  return null;
}

function isTiedToPayment(paymentId: string, order: ListedProviderOrder): boolean {
  return order.receipt === paymentId || order.notesPaymentId === paymentId;
}

function recoveryWindow(createdAt: Date, now: Date):
  | { kind: 'ready'; from: number; to: number }
  | { kind: 'uncertain_window' } {
  if (!(createdAt instanceof Date) || !(now instanceof Date)) {
    return { kind: 'uncertain_window' };
  }
  const createdMs = createdAt.getTime();
  const nowMs = now.getTime();
  if (!Number.isFinite(createdMs) || !Number.isFinite(nowMs)) {
    return { kind: 'uncertain_window' };
  }
  if (createdMs > nowMs + WINDOW_CLOCK_SKEW_PAD_SECONDS * 1000) {
    return { kind: 'uncertain_window' };
  }
  if (nowMs - createdMs < MIN_RECOVERY_AGE_MS) {
    return { kind: 'uncertain_window' };
  }

  const from = Math.floor(createdMs / 1000) - WINDOW_CLOCK_SKEW_PAD_SECONDS - WINDOW_BOUNDARY_PAD_SECONDS;
  const to = Math.floor(nowMs / 1000) + WINDOW_BOUNDARY_PAD_SECONDS;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from <= 0 || to <= 0 || from >= to) {
    return { kind: 'uncertain_window' };
  }
  return { kind: 'ready', from, to };
}

function finish(paymentId: string, result: OrderIdBackfillResult): OrderIdBackfillResult {
  if (result.outcome === 'assigned') {
    logger.info('Provider order id backfill stored an order id', {
      paymentId,
      providerOrderId: result.providerOrderId
    });
    return result;
  }
  if (result.outcome === 'unchanged') {
    logger.info('Provider order id backfill left the payment unchanged', {
      paymentId,
      reason: result.reason
    });
    return result;
  }
  logger.info('Provider order id backfill did not call the provider', {
    paymentId,
    outcome: result.outcome
  });
  return result;
}

export async function backfillProviderOrderId(
  paymentId: string,
  now: Date = new Date()
): Promise<OrderIdBackfillResult> {
  const payment = await findPaymentById(paymentId);
  if (!payment || !isBackfillCandidate(payment)) {
    return finish(paymentId, { outcome: 'ineligible' });
  }
  if (payment.providerOrderId) {
    return finish(paymentId, { outcome: 'already_assigned', providerOrderId: payment.providerOrderId });
  }

  const window = recoveryWindow(payment.createdAt, now);
  if (window.kind === 'uncertain_window') {
    return finish(payment.id, { outcome: 'unchanged', reason: 'uncertain_window' });
  }
  if (!razorpayOrderProvider.isConfigured()) {
    throw providerNotConfigured();
  }

  let listed;
  try {
    listed = await razorpayOrderProvider.listOrdersInWindow({ from: window.from, to: window.to });
  } catch (error) {
    logger.error('Provider order id backfill lookup failed', { paymentId: payment.id });
    throw error;
  }

  if (listed.kind === 'incomplete') {
    return finish(payment.id, { outcome: 'unchanged', reason: 'incomplete' });
  }
  if (listed.kind === 'malformed') {
    return finish(payment.id, { outcome: 'unchanged', reason: 'malformed' });
  }

  const tied = listed.orders.filter((order) => isTiedToPayment(payment.id, order));
  if (tied.length === 0) {
    return finish(payment.id, { outcome: 'unchanged', reason: 'no_match' });
  }
  if (tied.length !== 1) {
    return finish(payment.id, { outcome: 'unchanged', reason: 'ambiguous' });
  }

  const order = tied[0];
  const reason = mismatchReason(payment, order);
  if (reason) {
    return finish(payment.id, { outcome: 'unchanged', reason });
  }

  try {
    await assignProviderOrderId(payment.id, order.providerOrderId);
  } catch (error) {
    if (error instanceof OrderIdPersistError || error instanceof UniqueConstraintError) {
      return finish(payment.id, { outcome: 'unchanged', reason: 'conflict' });
    }
    throw error;
  }

  return finish(payment.id, { outcome: 'assigned', providerOrderId: order.providerOrderId });
}
