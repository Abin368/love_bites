import { UniqueConstraintError } from 'sequelize';
import {
  PaymentProviderOutcomeUnknownError,
  PaymentProviderRejectedError
} from '../../src/integrations/payment/payment.interface';
import {
  MIN_RECOVERY_AGE_MS,
  WINDOW_BOUNDARY_PAD_SECONDS,
  WINDOW_CLOCK_SKEW_PAD_SECONDS
} from '../../src/modules/payments/order-id-backfill.service';

jest.mock('../../src/modules/payments/payments.data-access', () => ({
  findPaymentById: jest.fn(),
  assignProviderOrderId: jest.fn(),
  OrderIdPersistError: class OrderIdPersistError extends Error {
    constructor(readonly providerOrderId: string) {
      super('Provider order id was not stored.');
      this.name = 'OrderIdPersistError';
    }
  }
}));

jest.mock('../../src/integrations/payment/razorpay.provider', () => ({
  razorpayOrderProvider: {
    isConfigured: jest.fn(() => true),
    createOrder: jest.fn(),
    listOrdersInWindow: jest.fn()
  }
}));

import { razorpayOrderProvider } from '../../src/integrations/payment/razorpay.provider';
import { backfillProviderOrderId } from '../../src/modules/payments/order-id-backfill.service';
import {
  assignProviderOrderId,
  findPaymentById,
  OrderIdPersistError
} from '../../src/modules/payments/payments.data-access';

const findPayment = findPaymentById as jest.Mock;
const assignOrder = assignProviderOrderId as jest.Mock;
const listOrders = razorpayOrderProvider.listOrdersInWindow as jest.Mock;
const createOrder = razorpayOrderProvider.createOrder as jest.Mock;
const isConfigured = razorpayOrderProvider.isConfigured as jest.Mock;

const paymentId = '6e6e0001-0000-4000-8000-0000000000aa';
const recoveredAt = new Date('2026-11-05T12:00:00.900Z');
const createdAt = new Date(recoveredAt.getTime() - 2 * 60 * 60 * 1000);

function expectedWindow(anchor = createdAt, now = recoveredAt) {
  return {
    from: Math.floor(anchor.getTime() / 1000) - WINDOW_CLOCK_SKEW_PAD_SECONDS - WINDOW_BOUNDARY_PAD_SECONDS,
    to: Math.floor(now.getTime() / 1000) + WINDOW_BOUNDARY_PAD_SECONDS
  };
}

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: paymentId,
    provider: 'RAZORPAY',
    paymentType: 'SUBSCRIPTION_INITIAL',
    status: 'INITIATED',
    providerOrderId: null,
    amountInCents: 49900,
    currency: 'INR',
    userId: '6e6e0001-0000-4000-8000-0000000000bb',
    planId: '6e6e0001-0000-4000-8000-000000000002',
    billingInterval: 'MONTH',
    subscriptionId: null,
    providerPaymentId: null,
    paidAt: null,
    failureReason: null,
    createdAt,
    ...overrides
  };
}

function matchingOrder(overrides: Record<string, unknown> = {}) {
  return {
    providerOrderId: 'order_backfill_1',
    receipt: paymentId,
    amountInCents: 49900,
    currency: 'INR',
    notesPaymentId: paymentId,
    ...overrides
  };
}

function unrelatedOrder() {
  return matchingOrder({
    providerOrderId: 'order_other',
    receipt: '6e6e0001-0000-4000-8000-0000000000cc',
    notesPaymentId: '6e6e0001-0000-4000-8000-0000000000cc'
  });
}

beforeEach(() => {
  findPayment.mockReset();
  assignOrder.mockReset();
  listOrders.mockReset();
  createOrder.mockReset();
  isConfigured.mockReset();
  isConfigured.mockReturnValue(true);
  assignOrder.mockResolvedValue(undefined);
});

