import { createHmac, randomUUID } from 'crypto';
import request from 'supertest';
import { env } from '../../src/config/env';
import { sequelize } from '../../src/config/database';
import { Payment, PaymentStatus } from '../../src/database/models/payment.model';
import { Plan } from '../../src/database/models/plan.model';
import { Subscription } from '../../src/database/models/subscription.model';
import { UsageRecord } from '../../src/database/models/usage-record.model';
import { User, UserRole } from '../../src/database/models/user.model';
import { hasActivePremium } from '../../src/modules/likes/likes.data-access';
import { logger } from '../../src/utils/logger';
import { signAccessToken } from '../../src/utils/jwt';
import { app } from '../../src/app';

const TEST_SECRET = 'test-razorpay-key-secret';
const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';
const originalSecret = env.RAZORPAY_KEY_SECRET;

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

function signOrder(storedOrderId: string, paymentId: string, secret = TEST_SECRET): string {
  return createHmac('sha256', secret).update(`${storedOrderId}|${paymentId}`, 'utf8').digest('hex');
}

async function createUser(role: UserRole = 'USER', status: User['status'] = 'ACTIVE'): Promise<User> {
  return User.create({
    email: `verify-${randomUUID()}@example.com`,
    phone: null,
    passwordHash: PASSWORD_HASH,
    role,
    status,
    emailVerified: false,
    phoneVerified: false
  });
}

async function createPlan(): Promise<Plan> {
  return Plan.create({
    code: 'PREMIUM_MONTHLY',
    name: 'Premium Monthly',
    billingInterval: 'MONTH',
    priceInCents: 49900,
    currency: 'INR',
    isActive: true,
    displayOrder: 2,
    ...timestamps()
  });
}

async function createPayment(input: {
  userId: string;
  planId: string;
  providerOrderId: string | null;
  status?: PaymentStatus;
  failureReason?: string | null;
}): Promise<Payment> {
  return Payment.create({
    userId: input.userId,
    planId: input.planId,
    subscriptionId: null,
    provider: 'RAZORPAY',
    providerOrderId: input.providerOrderId,
    providerPaymentId: null,
    amountInCents: 49900,
    currency: 'INR',
    status: input.status ?? 'INITIATED',
    paymentType: 'SUBSCRIPTION_INITIAL',
    idempotencyKey: randomUUID(),
    rawPayload: null,
    failureReason: input.failureReason ?? null,
    paidAt: null,
    ...timestamps()
  });
}

function postVerify(input: { token?: string; body?: Record<string, unknown>; query?: Record<string, string> }) {
  const call = request(app).post('/api/v1/payments/verify');
  if (input.token) {
    call.set('Authorization', `Bearer ${input.token}`);
  }
  if (input.query) {
    call.query(input.query);
  }
  return call.send(input.body ?? {});
}

function plain(payment: Payment): Record<string, unknown> {
  return payment.get({ plain: true }) as unknown as Record<string, unknown>;
}

beforeEach(() => {
  env.RAZORPAY_KEY_SECRET = TEST_SECRET;
});

afterEach(() => {
  env.RAZORPAY_KEY_SECRET = originalSecret;
});

