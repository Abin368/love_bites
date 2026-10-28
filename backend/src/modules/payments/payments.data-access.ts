import { Op, Transaction, UniqueConstraintError } from 'sequelize';
import { sequelize } from '../../config/database';
import '../../database/associations';
import { Payment } from '../../database/models/payment.model';
import { Plan } from '../../database/models/plan.model';

const IDEMPOTENCY_INDEX = 'uq_payments_user_idempotency_key';

export class OrderIdPersistError extends Error {
  constructor(readonly providerOrderId: string) {
    super('Provider order id was not stored.');
    this.name = 'OrderIdPersistError';
  }
}

export function isIdempotencyUniqueViolation(error: unknown): boolean {
  if (!(error instanceof UniqueConstraintError)) {
    return false;
  }

  const parent = error.parent as { constraint?: string; detail?: string } | undefined;
  const fields = error.fields ?? {};
  const fieldNames = Object.keys(fields).join(' ');
  const text = `${parent?.constraint ?? ''} ${parent?.detail ?? ''} ${error.message} ${fieldNames}`;
  return text.includes(IDEMPOTENCY_INDEX) || text.includes('idempotency_key') || text.includes('idempotencyKey');
}

export async function lockPlanById(planId: string, transaction: Transaction): Promise<Plan | null> {
  return Plan.findOne({
    where: { id: planId },
    transaction,
    lock: Transaction.LOCK.UPDATE
  });
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
