import { createHmac, randomUUID } from 'crypto';
import request from 'supertest';
import { env } from '../../src/config/env';
import {
  Payment,
  PaymentBillingInterval,
  PaymentStatus,
  PaymentType
} from '../../src/database/models/payment.model';
import { Plan } from '../../src/database/models/plan.model';
import { ProcessedWebhook } from '../../src/database/models/processed-webhook.model';
import { Subscription } from '../../src/database/models/subscription.model';
import { User } from '../../src/database/models/user.model';
import { hasActivePremium } from '../../src/modules/likes/likes.data-access';
import { sequelize } from '../../src/config/database';

jest.mock('../../src/integrations/payment/razorpay.provider', () => {
  const actual = jest.requireActual('../../src/integrations/payment/razorpay.provider');
  return {
    ...actual,
    razorpayOrderProvider: {
      isConfigured: () => true,
      createOrder: jest.fn(),
      listOrdersByReceipt: jest.fn()
    }
  };
});

import { razorpayOrderProvider } from '../../src/integrations/payment/razorpay.provider';
import { backfillProviderOrderId } from '../../src/modules/payments/order-id-backfill.service';
import { app } from '../../src/app';

const listOrders = razorpayOrderProvider.listOrdersByReceipt as jest.Mock;
const createOrder = razorpayOrderProvider.createOrder as jest.Mock;
const WEBHOOK_SECRET = 'test-razorpay-webhook-secret';
const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';
const originalWebhookSecret = env.RAZORPAY_WEBHOOK_SECRET;
const HOUR_MS = 60 * 60 * 1000;

function timestamps(): { createdAt: Date; updatedAt: Date } {
  const now = new Date();
  return { createdAt: now, updatedAt: now };
}

function sign(raw: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(raw, 'utf8').digest('hex');
}

function captureFor(orderId: string, providerPaymentId: string, localPaymentId: string): string {
  return JSON.stringify({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: providerPaymentId,
          order_id: orderId,
          status: 'captured',
          amount: 49900,
          currency: 'INR',
          notes: { paymentId: localPaymentId }
        }
      }
    }
  });
}

function postEvent(raw: string, eventId: string) {
  return request(app)
    .post('/api/v1/webhooks/razorpay')
    .set('Content-Type', 'application/json')
    .set('X-Razorpay-Signature', sign(raw))
    .set('X-Razorpay-Event-Id', eventId)
    .send(raw);
}

async function createUser(): Promise<User> {
  return User.create({
    email: `backfill-${randomUUID()}@example.com`,
    phone: null,
    passwordHash: PASSWORD_HASH,
    role: 'USER',
    status: 'ACTIVE',
    emailVerified: false,
    phoneVerified: false
  });
}

async function createPlan(): Promise<Plan> {
  return Plan.create({
    code: 'PREMIUM_MONTHLY',
    name: 'Premium',
    billingInterval: 'MONTH',
    priceInCents: 49900,
    currency: 'INR',
    isActive: true,
    displayOrder: 2,
    ...timestamps()
  });
}

async function createPayment(input: {
  userId: string | null;
  planId: string | null;
  providerOrderId?: string | null;
  status?: PaymentStatus;
  paymentType?: PaymentType;
  provider?: string;
  billingInterval?: PaymentBillingInterval | null;
}): Promise<Payment> {
  return Payment.create({
    userId: input.userId,
    planId: input.planId,
    subscriptionId: null,
    provider: input.provider ?? 'RAZORPAY',
    providerOrderId: input.providerOrderId ?? null,
    providerPaymentId: null,
    amountInCents: 49900,
    currency: 'INR',
    billingInterval: input.billingInterval === undefined ? 'MONTH' : input.billingInterval,
    status: input.status ?? 'INITIATED',
    paymentType: input.paymentType ?? 'SUBSCRIPTION_INITIAL',
    idempotencyKey: randomUUID(),
    rawPayload: null,
    failureReason: input.status === 'FAILED' ? 'PROVIDER_REJECTED' : null,
    paidAt: null,
    ...timestamps()
  });
}

function listedOrder(payment: Payment, providerOrderId: string) {
  return {
    kind: 'complete' as const,
    orders: [
      {
        providerOrderId,
        receipt: payment.id,
        amountInCents: payment.amountInCents,
        currency: payment.currency,
        notesPaymentId: payment.id
      }
    ]
  };
}

beforeEach(() => {
  env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  listOrders.mockReset();
  createOrder.mockReset();
});

afterEach(() => {
  env.RAZORPAY_WEBHOOK_SECRET = originalWebhookSecret;
});

