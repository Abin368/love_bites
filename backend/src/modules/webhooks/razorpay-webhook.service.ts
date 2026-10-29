import { Transaction, UniqueConstraintError } from 'sequelize';
import { sequelize } from '../../config/database';
import { Payment } from '../../database/models/payment.model';
import {
  capturePayment,
  lockPaymentByProviderOrderId,
  lockPaymentByProviderPaymentId,
  PaymentCaptureConflictError
} from '../payments/payments.data-access';
import { addUtcBillingInterval, type UtcBillingInterval } from '../subscriptions/billing-period';
import {
  expireElapsedNonterminalSubscription,
  findInPeriodCanceledSubscription,
  findQualifyingPremiumSubscription,
  insertActivePremiumSubscription,
  lockNonterminalSubscription
} from '../subscriptions/subscriptions.data-access';
import { InternalServerError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { findProcessedWebhook, insertProcessedWebhook } from './razorpay-webhook.data-access';

type WebhookOutcome = 'activated' | 'captured_unlinked' | 'captured_linked' | 'duplicate' | 'conflict';

interface MinimizedEvent {
  eventId: string;
  orderId: string | null;
  providerPaymentId: string | null;
  amount: number | null;
  currency: string | null;
  paymentStatus: string | null;
  outcome: WebhookOutcome;
  reason: string | null;
  processedAt: Date;
}

interface ValidCapture {
  orderId: string;
  providerPaymentId: string;
  amount: number;
  currency: string;
  notesPaymentId: string | undefined;
}

type ParsedCapture =
  | { kind: 'valid'; value: ValidCapture }
  | {
      kind: 'conflict';
      reason: string;
      orderId: string | null;
      providerPaymentId: string | null;
      amount: number | null;
      currency: string | null;
      paymentStatus: string | null;
    };

function processingFailed(): InternalServerError {
  return new InternalServerError(
    'Payment webhook could not be processed.',
    [],
    'WEBHOOK_PROCESSING_FAILED',
    true
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255) {
    return null;
  }
  return value;
}

function readAmount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return null;
  }
  return value;
}

function readCurrency(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 3) {
    return null;
  }
  return value;
}

function readStatus(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 30) {
    return null;
  }
  return value;
}

function isBillingInterval(value: string | null): value is UtcBillingInterval {
  return value === 'MONTH' || value === 'YEAR';
}

function paymentEntity(body: Record<string, unknown>): Record<string, unknown> | null {
  if (!isRecord(body.payload) || !isRecord(body.payload.payment) || !isRecord(body.payload.payment.entity)) {
    return null;
  }
  return body.payload.payment.entity;
}

function notesPaymentId(notes: unknown): string | undefined | null {
  if (notes === undefined || notes === null || Array.isArray(notes)) {
    return undefined;
  }
  if (!isRecord(notes) || !Object.prototype.hasOwnProperty.call(notes, 'paymentId')) {
    return undefined;
  }
  const value = notes.paymentId;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  return value;
}

function parseCapturedEvent(body: Record<string, unknown>): ParsedCapture {
  const entity = paymentEntity(body);
  if (!entity) {
    return {
      kind: 'conflict',
      reason: 'PAYMENT_ENTITY_INVALID',
      orderId: null,
      providerPaymentId: null,
      amount: null,
      currency: null,
      paymentStatus: null
    };
  }

  const orderId = readId(entity.order_id);
  const providerPaymentId = readId(entity.id);
  const amount = readAmount(entity.amount);
  const currency = readCurrency(entity.currency);
  const paymentStatus = readStatus(entity.status);
  const note = notesPaymentId(entity.notes);

  if (!providerPaymentId) {
    return {
      kind: 'conflict',
      reason: 'PAYMENT_ID_INVALID',
      orderId,
      providerPaymentId: null,
      amount,
      currency,
      paymentStatus
    };
  }
  if (!orderId) {
    return {
      kind: 'conflict',
      reason: 'ORDER_ID_INVALID',
      orderId: null,
      providerPaymentId,
      amount,
      currency,
      paymentStatus
    };
  }
  if (paymentStatus !== 'captured') {
    return {
      kind: 'conflict',
      reason: 'STATUS_NOT_CAPTURED',
      orderId,
      providerPaymentId,
      amount,
      currency,
      paymentStatus
    };
  }
  if (amount === null) {
    return {
      kind: 'conflict',
      reason: 'AMOUNT_INVALID',
      orderId,
      providerPaymentId,
      amount: null,
      currency,
      paymentStatus
    };
  }
  if (!currency) {
    return {
      kind: 'conflict',
      reason: 'CURRENCY_INVALID',
      orderId,
      providerPaymentId,
      amount,
      currency: null,
      paymentStatus
    };
  }
  if (note === null) {
    return {
      kind: 'conflict',
      reason: 'NOTE_MISMATCH',
      orderId,
      providerPaymentId,
      amount,
      currency,
      paymentStatus
    };
  }

  return {
    kind: 'valid',
    value: { orderId, providerPaymentId, amount, currency, notesPaymentId: note }
  };
}

