import { randomUUID } from 'crypto';
import request from 'supertest';
import { UniqueConstraintError } from 'sequelize';
import { sequelize } from '../../src/config/database';
import { Payment } from '../../src/database/models/payment.model';
import { Plan } from '../../src/database/models/plan.model';
import { PlanPriceChange } from '../../src/database/models/plan-price-change.model';
import { Subscription, SubscriptionStatus } from '../../src/database/models/subscription.model';
import { UsageRecord } from '../../src/database/models/usage-record.model';
import { User, UserRole } from '../../src/database/models/user.model';
import { PaymentProviderOutcomeUnknownError, PaymentProviderRejectedError } from '../../src/integrations/payment/payment.interface';
import { hasActivePremium } from '../../src/modules/likes/likes.data-access';
import * as paymentsDataAccess from '../../src/modules/payments/payments.data-access';
import { findQualifyingPremiumSubscription } from '../../src/modules/subscriptions/subscriptions.data-access';
import { signAccessToken } from '../../src/utils/jwt';

jest.mock('../../src/integrations/payment/razorpay.provider', () => ({
  razorpayOrderProvider: {
    isConfigured: () => true,
    publicKeyId: () => 'rzp_test_public',
    createOrder: jest.fn()
  }
}));

import { razorpayOrderProvider } from '../../src/integrations/payment/razorpay.provider';
import { app } from '../../src/app';

const createOrder = razorpayOrderProvider.createOrder as jest.Mock;
const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';
const HOUR_MS = 60 * 60 * 1000;

function timestamps(): { createdAt: Date; updatedAt: Date } {
  const now = new Date();
  return { createdAt: now, updatedAt: now };
}

function tokenFor(userId: string, role: UserRole): string {
  return signAccessToken({
    sub: userId,
    role,
    isVerified: false,
    isProfileComplete: false
  });
}

async function createUser(role: UserRole = 'USER', status: User['status'] = 'ACTIVE'): Promise<User> {
  return User.create({
    email: `checkout-${randomUUID()}@example.com`,
    phone: null,
    passwordHash: PASSWORD_HASH,
    role,
    status,
    emailVerified: false,
    phoneVerified: false
  });
}

async function createPlan(input: {
  code: string;
  priceInCents: number;
  currency?: string;
  isActive?: boolean;
  billingInterval?: 'NONE' | 'MONTH' | 'YEAR';
}): Promise<Plan> {
  return Plan.create({
    code: input.code,
    name: input.code,
    billingInterval:
      input.billingInterval ?? (input.code === 'FREE' ? 'NONE' : input.code === 'PREMIUM_YEARLY' ? 'YEAR' : 'MONTH'),
    priceInCents: input.priceInCents,
    currency: input.currency ?? 'INR',
    isActive: input.isActive ?? true,
    displayOrder: 1,
    ...timestamps()
  });
}

async function createSubscription(
  userId: string,
  planId: string,
  status: SubscriptionStatus,
  periodEnd: Date,
  gracePeriodEnd: Date | null = null
): Promise<Subscription> {
  return Subscription.create({
    userId,
    planId,
    status,
    autoRenew: status !== 'CANCELED',
    currentPeriodStart: new Date(Date.now() - HOUR_MS),
    currentPeriodEnd: periodEnd,
    gracePeriodEnd,
    canceledAt: status === 'CANCELED' ? new Date() : null,
    ...timestamps()
  });
}

function postCheckout(input: {
  token?: string;
  planId?: string;
  key?: string;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
}) {
  const call = request(app).post('/api/v1/payments/checkout');
  if (input.token) {
    call.set('Authorization', `Bearer ${input.token}`);
  }
  if (input.key !== undefined) {
    call.set('Idempotency-Key', input.key);
  }
  if (input.query) {
    call.query(input.query);
  }
  return call.send(input.body ?? { planId: input.planId });
}

function stubOrder(orderId = 'order_test_1'): void {
  createOrder.mockResolvedValue({ providerOrderId: orderId });
}

beforeEach(() => {
  createOrder.mockReset();
});