describe('provider order id backfill', () => {
  it('stores one matching order id and leaves the payment initiated', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const payment = await createPayment({ userId: user.id, planId: plan.id });
    listOrders.mockResolvedValue(listedOrder(payment, 'order_backfill_1'));

    const result = await backfillProviderOrderId(payment.id);

    expect(result).toEqual({ outcome: 'assigned', providerOrderId: 'order_backfill_1' });
    await payment.reload();
    expect(payment.status).toBe('INITIATED');
    expect(payment.providerOrderId).toBe('order_backfill_1');
    expect(payment.providerPaymentId).toBeNull();
    expect(payment.paidAt).toBeNull();
    expect(payment.subscriptionId).toBeNull();
    expect(payment.failureReason).toBeNull();
    expect(payment.rawPayload).toBeNull();
    expect(await Subscription.count()).toBe(0);
    expect(createOrder).not.toHaveBeenCalled();

    const repeat = await backfillProviderOrderId(payment.id);
    expect(repeat).toEqual({ outcome: 'already_assigned', providerOrderId: 'order_backfill_1' });
    expect(listOrders).toHaveBeenCalledTimes(1);
    await payment.reload();
    expect(payment.providerOrderId).toBe('order_backfill_1');
    expect(payment.status).toBe('INITIATED');
    expect(await Payment.count()).toBe(1);
    expect(await Subscription.count()).toBe(0);
  });

  it('does not change an ineligible or already assigned payment', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const captured = await createPayment({
      userId: user.id,
      planId: plan.id,
      status: 'CAPTURED',
      providerOrderId: 'order_captured'
    });
    const failed = await createPayment({ userId: user.id, planId: plan.id, status: 'FAILED' });
    const assigned = await createPayment({
      userId: user.id,
      planId: plan.id,
      providerOrderId: 'order_assigned'
    });
    const capturedBefore = captured.get({ plain: true });
    const failedBefore = failed.get({ plain: true });
    const assignedBefore = assigned.get({ plain: true });

    await expect(backfillProviderOrderId(captured.id)).resolves.toEqual({ outcome: 'ineligible' });
    await expect(backfillProviderOrderId(failed.id)).resolves.toEqual({ outcome: 'ineligible' });
    await expect(backfillProviderOrderId(assigned.id)).resolves.toEqual({
      outcome: 'already_assigned',
      providerOrderId: 'order_assigned'
    });

    await captured.reload();
    await failed.reload();
    await assigned.reload();
    expect(captured.get({ plain: true })).toEqual(capturedBefore);
    expect(failed.get({ plain: true })).toEqual(failedBefore);
    expect(assigned.get({ plain: true })).toEqual(assignedBefore);
    expect(listOrders).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
    expect(await Subscription.count()).toBe(0);
  });

  it('does not attach an order id when the capture snapshot is incomplete', async () => {
    const user = await createUser();
    const intervalUser = await createUser();
    const plan = await createPlan();
    const missingUser = await createPayment({ userId: null, planId: plan.id });
    const missingPlan = await createPayment({ userId: user.id, planId: null });
    const missingInterval = await createPayment({
      userId: intervalUser.id,
      planId: plan.id,
      billingInterval: null
    });
    const missingUserBefore = missingUser.get({ plain: true });
    const missingPlanBefore = missingPlan.get({ plain: true });
    const missingIntervalBefore = missingInterval.get({ plain: true });

    await expect(backfillProviderOrderId(missingUser.id)).resolves.toEqual({ outcome: 'ineligible' });
    await expect(backfillProviderOrderId(missingPlan.id)).resolves.toEqual({ outcome: 'ineligible' });
    await expect(backfillProviderOrderId(missingInterval.id)).resolves.toEqual({ outcome: 'ineligible' });

    await missingUser.reload();
    await missingPlan.reload();
    await missingInterval.reload();
    expect(missingUser.get({ plain: true })).toEqual(missingUserBefore);
    expect(missingPlan.get({ plain: true })).toEqual(missingPlanBefore);
    expect(missingInterval.get({ plain: true })).toEqual(missingIntervalBefore);
    expect(missingUser.providerOrderId).toBeNull();
    expect(missingPlan.providerOrderId).toBeNull();
    expect(missingInterval.providerOrderId).toBeNull();
    expect(listOrders).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
    expect(await Subscription.count()).toBe(0);
  });

  it('does not overwrite another payment when the order id is already stored or the row changes', async () => {
    const user = await createUser();
    const racingUser = await createUser();
    const plan = await createPlan();
    const holder = await createPayment({
      userId: user.id,
      planId: plan.id,
      providerOrderId: 'order_held',
      status: 'CAPTURED'
    });
    const eligible = await createPayment({ userId: user.id, planId: plan.id });
    const holderBefore = holder.get({ plain: true });
    listOrders.mockResolvedValue(listedOrder(eligible, 'order_held'));

    const conflict = await backfillProviderOrderId(eligible.id);

    expect(conflict).toEqual({ outcome: 'unchanged', reason: 'conflict' });
    await holder.reload();
    await eligible.reload();
    expect(holder.get({ plain: true })).toEqual(holderBefore);
    expect(eligible.status).toBe('INITIATED');
    expect(eligible.providerOrderId).toBeNull();

    const racing = await createPayment({ userId: racingUser.id, planId: plan.id });
    listOrders.mockImplementation(async () => {
      await racing.update({ status: 'FAILED', failureReason: 'PROVIDER_REJECTED' });
      return listedOrder(racing, 'order_race');
    });

    const raced = await backfillProviderOrderId(racing.id);

    expect(raced).toEqual({ outcome: 'unchanged', reason: 'conflict' });
    await racing.reload();
    expect(racing.status).toBe('FAILED');
    expect(racing.providerOrderId).toBeNull();
    expect(racing.failureReason).toBe('PROVIDER_REJECTED');
    await holder.reload();
    expect(holder.providerOrderId).toBe('order_held');
    expect(createOrder).not.toHaveBeenCalled();
    expect(await Subscription.count()).toBe(0);
  });

  it('lets a later captured webhook activate Premium once after the order id is stored', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const payment = await createPayment({ userId: user.id, planId: plan.id });
    listOrders.mockResolvedValue(listedOrder(payment, 'order_then_capture'));

    await backfillProviderOrderId(payment.id);
    expect(await Subscription.count()).toBe(0);
    const raw = captureFor('order_then_capture', 'pay_then_capture', payment.id);
    const first = await postEvent(raw, 'evt_backfill_capture');
    const second = await postEvent(raw, 'evt_backfill_capture');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await payment.reload();
    const subscription = await Subscription.findOne({ where: { userId: user.id } });
    expect(payment.status).toBe('CAPTURED');
    expect(payment.providerOrderId).toBe('order_then_capture');
    expect(payment.providerPaymentId).toBe('pay_then_capture');
    expect(payment.paidAt).not.toBeNull();
    expect(payment.subscriptionId).toBe(subscription?.id);
    expect(await Subscription.count()).toBe(1);
    expect(await ProcessedWebhook.count()).toBe(1);
    expect(await sequelize.transaction((transaction) => hasActivePremium(user.id, transaction))).toBe(true);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('keeps an early webhook retryable until backfill stores the order id', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const payment = await createPayment({ userId: user.id, planId: plan.id });
    const raw = captureFor('order_early', 'pay_early', payment.id);

    const early = await postEvent(raw, 'evt_early');

    expect(early.status).toBe(500);
    expect(early.body.error.code).toBe('WEBHOOK_PROCESSING_FAILED');
    expect(await ProcessedWebhook.findByPk('evt_early')).toBeNull();
    await payment.reload();
    expect(payment.status).toBe('INITIATED');
    expect(payment.providerOrderId).toBeNull();
    expect(await Subscription.count()).toBe(0);

    listOrders.mockResolvedValue(listedOrder(payment, 'order_early'));
    await backfillProviderOrderId(payment.id);
    const retry = await postEvent(raw, 'evt_early');

    expect(retry.status).toBe(200);
    await payment.reload();
    expect(payment.status).toBe('CAPTURED');
    expect(payment.providerOrderId).toBe('order_early');
    expect(await Subscription.count()).toBe(1);
    expect(await ProcessedWebhook.count()).toBe(1);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('captures a backfilled order without extending Premium that already qualifies', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const existing = await Subscription.create({
      userId: user.id,
      planId: plan.id,
      status: 'ACTIVE',
      autoRenew: false,
      currentPeriodStart: new Date(Date.now() - HOUR_MS),
      currentPeriodEnd: new Date(Date.now() + HOUR_MS),
      gracePeriodEnd: null,
      canceledAt: null,
      ...timestamps()
    });
    const periodEnd = existing.currentPeriodEnd.toISOString();
    const payment = await createPayment({ userId: user.id, planId: plan.id });
    listOrders.mockResolvedValue(listedOrder(payment, 'order_second_premium'));

    await backfillProviderOrderId(payment.id);
    await payment.reload();
    expect(payment.status).toBe('INITIATED');
    expect(payment.subscriptionId).toBeNull();
    expect(await Subscription.count()).toBe(1);

    const raw = captureFor('order_second_premium', 'pay_second_premium', payment.id);
    const response = await postEvent(raw, 'evt_second_premium');

    expect(response.status).toBe(200);
    await payment.reload();
    await existing.reload();
    expect(payment.status).toBe('CAPTURED');
    expect(payment.subscriptionId).toBeNull();
    expect(payment.paidAt).not.toBeNull();
    expect(existing.status).toBe('ACTIVE');
    expect(existing.currentPeriodEnd.toISOString()).toBe(periodEnd);
    expect(await Subscription.count()).toBe(1);
    expect(createOrder).not.toHaveBeenCalled();
  });
});