describe('backfillProviderOrderId', () => {
  it('does not look up or replace an order id that is already stored', async () => {
    findPayment.mockResolvedValue(payment({ providerOrderId: 'order_existing' }));

    await expect(backfillProviderOrderId(paymentId, recoveredAt)).resolves.toEqual({
      outcome: 'already_assigned',
      providerOrderId: 'order_existing'
    });
    expect(listOrders).not.toHaveBeenCalled();
    expect(assignOrder).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('does not backfill a captured payment, a failed payment, or an ineligible row', async () => {
    const rows = [
      payment({ status: 'CAPTURED', providerPaymentId: 'pay_1', paidAt: new Date() }),
      payment({ status: 'FAILED', failureReason: 'PROVIDER_REJECTED' }),
      payment({ status: 'AUTHORIZED' }),
      payment({ provider: 'OTHER' }),
      payment({ paymentType: 'CREDIT_PURCHASE' }),
      payment({ amountInCents: 0 }),
      payment({ currency: '' })
    ];

    for (const row of rows) {
      findPayment.mockResolvedValue(row);
      await expect(backfillProviderOrderId(paymentId, recoveredAt)).resolves.toEqual({ outcome: 'ineligible' });
    }

    findPayment.mockResolvedValue(null);
    await expect(backfillProviderOrderId(paymentId, recoveredAt)).resolves.toEqual({ outcome: 'ineligible' });
    expect(listOrders).not.toHaveBeenCalled();
    expect(assignOrder).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('does not look up a payment whose capture snapshot is incomplete', async () => {
    const rows = [
      payment({ userId: null }),
      payment({ planId: null }),
      payment({ billingInterval: null }),
      payment({ billingInterval: 'NONE' })
    ];

    for (const row of rows) {
      findPayment.mockResolvedValue(row);
      await expect(backfillProviderOrderId(paymentId, recoveredAt)).resolves.toEqual({ outcome: 'ineligible' });
    }

    expect(listOrders).not.toHaveBeenCalled();
    expect(assignOrder).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('does not call the provider for an invalid, future, or too-recent payment timestamp', async () => {
    const rows = [
      payment({ createdAt: new Date(Number.NaN) }),
      payment({ createdAt: new Date(recoveredAt.getTime() + WINDOW_CLOCK_SKEW_PAD_SECONDS * 1000 + 1) }),
      payment({ createdAt: new Date(recoveredAt.getTime() - (MIN_RECOVERY_AGE_MS - 1)) })
    ];

    for (const row of rows) {
      findPayment.mockResolvedValue(row);
      await expect(backfillProviderOrderId(paymentId, recoveredAt)).resolves.toEqual({
        outcome: 'unchanged',
        reason: 'uncertain_window'
      });
    }

    expect(listOrders).not.toHaveBeenCalled();
    expect(assignOrder).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('keeps a complete MONTH or YEAR snapshot eligible', async () => {
    for (const billingInterval of ['MONTH', 'YEAR'] as const) {
      findPayment.mockResolvedValue(payment({ billingInterval }));
      listOrders.mockResolvedValueOnce({ kind: 'complete', orders: [matchingOrder()] });
      await expect(backfillProviderOrderId(paymentId, recoveredAt)).resolves.toEqual({
        outcome: 'assigned',
        providerOrderId: 'order_backfill_1'
      });
    }

    expect(listOrders).toHaveBeenCalledTimes(2);
    expect(assignOrder).toHaveBeenCalledTimes(2);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('requests integer-second bounds and assigns the only fully matching tied order', async () => {
    findPayment.mockResolvedValue(payment());
    listOrders.mockResolvedValue({ kind: 'complete', orders: [unrelatedOrder(), matchingOrder()] });

    await expect(backfillProviderOrderId(paymentId, recoveredAt)).resolves.toEqual({
      outcome: 'assigned',
      providerOrderId: 'order_backfill_1'
    });
    const window = expectedWindow();
    expect(listOrders).toHaveBeenCalledWith(window);
    expect(Number.isInteger(window.from)).toBe(true);
    expect(Number.isInteger(window.to)).toBe(true);
    expect(window.from).toBeLessThan(Math.floor(createdAt.getTime() / 1000));
    expect(window.to).toBeGreaterThan(Math.floor(recoveredAt.getTime() / 1000));
    expect(assignOrder).toHaveBeenCalledWith(paymentId, 'order_backfill_1');
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('ties an order by receipt or by notes.paymentId and does not ignore a partial match', async () => {
    findPayment.mockResolvedValue(payment());
    listOrders.mockResolvedValueOnce({
      kind: 'complete',
      orders: [matchingOrder({ notesPaymentId: null })]
    });
    await expect(backfillProviderOrderId(paymentId, recoveredAt)).resolves.toEqual({
      outcome: 'unchanged',
      reason: 'note_mismatch'
    });

    listOrders.mockResolvedValueOnce({
      kind: 'complete',
      orders: [matchingOrder({ receipt: '6e6e0001-0000-4000-8000-0000000000bb' })]
    });
    await expect(backfillProviderOrderId(paymentId, recoveredAt)).resolves.toEqual({
      outcome: 'unchanged',
      reason: 'receipt_mismatch'
    });
    expect(assignOrder).not.toHaveBeenCalled();
  });

  it('leaves the payment unchanged when the listing is empty, ambiguous, incomplete, or malformed', async () => {
    findPayment.mockResolvedValue(payment());
    listOrders.mockResolvedValueOnce({ kind: 'complete', orders: [unrelatedOrder()] });
    await expect(backfillProviderOrderId(paymentId, recoveredAt)).resolves.toEqual({
      outcome: 'unchanged',
      reason: 'no_match'
    });

    listOrders.mockResolvedValueOnce({
      kind: 'complete',
      orders: [matchingOrder(), matchingOrder({ providerOrderId: 'order_2' })]
    });
    await expect(backfillProviderOrderId(paymentId, recoveredAt)).resolves.toEqual({
      outcome: 'unchanged',
      reason: 'ambiguous'
    });

    listOrders.mockResolvedValueOnce({
      kind: 'complete',
      orders: [
        matchingOrder(),
        matchingOrder({
          providerOrderId: 'order_partial',
          receipt: '6e6e0001-0000-4000-8000-0000000000bb',
          amountInCents: 100
        })
      ]
    });
    await expect(backfillProviderOrderId(paymentId, recoveredAt)).resolves.toEqual({
      outcome: 'unchanged',
      reason: 'ambiguous'
    });

    listOrders.mockResolvedValueOnce({ kind: 'incomplete' });
    await expect(backfillProviderOrderId(paymentId, recoveredAt)).resolves.toEqual({
      outcome: 'unchanged',
      reason: 'incomplete'
    });

    listOrders.mockResolvedValueOnce({ kind: 'malformed' });
    await expect(backfillProviderOrderId(paymentId, recoveredAt)).resolves.toEqual({
      outcome: 'unchanged',
      reason: 'malformed'
    });
    expect(assignOrder).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('does not assign when receipt, note, amount, or currency is missing or different', async () => {
    findPayment.mockResolvedValue(payment());
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ receipt: null }, 'receipt_mismatch'],
      [{ receipt: '6e6e0001-0000-4000-8000-0000000000bb' }, 'receipt_mismatch'],
      [{ notesPaymentId: null }, 'note_mismatch'],
      [{ notesPaymentId: '6e6e0001-0000-4000-8000-0000000000bb' }, 'note_mismatch'],
      [{ amountInCents: null }, 'amount_mismatch'],
      [{ amountInCents: 100 }, 'amount_mismatch'],
      [{ currency: null }, 'currency_mismatch'],
      [{ currency: 'USD' }, 'currency_mismatch']
    ];

    for (const [overrides, reason] of cases) {
      listOrders.mockResolvedValueOnce({ kind: 'complete', orders: [matchingOrder(overrides)] });
      await expect(backfillProviderOrderId(paymentId, recoveredAt)).resolves.toEqual({ outcome: 'unchanged', reason });
    }
    expect(assignOrder).not.toHaveBeenCalled();
  });

  it('does not assign when the provider times out, is rate limited, or returns a server error', async () => {
    findPayment.mockResolvedValue(payment());
    listOrders.mockRejectedValue(new PaymentProviderOutcomeUnknownError());

    await expect(backfillProviderOrderId(paymentId, recoveredAt)).rejects.toBeInstanceOf(
      PaymentProviderOutcomeUnknownError
    );
    expect(assignOrder).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('does not turn a provider rejection into no_match', async () => {
    findPayment.mockResolvedValue(payment());
    listOrders.mockRejectedValue(new PaymentProviderRejectedError());

    await expect(backfillProviderOrderId(paymentId, recoveredAt)).rejects.toBeInstanceOf(PaymentProviderRejectedError);
    expect(assignOrder).not.toHaveBeenCalled();
  });

  it('is idempotent once an order id has been stored and does not create a subscription field', async () => {
    findPayment.mockResolvedValueOnce(payment()).mockResolvedValueOnce(payment({ providerOrderId: 'order_backfill_1' }));
    listOrders.mockResolvedValue({ kind: 'complete', orders: [matchingOrder()] });

    await expect(backfillProviderOrderId(paymentId, recoveredAt)).resolves.toEqual({
      outcome: 'assigned',
      providerOrderId: 'order_backfill_1'
    });
    await expect(backfillProviderOrderId(paymentId, recoveredAt)).resolves.toEqual({
      outcome: 'already_assigned',
      providerOrderId: 'order_backfill_1'
    });
    expect(listOrders).toHaveBeenCalledTimes(1);
    expect(assignOrder).toHaveBeenCalledTimes(1);
    expect(assignOrder.mock.calls[0]).toEqual([paymentId, 'order_backfill_1']);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('reports a conflict when conditional persistence refuses the write', async () => {
    findPayment.mockResolvedValue(payment());
    listOrders.mockResolvedValue({ kind: 'complete', orders: [matchingOrder()] });
    assignOrder.mockRejectedValueOnce(new OrderIdPersistError('order_backfill_1'));

    await expect(backfillProviderOrderId(paymentId, recoveredAt)).resolves.toEqual({
      outcome: 'unchanged',
      reason: 'conflict'
    });

    assignOrder.mockRejectedValueOnce(new UniqueConstraintError({ message: 'duplicate order' }));
    await expect(backfillProviderOrderId(paymentId, recoveredAt)).resolves.toEqual({
      outcome: 'unchanged',
      reason: 'conflict'
    });
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('rethrows an unexpected database error instead of reporting a conflict', async () => {
    findPayment.mockResolvedValue(payment());
    listOrders.mockResolvedValue({ kind: 'complete', orders: [matchingOrder()] });
    const failure = new Error('database connection failed');
    assignOrder.mockRejectedValueOnce(failure);

    await expect(backfillProviderOrderId(paymentId, recoveredAt)).rejects.toBe(failure);
    expect(createOrder).not.toHaveBeenCalled();
  });
});
