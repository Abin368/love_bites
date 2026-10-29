import { createHmac, randomUUID } from 'crypto';
import request from 'supertest';
import { env } from '../../src/config/env';
import { sequelize } from '../../src/config/database';
import { Payment, PaymentBillingInterval, PaymentStatus, PaymentType } from '../../src/database/models/payment.model';
import { Plan } from '../../src/database/models/plan.model';
import { ProcessedWebhook } from '../../src/database/models/processed-webhook.model';
import { Subscription, SubscriptionStatus } from '../../src/database/models/subscription.model';
import { User } from '../../src/database/models/user.model';
import { hasActivePremium } from '../../src/modules/likes/likes.data-access';
import { addUtcBillingInterval } from '../../src/modules/subscriptions/billing-period';
import { app } from '../../src/app';

const WEBHOOK_SECRET = 'test-razorpay-webhook-secret';
const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';
const originalWebhookSecret = env.RAZORPAY_WEBHOOK_SECRET;
const HOUR_MS = 60 * 60 * 1000;

function timestamps(): { createdAt: Date; updatedAt: Date } {
  const now = new Date();
  return { createdAt: now, updatedAt: now };
}

function sign(raw: string, secret = WEBHOOK_SECRET): string {
  return createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
}

function postWebhook(raw: string, signature?: string | null, eventId?: string | null) {
  const call = request(app).post('/api/v1/webhooks/razorpay').set('Content-Type', 'application/json');
  if (signature !== undefined && signature !== null) {
    call.set('X-Razorpay-Signature', signature);
  }
  if (eventId !== undefined && eventId !== null) {
    call.set('X-Razorpay-Event-Id', eventId);
  }
  return call.send(raw);
}

function postEvent(raw: string, eventId: string) {
  return postWebhook(raw, sign(raw), eventId);
}

async function createUser(): Promise<User> {
  return User.create({
    email: `webhook-${randomUUID()}@example.com`,
    phone: null,
    passwordHash: PASSWORD_HASH,
    role: 'USER',
    status: 'ACTIVE',
    emailVerified: false,
    phoneVerified: false
  });
}

async function createPlan(billingInterval: 'MONTH' | 'YEAR' = 'MONTH', priceInCents = 49900): Promise<Plan> {
  return Plan.create({
    code: billingInterval === 'YEAR' ? 'PREMIUM_YEARLY' : 'PREMIUM_MONTHLY',
    name: 'Premium',
    billingInterval,
    priceInCents,
    currency: 'INR',
    isActive: true,
    displayOrder: 2,
    ...timestamps()
  });
}

async function createPayment(input: {
  userId: string | null;
  planId: string | null;
  providerOrderId: string | null;
  amountInCents?: number;
  currency?: string;
  billingInterval?: PaymentBillingInterval | null;
  status?: PaymentStatus;
  paymentType?: PaymentType;
  providerPaymentId?: string | null;
  subscriptionId?: string | null;
  failureReason?: string | null;
}): Promise<Payment> {
  return Payment.create({
    userId: input.userId,
    planId: input.planId,
    subscriptionId: input.subscriptionId ?? null,
    provider: 'RAZORPAY',
    providerOrderId: input.providerOrderId,
    providerPaymentId: input.providerPaymentId ?? null,
    amountInCents: input.amountInCents ?? 49900,
    currency: input.currency ?? 'INR',
    billingInterval: input.billingInterval === undefined ? 'MONTH' : input.billingInterval,
    status: input.status ?? 'INITIATED',
    paymentType: input.paymentType ?? 'SUBSCRIPTION_INITIAL',
    rawPayload: null,
    failureReason: input.failureReason ?? null,
    paidAt: null,
    ...timestamps()
  });
}

async function createSubscription(input: {
  userId: string;
  planId: string;
  status: SubscriptionStatus;
  periodEnd: Date;
  gracePeriodEnd?: Date | null;
  providerSubscriptionId?: string | null;
}): Promise<Subscription> {
  return Subscription.create({
    userId: input.userId,
    planId: input.planId,
    status: input.status,
    autoRenew: input.status !== 'CANCELED',
    currentPeriodStart: new Date(Date.now() - HOUR_MS),
    currentPeriodEnd: input.periodEnd,
    gracePeriodEnd: input.gracePeriodEnd ?? null,
    canceledAt: input.status === 'CANCELED' ? new Date() : null,
    providerSubscriptionId: input.providerSubscriptionId ?? null,
    ...timestamps()
  });
}

