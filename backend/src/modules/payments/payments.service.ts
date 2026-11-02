import { UniqueConstraintError } from 'sequelize';
import { sequelize } from '../../config/database';
import { Plan } from '../../database/models/plan.model';
import { Payment } from '../../database/models/payment.model';
import { PaymentProviderRejectedError } from '../../integrations/payment/payment.interface';
import { razorpayOrderProvider, verificationNotConfigured } from '../../integrations/payment/razorpay.provider';
import {
  expireElapsedNonterminalSubscription,
  findInPeriodCanceledSubscription,
  findQualifyingPremiumSubscription,
  lockNonterminalSubscription
} from '../subscriptions/subscriptions.data-access';
import {
  ConflictError,
  InternalServerError,
  NotFoundError,
  PaymentFailedError,
  UnprocessableEntityError,
  ValidationError
} from '../../utils/errors';
import { logger } from '../../utils/logger';
import * as paymentsDataAccess from './payments.data-access';
import type { CheckoutInput, CheckoutResult, VerifyPaymentInput } from './payments.types';

const PREMIUM_BILLING_INTERVAL = {
  PREMIUM_MONTHLY: 'MONTH',
  PREMIUM_YEARLY: 'YEAR'
} as const;

const PREMIUM_PLAN_CODES = new Set<string>(Object.keys(PREMIUM_BILLING_INTERVAL));

type OpenCheckout =
  | { kind: 'create'; payment: Payment; plan: Plan }
  | { kind: 'replay'; payment: Payment; plan: Plan }
  | { kind: 'failed' };

function planNotFound(): NotFoundError {
  return new NotFoundError('Resource not found', [], 'RESOURCE_NOT_FOUND');
}

function planUnavailable(): ValidationError {
  return new ValidationError('Validation failed', [{ field: 'planId', message: 'Plan is not available for checkout.' }]);
}

function planCurrencyRejected(): ValidationError {
  return new ValidationError('Validation failed', [{ field: 'planId', message: 'Plan currency must be INR.' }]);
}

function planPriceRejected(): ValidationError {
  return new ValidationError('Validation failed', [
    { field: 'planId', message: 'Plan price must be a positive integer number of cents.' }
  ]);
}

function planIntervalRejected(): ValidationError {
  return new ValidationError('Validation failed', [
    { field: 'planId', message: 'Plan billing interval does not match the plan code.' }
  ]);
}

function premiumAlreadyActive(): ConflictError {
  return new ConflictError('Premium access is already active.', [], 'ACTIVE_SUBSCRIPTION_EXISTS');
}

function checkoutAlreadyOpen(): ConflictError {
  return new ConflictError(
    'A checkout is already open for this account.',
    [],
    'CHECKOUT_ALREADY_OPEN'
  );
}

function idempotencyInProgress(): ConflictError {
  return new ConflictError('A request with this Idempotency-Key is already in progress.', [], 'IDEMPOTENCY_CONFLICT');
}

function idempotencyPlanConflict(): ConflictError {
  return new ConflictError('Idempotency-Key was already used for a different plan.', [], 'IDEMPOTENCY_CONFLICT');
}

function providerNotConfigured(): InternalServerError {
  return new InternalServerError('Payment provider is not configured.', [], 'PAYMENT_NOT_CONFIGURED', true);
}

function outcomeUnknown(): InternalServerError {
  return new InternalServerError(
    'The payment provider did not confirm a stored order.',
    [],
    'PAYMENT_OUTCOME_UNKNOWN',
    true
  );
}

function checkoutBillingInterval(plan: Plan): 'MONTH' | 'YEAR' {
  if (!PREMIUM_PLAN_CODES.has(plan.code) || !plan.isActive) {
    throw planUnavailable();
  }
  if (plan.currency !== 'INR') {
    throw planCurrencyRejected();
  }
  if (!Number.isInteger(plan.priceInCents) || plan.priceInCents <= 0) {
    throw planPriceRejected();
  }

  const expected = PREMIUM_BILLING_INTERVAL[plan.code as keyof typeof PREMIUM_BILLING_INTERVAL];
  if (!expected || plan.billingInterval !== expected) {
    throw planIntervalRejected();
  }
  return expected;
}

function resolveExisting(plan: Plan | null, payment: Payment): OpenCheckout {
  if (!plan || payment.planId !== plan.id) {
    throw idempotencyPlanConflict();
  }
  if (payment.providerOrderId) {
    return { kind: 'replay', payment, plan };
  }
  if (payment.status === 'FAILED') {
    return { kind: 'failed' };
  }
  throw idempotencyInProgress();
}