function isProcessedEventDuplicate(error: unknown): boolean {
  if (!(error instanceof UniqueConstraintError)) {
    return false;
  }
  const parent = error.parent as { constraint?: string; table?: string; detail?: string } | undefined;
  const text = `${parent?.constraint ?? ''} ${parent?.table ?? ''} ${parent?.detail ?? ''} ${error.message}`;
  return text.includes('processed_webhooks');
}

async function runWebhookTransaction(work: (transaction: Transaction) => Promise<void>): Promise<void> {
  try {
    await sequelize.transaction(work);
  } catch (error) {
    if (isProcessedEventDuplicate(error)) {
      return;
    }
    if (error instanceof InternalServerError) {
      throw error;
    }
    if (error instanceof UniqueConstraintError || error instanceof PaymentCaptureConflictError) {
      throw processingFailed();
    }
    throw error;
  }
}

async function recordEvent(transaction: Transaction, input: MinimizedEvent, paymentId?: string): Promise<void> {
  const fields = {
    eventId: input.eventId,
    reason: input.reason,
    ...(paymentId ? { paymentId } : {})
  };
  if (input.outcome === 'conflict') {
    logger.warn('Razorpay webhook was not applied', fields);
  } else {
    logger.info('Razorpay webhook applied', { ...fields, outcome: input.outcome });
  }

  await insertProcessedWebhook(
    {
      eventId: input.eventId,
      eventType: 'payment.captured',
      processedAt: input.processedAt,
      payload: {
        eventId: input.eventId,
        eventType: 'payment.captured',
        orderId: input.orderId,
        providerPaymentId: input.providerPaymentId,
        amount: input.amount,
        currency: input.currency,
        paymentStatus: input.paymentStatus,
        outcome: input.outcome,
        reason: input.reason
      }
    },
    transaction
  );
}

async function acknowledgeConflict(
  eventId: string,
  conflict: Extract<ParsedCapture, { kind: 'conflict' }>
): Promise<void> {
  await runWebhookTransaction(async (transaction) => {
    if (await findProcessedWebhook(eventId, transaction)) {
      return;
    }
    await recordEvent(transaction, {
      eventId,
      orderId: conflict.orderId,
      providerPaymentId: conflict.providerPaymentId,
      amount: conflict.amount,
      currency: conflict.currency,
      paymentStatus: conflict.paymentStatus,
      outcome: 'conflict',
      reason: conflict.reason,
      processedAt: new Date()
    });
  });
}

async function rejectSnapshot(
  transaction: Transaction,
  eventId: string,
  capture: ValidCapture,
  payment: Payment,
  reason: string,
  processedAt: Date
): Promise<void> {
  await recordEvent(
    transaction,
    {
      eventId,
      orderId: capture.orderId,
      providerPaymentId: capture.providerPaymentId,
      amount: capture.amount,
      currency: capture.currency,
      paymentStatus: 'captured',
      outcome: 'conflict',
      reason,
      processedAt
    },
    payment.id
  );
}