function captureBody(input: {
  eventId?: string;
  event?: string;
  orderId?: string;
  paymentId?: string;
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
  notes?: unknown;
  omitEntity?: boolean;
  extra?: Record<string, unknown>;
}): string {
  const entity: Record<string, unknown> = {
    id: input.paymentId ?? 'pay_test_1',
    order_id: input.orderId ?? 'order_test_1',
    status: input.status === undefined ? 'captured' : input.status,
    amount: input.amount === undefined ? 49900 : input.amount,
    currency: input.currency === undefined ? 'INR' : input.currency,
    ...input.extra
  };
  if (input.notes !== undefined) {
    entity.notes = input.notes;
  }
  return JSON.stringify({
    event: input.event ?? 'payment.captured',
    payload: input.omitEntity ? {} : { payment: { entity } }
  });
}

async function premium(userId: string): Promise<boolean> {
  return sequelize.transaction((transaction) => hasActivePremium(userId, transaction));
}

beforeEach(() => {
  env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

afterEach(() => {
  env.RAZORPAY_WEBHOOK_SECRET = originalWebhookSecret;
});

describe('POST /api/v1/webhooks/razorpay', () => {
  it('accepts a signed irrelevant event and writes nothing', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const payment = await createPayment({ userId: user.id, planId: plan.id, providerOrderId: 'order_irrelevant' });
    const before = payment.get({ plain: true });
    const authorized = JSON.stringify({ event: 'payment.authorized', payload: { payment: { entity: { id: 'pay_x' } } } });
    const paid = JSON.stringify({ event: 'order.paid' });

    const upper = await postWebhook(authorized, sign(authorized).toUpperCase(), 'evt_authorized');
    const lower = await postWebhook(paid, sign(paid), 'evt_paid');

    expect(upper.status).toBe(200);
    expect(upper.body).toEqual({ success: true, data: null, message: 'Webhook received.' });
    expect(lower.status).toBe(200);
    await payment.reload();
    expect(payment.get({ plain: true })).toEqual(before);
    expect(await Subscription.count()).toBe(0);
    expect(await ProcessedWebhook.count()).toBe(0);
    expect(await premium(user.id)).toBe(false);
  });

  it('rejects a missing, empty, or invalid signature without writing', async () => {
    const raw = '{"event":"order.paid","id":"evt_sig"}';
    const signature = sign(raw);
    const requests = [
      postWebhook(raw),
      postWebhook(raw, ''),
      postWebhook(raw, sign(raw, 'wrong-secret')),
      postWebhook(raw, signature.slice(0, 32)),
      postWebhook(raw, signature.slice(0, 63)),
      postWebhook(raw, `${signature.slice(0, 4)}zz${signature.slice(6)}`),
      postWebhook(raw, `${signature}00`),
      postWebhook('{"id":"evt_sig","event":"order.paid"}', signature),
      postWebhook('{\n  "event": "order.paid",\n  "id": "evt_sig"\n}', signature),
      postWebhook(raw, createHmac('sha256', WEBHOOK_SECRET).update('order_test_1|pay_test_1', 'utf8').digest('hex'))
    ];

    const responses = await Promise.all(requests);

    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toBe('Webhook signature is invalid.');
    }
    expect(await Payment.count()).toBe(0);
    expect(await Subscription.count()).toBe(0);
    expect(await ProcessedWebhook.count()).toBe(0);
  });

  it('rejects malformed JSON after a valid signature', async () => {
    const raw = '{';
    const response = await postWebhook(raw, sign(raw));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toBe('Invalid JSON payload structure.');
    expect(await ProcessedWebhook.count()).toBe(0);
  });

  it('fails closed when the webhook secret is missing and writes nothing', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const payment = await createPayment({ userId: user.id, planId: plan.id, providerOrderId: 'order_secret' });
    const before = payment.get({ plain: true });
    const raw = captureBody({ eventId: 'evt_secret', orderId: 'order_secret', paymentId: 'pay_secret' });
    env.RAZORPAY_WEBHOOK_SECRET = undefined;

    const response = await postWebhook(raw, sign(raw));

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('WEBHOOK_NOT_CONFIGURED');
    await payment.reload();
    expect(payment.get({ plain: true })).toEqual(before);
    expect(await Subscription.count()).toBe(0);
    expect(await ProcessedWebhook.count()).toBe(0);
  });

  it('activates Premium from the payment snapshot and omits personal payload fields', async () => {
    const user = await createUser();
    const plan = await createPlan('MONTH', 49900);
    const payment = await createPayment({
      userId: user.id,
      planId: plan.id,
      providerOrderId: 'order_activate',
      billingInterval: 'MONTH',
      amountInCents: 49900
    });
    const raw = captureBody({
      eventId: 'evt_activate',
      orderId: 'order_activate',
      paymentId: 'pay_activate',
      notes: { paymentId: payment.id },
      extra: { email: 'person@example.com', contact: '+919999999999', card: { last4: '4242' } }
    });

    const response = await postEvent(raw, 'evt_activate');

    expect(response.status).toBe(200);
    await payment.reload();
    const subscription = await Subscription.findOne({ where: { userId: user.id } });
    expect(subscription).not.toBeNull();
    expect(payment.status).toBe('CAPTURED');
    expect(payment.providerPaymentId).toBe('pay_activate');
    expect(payment.subscriptionId).toBe(subscription?.id);
    expect(payment.rawPayload).toBeNull();
    expect(payment.paidAt?.toISOString()).toBe(subscription?.currentPeriodStart.toISOString());
    expect(payment.billingInterval).toBe('MONTH');
    expect(payment.amountInCents).toBe(49900);
    expect(subscription?.status).toBe('ACTIVE');
    expect(subscription?.autoRenew).toBe(false);
    expect(subscription?.planId).toBe(plan.id);
    expect(subscription?.provider).toBe('RAZORPAY');
    expect(subscription?.providerSubscriptionId).toBeNull();
    expect(subscription?.providerCustomerId).toBeNull();
    expect(subscription?.gracePeriodEnd).toBeNull();
    expect(subscription?.canceledAt).toBeNull();
    expect(subscription?.endedAt).toBeNull();
    expect(subscription?.currentPeriodEnd.toISOString()).toBe(
      addUtcBillingInterval(subscription!.currentPeriodStart, 'MONTH').toISOString()
    );
    const event = await ProcessedWebhook.findByPk('evt_activate');
    expect(event?.eventType).toBe('payment.captured');
    expect(event?.provider).toBe('RAZORPAY');
    expect(event?.payload).toMatchObject({ outcome: 'activated', reason: null, orderId: 'order_activate' });
    expect(JSON.stringify(event?.payload)).not.toContain('person@example.com');
    expect(JSON.stringify(event?.payload)).not.toContain('4242');
    expect(await premium(user.id)).toBe(true);
    expect(await Subscription.count()).toBe(1);
  });

  it('uses the saved billing interval after the plan interval and price change', async () => {
    const user = await createUser();
    const plan = await createPlan('YEAR', 399900);
    const payment = await createPayment({
      userId: user.id,
      planId: plan.id,
      providerOrderId: 'order_year',
      amountInCents: 399900,
      billingInterval: 'YEAR'
    });
    await plan.update({ billingInterval: 'MONTH', priceInCents: 100 });
    const raw = captureBody({
      eventId: 'evt_year',
      orderId: 'order_year',
      paymentId: 'pay_year',
      amount: 399900
    });

    const response = await postEvent(raw, 'evt_year');

    expect(response.status).toBe(200);
    const subscription = await Subscription.findOne({ where: { userId: user.id } });
    expect(subscription?.planId).toBe(plan.id);
    expect(subscription?.currentPeriodEnd.toISOString()).toBe(
      addUtcBillingInterval(subscription!.currentPeriodStart, 'YEAR').toISOString()
    );
    await payment.reload();
    expect(payment.amountInCents).toBe(399900);
    expect(payment.billingInterval).toBe('YEAR');
  });

  it.each([
    ['amount mismatch', { amount: 49901 }, 'AMOUNT_MISMATCH'],
    ['currency mismatch', { currency: 'USD' }, 'CURRENCY_MISMATCH'],
    ['string amount', { amount: '49900' }, 'AMOUNT_INVALID'],
    ['status not captured', { status: 'authorized' }, 'STATUS_NOT_CAPTURED'],
    ['missing payment id', { paymentId: '' }, 'PAYMENT_ID_INVALID'],
    ['missing order id', { orderId: '' }, 'ORDER_ID_INVALID']
  ] as const)('does not grant Premium for %s', async (_label, override, reason) => {
    const user = await createUser();
    const plan = await createPlan();
    const payment = await createPayment({ userId: user.id, planId: plan.id, providerOrderId: 'order_bad' });
    const before = payment.get({ plain: true });
    const raw = captureBody({ eventId: `evt_${reason}`, orderId: 'order_bad', paymentId: 'pay_bad', ...override });

    const response = await postEvent(raw, `evt_${reason}`);

    expect(response.status).toBe(200);
    await payment.reload();
    expect(payment.get({ plain: true })).toEqual(before);
    expect(await Subscription.count()).toBe(0);
    expect(await premium(user.id)).toBe(false);
    expect((await ProcessedWebhook.findByPk(`evt_${reason}`))?.payload).toMatchObject({ outcome: 'conflict', reason });
  });

  it('does not grant Premium when the payment snapshot cannot activate', async () => {
    const user = await createUser();
    const plan = await createPlan('YEAR');
    const cases = [
      createPayment({
        userId: user.id,
        planId: plan.id,
        providerOrderId: 'order_type',
        paymentType: 'CREDIT_PURCHASE'
      }),
      createPayment({
        userId: null,
        planId: plan.id,
        providerOrderId: 'order_user',
        billingInterval: 'MONTH'
      }),
      createPayment({
        userId: user.id,
        planId: null,
        providerOrderId: 'order_plan',
        billingInterval: 'MONTH'
      }),
      createPayment({
        userId: user.id,
        planId: plan.id,
        providerOrderId: 'order_interval',
        billingInterval: null
      })
    ];
    const payments = await Promise.all(cases);
    const befores = payments.map((payment) => payment.get({ plain: true }));

    const responses = await Promise.all(
      payments.map((payment, index) => {
        const raw = captureBody({
          eventId: `evt_snapshot_${index}`,
          orderId: payment.providerOrderId ?? '',
          paymentId: `pay_snapshot_${index}`
        });
        return postEvent(raw, `evt_snapshot_${index}`);
      })
    );

    for (const response of responses) {
      expect(response.status).toBe(200);
    }
    for (const [index, payment] of payments.entries()) {
      await payment.reload();
      expect(payment.get({ plain: true })).toEqual(befores[index]);
    }
    expect(await Subscription.count()).toBe(0);
    expect((await ProcessedWebhook.findByPk('evt_snapshot_0'))?.payload).toMatchObject({ reason: 'PAYMENT_TYPE_INVALID' });
    expect((await ProcessedWebhook.findByPk('evt_snapshot_3'))?.payload).toMatchObject({ reason: 'SNAPSHOT_INCOMPLETE' });
  });

  it('does not grant Premium when notes.paymentId does not match the payment', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const payment = await createPayment({ userId: user.id, planId: plan.id, providerOrderId: 'order_note' });
    const before = payment.get({ plain: true });
    const raw = captureBody({
      eventId: 'evt_note',
      orderId: 'order_note',
      paymentId: 'pay_note',
      notes: { paymentId: randomUUID() }
    });

    const response = await postEvent(raw, 'evt_note');

    expect(response.status).toBe(200);
    await payment.reload();
    expect(payment.get({ plain: true })).toEqual(before);
    expect(await Subscription.count()).toBe(0);
    expect((await ProcessedWebhook.findByPk('evt_note'))?.payload).toMatchObject({ reason: 'NOTE_MISMATCH' });
  });

  it('returns non-2xx for an unknown order and does not record the event', async () => {
    const raw = captureBody({ eventId: 'evt_unknown', orderId: 'order_missing', paymentId: 'pay_missing' });

    const response = await postEvent(raw, 'evt_unknown');

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('WEBHOOK_PROCESSING_FAILED');
    expect(response.body.error.details).toEqual([]);
    expect(await ProcessedWebhook.findByPk('evt_unknown')).toBeNull();
    expect(await Payment.count()).toBe(0);
    expect(await Subscription.count()).toBe(0);
  });

  it('treats the same captured payment and the same event id as idempotent', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const payment = await createPayment({ userId: user.id, planId: plan.id, providerOrderId: 'order_same' });
    const raw = captureBody({ eventId: 'evt_same', orderId: 'order_same', paymentId: 'pay_same' });

    const first = await postEvent(raw, 'evt_same');
    const created = await Subscription.findOne({ where: { userId: user.id } });
    await payment.reload();
    const paidAt = payment.paidAt?.toISOString();
    const periodEnd = created?.currentPeriodEnd.toISOString();
    const second = await postEvent(raw, 'evt_same');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await payment.reload();
    await created?.reload();
    expect(await Subscription.count()).toBe(1);
    expect(await ProcessedWebhook.count()).toBe(1);
    expect(payment.paidAt?.toISOString()).toBe(paidAt);
    expect(created?.currentPeriodEnd.toISOString()).toBe(periodEnd);
    expect(payment.subscriptionId).toBe(created?.id);
  });

  it('records a distinct event id for an already captured payment without changing the period', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const payment = await createPayment({ userId: user.id, planId: plan.id, providerOrderId: 'order_distinct' });
    const firstRaw = captureBody({ eventId: 'evt_distinct_1', orderId: 'order_distinct', paymentId: 'pay_distinct' });
    await postEvent(firstRaw, 'evt_distinct_1');
    const created = await Subscription.findOne({ where: { userId: user.id } });
    const periodEnd = created?.currentPeriodEnd.toISOString();
    await payment.reload();
    const paidAt = payment.paidAt?.toISOString();
    const secondRaw = captureBody({ eventId: 'evt_distinct_2', orderId: 'order_distinct', paymentId: 'pay_distinct' });

    const response = await postEvent(secondRaw, 'evt_distinct_2');

    expect(response.status).toBe(200);
    await payment.reload();
    await created?.reload();
    expect(await Subscription.count()).toBe(1);
    expect(await ProcessedWebhook.count()).toBe(2);
    expect((await ProcessedWebhook.findByPk('evt_distinct_2'))?.payload).toMatchObject({ outcome: 'duplicate' });
    expect(payment.paidAt?.toISOString()).toBe(paidAt);
    expect(created?.currentPeriodEnd.toISOString()).toBe(periodEnd);
  });

  it('does not overwrite a conflicting provider payment id or a failed payment', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const captured = await createPayment({
      userId: user.id,
      planId: plan.id,
      providerOrderId: 'order_held',
      providerPaymentId: 'pay_held',
      status: 'CAPTURED'
    });
    const other = await createPayment({
      userId: user.id,
      planId: plan.id,
      providerOrderId: 'order_other',
      billingInterval: 'MONTH'
    });
    const failed = await createPayment({
      userId: user.id,
      planId: plan.id,
      providerOrderId: 'order_failed',
      status: 'FAILED',
      failureReason: 'PROVIDER_REJECTED'
    });
    const capturedBefore = captured.get({ plain: true });
    const otherBefore = other.get({ plain: true });
    const failedBefore = failed.get({ plain: true });
    const conflictRaw = captureBody({ eventId: 'evt_conflict_pay', orderId: 'order_other', paymentId: 'pay_held' });
    const failedRaw = captureBody({ eventId: 'evt_failed', orderId: 'order_failed', paymentId: 'pay_failed' });

    const conflict = await postEvent(conflictRaw, 'evt_conflict_pay');
    const rejected = await postEvent(failedRaw, 'evt_failed');

    expect(conflict.status).toBe(200);
    expect(rejected.status).toBe(200);
    await captured.reload();
    await other.reload();
    await failed.reload();
    expect(captured.get({ plain: true })).toEqual(capturedBefore);
    expect(other.get({ plain: true })).toEqual(otherBefore);
    expect(failed.get({ plain: true })).toEqual(failedBefore);
    expect(await Subscription.count()).toBe(0);
    expect((await ProcessedWebhook.findByPk('evt_conflict_pay'))?.payload).toMatchObject({
      reason: 'PROVIDER_PAYMENT_ID_CONFLICT'
    });
    expect((await ProcessedWebhook.findByPk('evt_failed'))?.payload).toMatchObject({ reason: 'PAYMENT_STATUS_CONFLICT' });
  });

  it('captures a payment that already has a subscription without creating another', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const existing = await createSubscription({
      userId: user.id,
      planId: plan.id,
      status: 'ACTIVE',
      periodEnd: new Date(Date.now() + HOUR_MS)
    });
    const before = existing.get({ plain: true });
    const payment = await createPayment({
      userId: user.id,
      planId: plan.id,
      providerOrderId: 'order_linked',
      subscriptionId: existing.id
    });
    const raw = captureBody({ eventId: 'evt_linked', orderId: 'order_linked', paymentId: 'pay_linked' });

    const response = await postEvent(raw, 'evt_linked');

    expect(response.status).toBe(200);
    await payment.reload();
    await existing.reload();
    expect(payment.status).toBe('CAPTURED');
    expect(payment.subscriptionId).toBe(existing.id);
    expect(payment.providerPaymentId).toBe('pay_linked');
    expect(await Subscription.count()).toBe(1);
    expect(existing.currentPeriodEnd.toISOString()).toBe(before.currentPeriodEnd.toISOString());
    expect(existing.status).toBe('ACTIVE');
  });

  it('captures a second order without extending a qualifying subscription', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const first = await createPayment({ userId: user.id, planId: plan.id, providerOrderId: 'order_first' });
    const second = await createPayment({ userId: user.id, planId: plan.id, providerOrderId: 'order_second' });
    const firstRaw = captureBody({ eventId: 'evt_first', orderId: 'order_first', paymentId: 'pay_first' });
    await postEvent(firstRaw, 'evt_first');
    const subscription = await Subscription.findOne({ where: { userId: user.id } });
    const periodEnd = subscription?.currentPeriodEnd.toISOString();
    const secondRaw = captureBody({ eventId: 'evt_second', orderId: 'order_second', paymentId: 'pay_second' });

    const response = await postEvent(secondRaw, 'evt_second');

    expect(response.status).toBe(200);
    await first.reload();
    await second.reload();
    await subscription?.reload();
    expect(first.subscriptionId).toBe(subscription?.id);
    expect(second.status).toBe('CAPTURED');
    expect(second.providerPaymentId).toBe('pay_second');
    expect(second.paidAt).not.toBeNull();
    expect(second.subscriptionId).toBeNull();
    expect(second.rawPayload).toBeNull();
    expect(await Subscription.count()).toBe(1);
    expect(subscription?.currentPeriodEnd.toISOString()).toBe(periodEnd);
  });

  it('expires an elapsed nonterminal subscription inside the capture transaction', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const elapsed = await createSubscription({
      userId: user.id,
      planId: plan.id,
      status: 'ACTIVE',
      periodEnd: new Date(Date.now() - HOUR_MS),
      gracePeriodEnd: null,
      providerSubscriptionId: 'sub_old'
    });
    const payment = await createPayment({ userId: user.id, planId: plan.id, providerOrderId: 'order_elapsed' });
    const raw = captureBody({ eventId: 'evt_elapsed', orderId: 'order_elapsed', paymentId: 'pay_elapsed' });

    const response = await postEvent(raw, 'evt_elapsed');

    expect(response.status).toBe(200);
    await elapsed.reload();
    await payment.reload();
    const created = await Subscription.findOne({ where: { userId: user.id, status: 'ACTIVE' } });
    expect(elapsed.status).toBe('EXPIRED');
    expect(elapsed.providerSubscriptionId).toBe('sub_old');
    expect(elapsed.endedAt?.toISOString()).toBe(created?.currentPeriodStart.toISOString());
    expect(created?.id).not.toBe(elapsed.id);
    expect(payment.subscriptionId).toBe(created?.id);
    expect(await premium(user.id)).toBe(true);
  });

  it('keeps a future grace period and an in-period canceled subscription unchanged', async () => {
    const user = await createUser();
    const other = await createUser();
    const plan = await createPlan();
    const graceEnd = new Date(Date.now() + HOUR_MS);
    const grace = await createSubscription({
      userId: user.id,
      planId: plan.id,
      status: 'ACTIVE',
      periodEnd: new Date(Date.now() - HOUR_MS),
      gracePeriodEnd: graceEnd
    });
    const canceledEnd = new Date(Date.now() + 2 * HOUR_MS);
    const canceled = await createSubscription({
      userId: other.id,
      planId: plan.id,
      status: 'CANCELED',
      periodEnd: canceledEnd
    });
    const gracePayment = await createPayment({ userId: user.id, planId: plan.id, providerOrderId: 'order_grace' });
    const canceledPayment = await createPayment({
      userId: other.id,
      planId: plan.id,
      providerOrderId: 'order_canceled'
    });
    const graceBefore = grace.currentPeriodEnd.toISOString();
    const canceledBefore = canceled.get({ plain: true });

    const graceRaw = captureBody({ eventId: 'evt_grace', orderId: 'order_grace', paymentId: 'pay_grace' });
    const canceledRaw = captureBody({ eventId: 'evt_canceled', orderId: 'order_canceled', paymentId: 'pay_canceled' });
    const graceResponse = await postEvent(graceRaw, 'evt_grace');
    const canceledResponse = await postEvent(canceledRaw, 'evt_canceled');

    expect(graceResponse.status).toBe(200);
    expect(canceledResponse.status).toBe(200);
    await grace.reload();
    await canceled.reload();
    await gracePayment.reload();
    await canceledPayment.reload();
    expect(grace.status).toBe('ACTIVE');
    expect(grace.currentPeriodEnd.toISOString()).toBe(graceBefore);
    expect(grace.gracePeriodEnd?.toISOString()).toBe(graceEnd.toISOString());
    expect(grace.endedAt).toBeNull();
    expect(gracePayment.status).toBe('CAPTURED');
    expect(gracePayment.subscriptionId).toBeNull();
    expect(canceled.get({ plain: true })).toEqual(canceledBefore);
    expect(canceledPayment.status).toBe('CAPTURED');
    expect(canceledPayment.subscriptionId).toBeNull();
    expect(await Subscription.count({ where: { userId: user.id } })).toBe(1);
    expect(await Subscription.count({ where: { userId: other.id } })).toBe(1);
    expect(await premium(user.id)).toBe(true);
    expect(await premium(other.id)).toBe(true);
  });

  it('rolls back expiration, subscription creation, and the payment update when event recording fails', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const elapsed = await createSubscription({
      userId: user.id,
      planId: plan.id,
      status: 'ACTIVE',
      periodEnd: new Date(Date.now() - HOUR_MS)
    });
    const before = elapsed.get({ plain: true });
    const payment = await createPayment({ userId: user.id, planId: plan.id, providerOrderId: 'order_rollback' });
    const paymentBefore = payment.get({ plain: true });
    const hook = 'webhook-fail-insert';
    ProcessedWebhook.addHook('beforeCreate', hook, () => {
      throw new Error('forced webhook failure');
    });

    try {
      const raw = captureBody({ eventId: 'evt_rollback', orderId: 'order_rollback', paymentId: 'pay_rollback' });
      const response = await postEvent(raw, 'evt_rollback');

      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(JSON.stringify(response.body)).not.toContain('forced webhook failure');
    } finally {
      ProcessedWebhook.removeHook('beforeCreate', hook);
    }

    await elapsed.reload();
    await payment.reload();
    expect(elapsed.get({ plain: true })).toEqual(before);
    expect(payment.get({ plain: true })).toEqual(paymentBefore);
    expect(await Subscription.count()).toBe(1);
    expect(await ProcessedWebhook.count()).toBe(0);
    expect(await premium(user.id)).toBe(false);
  });

  it('applies one subscription when the same event is delivered concurrently', async () => {
    const user = await createUser();
    const plan = await createPlan();
    await createPayment({ userId: user.id, planId: plan.id, providerOrderId: 'order_concurrent' });
    const raw = captureBody({ eventId: 'evt_concurrent', orderId: 'order_concurrent', paymentId: 'pay_concurrent' });

    const [first, second] = await Promise.all([postEvent(raw, 'evt_concurrent'), postEvent(raw, 'evt_concurrent')]);

    expect([first.status, second.status].sort()).toEqual([200, 200]);
    expect(await Subscription.count({ where: { userId: user.id } })).toBe(1);
    expect(await ProcessedWebhook.count()).toBe(1);
    const payment = await Payment.findOne({ where: { providerOrderId: 'order_concurrent' } });
    expect(payment?.status).toBe('CAPTURED');
    expect(payment?.subscriptionId).not.toBeNull();
  });

  it('rolls back the losing order when two captures race and records it without extending on retry', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const first = await createPayment({ userId: user.id, planId: plan.id, providerOrderId: 'order_race_1' });
    const second = await createPayment({ userId: user.id, planId: plan.id, providerOrderId: 'order_race_2' });
    const firstRaw = captureBody({ eventId: 'evt_race_1', orderId: 'order_race_1', paymentId: 'pay_race_1' });
    const secondRaw = captureBody({ eventId: 'evt_race_2', orderId: 'order_race_2', paymentId: 'pay_race_2' });
    let arrived = 0;
    let release: () => void = () => undefined;
    const opened = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hook = `webhook-race-${randomUUID()}`;
    Subscription.addHook('beforeCreate', hook, async () => {
      arrived += 1;
      if (arrived >= 2) {
        release();
        return;
      }
      await opened;
    });

    let responses: Array<{ status: number; body: { error?: { details?: unknown } } }> = [];
    try {
      responses = await Promise.all([postEvent(firstRaw, 'evt_race_1'), postEvent(secondRaw, 'evt_race_2')]);
    } finally {
      Subscription.removeHook('beforeCreate', hook);
    }

    const failed = responses.filter((response) => response.status !== 200);
    const succeeded = responses.filter((response) => response.status === 200);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].status).toBe(500);
    expect(failed[0].body.error?.details).toEqual([]);
    expect(JSON.stringify(failed[0].body)).not.toContain('uq_subscriptions');
    expect(await Subscription.count({ where: { userId: user.id } })).toBe(1);
    await first.reload();
    await second.reload();
    const loser = first.status === 'INITIATED' ? first : second;
    const winner = loser === first ? second : first;
    const loserRaw = loser === first ? firstRaw : secondRaw;
    const loserEventId = loser === first ? 'evt_race_1' : 'evt_race_2';
    expect(loser.providerPaymentId).toBeNull();
    expect(loser.subscriptionId).toBeNull();
    expect(await ProcessedWebhook.findByPk(loserEventId)).toBeNull();
    const winnerSubscription = await Subscription.findOne({ where: { userId: user.id } });
    const periodEnd = winnerSubscription?.currentPeriodEnd.toISOString();
    expect(winner.subscriptionId).toBe(winnerSubscription?.id);

    const retry = await postEvent(loserRaw, loserEventId);

    expect(retry.status).toBe(200);
    await loser.reload();
    await winnerSubscription?.reload();
    expect(loser.status).toBe('CAPTURED');
    expect(loser.subscriptionId).toBeNull();
    expect(loser.paidAt).not.toBeNull();
    expect(await Subscription.count({ where: { userId: user.id } })).toBe(1);
    expect(winnerSubscription?.currentPeriodEnd.toISOString()).toBe(periodEnd);
    expect(await ProcessedWebhook.findByPk(loserEventId)).not.toBeNull();
  });

  it('activates Premium from a Razorpay envelope that has no top-level id', async () => {
    const user = await createUser();
    const plan = await createPlan('MONTH', 49900);
    const payment = await createPayment({
      userId: user.id,
      planId: plan.id,
      providerOrderId: 'order_header_activate',
      billingInterval: 'MONTH',
      amountInCents: 49900
    });
    const eventId = 'evt_header_activate';
    const raw = JSON.stringify({
      entity: 'event',
      account_id: 'acc_test_header',
      event: 'payment.captured',
      contains: ['payment'],
      payload: {
        payment: {
          entity: {
            id: 'pay_header_activate',
            entity: 'payment',
            amount: 49900,
            currency: 'INR',
            status: 'captured',
            order_id: 'order_header_activate',
            email: 'person@example.com',
            contact: '+919999999999',
            notes: [],
            created_at: 1567674599
          }
        }
      },
      created_at: 1567674606
    });
    const header = `  ${eventId}  `;

    const first = await postWebhook(raw, sign(raw), header);

    expect(first.status).toBe(200);
    await payment.reload();
    const subscription = await Subscription.findOne({ where: { userId: user.id } });
    expect(payment.status).toBe('CAPTURED');
    expect(payment.providerPaymentId).toBe('pay_header_activate');
    expect(payment.subscriptionId).toBe(subscription?.id);
    expect(subscription?.status).toBe('ACTIVE');
    expect(subscription?.autoRenew).toBe(false);
    expect(await premium(user.id)).toBe(true);
    const stored = await ProcessedWebhook.findByPk(eventId);
    expect(stored?.eventType).toBe('payment.captured');
    expect(stored?.payload).toMatchObject({ eventId, outcome: 'activated', orderId: 'order_header_activate' });
    expect(JSON.stringify(stored?.payload)).not.toContain('person@example.com');
    expect(await ProcessedWebhook.findByPk('pay_header_activate')).toBeNull();
    expect(await ProcessedWebhook.count()).toBe(1);
    const paidAt = payment.paidAt?.toISOString();
    const periodEnd = subscription?.currentPeriodEnd.toISOString();

    const second = await postWebhook(raw, sign(raw), header);

    expect(second.status).toBe(200);
    await payment.reload();
    await subscription?.reload();
    expect(await Subscription.count()).toBe(1);
    expect(await ProcessedWebhook.count()).toBe(1);
    expect(payment.paidAt?.toISOString()).toBe(paidAt);
    expect(subscription?.currentPeriodEnd.toISOString()).toBe(periodEnd);
    expect(payment.subscriptionId).toBe(subscription?.id);
  });

  it('rejects a missing, empty, or whitespace-only event id before any write', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const payment = await createPayment({
      userId: user.id,
      planId: plan.id,
      providerOrderId: 'order_bad_header'
    });
    const before = payment.get({ plain: true });
    const raw = JSON.stringify({
      id: 'evt_body_must_not_win',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_bad_header',
            order_id: 'order_bad_header',
            status: 'captured',
            amount: 49900,
            currency: 'INR'
          }
        }
      }
    });
    const signature = sign(raw);
    const responses = await Promise.all([
      postWebhook(raw, signature),
      postWebhook(raw, signature, ''),
      postWebhook(raw, signature, '   '),
      postWebhook(raw, signature, '\t')
    ]);

    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toBe('Webhook event id is invalid.');
    }
    await payment.reload();
    expect(payment.get({ plain: true })).toEqual(before);
    expect(await Subscription.count()).toBe(0);
    expect(await ProcessedWebhook.count()).toBe(0);
    expect(await ProcessedWebhook.findByPk('evt_body_must_not_win')).toBeNull();
    expect(await ProcessedWebhook.findByPk('pay_bad_header')).toBeNull();
  });

  it('rejects an event id longer than 255 characters before any write', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const payment = await createPayment({
      userId: user.id,
      planId: plan.id,
      providerOrderId: 'order_long_header'
    });
    const before = payment.get({ plain: true });
    const raw = captureBody({
      orderId: 'order_long_header',
      paymentId: 'pay_long_header'
    });

    const response = await postWebhook(raw, sign(raw), ` ${'e'.repeat(256)} `);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toBe('Webhook event id is invalid.');
    await payment.reload();
    expect(payment.get({ plain: true })).toEqual(before);
    expect(await Subscription.count()).toBe(0);
    expect(await ProcessedWebhook.count()).toBe(0);
  });
});