describe('POST /api/v1/payments/verify', () => {
  it('verifies a signature over the stored order id and leaves payment and entitlement state unchanged', async () => {
    const user = await createUser('USER', 'UNVERIFIED');
    const plan = await createPlan();
    const storedOrderId = 'order_stored_1';
    const paymentId = 'pay_test_1';
    const payment = await createPayment({ userId: user.id, planId: plan.id, providerOrderId: storedOrderId });
    const before = plain(payment);
    const signature = signOrder(storedOrderId, paymentId);
    const token = tokenFor(user.id, 'USER');

    const response = await postVerify({
      token,
      body: {
        razorpayPaymentId: paymentId,
        razorpayOrderId: `  ${storedOrderId}  `,
        razorpaySignature: signature
      }
    });
    const repeat = await postVerify({
      token,
      body: {
        razorpayPaymentId: paymentId,
        razorpayOrderId: storedOrderId,
        razorpaySignature: signature
      }
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: null,
      message: 'Payment signature verified.'
    });
    expect(repeat.status).toBe(200);
    expect(repeat.body).toEqual(response.body);
    expect(JSON.stringify(response.body)).not.toContain(signature);
    expect(JSON.stringify(response.body)).not.toContain(TEST_SECRET);

    await payment.reload();
    expect(plain(payment)).toEqual(before);
    expect(payment.status).toBe('INITIATED');
    expect(payment.providerPaymentId).toBeNull();
    expect(payment.paidAt).toBeNull();
    expect(await Payment.count()).toBe(1);
    expect(await Subscription.count()).toBe(0);
    expect(await UsageRecord.count()).toBe(0);
    await sequelize.transaction(async (transaction) => {
      expect(await hasActivePremium(user.id, transaction)).toBe(false);
    });
    const entitlements = await request(app)
      .get('/api/v1/me/entitlements')
      .set('Authorization', `Bearer ${token}`);
    expect(entitlements.body.data.tier).toBe('FREE');
  });

  it('rejects a signature that was not built from the stored order id', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const payment = await createPayment({
      userId: user.id,
      planId: plan.id,
      providerOrderId: 'order_stored_2'
    });
    const before = plain(payment);

    const response = await postVerify({
      token: tokenFor(user.id, 'USER'),
      body: {
        razorpayPaymentId: 'pay_test_2',
        razorpayOrderId: 'order_stored_2',
        razorpaySignature: signOrder('order_other', 'pay_test_2')
      }
    });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('PAYMENT_SIGNATURE_INVALID');
    expect(response.body.error.message).toBe('Payment signature is invalid.');
    expect(response.body.error.details).toEqual([]);
    await payment.reload();
    expect(plain(payment)).toEqual(before);
  });

  it('returns the existing authentication and authorization errors', async () => {
    const admin = await createUser('ADMIN');
    const body = {
      razorpayPaymentId: 'pay_test_auth',
      razorpayOrderId: 'order_auth',
      razorpaySignature: signOrder('order_auth', 'pay_test_auth')
    };

    const missing = await postVerify({ body });
    const invalid = await postVerify({ token: 'not-a-token', body });
    const forbidden = await postVerify({ token: tokenFor(admin.id, 'ADMIN'), body });

    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('AUTH_REQUIRED');
    expect(invalid.status).toBe(401);
    expect(invalid.body.error.code).toBe('INVALID_TOKEN');
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
    expect(await Payment.count()).toBe(0);
  });

  it('rejects missing, empty, mistyped, and unknown fields, and query parameters', async () => {
    const user = await createUser();
    const token = tokenFor(user.id, 'USER');
    const valid = {
      razorpayPaymentId: 'pay_test_fields',
      razorpayOrderId: 'order_fields',
      razorpaySignature: signOrder('order_fields', 'pay_test_fields')
    };

    const missing = await postVerify({ token, body: {} });
    const empty = await postVerify({
      token,
      body: { razorpayPaymentId: '', razorpayOrderId: 'order_fields', razorpaySignature: 'abc' }
    });
    const blank = await postVerify({
      token,
      body: { razorpayPaymentId: 'pay_test_fields', razorpayOrderId: '   ', razorpaySignature: 'abc' }
    });
    const wrongType = await postVerify({
      token,
      body: { razorpayPaymentId: 15, razorpayOrderId: 'order_fields', razorpaySignature: null }
    });
    const unknown = await postVerify({
      token,
      body: { ...valid, amountInCents: 100, status: 'CAPTURED', providerPaymentId: 'pay_client' }
    });
    const query = await postVerify({ token, body: valid, query: { userId: user.id } });

    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');
    expect(missing.body.error.details.map((detail: { field: string }) => detail.field).sort()).toEqual([
      'razorpayOrderId',
      'razorpayPaymentId',
      'razorpaySignature'
    ]);
    expect(empty.status).toBe(400);
    expect(empty.body.error.details[0]).toMatchObject({
      field: 'razorpayPaymentId',
      message: 'Razorpay payment id is required.'
    });
    expect(blank.status).toBe(400);
    expect(blank.body.error.details[0]).toMatchObject({
      field: 'razorpayOrderId',
      message: 'Razorpay order id is required.'
    });
    expect(wrongType.status).toBe(400);
    expect(wrongType.body.error.code).toBe('VALIDATION_ERROR');
    expect(wrongType.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'razorpayPaymentId', message: 'Razorpay payment id must be a string.' }),
        expect.objectContaining({ field: 'razorpaySignature', message: 'Razorpay signature must be a string.' })
      ])
    );
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.details.some((detail: { code?: string }) => detail.code === 'unrecognized_keys')).toBe(
      true
    );
    expect(query.status).toBe(400);
    expect(query.body.error.details[0].message).toBe('Unsupported query parameter.');
    expect(await Payment.count()).toBe(0);
  });

  it('returns the same not-found response for an unknown order and another user order', async () => {
    const owner = await createUser();
    const other = await createUser();
    const plan = await createPlan();
    const storedOrderId = 'order_owned_1';
    const payment = await createPayment({ userId: owner.id, planId: plan.id, providerOrderId: storedOrderId });
    const before = plain(payment);
    const signature = signOrder(storedOrderId, 'pay_owned_1');

    const unowned = await postVerify({
      token: tokenFor(other.id, 'USER'),
      body: {
        razorpayPaymentId: 'pay_owned_1',
        razorpayOrderId: storedOrderId,
        razorpaySignature: signature
      }
    });
    const unknown = await postVerify({
      token: tokenFor(owner.id, 'USER'),
      body: {
        razorpayPaymentId: 'pay_owned_1',
        razorpayOrderId: 'order_missing',
        razorpaySignature: signOrder('order_missing', 'pay_owned_1')
      }
    });

    expect(unowned.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(unowned.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(unknown.body.error.code).toBe(unowned.body.error.code);
    expect(unknown.body.error.message).toBe(unowned.body.error.message);
    expect(unowned.body.error.message).toBe('Resource not found');
    expect(JSON.stringify(unowned.body)).not.toContain(signature);
    await payment.reload();
    expect(plain(payment)).toEqual(before);
  });

  it('rejects altered, truncated, and non-hex signatures without exposing them', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const storedOrderId = 'order_bad_sig';
    const providerPaymentId = 'pay_bad_sig';
    const payment = await createPayment({ userId: user.id, planId: plan.id, providerOrderId: storedOrderId });
    const before = plain(payment);
    const signature = signOrder(storedOrderId, providerPaymentId);
    const altered = `${signature.slice(0, -1)}${signature.endsWith('a') ? 'b' : 'a'}`;
    const token = tokenFor(user.id, 'USER');
    const warn = jest.spyOn(logger, 'warn');
    const error = jest.spyOn(logger, 'error');

    try {
      const changedPayment = await postVerify({
        token,
        body: {
          razorpayPaymentId: 'pay_other',
          razorpayOrderId: storedOrderId,
          razorpaySignature: signature
        }
      });
      const changedSignature = await postVerify({
        token,
        body: {
          razorpayPaymentId: providerPaymentId,
          razorpayOrderId: storedOrderId,
          razorpaySignature: altered
        }
      });
      const truncated = await postVerify({
        token,
        body: {
          razorpayPaymentId: providerPaymentId,
          razorpayOrderId: storedOrderId,
          razorpaySignature: signature.slice(0, 32)
        }
      });
      const nonHex = await postVerify({
        token,
        body: {
          razorpayPaymentId: providerPaymentId,
          razorpayOrderId: storedOrderId,
          razorpaySignature: 'z'.repeat(64)
        }
      });

      for (const response of [changedPayment, changedSignature, truncated, nonHex]) {
        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe('PAYMENT_SIGNATURE_INVALID');
        expect(JSON.stringify(response.body)).not.toContain(TEST_SECRET);
        expect(JSON.stringify(response.body)).not.toContain(signature);
        expect(JSON.stringify(response.body)).not.toContain(altered);
      }
      const logged = JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
      expect(logged).not.toContain(TEST_SECRET);
      expect(logged).not.toContain(signature);
      expect(logged).not.toContain(altered);
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }

    await payment.reload();
    expect(plain(payment)).toEqual(before);
    expect(await Subscription.count()).toBe(0);
  });

  it('does not verify or backfill a null order id, and does not advance a failed payment', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const unresolved = await createPayment({ userId: user.id, planId: plan.id, providerOrderId: null });
    const failed = await createPayment({
      userId: user.id,
      planId: plan.id,
      providerOrderId: null,
      status: 'FAILED',
      failureReason: 'PROVIDER_REJECTED'
    });
    const failedWithOrder = await createPayment({
      userId: user.id,
      planId: plan.id,
      providerOrderId: 'order_failed_kept',
      status: 'FAILED',
      failureReason: 'PROVIDER_REJECTED'
    });
    const unresolvedBefore = plain(unresolved);
    const failedBefore = plain(failed);
    const failedWithOrderBefore = plain(failedWithOrder);
    const token = tokenFor(user.id, 'USER');

    const backfill = await postVerify({
      token,
      body: {
        razorpayPaymentId: 'pay_backfill',
        razorpayOrderId: 'order_backfill',
        razorpaySignature: signOrder('order_backfill', 'pay_backfill')
      }
    });
    const failedAttempt = await postVerify({
      token,
      body: {
        razorpayPaymentId: 'pay_failed',
        razorpayOrderId: 'order_failed_client',
        razorpaySignature: signOrder('order_failed_client', 'pay_failed')
      }
    });
    const failedMatch = await postVerify({
      token,
      body: {
        razorpayPaymentId: 'pay_failed_kept',
        razorpayOrderId: 'order_failed_kept',
        razorpaySignature: signOrder('order_failed_kept', 'pay_failed_kept')
      }
    });

    expect(backfill.status).toBe(404);
    expect(backfill.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(failedAttempt.status).toBe(404);
    expect(failedMatch.status).toBe(200);
    expect(failedMatch.body.message).toBe('Payment signature verified.');

    await unresolved.reload();
    await failed.reload();
    await failedWithOrder.reload();
    expect(plain(unresolved)).toEqual(unresolvedBefore);
    expect(unresolved.providerOrderId).toBeNull();
    expect(unresolved.status).toBe('INITIATED');
    expect(plain(failed)).toEqual(failedBefore);
    expect(failed.status).toBe('FAILED');
    expect(failed.providerOrderId).toBeNull();
    expect(failed.failureReason).toBe('PROVIDER_REJECTED');
    expect(plain(failedWithOrder)).toEqual(failedWithOrderBefore);
    expect(failedWithOrder.status).toBe('FAILED');
    expect(failedWithOrder.providerPaymentId).toBeNull();
    expect(await Subscription.count()).toBe(0);
  });

  it('returns the not-configured error when the verification secret is missing and writes nothing', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const payment = await createPayment({
      userId: user.id,
      planId: plan.id,
      providerOrderId: 'order_unconfigured'
    });
    const before = plain(payment);
    const signature = signOrder('order_unconfigured', 'pay_unconfigured');
    env.RAZORPAY_KEY_SECRET = undefined;
    const warn = jest.spyOn(logger, 'warn');
    const error = jest.spyOn(logger, 'error');

    try {
      const response = await postVerify({
        token: tokenFor(user.id, 'USER'),
        body: {
          razorpayPaymentId: 'pay_unconfigured',
          razorpayOrderId: 'order_unconfigured',
          razorpaySignature: signature
        }
      });

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('PAYMENT_VERIFICATION_NOT_CONFIGURED');
      expect(response.body.error.message).toBe('Payment verification is not configured.');
      expect(JSON.stringify(response.body)).not.toContain(TEST_SECRET);
      expect(JSON.stringify(response.body)).not.toContain(signature);
      const logged = JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
      expect(logged).not.toContain(TEST_SECRET);
      expect(logged).not.toContain(signature);
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }

    await payment.reload();
    expect(plain(payment)).toEqual(before);
    expect(await Subscription.count()).toBe(0);
  });
});