async function applyValidCapture(eventId: string, capture: ValidCapture): Promise<void> {
  await runWebhookTransaction(async (transaction) => {
    if (await findProcessedWebhook(eventId, transaction)) {
      return;
    }

    const payment = await lockPaymentByProviderOrderId(capture.orderId, transaction);
    if (!payment || payment.provider !== 'RAZORPAY' || payment.providerOrderId !== capture.orderId) {
      logger.warn('Razorpay webhook was not applied', { eventId, reason: 'UNKNOWN_ORDER' });
      throw processingFailed();
    }

    if (await findProcessedWebhook(eventId, transaction)) {
      return;
    }

    const processedAt = new Date();
    if (payment.paymentType !== 'SUBSCRIPTION_INITIAL') {
      await rejectSnapshot(transaction, eventId, capture, payment, 'PAYMENT_TYPE_INVALID', processedAt);
      return;
    }
    if (!payment.userId || !payment.planId || !isBillingInterval(payment.billingInterval)) {
      await rejectSnapshot(transaction, eventId, capture, payment, 'SNAPSHOT_INCOMPLETE', processedAt);
      return;
    }
    if (payment.amountInCents !== capture.amount) {
      await rejectSnapshot(transaction, eventId, capture, payment, 'AMOUNT_MISMATCH', processedAt);
      return;
    }
    if (payment.currency !== capture.currency) {
      await rejectSnapshot(transaction, eventId, capture, payment, 'CURRENCY_MISMATCH', processedAt);
      return;
    }
    if (capture.notesPaymentId !== undefined && capture.notesPaymentId !== payment.id) {
      await rejectSnapshot(transaction, eventId, capture, payment, 'NOTE_MISMATCH', processedAt);
      return;
    }

    if (payment.providerPaymentId && payment.providerPaymentId !== capture.providerPaymentId) {
      await rejectSnapshot(transaction, eventId, capture, payment, 'PROVIDER_PAYMENT_ID_CONFLICT', processedAt);
      return;
    }

    if (!payment.providerPaymentId) {
      const holder = await lockPaymentByProviderPaymentId(capture.providerPaymentId, transaction);
      if (holder && holder.id !== payment.id) {
        await rejectSnapshot(transaction, eventId, capture, payment, 'PROVIDER_PAYMENT_ID_CONFLICT', processedAt);
        return;
      }
    }

    if (payment.status === 'CAPTURED' && payment.providerPaymentId === capture.providerPaymentId) {
      await recordEvent(
        transaction,
        {
          eventId,
          orderId: capture.orderId,
          providerPaymentId: capture.providerPaymentId,
          amount: capture.amount,
          currency: capture.currency,
          paymentStatus: 'captured',
          outcome: 'duplicate',
          reason: null,
          processedAt
        },
        payment.id
      );
      return;
    }

    if (payment.status !== 'INITIATED' && payment.status !== 'AUTHORIZED') {
      await rejectSnapshot(transaction, eventId, capture, payment, 'PAYMENT_STATUS_CONFLICT', processedAt);
      return;
    }

    const userId = payment.userId;
    const planId = payment.planId;
    const interval = payment.billingInterval;

    if (payment.subscriptionId) {
      await capturePayment(
        payment.id,
        {
          providerPaymentId: capture.providerPaymentId,
          paidAt: processedAt,
          subscriptionId: payment.subscriptionId
        },
        transaction
      );
      await recordEvent(
        transaction,
        {
          eventId,
          orderId: capture.orderId,
          providerPaymentId: capture.providerPaymentId,
          amount: capture.amount,
          currency: capture.currency,
          paymentStatus: 'captured',
          outcome: 'captured_linked',
          reason: 'SUBSCRIPTION_ALREADY_LINKED',
          processedAt
        },
        payment.id
      );
      return;
    }

    const now = processedAt;
    await lockNonterminalSubscription(userId, transaction);
    await expireElapsedNonterminalSubscription(userId, now, transaction);
    await findInPeriodCanceledSubscription(userId, now, transaction);
    const qualifying = await findQualifyingPremiumSubscription(userId, transaction, now);
    if (qualifying) {
      await capturePayment(
        payment.id,
        {
          providerPaymentId: capture.providerPaymentId,
          paidAt: now,
          subscriptionId: null
        },
        transaction
      );
      await recordEvent(
        transaction,
        {
          eventId,
          orderId: capture.orderId,
          providerPaymentId: capture.providerPaymentId,
          amount: capture.amount,
          currency: capture.currency,
          paymentStatus: 'captured',
          outcome: 'captured_unlinked',
          reason: null,
          processedAt: now
        },
        payment.id
      );
      return;
    }

    const subscription = await insertActivePremiumSubscription(
      {
        userId,
        planId,
        currentPeriodStart: now,
        currentPeriodEnd: addUtcBillingInterval(now, interval)
      },
      transaction
    );
    await capturePayment(
      payment.id,
      {
        providerPaymentId: capture.providerPaymentId,
        paidAt: now,
        subscriptionId: subscription.id
      },
      transaction
    );
    await recordEvent(
      transaction,
      {
        eventId,
        orderId: capture.orderId,
        providerPaymentId: capture.providerPaymentId,
        amount: capture.amount,
        currency: capture.currency,
        paymentStatus: 'captured',
        outcome: 'activated',
        reason: null,
        processedAt: now
      },
      payment.id
    );
  });
}

export async function processRazorpayWebhook(body: unknown): Promise<void> {
  if (!isRecord(body) || body.event !== 'payment.captured') {
    return;
  }

  const eventId = readId(body.id);
  if (!eventId) {
    logger.warn('Razorpay webhook was not applied', { reason: 'EVENT_ID_INVALID' });
    return;
  }

  const parsed = parseCapturedEvent(body);
  if (parsed.kind === 'conflict') {
    await acknowledgeConflict(eventId, parsed);
    return;
  }

  await applyValidCapture(eventId, parsed.value);
}