async function openCheckout(input: CheckoutInput): Promise<OpenCheckout> {
  try {
    return await sequelize.transaction(async (transaction) => {
      const plan = await paymentsDataAccess.lockPlanById(input.planId, transaction);
      const existing = await paymentsDataAccess.lockPaymentByUserAndKey(
        input.userId,
        input.idempotencyKey,
        transaction
      );
      if (existing) {
        return resolveExisting(plan, existing);
      }

      const outstanding = await paymentsDataAccess.findUnresolvedSubscriptionCheckout(
        input.userId,
        transaction
      );
      if (outstanding) {
        throw checkoutAlreadyOpen();
      }

      if (!plan) {
        throw planNotFound();
      }

      const billingInterval = checkoutBillingInterval(plan);
      await lockNonterminalSubscription(input.userId, transaction);
      const now = new Date();
      await expireElapsedNonterminalSubscription(input.userId, now, transaction);
      await findInPeriodCanceledSubscription(input.userId, now, transaction);
      const qualifying = await findQualifyingPremiumSubscription(input.userId, transaction, now);
      if (qualifying) {
        throw premiumAlreadyActive();
      }

      const payment = await paymentsDataAccess.insertInitiatedCheckout(
        {
          userId: input.userId,
          planId: plan.id,
          idempotencyKey: input.idempotencyKey,
          amountInCents: plan.priceInCents,
          currency: plan.currency,
          billingInterval
        },
        transaction
      );
      return { kind: 'create', payment, plan };
    });
  } catch (error) {
    if (paymentsDataAccess.isOutstandingCheckoutUniqueViolation(error)) {
      throw checkoutAlreadyOpen();
    }
    if (!paymentsDataAccess.isIdempotencyUniqueViolation(error) && !(error instanceof UniqueConstraintError)) {
      throw error;
    }
    if (!paymentsDataAccess.isIdempotencyUniqueViolation(error)) {
      throw new InternalServerError('Internal server error', [], 'INTERNAL_SERVER_ERROR', true);
    }

    return sequelize.transaction(async (transaction) => {
      const plan = await paymentsDataAccess.lockPlanById(input.planId, transaction);
      const existing = await paymentsDataAccess.lockPaymentByUserAndKey(
        input.userId,
        input.idempotencyKey,
        transaction
      );
      if (!existing) {
        throw new InternalServerError('Internal server error', [], 'INTERNAL_SERVER_ERROR', true);
      }
      return resolveExisting(plan, existing);
    });
  }
}

function toResult(payment: Payment, plan: Plan): CheckoutResult {
  if (!payment.providerOrderId) {
    throw outcomeUnknown();
  }
  return {
    paymentId: payment.id,
    planId: plan.id,
    planCode: plan.code,
    orderId: payment.providerOrderId,
    amountInCents: payment.amountInCents,
    currency: payment.currency,
    keyId: razorpayOrderProvider.publicKeyId()
  };
}

export async function createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  if (!razorpayOrderProvider.isConfigured()) {
    throw providerNotConfigured();
  }

  const opened = await openCheckout(input);
  if (opened.kind === 'failed') {
    throw new PaymentFailedError('Payment could not be initiated.');
  }
  if (opened.kind === 'replay') {
    return toResult(opened.payment, opened.plan);
  }

  const payment = opened.payment;
  const plan = opened.plan;
  try {
    const created = await razorpayOrderProvider.createOrder({
      amountInCents: payment.amountInCents,
      currency: 'INR',
      receipt: payment.id,
      paymentId: payment.id
    });
    try {
      await paymentsDataAccess.assignProviderOrderId(payment.id, created.providerOrderId);
    } catch {
      logger.error('Checkout order id was not stored', {
        paymentId: payment.id,
        providerOrderId: created.providerOrderId
      });
      throw outcomeUnknown();
    }
    payment.providerOrderId = created.providerOrderId;
    return toResult(payment, plan);
  } catch (error) {
    if (error instanceof PaymentFailedError || error instanceof InternalServerError) {
      throw error;
    }
    if (error instanceof PaymentProviderRejectedError) {
      const marked = await paymentsDataAccess.markCheckoutFailed(payment.id);
      if (!marked) {
        logger.error('Checkout rejection was not recorded', { paymentId: payment.id });
        throw outcomeUnknown();
      }
      throw new PaymentFailedError('Payment could not be initiated.');
    }
    logger.error('Checkout provider outcome is unknown', { paymentId: payment.id });
    throw outcomeUnknown();
  }
}

function orderNotFound(): NotFoundError {
  return new NotFoundError('Resource not found', [], 'RESOURCE_NOT_FOUND');
}

function signatureInvalid(): UnprocessableEntityError {
  return new UnprocessableEntityError('Payment signature is invalid.', [], 'PAYMENT_SIGNATURE_INVALID');
}

export async function verifyPayment(input: VerifyPaymentInput): Promise<void> {
  if (!razorpayOrderProvider.isVerificationConfigured()) {
    throw verificationNotConfigured();
  }

  const payment = await paymentsDataAccess.findPaymentByUserProviderOrder(input.userId, input.razorpayOrderId);
  if (!payment?.providerOrderId) {
    throw orderNotFound();
  }

  const valid = razorpayOrderProvider.verifyOrderSignature({
    storedOrderId: payment.providerOrderId,
    razorpayPaymentId: input.razorpayPaymentId,
    razorpaySignature: input.razorpaySignature
  });
  if (!valid) {
    throw signatureInvalid();
  }
}