describe('POST /api/v1/payments/checkout', () => {
  it('rejects a missing token, an invalid token, an ADMIN, and a suspended user', async () => {
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    const admin = await createUser('ADMIN');
    const suspended = await createUser('USER', 'SUSPENDED');
    const key = randomUUID();

    const missing = await postCheckout({ planId: plan.id, key });
    const invalid = await postCheckout({ token: 'not-a-token', planId: plan.id, key });
    const forbidden = await postCheckout({ token: tokenFor(admin.id, 'ADMIN'), planId: plan.id, key });
    const blocked = await postCheckout({ token: tokenFor(suspended.id, 'USER'), planId: plan.id, key });

    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('AUTH_REQUIRED');
    expect(invalid.status).toBe(401);
    expect(invalid.body.error.code).toBe('INVALID_TOKEN');
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ACCOUNT_SUSPENDED');
    expect(createOrder).not.toHaveBeenCalled();
    expect(await Payment.count()).toBe(0);
  });

  it('lets an unverified USER start checkout', async () => {
    const user = await createUser('USER', 'UNVERIFIED');
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    stubOrder();

    const response = await postCheckout({ token: tokenFor(user.id, 'USER'), planId: plan.id, key: randomUUID() });

    expect(response.status).toBe(200);
    expect(response.body.data.planCode).toBe('PREMIUM_MONTHLY');
  });

  it('rejects unknown fields, query parameters, a bad plan id, and a bad idempotency key', async () => {
    const user = await createUser();
    const token = tokenFor(user.id, 'USER');
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    const key = randomUUID();

    const unknown = await postCheckout({
      token,
      key,
      body: {
        planId: plan.id,
        amountInCents: 100,
        currency: 'USD',
        status: 'CAPTURED',
        provider: 'MANUAL',
        providerOrderId: 'order_client',
        providerPaymentId: 'pay_client',
        paymentType: 'CREDIT_PURCHASE',
        subscriptionId: randomUUID()
      }
    });
    const query = await postCheckout({ token, planId: plan.id, key, query: { userId: user.id } });
    const malformedPlan = await postCheckout({ token, planId: 'not-a-uuid', key });
    const missingKey = await postCheckout({ token, planId: plan.id });
    const blankKey = await postCheckout({ token, planId: plan.id, key: '' });
    const malformedKey = await postCheckout({ token, planId: plan.id, key: 'not-a-uuid' });
    const overlongKey = await postCheckout({ token, planId: plan.id, key: `${randomUUID()}${randomUUID()}` });

    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('VALIDATION_ERROR');
    expect(unknown.body.error.details.some((detail: { code?: string }) => detail.code === 'unrecognized_keys')).toBe(true);
    expect(query.status).toBe(400);
    expect(query.body.error.details[0].message).toBe('Unsupported query parameter.');
    expect(malformedPlan.status).toBe(400);
    expect(malformedPlan.body.error.details).toEqual([{ field: 'planId', message: 'Plan id must be a valid UUID.', code: 'invalid_string' }]);
    expect(missingKey.status).toBe(400);
    expect(missingKey.body.error.details).toEqual([{ field: 'Idempotency-Key', message: 'Idempotency-Key is required.' }]);
    expect(blankKey.status).toBe(400);
    expect(blankKey.body.error.details[0].message).toBe('Idempotency-Key is required.');
    expect(malformedKey.status).toBe(400);
    expect(malformedKey.body.error.details[0].message).toBe('Idempotency-Key must be a valid UUID.');
    expect(overlongKey.status).toBe(400);
    expect(overlongKey.body.error.details[0].message).toBe('Idempotency-Key must be a valid UUID.');
    expect(createOrder).not.toHaveBeenCalled();
    expect(await Payment.count()).toBe(0);
  });

  it('rejects missing, inactive, free, non-INR, and non-positive plans before inserting a payment', async () => {
    const user = await createUser();
    const token = tokenFor(user.id, 'USER');
    const monthly = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900, isActive: false });
    const free = await createPlan({ code: 'FREE', priceInCents: 0 });
    const legacy = await createPlan({ code: 'PREMIUM_YEARLY', priceInCents: 399900, currency: 'USD' });

    const missing = await postCheckout({ token, planId: randomUUID(), key: randomUUID() });
    const inactiveResponse = await postCheckout({ token, planId: monthly.id, key: randomUUID() });
    const freeResponse = await postCheckout({ token, planId: free.id, key: randomUUID() });
    const legacyResponse = await postCheckout({ token, planId: legacy.id, key: randomUUID() });
    await monthly.update({ isActive: true, priceInCents: 0 });
    const zeroResponse = await postCheckout({ token, planId: monthly.id, key: randomUUID() });

    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(inactiveResponse.status).toBe(400);
    expect(inactiveResponse.body.error.details[0].message).toBe('Plan is not available for checkout.');
    expect(freeResponse.status).toBe(400);
    expect(freeResponse.body.error.details[0].message).toBe('Plan is not available for checkout.');
    expect(legacyResponse.status).toBe(400);
    expect(legacyResponse.body.error.details[0].message).toBe('Plan currency must be INR.');
    expect(zeroResponse.status).toBe(400);
    expect(zeroResponse.body.error.details[0].message).toBe('Plan price must be a positive integer number of cents.');
    expect(createOrder).not.toHaveBeenCalled();
    expect(await Payment.count()).toBe(0);
    expect(await Subscription.count()).toBe(0);
  });

  it('snapshots the locked plan, stores an initiated payment, and does not activate Premium', async () => {
    const user = await createUser();
    const plan = await createPlan({ code: 'PREMIUM_YEARLY', priceInCents: 399900 });
    stubOrder('order_yearly_1');

    const response = await postCheckout({ token: tokenFor(user.id, 'USER'), planId: plan.id, key: randomUUID() });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Checkout initiated.');
    expect(response.body.data).toEqual({
      paymentId: expect.any(String),
      planId: plan.id,
      planCode: 'PREMIUM_YEARLY',
      orderId: 'order_yearly_1',
      amountInCents: 399900,
      currency: 'INR',
      keyId: 'rzp_test_public'
    });
    expect(response.body.data.subscriptionId).toBeUndefined();
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0]).toEqual({
      amountInCents: 399900,
      currency: 'INR',
      receipt: response.body.data.paymentId,
      paymentId: response.body.data.paymentId
    });

    const payment = await Payment.findByPk(response.body.data.paymentId);
    expect(payment).toMatchObject({
      userId: user.id,
      planId: plan.id,
      subscriptionId: null,
      provider: 'RAZORPAY',
      providerOrderId: 'order_yearly_1',
      providerPaymentId: null,
      amountInCents: 399900,
      currency: 'INR',
      billingInterval: 'YEAR',
      status: 'INITIATED',
      paymentType: 'SUBSCRIPTION_INITIAL'
    });
    expect(payment?.idempotencyKey).toEqual(expect.any(String));
    expect(await Subscription.count()).toBe(0);
    expect(await UsageRecord.count()).toBe(0);
    expect(await PlanPriceChange.count()).toBe(0);

    const entitlements = await request(app)
      .get('/api/v1/me/entitlements')
      .set('Authorization', `Bearer ${tokenFor(user.id, 'USER')}`);
    const current = await request(app)
      .get('/api/v1/subscriptions/me')
      .set('Authorization', `Bearer ${tokenFor(user.id, 'USER')}`);
    expect(entitlements.body.data.tier).toBe('FREE');
    expect(entitlements.body.data.features.unlimitedSwipes).toBe(false);
    expect(current.body.data).toEqual({ hasActiveSubscription: false, subscription: null });
    await sequelize.transaction(async (transaction) => {
      expect(await hasActivePremium(user.id, transaction)).toBe(false);
    });
  });

  it('returns the stored order for the same user and key without another provider call', async () => {
    const user = await createUser();
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    const key = randomUUID().toUpperCase();
    stubOrder('order_replay_1');

    const first = await postCheckout({ token: tokenFor(user.id, 'USER'), planId: plan.id, key });
    const second = await postCheckout({ token: tokenFor(user.id, 'USER'), planId: plan.id.toUpperCase(), key: key.toLowerCase() });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data).toEqual(first.body.data);
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(await Payment.count()).toBe(1);
  });

  it('rejects reuse of a key for a different plan and allows another user to use the same key', async () => {
    const firstUser = await createUser();
    const secondUser = await createUser();
    const monthly = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    const yearly = await createPlan({ code: 'PREMIUM_YEARLY', priceInCents: 399900 });
    const key = randomUUID();
    let orderCount = 0;
    createOrder.mockImplementation(async () => {
      orderCount += 1;
      return { providerOrderId: `order_shared_${orderCount}` };
    });

    const original = await postCheckout({ token: tokenFor(firstUser.id, 'USER'), planId: monthly.id, key });
    const otherPlan = await postCheckout({ token: tokenFor(firstUser.id, 'USER'), planId: yearly.id, key });
    const otherUser = await postCheckout({ token: tokenFor(secondUser.id, 'USER'), planId: yearly.id, key });

    expect(original.status).toBe(200);
    expect(otherPlan.status).toBe(409);
    expect(otherPlan.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(otherPlan.body.error.message).toBe('Idempotency-Key was already used for a different plan.');
    expect(JSON.stringify(otherPlan.body)).not.toMatch(/uq_payments|23505|Sequelize/i);
    expect(otherUser.status).toBe(200);
    expect(otherUser.body.data.planId).toBe(yearly.id);
    expect(otherUser.body.data.orderId).toBe('order_shared_2');
    expect(original.body.data.orderId).toBe('order_shared_1');
    expect(createOrder).toHaveBeenCalledTimes(2);
    expect(await Payment.count()).toBe(2);
  });

  it('does not start a second provider order for a concurrent or unresolved attempt', async () => {
    const user = await createUser();
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    const token = tokenFor(user.id, 'USER');
    const key = randomUUID();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    createOrder.mockImplementation(async () => {
      entered();
      await gate;
      return { providerOrderId: 'order_concurrent_1' };
    });

    const firstPromise = postCheckout({ token, planId: plan.id, key });
    const startedOrFinished = await Promise.race([
      started.then(() => 'started' as const),
      firstPromise.then((response) => response)
    ]);
    if (startedOrFinished !== 'started') {
      throw new Error(`Checkout did not reach the provider: ${JSON.stringify(startedOrFinished.body)}`);
    }
    const second = await postCheckout({ token, planId: plan.id, key });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(second.body.error.message).toBe('A request with this Idempotency-Key is already in progress.');
    expect(JSON.stringify(second.body)).not.toMatch(/uq_payments|23505|Sequelize/i);
    expect(createOrder).toHaveBeenCalledTimes(1);
    release();
    const first = await firstPromise;
    expect(first.status).toBe(200);
    expect(first.body.data.orderId).toBe('order_concurrent_1');
    expect(await Payment.count()).toBe(1);
    expect(await Subscription.count()).toBe(0);

    const unresolvedUser = await createUser();
    const unresolvedKey = randomUUID();
    await Payment.create({
      userId: unresolvedUser.id,
      planId: plan.id,
      amountInCents: plan.priceInCents,
      currency: 'INR',
      status: 'INITIATED',
      paymentType: 'SUBSCRIPTION_INITIAL',
      idempotencyKey: unresolvedKey,
      providerOrderId: null,
      providerPaymentId: null,
      ...timestamps()
    });
    createOrder.mockClear();
    const unresolved = await postCheckout({
      token: tokenFor(unresolvedUser.id, 'USER'),
      planId: plan.id,
      key: unresolvedKey
    });
    expect(unresolved.status).toBe(409);
    expect(unresolved.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('marks a known provider rejection as FAILED and does not create a subscription', async () => {
    const user = await createUser();
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 1 });
    const key = randomUUID();
    createOrder.mockRejectedValue(new PaymentProviderRejectedError());

    const failed = await postCheckout({ token: tokenFor(user.id, 'USER'), planId: plan.id, key });
    const replay = await postCheckout({ token: tokenFor(user.id, 'USER'), planId: plan.id, key });

    expect(failed.status).toBe(402);
    expect(failed.body.error.code).toBe('PAYMENT_FAILED');
    expect(failed.body.error.message).toBe('Payment could not be initiated.');
    expect(JSON.stringify(failed.body)).not.toMatch(/key_secret|rejected the order/i);
    expect(replay.status).toBe(402);
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0].amountInCents).toBe(1);
    const payment = await Payment.findOne({ where: { userId: user.id } });
    expect(payment).toMatchObject({
      status: 'FAILED',
      providerOrderId: null,
      failureReason: 'PROVIDER_REJECTED',
      subscriptionId: null
    });
    expect(await Subscription.count()).toBe(0);
  });

  it('keeps an ambiguous provider result unresolved and does not create another order', async () => {
    const user = await createUser();
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    const key = randomUUID();
    createOrder.mockRejectedValue(new PaymentProviderOutcomeUnknownError());

    const unknown = await postCheckout({ token: tokenFor(user.id, 'USER'), planId: plan.id, key });
    const retry = await postCheckout({ token: tokenFor(user.id, 'USER'), planId: plan.id, key });

    expect(unknown.status).toBe(500);
    expect(unknown.body.error.code).toBe('PAYMENT_OUTCOME_UNKNOWN');
    expect(unknown.body.error.message).toBe(
      'The payment provider did not confirm a stored order.'
    );
    expect(retry.status).toBe(409);
    expect(retry.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(createOrder).toHaveBeenCalledTimes(1);
    const payment = await Payment.findOne({ where: { userId: user.id } });
    expect(payment).toMatchObject({ status: 'INITIATED', providerOrderId: null });
    expect(await Subscription.count()).toBe(0);
  });

  it('does not create a second order when the provider order id cannot be stored', async () => {
    const user = await createUser();
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    const key = randomUUID();
    createOrder.mockResolvedValue({ providerOrderId: 'order_unstored_1' });
    const assign = jest
      .spyOn(paymentsDataAccess, 'assignProviderOrderId')
      .mockRejectedValueOnce(new Error('db write failed'));

    try {
      const failedStore = await postCheckout({ token: tokenFor(user.id, 'USER'), planId: plan.id, key });
      expect(failedStore.status).toBe(500);
      expect(failedStore.body.error.code).toBe('PAYMENT_OUTCOME_UNKNOWN');
      expect(JSON.stringify(failedStore.body)).not.toMatch(/order_unstored_1|db write failed/);
    } finally {
      assign.mockRestore();
    }

    const retry = await postCheckout({ token: tokenFor(user.id, 'USER'), planId: plan.id, key });
    expect(retry.status).toBe(409);
    expect(createOrder).toHaveBeenCalledTimes(1);
    const payment = await Payment.findOne({ where: { userId: user.id } });
    expect(payment).toMatchObject({ status: 'INITIATED', providerOrderId: null });
    expect(await Subscription.count()).toBe(0);
  });

  it('blocks qualifying and in-period canceled Premium, and allows a lapsed subscription', async () => {
    const activeUser = await createUser();
    const canceledUser = await createUser();
    const lapsedUser = await createUser();
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    const future = new Date(Date.now() + 24 * HOUR_MS);
    const past = new Date(Date.now() - 24 * HOUR_MS);
    const active = await createSubscription(activeUser.id, plan.id, 'ACTIVE', future);
    const canceled = await createSubscription(canceledUser.id, plan.id, 'CANCELED', future);
    const lapsed = await createSubscription(lapsedUser.id, plan.id, 'CANCELED', past);
    stubOrder('order_after_lapse');

    const activeResponse = await postCheckout({
      token: tokenFor(activeUser.id, 'USER'),
      planId: plan.id,
      key: randomUUID()
    });
    const canceledResponse = await postCheckout({
      token: tokenFor(canceledUser.id, 'USER'),
      planId: plan.id,
      key: randomUUID()
    });
    const lapsedResponse = await postCheckout({
      token: tokenFor(lapsedUser.id, 'USER'),
      planId: plan.id,
      key: randomUUID()
    });

    expect(activeResponse.status).toBe(409);
    expect(activeResponse.body.error.code).toBe('ACTIVE_SUBSCRIPTION_EXISTS');
    expect(canceledResponse.status).toBe(409);
    expect(canceledResponse.body.error.code).toBe('ACTIVE_SUBSCRIPTION_EXISTS');
    expect(lapsedResponse.status).toBe(200);
    expect(createOrder).toHaveBeenCalledTimes(1);
    await active.reload();
    await canceled.reload();
    await lapsed.reload();
    expect(active.status).toBe('ACTIVE');
    expect(canceled.status).toBe('CANCELED');
    expect(lapsed.status).toBe('CANCELED');
    expect(await Subscription.count()).toBe(3);
    expect(await Payment.count()).toBe(1);
  });

  it('keeps the payment snapshot after a later admin price change', async () => {
    const user = await createUser();
    const admin = await createUser('ADMIN');
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    stubOrder('order_snapshot_1');

    const checkout = await postCheckout({ token: tokenFor(user.id, 'USER'), planId: plan.id, key: randomUUID() });
    const price = await request(app)
      .patch(`/api/v1/admin/config/plans/${plan.id}`)
      .set('Authorization', `Bearer ${tokenFor(admin.id, 'ADMIN')}`)
      .send({ priceInCents: 59900, reason: 'Launch price' });

    expect(checkout.status).toBe(200);
    expect(price.status).toBe(200);
    const payment = await Payment.findByPk(checkout.body.data.paymentId);
    await plan.reload();
    expect(payment?.amountInCents).toBe(49900);
    expect(payment?.currency).toBe('INR');
    expect(plan.priceInCents).toBe(59900);
    expect(await Subscription.count()).toBe(0);
  });

  it('keeps nullable legacy payments and the provider payment and order uniqueness rules', async () => {
    const user = await createUser();
    const other = await createUser();
    const legacy = await Payment.create({
      userId: user.id,
      amountInCents: 49900,
      currency: 'INR',
      paymentType: 'SUBSCRIPTION_INITIAL',
      providerPaymentId: null,
      providerOrderId: null,
      ...timestamps()
    });
    const secondLegacy = await Payment.create({
      userId: user.id,
      amountInCents: 100,
      currency: 'INR',
      paymentType: 'SUBSCRIPTION_RECURRING',
      providerPaymentId: null,
      providerOrderId: null,
      ...timestamps()
    });
    await Payment.create({
      userId: user.id,
      amountInCents: 49900,
      currency: 'INR',
      status: 'CAPTURED',
      paymentType: 'SUBSCRIPTION_INITIAL',
      providerPaymentId: 'pay_unique_1',
      providerOrderId: 'order_unique_1',
      idempotencyKey: '6e6e0001-0000-4000-8000-000000000001',
      paidAt: new Date(),
      ...timestamps()
    });
    await Payment.create({
      userId: other.id,
      amountInCents: 49900,
      currency: 'INR',
      paymentType: 'SUBSCRIPTION_INITIAL',
      idempotencyKey: '6e6e0001-0000-4000-8000-000000000001',
      ...timestamps()
    });

    await expect(
      Payment.create({
        userId: user.id,
        amountInCents: 49900,
        currency: 'INR',
        status: 'CAPTURED',
        paymentType: 'SUBSCRIPTION_INITIAL',
        providerPaymentId: 'pay_unique_1',
        providerOrderId: 'order_other',
        paidAt: new Date(),
        ...timestamps()
      })
    ).rejects.toBeInstanceOf(UniqueConstraintError);
    await expect(
      Payment.create({
        userId: user.id,
        amountInCents: 49900,
        currency: 'INR',
        status: 'CAPTURED',
        paymentType: 'SUBSCRIPTION_INITIAL',
        providerPaymentId: 'pay_other',
        providerOrderId: 'order_unique_1',
        paidAt: new Date(),
        ...timestamps()
      })
    ).rejects.toBeInstanceOf(UniqueConstraintError);
    await expect(
      Payment.create({
        userId: user.id,
        amountInCents: 49900,
        currency: 'INR',
        status: 'CAPTURED',
        paymentType: 'SUBSCRIPTION_INITIAL',
        idempotencyKey: '6e6e0001-0000-4000-8000-000000000001',
        paidAt: new Date(),
        ...timestamps()
      })
    ).rejects.toBeInstanceOf(UniqueConstraintError);

    expect(legacy.planId).toBeNull();
    expect(legacy.idempotencyKey).toBeNull();
    expect(legacy.billingInterval).toBeNull();
    await legacy.reload();
    expect(legacy.billingInterval).toBeNull();
    expect(secondLegacy.providerOrderId).toBeNull();

    await expect(
      Payment.create({
        userId: user.id,
        amountInCents: 100,
        currency: 'INR',
        paymentType: 'CREDIT_PURCHASE',
        billingInterval: 'NONE' as unknown as Payment['billingInterval'],
        ...timestamps()
      })
    ).rejects.toThrow(/chk_payments_billing_interval/);
  });

  it('stores MONTH for monthly Premium checkout', async () => {
    const user = await createUser();
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900, billingInterval: 'MONTH' });
    stubOrder('order_month_1');

    const response = await postCheckout({ token: tokenFor(user.id, 'USER'), planId: plan.id, key: randomUUID() });

    expect(response.status).toBe(200);
    const payment = await Payment.findByPk(response.body.data.paymentId);
    expect(payment?.billingInterval).toBe('MONTH');
    expect(payment?.amountInCents).toBe(49900);
    expect(payment?.currency).toBe('INR');
  });

  it('stores YEAR for yearly Premium checkout', async () => {
    const user = await createUser();
    const plan = await createPlan({ code: 'PREMIUM_YEARLY', priceInCents: 399900, billingInterval: 'YEAR' });
    stubOrder('order_year_1');

    const response = await postCheckout({ token: tokenFor(user.id, 'USER'), planId: plan.id, key: randomUUID() });

    expect(response.status).toBe(200);
    const payment = await Payment.findByPk(response.body.data.paymentId);
    expect(payment?.billingInterval).toBe('YEAR');
    expect(payment?.amountInCents).toBe(399900);
    expect(payment?.currency).toBe('INR');
  });

  it('rejects a monthly plan whose interval is YEAR before inserting a payment', async () => {
    const user = await createUser();
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900, billingInterval: 'YEAR' });

    const response = await postCheckout({ token: tokenFor(user.id, 'USER'), planId: plan.id, key: randomUUID() });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toEqual([
      { field: 'planId', message: 'Plan billing interval does not match the plan code.' }
    ]);
    expect(createOrder).not.toHaveBeenCalled();
    expect(await Payment.count()).toBe(0);
    expect(await Subscription.count()).toBe(0);
  });

  it('rejects a yearly plan whose interval is MONTH before inserting a payment', async () => {
    const user = await createUser();
    const plan = await createPlan({ code: 'PREMIUM_YEARLY', priceInCents: 399900, billingInterval: 'MONTH' });

    const response = await postCheckout({ token: tokenFor(user.id, 'USER'), planId: plan.id, key: randomUUID() });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toEqual([
      { field: 'planId', message: 'Plan billing interval does not match the plan code.' }
    ]);
    expect(createOrder).not.toHaveBeenCalled();
    expect(await Payment.count()).toBe(0);
    expect(await Subscription.count()).toBe(0);
  });

  it('rejects a Premium plan with an unsupported interval before inserting a payment', async () => {
    const user = await createUser();
    const token = tokenFor(user.id, 'USER');
    const monthly = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900, billingInterval: 'NONE' });
    const yearly = await createPlan({ code: 'PREMIUM_YEARLY', priceInCents: 399900, billingInterval: 'NONE' });

    const monthlyResponse = await postCheckout({ token, planId: monthly.id, key: randomUUID() });
    const yearlyResponse = await postCheckout({ token, planId: yearly.id, key: randomUUID() });

    expect(monthlyResponse.status).toBe(400);
    expect(monthlyResponse.body.error.details[0].message).toBe('Plan billing interval does not match the plan code.');
    expect(yearlyResponse.status).toBe(400);
    expect(yearlyResponse.body.error.details[0].message).toBe('Plan billing interval does not match the plan code.');
    expect(createOrder).not.toHaveBeenCalled();
    expect(await Payment.count()).toBe(0);
    expect(await Subscription.count()).toBe(0);
  });

  it('keeps the payment billing interval after the plan interval changes', async () => {
    const user = await createUser();
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    const key = randomUUID();
    stubOrder('order_interval_snapshot');

    const checkout = await postCheckout({ token: tokenFor(user.id, 'USER'), planId: plan.id, key });
    expect(checkout.status).toBe(200);
    await plan.update({ billingInterval: 'YEAR' });

    const replay = await postCheckout({ token: tokenFor(user.id, 'USER'), planId: plan.id, key });
    const payment = await Payment.findByPk(checkout.body.data.paymentId);
    await plan.reload();

    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual(checkout.body.data);
    expect(payment?.billingInterval).toBe('MONTH');
    expect(plan.billingInterval).toBe('YEAR');
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(await Subscription.count()).toBe(0);
  });

  async function expectNotPremium(userId: string, token: string): Promise<void> {
    const me = await request(app).get('/api/v1/subscriptions/me').set('Authorization', `Bearer ${token}`);
    const entitlements = await request(app).get('/api/v1/me/entitlements').set('Authorization', `Bearer ${token}`);
    const premium = await sequelize.transaction((transaction) => hasActivePremium(userId, transaction));
    const qualifying = await sequelize.transaction((transaction) =>
      findQualifyingPremiumSubscription(userId, transaction)
    );

    expect(me.status).toBe(200);
    expect(me.body.data).toEqual({ hasActiveSubscription: false, subscription: null });
    expect(entitlements.status).toBe(200);
    expect(entitlements.body.data.tier).toBe('FREE');
    expect(premium).toBe(false);
    expect(qualifying).toBeNull();
  }

  it('expires a fully elapsed active subscription with null grace and completes checkout', async () => {
    const user = await createUser();
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    const periodStart = new Date(Date.now() - 48 * HOUR_MS);
    const periodEnd = new Date(Date.now() - 24 * HOUR_MS);
    const subscription = await createSubscription(user.id, plan.id, 'ACTIVE', periodEnd, null);
    await subscription.update({
      providerSubscriptionId: 'sub_elapsed_null',
      providerCustomerId: 'cust_elapsed_null',
      autoRenew: true,
      currentPeriodStart: periodStart,
      canceledAt: null,
      endedAt: null
    });
    stubOrder('order_expired_null_grace');
    const token = tokenFor(user.id, 'USER');

    const response = await postCheckout({ token, planId: plan.id, key: randomUUID() });
    await subscription.reload();

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Checkout initiated.');
    expect(subscription.status).toBe('EXPIRED');
    expect(subscription.endedAt).not.toBeNull();
    expect(subscription.currentPeriodStart.toISOString()).toBe(periodStart.toISOString());
    expect(subscription.currentPeriodEnd.toISOString()).toBe(periodEnd.toISOString());
    expect(subscription.gracePeriodEnd).toBeNull();
    expect(subscription.providerSubscriptionId).toBe('sub_elapsed_null');
    expect(subscription.providerCustomerId).toBe('cust_elapsed_null');
    expect(subscription.autoRenew).toBe(true);
    expect(subscription.canceledAt).toBeNull();
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(await Payment.count()).toBe(1);
    expect(await Subscription.count()).toBe(1);
    await expectNotPremium(user.id, token);
  });

  it('expires a fully elapsed active subscription with elapsed grace and completes checkout', async () => {
    const user = await createUser();
    const plan = await createPlan({ code: 'PREMIUM_YEARLY', priceInCents: 399900 });
    const periodEnd = new Date(Date.now() - 48 * HOUR_MS);
    const graceEnd = new Date(Date.now() - 24 * HOUR_MS);
    const subscription = await createSubscription(user.id, plan.id, 'ACTIVE', periodEnd, graceEnd);
    await subscription.update({
      providerSubscriptionId: 'sub_elapsed_grace',
      providerCustomerId: 'cust_elapsed_grace',
      autoRenew: false
    });
    stubOrder('order_expired_elapsed_grace');
    const token = tokenFor(user.id, 'USER');

    const response = await postCheckout({ token, planId: plan.id, key: randomUUID() });
    await subscription.reload();

    expect(response.status).toBe(200);
    expect(subscription.status).toBe('EXPIRED');
    expect(subscription.endedAt).not.toBeNull();
    expect(subscription.gracePeriodEnd?.toISOString()).toBe(graceEnd.toISOString());
    expect(subscription.currentPeriodEnd.toISOString()).toBe(periodEnd.toISOString());
    expect(subscription.providerSubscriptionId).toBe('sub_elapsed_grace');
    expect(subscription.providerCustomerId).toBe('cust_elapsed_grace');
    expect(subscription.autoRenew).toBe(false);
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(await Payment.count()).toBe(1);
    await expectNotPremium(user.id, token);
  });

  it('keeps an active subscription with future grace and returns the existing conflict', async () => {
    const user = await createUser();
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    const periodEnd = new Date(Date.now() - 24 * HOUR_MS);
    const graceEnd = new Date(Date.now() + 24 * HOUR_MS);
    const subscription = await createSubscription(user.id, plan.id, 'ACTIVE', periodEnd, graceEnd);
    const before = subscription.toJSON();

    const response = await postCheckout({ token: tokenFor(user.id, 'USER'), planId: plan.id, key: randomUUID() });
    await subscription.reload();

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ACTIVE_SUBSCRIPTION_EXISTS');
    expect(response.body.error.message).toBe('Premium access is already active.');
    expect(subscription.toJSON()).toEqual(before);
    expect(subscription.status).toBe('ACTIVE');
    expect(subscription.endedAt).toBeNull();
    expect(createOrder).not.toHaveBeenCalled();
    expect(await Payment.count()).toBe(0);
  });

  it('keeps an in-period canceled subscription and returns the existing conflict', async () => {
    const user = await createUser();
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    const periodEnd = new Date(Date.now() + 24 * HOUR_MS);
    const subscription = await createSubscription(user.id, plan.id, 'CANCELED', periodEnd, new Date(Date.now() + 48 * HOUR_MS));
    const before = subscription.toJSON();

    const response = await postCheckout({ token: tokenFor(user.id, 'USER'), planId: plan.id, key: randomUUID() });
    await subscription.reload();

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ACTIVE_SUBSCRIPTION_EXISTS');
    expect(subscription.toJSON()).toEqual(before);
    expect(subscription.status).toBe('CANCELED');
    expect(subscription.endedAt).toBeNull();
    expect(createOrder).not.toHaveBeenCalled();
    expect(await Payment.count()).toBe(0);
  });

  it('keeps a lapsed canceled subscription and completes checkout', async () => {
    const user = await createUser();
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    const periodEnd = new Date(Date.now() - 24 * HOUR_MS);
    const graceEnd = new Date(Date.now() + 24 * HOUR_MS);
    const subscription = await createSubscription(user.id, plan.id, 'CANCELED', periodEnd, graceEnd);
    await subscription.update({
      providerSubscriptionId: 'sub_lapsed_canceled',
      providerCustomerId: 'cust_lapsed_canceled',
      autoRenew: false
    });
    const canceledAt = subscription.canceledAt;
    stubOrder('order_after_lapsed_canceled');

    const response = await postCheckout({ token: tokenFor(user.id, 'USER'), planId: plan.id, key: randomUUID() });
    await subscription.reload();

    expect(response.status).toBe(200);
    expect(subscription.status).toBe('CANCELED');
    expect(subscription.endedAt).toBeNull();
    expect(subscription.currentPeriodEnd.toISOString()).toBe(periodEnd.toISOString());
    expect(subscription.gracePeriodEnd?.toISOString()).toBe(graceEnd.toISOString());
    expect(subscription.canceledAt?.toISOString()).toBe(canceledAt?.toISOString());
    expect(subscription.providerSubscriptionId).toBe('sub_lapsed_canceled');
    expect(subscription.providerCustomerId).toBe('cust_lapsed_canceled');
    expect(subscription.autoRenew).toBe(false);
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(await Payment.count()).toBe(1);
    expect(await Subscription.count()).toBe(1);
  });

  it('commits expiration before an unknown provider outcome and does not roll it back', async () => {
    const user = await createUser();
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    const subscription = await createSubscription(
      user.id,
      plan.id,
      'ACTIVE',
      new Date(Date.now() - 24 * HOUR_MS),
      null
    );
    createOrder.mockImplementation(async () => {
      const seen = await Subscription.findByPk(subscription.id);
      expect(seen?.status).toBe('EXPIRED');
      expect(seen?.endedAt).not.toBeNull();
      throw new PaymentProviderOutcomeUnknownError();
    });

    const response = await postCheckout({ token: tokenFor(user.id, 'USER'), planId: plan.id, key: randomUUID() });
    await subscription.reload();
    const payment = await Payment.findOne({ where: { userId: user.id } });

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('PAYMENT_OUTCOME_UNKNOWN');
    expect(subscription.status).toBe('EXPIRED');
    expect(subscription.endedAt).not.toBeNull();
    expect(payment).toMatchObject({ status: 'INITIATED', providerOrderId: null });
    expect(createOrder).toHaveBeenCalledTimes(1);
  });

  it('commits expiration before a rejected provider call and does not roll it back', async () => {
    const user = await createUser();
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    const subscription = await createSubscription(
      user.id,
      plan.id,
      'GRACE_PERIOD',
      new Date(Date.now() - 48 * HOUR_MS),
      new Date(Date.now() - HOUR_MS)
    );
    createOrder.mockImplementation(async () => {
      const seen = await Subscription.findByPk(subscription.id);
      expect(seen?.status).toBe('EXPIRED');
      expect(seen?.endedAt).not.toBeNull();
      throw new PaymentProviderRejectedError();
    });

    const response = await postCheckout({ token: tokenFor(user.id, 'USER'), planId: plan.id, key: randomUUID() });
    await subscription.reload();
    const payment = await Payment.findOne({ where: { userId: user.id } });

    expect(response.status).toBe(402);
    expect(response.body.error.code).toBe('PAYMENT_FAILED');
    expect(subscription.status).toBe('EXPIRED');
    expect(subscription.endedAt).not.toBeNull();
    expect(payment).toMatchObject({ status: 'FAILED', failureReason: 'PROVIDER_REJECTED', providerOrderId: null });
    expect(createOrder).toHaveBeenCalledTimes(1);
  });

  it('does not expire a subscription while replaying, rejecting, or holding an existing checkout key', async () => {
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    const past = new Date(Date.now() - 24 * HOUR_MS);
    const replayUser = await createUser();
    const pendingUser = await createUser();
    const failedUser = await createUser();
    const replaySubscription = await createSubscription(replayUser.id, plan.id, 'ACTIVE', past, null);
    const pendingSubscription = await createSubscription(pendingUser.id, plan.id, 'PAST_DUE', past, null);
    const failedSubscription = await createSubscription(failedUser.id, plan.id, 'GRACE_PERIOD', past, past);
    const replayKey = randomUUID();
    const pendingKey = randomUUID();
    const failedKey = randomUUID();
    await Payment.create({
      userId: replayUser.id,
      planId: plan.id,
      amountInCents: plan.priceInCents,
      currency: 'INR',
      billingInterval: 'MONTH',
      status: 'INITIATED',
      paymentType: 'SUBSCRIPTION_INITIAL',
      idempotencyKey: replayKey,
      providerOrderId: 'order_existing_replay',
      providerPaymentId: null,
      ...timestamps()
    });
    await Payment.create({
      userId: pendingUser.id,
      planId: plan.id,
      amountInCents: plan.priceInCents,
      currency: 'INR',
      billingInterval: 'MONTH',
      status: 'INITIATED',
      paymentType: 'SUBSCRIPTION_INITIAL',
      idempotencyKey: pendingKey,
      providerOrderId: null,
      providerPaymentId: null,
      ...timestamps()
    });
    await Payment.create({
      userId: failedUser.id,
      planId: plan.id,
      amountInCents: plan.priceInCents,
      currency: 'INR',
      billingInterval: 'MONTH',
      status: 'FAILED',
      failureReason: 'PROVIDER_REJECTED',
      paymentType: 'SUBSCRIPTION_INITIAL',
      idempotencyKey: failedKey,
      providerOrderId: null,
      providerPaymentId: null,
      ...timestamps()
    });

    const replay = await postCheckout({ token: tokenFor(replayUser.id, 'USER'), planId: plan.id, key: replayKey });
    const pending = await postCheckout({ token: tokenFor(pendingUser.id, 'USER'), planId: plan.id, key: pendingKey });
    const failed = await postCheckout({ token: tokenFor(failedUser.id, 'USER'), planId: plan.id, key: failedKey });
    await replaySubscription.reload();
    await pendingSubscription.reload();
    await failedSubscription.reload();

    expect(replay.status).toBe(200);
    expect(replay.body.data.orderId).toBe('order_existing_replay');
    expect(pending.status).toBe(409);
    expect(pending.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(failed.status).toBe(402);
    expect(failed.body.error.code).toBe('PAYMENT_FAILED');
    expect(replaySubscription.status).toBe('ACTIVE');
    expect(pendingSubscription.status).toBe('PAST_DUE');
    expect(failedSubscription.status).toBe('GRACE_PERIOD');
    expect(replaySubscription.endedAt).toBeNull();
    expect(pendingSubscription.endedAt).toBeNull();
    expect(failedSubscription.endedAt).toBeNull();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('rejects a different idempotency key when an INITIATED checkout already has a provider order id', async () => {
    const user = await createUser();
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    stubOrder('order_open_1');
    const first = await postCheckout({ token: tokenFor(user.id, 'USER'), planId: plan.id, key: randomUUID() });
    createOrder.mockClear();

    const blocked = await postCheckout({
      token: tokenFor(user.id, 'USER'),
      planId: plan.id,
      key: randomUUID()
    });

    expect(first.status).toBe(200);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('CHECKOUT_ALREADY_OPEN');
    expect(blocked.body.error.message).toBe('A checkout is already open for this account.');
    expect(JSON.stringify(blocked.body)).not.toMatch(/uq_payments|23505|Sequelize/i);
    expect(createOrder).not.toHaveBeenCalled();
    expect(await Payment.count({ where: { userId: user.id } })).toBe(1);
  });

  it('rejects a different key when the existing INITIATED checkout has a null provider order id', async () => {
    const user = await createUser();
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    const openKey = randomUUID();
    await Payment.create({
      userId: user.id,
      planId: plan.id,
      amountInCents: plan.priceInCents,
      currency: 'INR',
      billingInterval: 'MONTH',
      status: 'INITIATED',
      paymentType: 'SUBSCRIPTION_INITIAL',
      idempotencyKey: openKey,
      providerOrderId: null,
      providerPaymentId: null,
      ...timestamps()
    });

    const blocked = await postCheckout({
      token: tokenFor(user.id, 'USER'),
      planId: plan.id,
      key: randomUUID()
    });
    const sameKey = await postCheckout({
      token: tokenFor(user.id, 'USER'),
      planId: plan.id,
      key: openKey
    });

    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('CHECKOUT_ALREADY_OPEN');
    expect(sameKey.status).toBe(409);
    expect(sameKey.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(sameKey.body.error.message).toBe('A request with this Idempotency-Key is already in progress.');
    expect(createOrder).not.toHaveBeenCalled();
    expect(await Payment.count({ where: { userId: user.id } })).toBe(1);
  });

  it('rejects a different key when the existing checkout payment is AUTHORIZED', async () => {
    const user = await createUser();
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    await Payment.create({
      userId: user.id,
      planId: plan.id,
      amountInCents: plan.priceInCents,
      currency: 'INR',
      billingInterval: 'MONTH',
      status: 'AUTHORIZED',
      paymentType: 'SUBSCRIPTION_INITIAL',
      idempotencyKey: randomUUID(),
      providerOrderId: 'order_authorized_open',
      providerPaymentId: null,
      ...timestamps()
    });

    const blocked = await postCheckout({
      token: tokenFor(user.id, 'USER'),
      planId: plan.id,
      key: randomUUID()
    });

    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('CHECKOUT_ALREADY_OPEN');
    expect(createOrder).not.toHaveBeenCalled();
    expect(await Payment.count({ where: { userId: user.id } })).toBe(1);
  });

  it('allows a new checkout after FAILED and does not treat CAPTURED as outstanding by itself', async () => {
    const failedUser = await createUser();
    const capturedUser = await createUser();
    const premiumUser = await createUser();
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    await Payment.create({
      userId: failedUser.id,
      planId: plan.id,
      amountInCents: plan.priceInCents,
      currency: 'INR',
      billingInterval: 'MONTH',
      status: 'FAILED',
      paymentType: 'SUBSCRIPTION_INITIAL',
      idempotencyKey: randomUUID(),
      providerOrderId: null,
      providerPaymentId: null,
      failureReason: 'PROVIDER_REJECTED',
      ...timestamps()
    });
    await Payment.create({
      userId: capturedUser.id,
      planId: plan.id,
      amountInCents: plan.priceInCents,
      currency: 'INR',
      billingInterval: 'MONTH',
      status: 'CAPTURED',
      paymentType: 'SUBSCRIPTION_INITIAL',
      idempotencyKey: randomUUID(),
      providerOrderId: 'order_captured_only',
      providerPaymentId: 'pay_captured_only',
      paidAt: new Date(),
      ...timestamps()
    });
    await createSubscription(premiumUser.id, plan.id, 'ACTIVE', new Date(Date.now() + HOUR_MS));
    await Payment.create({
      userId: premiumUser.id,
      planId: plan.id,
      amountInCents: plan.priceInCents,
      currency: 'INR',
      billingInterval: 'MONTH',
      status: 'CAPTURED',
      paymentType: 'SUBSCRIPTION_INITIAL',
      idempotencyKey: randomUUID(),
      providerOrderId: 'order_captured_premium',
      providerPaymentId: 'pay_captured_premium',
      paidAt: new Date(),
      ...timestamps()
    });
    let orderCount = 0;
    createOrder.mockImplementation(async () => {
      orderCount += 1;
      return { providerOrderId: `order_after_terminal_${orderCount}` };
    });

    const afterFailed = await postCheckout({
      token: tokenFor(failedUser.id, 'USER'),
      planId: plan.id,
      key: randomUUID()
    });
    const afterCaptured = await postCheckout({
      token: tokenFor(capturedUser.id, 'USER'),
      planId: plan.id,
      key: randomUUID()
    });
    const withPremium = await postCheckout({
      token: tokenFor(premiumUser.id, 'USER'),
      planId: plan.id,
      key: randomUUID()
    });

    expect(afterFailed.status).toBe(200);
    expect(afterCaptured.status).toBe(200);
    expect(withPremium.status).toBe(409);
    expect(withPremium.body.error.code).toBe('ACTIVE_SUBSCRIPTION_EXISTS');
    expect(createOrder).toHaveBeenCalledTimes(2);
    expect(await Payment.count({ where: { userId: failedUser.id } })).toBe(2);
    expect(await Payment.count({ where: { userId: capturedUser.id } })).toBe(2);
    expect(await Payment.count({ where: { userId: premiumUser.id } })).toBe(1);
  });

  it('rejects concurrent different-key checkouts so only one unresolved payment and one Razorpay order exist', async () => {
    const user = await createUser();
    const monthly = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    const yearly = await createPlan({ code: 'PREMIUM_YEARLY', priceInCents: 399900 });
    const token = tokenFor(user.id, 'USER');
    let orderCount = 0;
    createOrder.mockImplementation(async () => {
      orderCount += 1;
      return { providerOrderId: `order_race_${orderCount}` };
    });

    const responses = await Promise.all([
      postCheckout({ token, planId: monthly.id, key: randomUUID() }),
      postCheckout({ token, planId: yearly.id, key: randomUUID() })
    ]);

    const succeeded = responses.filter((response) => response.status === 200);
    const blocked = responses.filter((response) => response.status === 409);
    expect(succeeded).toHaveLength(1);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].body.error.code).toBe('CHECKOUT_ALREADY_OPEN');
    expect(JSON.stringify(blocked[0].body)).not.toMatch(/uq_payments|23505|Sequelize/i);
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(await Payment.count({ where: { userId: user.id, status: 'INITIATED' } })).toBe(1);
    expect(await Payment.count({ where: { userId: user.id } })).toBe(1);
  });

  it('maps a one-unresolved-checkout unique violation to CHECKOUT_ALREADY_OPEN without calling Razorpay', async () => {
    const user = await createUser();
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    const insert = jest.spyOn(paymentsDataAccess, 'insertInitiatedCheckout').mockRejectedValueOnce(
      new UniqueConstraintError({
        message: 'duplicate key value violates unique constraint "uq_payments_one_unresolved_subscription_checkout_per_user"',
        errors: [],
        fields: { user_id: user.id },
        parent: {
          constraint: 'uq_payments_one_unresolved_subscription_checkout_per_user',
          detail: 'Key (user_id)=(...) already exists.'
        } as Error & { constraint: string; detail: string }
      })
    );

    try {
      const response = await postCheckout({
        token: tokenFor(user.id, 'USER'),
        planId: plan.id,
        key: randomUUID()
      });
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('CHECKOUT_ALREADY_OPEN');
      expect(JSON.stringify(response.body)).not.toMatch(/uq_payments|23505|Sequelize/i);
    } finally {
      insert.mockRestore();
    }

    expect(createOrder).not.toHaveBeenCalled();
    expect(await Payment.count({ where: { userId: user.id } })).toBe(0);
  });

  it('does not map an unrelated unique violation to CHECKOUT_ALREADY_OPEN', async () => {
    const user = await createUser();
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    const insert = jest.spyOn(paymentsDataAccess, 'insertInitiatedCheckout').mockRejectedValueOnce(
      new UniqueConstraintError({
        message: 'duplicate key value violates unique constraint "uq_payments_provider_order_id"',
        errors: [],
        fields: { provider_order_id: 'order_other' },
        parent: {
          constraint: 'uq_payments_provider_order_id',
          detail: 'Key (provider, provider_order_id)=(RAZORPAY, order_other) already exists.'
        } as Error & { constraint: string; detail: string }
      })
    );

    try {
      const response = await postCheckout({
        token: tokenFor(user.id, 'USER'),
        planId: plan.id,
        key: randomUUID()
      });
      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(response.body.error.code).not.toBe('CHECKOUT_ALREADY_OPEN');
      expect(JSON.stringify(response.body)).not.toMatch(/uq_payments|23505|Sequelize/i);
    } finally {
      insert.mockRestore();
    }

    expect(createOrder).not.toHaveBeenCalled();
    expect(await Payment.count({ where: { userId: user.id } })).toBe(0);
  });
});
