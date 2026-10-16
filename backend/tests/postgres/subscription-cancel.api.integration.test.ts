import { randomUUID } from 'crypto';
import request from 'supertest';
import { Payment } from '../../src/database/models/payment.model';
import { Plan } from '../../src/database/models/plan.model';
import { Subscription, SubscriptionStatus } from '../../src/database/models/subscription.model';
import { UsageRecord } from '../../src/database/models/usage-record.model';
import { User, UserRole } from '../../src/database/models/user.model';
import { UserCreditBalance } from '../../src/database/models/user-credit-balance.model';
import { currentUtcDayWindow, DAILY_LIKE_PASS_METRIC } from '../../src/modules/likes/likes.data-access';
import { signAccessToken } from '../../src/utils/jwt';
import { app } from '../../src/app';
import { ensurePlanCatalog } from './plan-catalog.fixture';

const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const CANCEL_MESSAGE = 'Subscription cancelled. Premium access remains active until period end.';

function timestamps(at = new Date('2026-10-01T00:00:00.000Z')): { createdAt: Date; updatedAt: Date } {
  return { createdAt: at, updatedAt: at };
}

function tokenFor(userId: string, role: 'USER' | 'ADMIN' = 'USER'): string {
  return signAccessToken({
    sub: userId,
    role,
    isVerified: true,
    isProfileComplete: false
  });
}

function authHeader(userId: string, role: 'USER' | 'ADMIN' = 'USER') {
  return { Authorization: `Bearer ${tokenFor(userId, role)}` };
}

function cancel(userId?: string, role: 'USER' | 'ADMIN' = 'USER') {
  const call = request(app).post('/api/v1/subscriptions/cancel');
  if (!userId) {
    return call;
  }
  return call.set(authHeader(userId, role));
}

async function createUser(input: { role?: UserRole; emailVerified?: boolean; status?: 'UNVERIFIED' | 'ACTIVE' } = {}): Promise<User> {
  return User.create({
    email: `subscription-cancel-${randomUUID()}@example.com`,
    phone: null,
    passwordHash: PASSWORD_HASH,
    role: input.role ?? 'USER',
    status: input.status ?? 'ACTIVE',
    emailVerified: input.emailVerified ?? true,
    phoneVerified: false
  });
}

async function subscribe(
  userId: string,
  input: {
    code: 'FREE' | 'PREMIUM_MONTHLY' | 'PREMIUM_YEARLY';
    status: SubscriptionStatus;
    currentPeriodEnd: Date;
    gracePeriodEnd?: Date | null;
    autoRenew?: boolean;
    currentPeriodStart?: Date;
    canceledAt?: Date | null;
    endedAt?: Date | null;
    providerSubscriptionId?: string;
    providerCustomerId?: string;
    updatedAt?: Date;
  }
): Promise<Subscription> {
  const plan = await Plan.findOne({ where: { code: input.code } });
  if (!plan) {
    throw new Error(`Missing plan ${input.code}`);
  }
  const stamped = timestamps(input.updatedAt);

  return Subscription.create({
    userId,
    planId: plan.id,
    provider: 'RAZORPAY',
    providerSubscriptionId: input.providerSubscriptionId ?? `sub_${input.code}`,
    providerCustomerId: input.providerCustomerId ?? `cust_${input.code}`,
    status: input.status,
    autoRenew: input.autoRenew ?? input.status !== 'CANCELED',
    currentPeriodStart: input.currentPeriodStart ?? new Date(input.currentPeriodEnd.getTime() - 30 * DAY_MS),
    currentPeriodEnd: input.currentPeriodEnd,
    gracePeriodEnd: input.gracePeriodEnd ?? null,
    canceledAt: input.canceledAt === undefined ? (input.status === 'CANCELED' ? stamped.updatedAt : null) : input.canceledAt,
    endedAt: input.endedAt === undefined ? (input.status === 'EXPIRED' ? stamped.updatedAt : null) : input.endedAt,
    ...stamped
  });
}

function successBody(activeUntil: Date) {
  return {
    success: true,
    data: {
      autoRenew: false,
      activeUntil: activeUntil.toISOString()
    },
    message: CANCEL_MESSAGE
  };
}

