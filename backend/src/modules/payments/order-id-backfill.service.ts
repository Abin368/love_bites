import { UniqueConstraintError } from 'sequelize';
import { razorpayOrderProvider } from '../../integrations/payment/razorpay.provider';
import { InternalServerError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { assignProviderOrderId, findPaymentById, OrderIdPersistError } from './payments.data-access';

type BackfillPayment = NonNullable<Awaited<ReturnType<typeof findPaymentById>>>;

export type OrderIdBackfillUnchangedReason =
  | 'no_match'
  | 'ambiguous'
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

function isBackfillCandidate(payment: BackfillPayment): boolean {
  return (
    payment.provider === 'RAZORPAY' &&
    payment.paymentType === 'SUBSCRIPTION_INITIAL' &&
    payment.status === 'INITIATED' &&
    Number.isInteger(payment.amountInCents) &&
    payment.amountInCents > 0 &&
    payment.currency.length > 0
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

export async function backfillProviderOrderId(paymentId: string): Promise<OrderIdBackfillResult> {
  const payment = await findPaymentById(paymentId);
  if (!payment || !isBackfillCandidate(payment)) {
    return finish(paymentId, { outcome: 'ineligible' });
  }
  if (payment.providerOrderId) {
    return finish(paymentId, { outcome: 'already_assigned', providerOrderId: payment.providerOrderId });
  }
  if (!razorpayOrderProvider.isConfigured()) {
    throw providerNotConfigured();
  }

  let listed;
  try {
    listed = await razorpayOrderProvider.listOrdersByReceipt(payment.id);
  } catch (error) {
    logger.error('Provider order id backfill lookup failed', { paymentId: payment.id });
    throw error;
  }

  if (listed.kind === 'incomplete') {
    return finish(payment.id, { outcome: 'unchanged', reason: 'ambiguous' });
  }
  if (listed.kind === 'malformed') {
    return finish(payment.id, { outcome: 'unchanged', reason: 'malformed' });
  }
  if (listed.orders.length === 0) {
    return finish(payment.id, { outcome: 'unchanged', reason: 'no_match' });
  }
  if (listed.orders.length !== 1) {
    return finish(payment.id, { outcome: 'unchanged', reason: 'ambiguous' });
  }

  const order = listed.orders[0];
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
