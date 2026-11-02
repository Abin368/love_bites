import { Op, Transaction, UniqueConstraintError } from 'sequelize';
import { sequelize } from '../../config/database';
import '../../database/associations';
import { Payment, type PaymentBillingInterval } from '../../database/models/payment.model';
import { Plan } from '../../database/models/plan.model';

const IDEMPOTENCY_INDEX = 'uq_payments_user_idempotency_key';
const OUTSTANDING_CHECKOUT_INDEX = 'uq_payments_one_unresolved_subscription_checkout_per_user';
const UNRESOLVED_CHECKOUT_STATUSES = ['INITIATED', 'AUTHORIZED'] as const;

export class OrderIdPersistError extends Error {
  constructor(readonly providerOrderId: string) {
    super('Provider order id was not stored.');
    this.name = 'OrderIdPersistError';
  }
}

function uniqueViolationText(error: UniqueConstraintError): string {
  const parent = error.parent as { constraint?: string; detail?: string } | undefined;
  const fields = error.fields ?? {};
  const fieldNames = Object.keys(fields).join(' ');
  return `${parent?.constraint ?? ''} ${parent?.detail ?? ''} ${error.message} ${fieldNames}`;
}

export function isIdempotencyUniqueViolation(error: unknown): boolean {
  if (!(error instanceof UniqueConstraintError)) {
    return false;
  }

  const text = uniqueViolationText(error);
  return text.includes(IDEMPOTENCY_INDEX) || text.includes('idempotency_key') || text.includes('idempotencyKey');
}

export function isOutstandingCheckoutUniqueViolation(error: unknown): boolean {
  if (!(error instanceof UniqueConstraintError)) {
    return false;
  }

  return uniqueViolationText(error).includes(OUTSTANDING_CHECKOUT_INDEX);
}

export async function findUnresolvedSubscriptionCheckout(
  userId: string,
  transaction: Transaction
): Promise<Payment | null> {
  return Payment.findOne({
    where: {
      userId,
      paymentType: 'SUBSCRIPTION_INITIAL',
      status: { [Op.in]: [...UNRESOLVED_CHECKOUT_STATUSES] }
    },
    transaction,
    lock: Transaction.LOCK.UPDATE
  });
}

export async function lockPlanById(planId: string, transaction: Transaction): Promise<Plan | null> {
  return Plan.findOne({
    where: { id: planId },
    transaction,
    lock: Transaction.LOCK.UPDATE
  });
}

export async function findPaymentById(paymentId: string): Promise<Payment | null> {
  return Payment.findByPk(paymentId);
}

export async function findPaymentByUserProviderOrder(
  userId: string,
  providerOrderId: string
): Promise<Payment | null> {
  return Payment.findOne({
    where: {
      userId,
      provider: 'RAZORPAY',
      providerOrderId
    }
  });
}

export async function lockPaymentByUserAndKey(
  userId: string,
  idempotencyKey: string,
  transaction: Transaction
): Promise<Payment | null> {
  return Payment.findOne({
    where: { userId, idempotencyKey },
    transaction,
    lock: Transaction.LOCK.UPDATE
  });
}

export async function insertInitiatedCheckout(
  input: {
    userId: string;
    planId: string;
    idempotencyKey: string;
    amountInCents: number;
    currency: string;
    billingInterval: PaymentBillingInterval;
  },
  transaction: Transaction
): Promise<Payment> {
  const now = new Date();
  return Payment.create(
    {
      userId: input.userId,
      planId: input.planId,
      subscriptionId: null,
      provider: 'RAZORPAY',
      providerOrderId: null,
      providerPaymentId: null,
      amountInCents: input.amountInCents,
      currency: input.currency,
      billingInterval: input.billingInterval,
      status: 'INITIATED',
      paymentType: 'SUBSCRIPTION_INITIAL',
      idempotencyKey: input.idempotencyKey,
      rawPayload: null,
      failureReason: null,
      paidAt: null,
      createdAt: now,
      updatedAt: now
    },
    { transaction }
  );
}

export async function assignProviderOrderId(paymentId: string, providerOrderId: string): Promise<void> {
  await sequelize.transaction(async (transaction) => {
    const [count] = await Payment.update(
      { providerOrderId },
      {
        where: {
          id: paymentId,
          status: 'INITIATED',
          providerOrderId: { [Op.is]: null }
        },
        transaction
      }
    );
    if (count === 1) {
      return;
    }

    const current = await Payment.findByPk(paymentId, {
      transaction,
      lock: Transaction.LOCK.UPDATE
    });
    if (current?.providerOrderId === providerOrderId) {
      return;
    }

    throw new OrderIdPersistError(providerOrderId);
  });
}

export class PaymentCaptureConflictError extends Error {
  constructor() {
    super('Payment capture was not applied.');
    this.name = 'PaymentCaptureConflictError';
  }
}

export async function lockPaymentByProviderOrderId(
  providerOrderId: string,
  transaction: Transaction
): Promise<Payment | null> {
  return Payment.findOne({
    where: { provider: 'RAZORPAY', providerOrderId },
    transaction,
    lock: Transaction.LOCK.UPDATE
  });
}

export async function lockPaymentByProviderPaymentId(
  providerPaymentId: string,
  transaction: Transaction
): Promise<Payment | null> {
  return Payment.findOne({
    where: { provider: 'RAZORPAY', providerPaymentId },
    transaction,
    lock: Transaction.LOCK.UPDATE
  });
}

export async function capturePayment(
  paymentId: string,
  input: {
    providerPaymentId: string;
    paidAt: Date;
    subscriptionId: string | null;
  },
  transaction: Transaction
): Promise<void> {
  const [count] = await Payment.update(
    {
      status: 'CAPTURED',
      providerPaymentId: input.providerPaymentId,
      paidAt: input.paidAt,
      subscriptionId: input.subscriptionId
    },
    {
      where: {
        id: paymentId,
        status: { [Op.in]: ['INITIATED', 'AUTHORIZED'] }
      },
      transaction
    }
  );
  if (count !== 1) {
    throw new PaymentCaptureConflictError();
  }
}

export async function markCheckoutFailed(paymentId: string): Promise<boolean> {
  return sequelize.transaction(async (transaction) => {
    const [count] = await Payment.update(
      { status: 'FAILED', failureReason: 'PROVIDER_REJECTED' },
      {
        where: {
          id: paymentId,
          status: 'INITIATED',
          providerOrderId: { [Op.is]: null }
        },
        transaction
      }
    );
    return count === 1;
  });
}