async function expectNotFound(response: { status: number; body: { success: boolean; error: { code: string; message: string; details: unknown; timestamp: unknown; requestId: unknown } } }): Promise<void> {
  expect(response.status).toBe(404);
  expect(response.body.success).toBe(false);
  expect(response.body.error.code).toBe('ACTIVE_SUBSCRIPTION_NOT_FOUND');
  expect(response.body.error.message).toBe('Active subscription not found.');
  expect(response.body.error.details).toEqual([]);
  expect(typeof response.body.error.timestamp).toBe('string');
  expect(typeof response.body.error.requestId).toBe('string');
}

async function sideRecords(userId: string): Promise<{ usage: number; credits: number; payment: string | null }> {
  const window = currentUtcDayWindow();
  const usage = await UsageRecord.findOne({
    where: { userId, metricKey: DAILY_LIKE_PASS_METRIC, periodStart: window.periodStart }
  });
  const credits = await UserCreditBalance.findOne({ where: { userId, creditType: 'SUPER_LIKE' } });
  const payment = await Payment.findOne({ where: { userId } });
  return {
    usage: usage?.usageCount ?? -1,
    credits: credits?.balance ?? -1,
    payment: payment ? JSON.stringify(payment.toJSON()) : null
  };
}

async function seedSideRecords(userId: string, subscriptionId: string): Promise<void> {
  const window = currentUtcDayWindow();
  await UsageRecord.create({
    userId,
    metricKey: DAILY_LIKE_PASS_METRIC,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    usageCount: 4,
    ...timestamps()
  });
  await UserCreditBalance.create({
    userId,
    creditType: 'SUPER_LIKE',
    balance: 3,
    ...timestamps()
  });
  await Payment.create({
    userId,
    subscriptionId,
    amountInCents: 49900,
    currency: 'INR',
    status: 'CAPTURED',
    paymentType: 'SUBSCRIPTION_INITIAL',
    ...timestamps()
  });
}

describe('POST /api/v1/subscriptions/cancel', () => {
  it('returns 401 when the token is missing and when it is invalid', async () => {
    const missing = await cancel();
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('AUTH_REQUIRED');

    const invalid = await request(app).post('/api/v1/subscriptions/cancel').set({ Authorization: 'Bearer not-a-token' });
    expect(invalid.status).toBe(401);
    expect(invalid.body.error.code).toBe('INVALID_TOKEN');
    expect(await Subscription.count()).toBe(0);
  });

  it('returns 403 for an authenticated admin', async () => {
    const admin = await createUser({ role: 'ADMIN' });

    const response = await cancel(admin.id, 'ADMIN');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(await Subscription.count()).toBe(0);
  });

  it('rejects query parameters and a request body with VALIDATION_ERROR', async () => {
    await ensurePlanCatalog();
    const caller = await createUser();
    const subscription = await subscribe(caller.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'ACTIVE',
      currentPeriodEnd: new Date(Date.now() + HOUR_MS)
    });
    const before = (await Subscription.findByPk(subscription.id))?.toJSON();

    const query = await cancel(caller.id).query({ userId: caller.id });
    expect(query.status).toBe(400);
    expect(query.body.error.code).toBe('VALIDATION_ERROR');
    expect(query.body.error.details).toEqual([{ field: 'userId', message: 'Unsupported query parameter.' }]);

    const body = await cancel(caller.id).send({ userId: caller.id });
    expect(body.status).toBe(400);
    expect(body.body.error.code).toBe('VALIDATION_ERROR');
    expect((await Subscription.findByPk(subscription.id))?.toJSON()).toEqual(before);
  });

  it('cancels an active monthly premium subscription and preserves unrelated fields', async () => {
    await ensurePlanCatalog();
    const caller = await createUser({ emailVerified: false, status: 'UNVERIFIED' });
    const future = new Date(Date.now() + 2 * HOUR_MS);
    const grace = new Date(Date.now() + 3 * HOUR_MS);
    const periodStart = new Date(Date.now() - DAY_MS);
    const subscription = await subscribe(caller.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'ACTIVE',
      currentPeriodStart: periodStart,
      currentPeriodEnd: future,
      gracePeriodEnd: grace,
      autoRenew: true,
      providerSubscriptionId: 'sub_monthly',
      providerCustomerId: 'cust_monthly'
    });
    await seedSideRecords(caller.id, subscription.id);
    const before = (await Subscription.findByPk(subscription.id))?.toJSON();
    const sidesBefore = await sideRecords(caller.id);
    const startedAt = Date.now();

    const response = await cancel(caller.id);

    const stored = await Subscription.findByPk(subscription.id);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(successBody(future));
    expect(Object.keys(response.body.data).sort()).toEqual(['activeUntil', 'autoRenew']);
    expect(stored?.status).toBe('CANCELED');
    expect(stored?.autoRenew).toBe(false);
    expect(stored?.canceledAt).not.toBeNull();
    expect(stored!.canceledAt!.getTime()).toBeGreaterThanOrEqual(startedAt - 1000);
    expect(stored!.canceledAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(stored?.endedAt).toBeNull();
    expect(stored?.currentPeriodStart.toISOString()).toBe(periodStart.toISOString());
    expect(stored?.currentPeriodEnd.toISOString()).toBe(future.toISOString());
    expect(stored?.gracePeriodEnd?.toISOString()).toBe(grace.toISOString());
    expect(stored?.planId).toBe(before?.planId);
    expect(stored?.provider).toBe('RAZORPAY');
    expect(stored?.providerSubscriptionId).toBe('sub_monthly');
    expect(stored?.providerCustomerId).toBe('cust_monthly');
    expect(stored?.createdAt.toISOString()).toBe(before?.createdAt.toISOString());
    expect(await sideRecords(caller.id)).toEqual(sidesBefore);
  });

  it('cancels an active yearly premium subscription', async () => {
    await ensurePlanCatalog();
    const caller = await createUser();
    const future = new Date(Date.now() + 10 * DAY_MS);
    const subscription = await subscribe(caller.id, {
      code: 'PREMIUM_YEARLY',
      status: 'ACTIVE',
      currentPeriodEnd: future,
      gracePeriodEnd: null,
      autoRenew: true,
      providerSubscriptionId: 'sub_yearly',
      providerCustomerId: 'cust_yearly'
    });

    const response = await cancel(caller.id);

    const stored = await Subscription.findByPk(subscription.id);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(successBody(future));
    expect(stored?.status).toBe('CANCELED');
    expect(stored?.autoRenew).toBe(false);
    expect(stored?.canceledAt).not.toBeNull();
    expect(stored?.endedAt).toBeNull();
    expect(stored?.providerSubscriptionId).toBe('sub_yearly');
    expect(stored?.providerCustomerId).toBe('cust_yearly');
    expect(stored?.gracePeriodEnd).toBeNull();
  });

  it('returns the same success body for a repeated in-period cancellation without writes', async () => {
    await ensurePlanCatalog();
    const caller = await createUser();
    const future = new Date(Date.now() + HOUR_MS);
    const subscription = await subscribe(caller.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'ACTIVE',
      currentPeriodEnd: future,
      autoRenew: true
    });
    await seedSideRecords(caller.id, subscription.id);

    const first = await cancel(caller.id);
    const stored = await Subscription.findByPk(subscription.id);
    const before = stored?.toJSON();
    const sidesBefore = await sideRecords(caller.id);

    const second = await cancel(caller.id);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(second.body).toEqual(successBody(future));
    expect((await Subscription.findByPk(subscription.id))?.toJSON()).toEqual(before);
    expect(await sideRecords(caller.id)).toEqual(sidesBefore);
    expect(stored?.canceledAt).not.toBeNull();
    expect((await Subscription.findByPk(subscription.id))?.updatedAt.toISOString()).toBe(stored?.updatedAt.toISOString());
  });

  it('recognizes an already canceled in-period row without repairing auto renew', async () => {
    await ensurePlanCatalog();
    const caller = await createUser();
    const future = new Date(Date.now() + HOUR_MS);
    const canceledAt = new Date('2026-10-02T00:00:00.000Z');
    const subscription = await subscribe(caller.id, {
      code: 'PREMIUM_YEARLY',
      status: 'CANCELED',
      currentPeriodEnd: future,
      autoRenew: true,
      canceledAt,
      updatedAt: canceledAt
    });
    const before = (await Subscription.findByPk(subscription.id))?.toJSON();

    const response = await cancel(caller.id);

    expect(response.body).toEqual(successBody(future));
    expect((await Subscription.findByPk(subscription.id))?.toJSON()).toEqual(before);
    expect((await Subscription.findByPk(subscription.id))?.autoRenew).toBe(true);
  });

  it('uses the latest in-period canceled row when several exist', async () => {
    await ensurePlanCatalog();
    const caller = await createUser();
    const sooner = new Date(Date.now() + HOUR_MS);
    const later = new Date(Date.now() + 2 * HOUR_MS);
    const older = await subscribe(caller.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'CANCELED',
      currentPeriodEnd: later,
      autoRenew: false,
      updatedAt: new Date('2026-09-01T00:00:00.000Z')
    });
    const newer = await subscribe(caller.id, {
      code: 'PREMIUM_YEARLY',
      status: 'CANCELED',
      currentPeriodEnd: sooner,
      autoRenew: false,
      updatedAt: new Date('2026-10-01T00:00:00.000Z')
    });
    const olderBefore = (await Subscription.findByPk(older.id))?.toJSON();
    const newerBefore = (await Subscription.findByPk(newer.id))?.toJSON();

    const response = await cancel(caller.id);

    expect(response.body).toEqual(successBody(later));
    expect((await Subscription.findByPk(older.id))?.toJSON()).toEqual(olderBefore);
    expect((await Subscription.findByPk(newer.id))?.toJSON()).toEqual(newerBefore);
  });

  it('returns 404 when the caller has no subscription', async () => {
    await ensurePlanCatalog();
    const caller = await createUser();

    const response = await cancel(caller.id);

    await expectNotFound(response);
    expect(await Subscription.count()).toBe(0);
    expect(await Payment.count()).toBe(0);
    expect(await UsageRecord.count()).toBe(0);
    expect(await UserCreditBalance.count()).toBe(0);
  });

  it('returns 404 for expired history, an ended canceled row, and a grace-only canceled row', async () => {
    await ensurePlanCatalog();
    const expiredUser = await createUser();
    const endedUser = await createUser();
    const graceUser = await createUser();
    const future = new Date(Date.now() + HOUR_MS);
    const past = new Date(Date.now() - HOUR_MS);
    const expired = await subscribe(expiredUser.id, {
      code: 'PREMIUM_YEARLY',
      status: 'EXPIRED',
      currentPeriodEnd: future,
      gracePeriodEnd: future
    });
    const ended = await subscribe(endedUser.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'CANCELED',
      currentPeriodEnd: past,
      gracePeriodEnd: null,
      autoRenew: false
    });
    const graceOnly = await subscribe(graceUser.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'CANCELED',
      currentPeriodEnd: past,
      gracePeriodEnd: future,
      autoRenew: false
    });
    const before = [
      (await Subscription.findByPk(expired.id))?.toJSON(),
      (await Subscription.findByPk(ended.id))?.toJSON(),
      (await Subscription.findByPk(graceOnly.id))?.toJSON()
    ];

    await expectNotFound(await cancel(expiredUser.id));
    await expectNotFound(await cancel(endedUser.id));
    await expectNotFound(await cancel(graceUser.id));

    expect([
      (await Subscription.findByPk(expired.id))?.toJSON(),
      (await Subscription.findByPk(ended.id))?.toJSON(),
      (await Subscription.findByPk(graceOnly.id))?.toJSON()
    ]).toEqual(before);
  });

  it('leaves PAST_DUE and GRACE_PERIOD rows unchanged and does not fall back to canceled history', async () => {
    await ensurePlanCatalog();
    const pastDueUser = await createUser();
    const graceUser = await createUser();
    const future = new Date(Date.now() + 2 * HOUR_MS);
    const pastDueCanceled = await subscribe(pastDueUser.id, {
      code: 'PREMIUM_YEARLY',
      status: 'CANCELED',
      currentPeriodEnd: future,
      autoRenew: false,
      updatedAt: new Date('2026-09-01T00:00:00.000Z')
    });
    const pastDue = await subscribe(pastDueUser.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'PAST_DUE',
      currentPeriodEnd: future,
      gracePeriodEnd: new Date(Date.now() + 3 * HOUR_MS),
      autoRenew: true
    });
    const graceCanceled = await subscribe(graceUser.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'CANCELED',
      currentPeriodEnd: future,
      autoRenew: false,
      updatedAt: new Date('2026-09-01T00:00:00.000Z')
    });
    const grace = await subscribe(graceUser.id, {
      code: 'PREMIUM_YEARLY',
      status: 'GRACE_PERIOD',
      currentPeriodEnd: new Date(Date.now() - HOUR_MS),
      gracePeriodEnd: future,
      autoRenew: false
    });
    const before = [
      (await Subscription.findByPk(pastDueCanceled.id))?.toJSON(),
      (await Subscription.findByPk(pastDue.id))?.toJSON(),
      (await Subscription.findByPk(graceCanceled.id))?.toJSON(),
      (await Subscription.findByPk(grace.id))?.toJSON()
    ];

    await expectNotFound(await cancel(pastDueUser.id));
    await expectNotFound(await cancel(graceUser.id));

    expect([
      (await Subscription.findByPk(pastDueCanceled.id))?.toJSON(),
      (await Subscription.findByPk(pastDue.id))?.toJSON(),
      (await Subscription.findByPk(graceCanceled.id))?.toJSON(),
      (await Subscription.findByPk(grace.id))?.toJSON()
    ]).toEqual(before);
  });

  it('cancels an elapsed active subscription and returns 404 on the next request', async () => {
    await ensurePlanCatalog();
    const caller = await createUser();
    const past = new Date(Date.now() - HOUR_MS);
    const subscription = await subscribe(caller.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'ACTIVE',
      currentPeriodEnd: past,
      gracePeriodEnd: new Date(Date.now() + HOUR_MS),
      autoRenew: true
    });

    const first = await cancel(caller.id);
    const second = await cancel(caller.id);

    expect(first.body).toEqual(successBody(past));
    await expectNotFound(second);
    const stored = await Subscription.findByPk(subscription.id);
    expect(stored?.status).toBe('CANCELED');
    expect(stored?.autoRenew).toBe(false);
    expect(stored?.endedAt).toBeNull();
    expect(stored?.gracePeriodEnd).not.toBeNull();
  });

  it('does not change another user subscription', async () => {
    await ensurePlanCatalog();
    const caller = await createUser();
    const other = await createUser();
    const future = new Date(Date.now() + HOUR_MS);
    await subscribe(caller.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'ACTIVE',
      currentPeriodEnd: future
    });
    const otherSubscription = await subscribe(other.id, {
      code: 'PREMIUM_YEARLY',
      status: 'ACTIVE',
      currentPeriodEnd: future,
      autoRenew: true,
      providerSubscriptionId: 'sub_other',
      providerCustomerId: 'cust_other'
    });
    const before = (await Subscription.findByPk(otherSubscription.id))?.toJSON();

    const response = await cancel(caller.id);

    expect(response.status).toBe(200);
    expect((await Subscription.findByPk(otherSubscription.id))?.toJSON()).toEqual(before);
  });

  it('applies one state change when two cancellations run concurrently', async () => {
    await ensurePlanCatalog();
    const caller = await createUser();
    const future = new Date(Date.now() + HOUR_MS);
    const subscription = await subscribe(caller.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'ACTIVE',
      currentPeriodEnd: future,
      autoRenew: true
    });
    await seedSideRecords(caller.id, subscription.id);
    const sidesBefore = await sideRecords(caller.id);

    const [first, second] = await Promise.all([cancel(caller.id), cancel(caller.id)]);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.body).toEqual(successBody(future));
    expect(second.body).toEqual(successBody(future));
    const stored = await Subscription.findByPk(subscription.id);
    const afterConcurrent = stored?.toJSON();
    expect(stored?.status).toBe('CANCELED');
    expect(stored?.autoRenew).toBe(false);
    expect(stored?.canceledAt).not.toBeNull();
    expect(stored?.endedAt).toBeNull();
    expect(await Subscription.count({ where: { userId: caller.id } })).toBe(1);
    expect(await sideRecords(caller.id)).toEqual(sidesBefore);

    const third = await cancel(caller.id);
    expect(third.body).toEqual(successBody(future));
    expect((await Subscription.findByPk(subscription.id))?.toJSON()).toEqual(afterConcurrent);
  });
});
