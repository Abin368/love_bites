import { randomUUID } from 'crypto';
import request from 'supertest';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../../src/config/database';
import { Plan } from '../../src/database/models/plan.model';
import { Subscription, SubscriptionStatus } from '../../src/database/models/subscription.model';
import { User, UserRole } from '../../src/database/models/user.model';
import { currentUtcDayWindow } from '../../src/modules/likes/likes.data-access';
import { signAccessToken } from '../../src/utils/jwt';
import { app } from '../../src/app';
import { ensurePlanCatalog } from './plan-catalog.fixture';

const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PROVIDER_SUBSCRIPTION_ID = 'sub_should_not_leak';
const PROVIDER_CUSTOMER_ID = 'cust_should_not_leak';
const SUBSCRIPTION_FIELDS = ['autoRenew', 'currentPeriodEnd', 'currentPeriodStart', 'gracePeriodEnd', 'plan', 'status'];

function timestamps(): { createdAt: Date; updatedAt: Date } {
  const now = new Date();
  return { createdAt: now, updatedAt: now };
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

function getSubscription(userId?: string, role: 'USER' | 'ADMIN' = 'USER') {
  const call = request(app).get('/api/v1/subscriptions/me');
  if (!userId) {
    return call;
  }
  return call.set(authHeader(userId, role));
}

async function createUser(input: { role?: UserRole; emailVerified?: boolean; status?: 'UNVERIFIED' | 'ACTIVE' } = {}): Promise<User> {
  return User.create({
    email: `subscription-me-${randomUUID()}@example.com`,
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
  }
): Promise<Subscription> {
  const plan = await Plan.findOne({ where: { code: input.code } });
  if (!plan) {
    throw new Error(`Missing plan ${input.code}`);
  }

  return Subscription.create({
    userId,
    planId: plan.id,
    provider: 'RAZORPAY',
    providerSubscriptionId: PROVIDER_SUBSCRIPTION_ID,
    providerCustomerId: PROVIDER_CUSTOMER_ID,
    status: input.status,
    autoRenew: input.autoRenew ?? true,
    currentPeriodStart: input.currentPeriodStart ?? new Date(input.currentPeriodEnd.getTime() - 30 * DAY_MS),
    currentPeriodEnd: input.currentPeriodEnd,
    gracePeriodEnd: input.gracePeriodEnd ?? null,
    canceledAt: input.status === 'CANCELED' ? new Date() : null,
    endedAt: input.status === 'EXPIRED' ? new Date() : null,
    ...timestamps()
  });
}

function emptyBody() {
  return {
    success: true,
    data: {
      hasActiveSubscription: false,
      subscription: null
    },
    message: 'Subscription retrieved successfully.'
  };
}

async function activeBody(subscriptionId: string, plan: Plan) {
  const stored = await Subscription.findByPk(subscriptionId);
  if (!stored) {
    throw new Error('Missing subscription');
  }

  return {
    success: true,
    data: {
      hasActiveSubscription: true,
      subscription: {
        plan: {
          code: plan.code,
          name: plan.name
        },
        status: stored.status,
        autoRenew: stored.autoRenew,
        currentPeriodStart: stored.currentPeriodStart.toISOString(),
        currentPeriodEnd: stored.currentPeriodEnd.toISOString(),
        gracePeriodEnd: stored.gracePeriodEnd ? stored.gracePeriodEnd.toISOString() : null
      }
    },
    message: 'Subscription retrieved successfully.'
  };
}

function expectApprovedFields(body: { data: { subscription: { plan: Record<string, unknown> } } }): void {
  expect(Object.keys(body.data).sort()).toEqual(['hasActiveSubscription', 'subscription']);
  expect(Object.keys(body.data.subscription).sort()).toEqual(SUBSCRIPTION_FIELDS);
  expect(Object.keys(body.data.subscription.plan).sort()).toEqual(['code', 'name']);
  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain(PROVIDER_SUBSCRIPTION_ID);
  expect(serialized).not.toContain(PROVIDER_CUSTOMER_ID);
  expect(serialized).not.toContain('RAZORPAY');
  expect(serialized).not.toContain('canceledAt');
  expect(serialized).not.toContain('endedAt');
  expect(serialized).not.toContain('provider');
}

async function publicRowCounts(): Promise<Record<string, string>> {
  const tables = await sequelize.query<{ tablename: string }>(
    `SELECT tablename
     FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename <> 'spatial_ref_sys'
       AND tablename <> 'SequelizeMeta'
     ORDER BY tablename`,
    { type: QueryTypes.SELECT }
  );

  const counts: Record<string, string> = {};
  for (const table of tables) {
    if (!/^[a-z0-9_]+$/.test(table.tablename)) {
      throw new Error(`Unexpected table name ${table.tablename}`);
    }
    const rows = await sequelize.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM "${table.tablename}"`, {
      type: QueryTypes.SELECT
    });
    counts[table.tablename] = rows[0]?.n ?? '0';
  }
  return counts;
}

async function mutationStats(): Promise<Record<string, string>> {
  const rows = await sequelize.query<{ relname: string; ins: string; upd: string; del: string }>(
    `SELECT relname,
            n_tup_ins::text AS ins,
            n_tup_upd::text AS upd,
            n_tup_del::text AS del
     FROM pg_stat_user_tables
     WHERE schemaname = 'public'
     ORDER BY relname`,
    { type: QueryTypes.SELECT }
  );
  return Object.fromEntries(rows.map((row) => [row.relname, `${row.ins}:${row.upd}:${row.del}`]));
}

describe('GET /api/v1/subscriptions/me', () => {
  it('returns 401 when the token is missing', async () => {
    const response = await getSubscription();

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('returns 403 for an authenticated admin', async () => {
    const admin = await createUser({ role: 'ADMIN' });

    const response = await getSubscription(admin.id, 'ADMIN');

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('allows an unverified USER', async () => {
    const unverified = await createUser({ emailVerified: false, status: 'UNVERIFIED' });

    const response = await getSubscription(unverified.id);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(emptyBody());
  });

  it('rejects query parameters and a request body with VALIDATION_ERROR', async () => {
    const caller = await createUser();

    const query = await getSubscription(caller.id).query({ userId: caller.id });
    expect(query.status).toBe(400);
    expect(query.body.success).toBe(false);
    expect(query.body.error.code).toBe('VALIDATION_ERROR');
    expect(query.body.error.details).toEqual([{ field: 'userId', message: 'Unsupported query parameter.' }]);

    const body = await getSubscription(caller.id).send({ status: 'ACTIVE' });
    expect(body.status).toBe(400);
    expect(body.body.success).toBe(false);
    expect(body.body.error.code).toBe('VALIDATION_ERROR');
    expect(await Subscription.count()).toBe(0);
  });

  it('returns the empty state when the caller has no subscription', async () => {
    await ensurePlanCatalog();
    const caller = await createUser();
    const other = await createUser();
    await subscribe(other.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'ACTIVE',
      currentPeriodEnd: new Date(Date.now() + HOUR_MS),
      gracePeriodEnd: null
    });

    const response = await getSubscription(caller.id);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(emptyBody());
  });

  it('returns a qualifying ACTIVE monthly subscription and only the approved fields', async () => {
    await ensurePlanCatalog();
    const monthly = await Plan.findOne({ where: { code: 'PREMIUM_MONTHLY' } });
    if (!monthly) {
      throw new Error('Missing monthly plan');
    }
    await monthly.update({ isActive: false });
    const caller = await createUser();
    const future = new Date(Date.now() + 2 * HOUR_MS);
    const past = new Date(Date.now() - HOUR_MS);
    await subscribe(caller.id, {
      code: 'PREMIUM_YEARLY',
      status: 'EXPIRED',
      currentPeriodEnd: future,
      gracePeriodEnd: future,
      autoRenew: false
    });
    const active = await subscribe(caller.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'ACTIVE',
      currentPeriodEnd: future,
      gracePeriodEnd: null,
      autoRenew: true,
      currentPeriodStart: past
    });

    const response = await getSubscription(caller.id);

    expect(response.body).toEqual(await activeBody(active.id, monthly));
    expectApprovedFields(response.body);
    expect(response.body.data.subscription.plan.name).toBe('Love Bite Premium (Monthly)');
    expect(response.body.data.subscription.gracePeriodEnd).toBeNull();
  });

  it('returns a qualifying yearly Premium subscription', async () => {
    await ensurePlanCatalog();
    const yearly = await Plan.findOne({ where: { code: 'PREMIUM_YEARLY' } });
    if (!yearly) {
      throw new Error('Missing yearly plan');
    }
    const caller = await createUser();
    const subscription = await subscribe(caller.id, {
      code: 'PREMIUM_YEARLY',
      status: 'ACTIVE',
      currentPeriodEnd: new Date(Date.now() + 10 * DAY_MS),
      gracePeriodEnd: null,
      autoRenew: true
    });

    const response = await getSubscription(caller.id);

    expect(response.body).toEqual(await activeBody(subscription.id, yearly));
    expect(response.body.data.subscription.plan).toEqual({
      code: 'PREMIUM_YEARLY',
      name: 'Love Bite Premium (Yearly)'
    });
  });

  it('returns qualifying PAST_DUE and GRACE_PERIOD subscriptions from the live period predicate', async () => {
    await ensurePlanCatalog();
    const monthly = await Plan.findOne({ where: { code: 'PREMIUM_MONTHLY' } });
    const yearly = await Plan.findOne({ where: { code: 'PREMIUM_YEARLY' } });
    if (!monthly || !yearly) {
      throw new Error('Missing premium plans');
    }
    const pastDueUser = await createUser();
    const graceOnlyUser = await createUser();
    const graceWithCurrentUser = await createUser();
    const future = new Date(Date.now() + HOUR_MS);
    const past = new Date(Date.now() - HOUR_MS);

    const pastDue = await subscribe(pastDueUser.id, {
      code: 'PREMIUM_YEARLY',
      status: 'PAST_DUE',
      currentPeriodEnd: future,
      gracePeriodEnd: past,
      autoRenew: true
    });
    const graceOnly = await subscribe(graceOnlyUser.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'GRACE_PERIOD',
      currentPeriodEnd: past,
      gracePeriodEnd: future,
      autoRenew: false
    });
    const graceWithCurrent = await subscribe(graceWithCurrentUser.id, {
      code: 'PREMIUM_YEARLY',
      status: 'GRACE_PERIOD',
      currentPeriodEnd: future,
      gracePeriodEnd: null,
      autoRenew: false
    });

    const pastDueResponse = await getSubscription(pastDueUser.id);
    const graceOnlyResponse = await getSubscription(graceOnlyUser.id);
    const graceWithCurrentResponse = await getSubscription(graceWithCurrentUser.id);

    expect(pastDueResponse.body).toEqual(await activeBody(pastDue.id, yearly));
    expect(graceOnlyResponse.body).toEqual(await activeBody(graceOnly.id, monthly));
    expect(graceWithCurrentResponse.body).toEqual(await activeBody(graceWithCurrent.id, yearly));
    expect(graceOnlyResponse.body.data.subscription.autoRenew).toBe(false);
    expect(graceWithCurrentResponse.body.data.subscription.gracePeriodEnd).toBeNull();
  });

  it('returns an in-period CANCELED premium subscription', async () => {
    await ensurePlanCatalog();
    const monthly = await Plan.findOne({ where: { code: 'PREMIUM_MONTHLY' } });
    if (!monthly) {
      throw new Error('Missing monthly plan');
    }
    const caller = await createUser();
    const future = new Date(Date.now() + HOUR_MS);
    const canceled = await subscribe(caller.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'CANCELED',
      currentPeriodEnd: future,
      gracePeriodEnd: future,
      autoRenew: false
    });

    const response = await getSubscription(caller.id);

    expect(response.body).toEqual(await activeBody(canceled.id, monthly));
    expect(response.body.data.subscription.status).toBe('CANCELED');
    expect(response.body.data.subscription.autoRenew).toBe(false);
    expectApprovedFields(response.body);
  });

  it('returns the empty state when a canceled paid period has ended even if grace remains', async () => {
    await ensurePlanCatalog();
    const caller = await createUser();
    const past = new Date(Date.now() - HOUR_MS);
    const future = new Date(Date.now() + HOUR_MS);
    await subscribe(caller.id, {
      code: 'PREMIUM_YEARLY',
      status: 'CANCELED',
      currentPeriodEnd: past,
      gracePeriodEnd: future,
      autoRenew: false
    });

    const response = await getSubscription(caller.id);

    expect(response.body).toEqual(emptyBody());
  });

  it('returns the empty state for an EXPIRED subscription', async () => {
    await ensurePlanCatalog();
    const caller = await createUser();
    const future = new Date(Date.now() + HOUR_MS);
    await subscribe(caller.id, {
      code: 'PREMIUM_YEARLY',
      status: 'EXPIRED',
      currentPeriodEnd: future,
      gracePeriodEnd: future,
      autoRenew: false
    });

    const response = await getSubscription(caller.id);

    expect(response.body).toEqual(emptyBody());
  });

  it('returns the empty state when neither period timestamp remains in the future', async () => {
    await ensurePlanCatalog();
    const activeUser = await createUser();
    const pastDueUser = await createUser();
    const graceUser = await createUser();
    const past = new Date(Date.now() - HOUR_MS);
    const earlier = new Date(Date.now() - 2 * HOUR_MS);

    await subscribe(activeUser.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'ACTIVE',
      currentPeriodEnd: past,
      gracePeriodEnd: null
    });
    await subscribe(pastDueUser.id, {
      code: 'PREMIUM_YEARLY',
      status: 'PAST_DUE',
      currentPeriodEnd: past,
      gracePeriodEnd: earlier
    });
    await subscribe(graceUser.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'GRACE_PERIOD',
      currentPeriodEnd: earlier,
      gracePeriodEnd: past
    });

    for (const user of [activeUser, pastDueUser, graceUser]) {
      const response = await getSubscription(user.id);
      expect(response.body).toEqual(emptyBody());
    }
  });

  it('does not treat a FREE plan subscription as active Premium', async () => {
    await ensurePlanCatalog();
    const caller = await createUser();
    const future = new Date(Date.now() + HOUR_MS);
    await subscribe(caller.id, {
      code: 'FREE',
      status: 'ACTIVE',
      currentPeriodEnd: future,
      gracePeriodEnd: future,
      autoRenew: true
    });

    const response = await getSubscription(caller.id);

    expect(response.body).toEqual(emptyBody());
  });

  it('returns the in-period canceled row and ignores an expired row', async () => {
    await ensurePlanCatalog();
    const monthly = await Plan.findOne({ where: { code: 'PREMIUM_MONTHLY' } });
    if (!monthly) {
      throw new Error('Missing monthly plan');
    }
    const caller = await createUser();
    const future = new Date(Date.now() + HOUR_MS);
    const canceled = await subscribe(caller.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'CANCELED',
      currentPeriodEnd: future,
      gracePeriodEnd: future,
      autoRenew: false
    });
    await subscribe(caller.id, {
      code: 'PREMIUM_YEARLY',
      status: 'EXPIRED',
      currentPeriodEnd: future,
      gracePeriodEnd: null,
      autoRenew: false
    });

    const response = await getSubscription(caller.id);

    expect(response.body).toEqual(await activeBody(canceled.id, monthly));
    expect(await Subscription.count({ where: { userId: caller.id } })).toBe(2);
  });

  it('prefers a qualifying non-canceled row over a future-dated canceled row', async () => {
    await ensurePlanCatalog();
    const yearly = await Plan.findOne({ where: { code: 'PREMIUM_YEARLY' } });
    if (!yearly) {
      throw new Error('Missing yearly plan');
    }
    const caller = await createUser();
    const sooner = new Date(Date.now() + HOUR_MS);
    const later = new Date(Date.now() + 2 * HOUR_MS);
    await subscribe(caller.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'CANCELED',
      currentPeriodEnd: later,
      gracePeriodEnd: later,
      autoRenew: false
    });
    const active = await subscribe(caller.id, {
      code: 'PREMIUM_YEARLY',
      status: 'ACTIVE',
      currentPeriodEnd: sooner,
      gracePeriodEnd: null,
      autoRenew: true
    });

    const response = await getSubscription(caller.id);

    expect(response.body).toEqual(await activeBody(active.id, yearly));
    expect(response.body.data.subscription.status).toBe('ACTIVE');
  });

  it('does not write or mutate subscription rows', async () => {
    await ensurePlanCatalog();
    const caller = await createUser();
    const subscription = await subscribe(caller.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'ACTIVE',
      currentPeriodEnd: new Date(Date.now() + HOUR_MS),
      gracePeriodEnd: null,
      autoRenew: true
    });
    const before = (await Subscription.findByPk(subscription.id))?.toJSON();
    const countsBefore = await publicRowCounts();
    const statsBefore = await mutationStats();

    const response = await getSubscription(caller.id);

    expect(response.status).toBe(200);
    expect(response.body.data.hasActiveSubscription).toBe(true);
    expect(await publicRowCounts()).toEqual(countsBefore);
    expect(await mutationStats()).toEqual(statsBefore);
    expect((await Subscription.findByPk(subscription.id))?.toJSON()).toEqual(before);
  });

  it('keeps entitlements and usage on the same Premium predicate', async () => {
    await ensurePlanCatalog();
    const premiumUser = await createUser();
    const canceledUser = await createUser();
    const future = new Date(Date.now() + HOUR_MS);
    await subscribe(premiumUser.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'ACTIVE',
      currentPeriodEnd: future,
      gracePeriodEnd: null
    });
    await subscribe(canceledUser.id, {
      code: 'PREMIUM_YEARLY',
      status: 'CANCELED',
      currentPeriodEnd: future,
      gracePeriodEnd: future,
      autoRenew: false
    });

    const quotaResetsAt = currentUtcDayWindow().periodEnd.toISOString();
    const premiumSubscription = await getSubscription(premiumUser.id);
    const premiumEntitlements = await request(app).get('/api/v1/me/entitlements').set(authHeader(premiumUser.id));
    const premiumUsage = await request(app).get('/api/v1/me/usage').set(authHeader(premiumUser.id));
    const canceledSubscription = await getSubscription(canceledUser.id);
    const canceledEntitlements = await request(app).get('/api/v1/me/entitlements').set(authHeader(canceledUser.id));
    const canceledUsage = await request(app).get('/api/v1/me/usage').set(authHeader(canceledUser.id));
    expect(premiumSubscription.body.data.hasActiveSubscription).toBe(true);
    expect(premiumEntitlements.body.data.tier).toBe('PREMIUM');
    expect(premiumUsage.body.data.dailyLikePass).toEqual({ used: 0, limit: null, remaining: null, isUnlimited: true });
    expect(premiumUsage.body.data.dailyTextMessages).toEqual({ used: 0, limit: null, remaining: null, isUnlimited: true });
    expect(premiumUsage.body.data.quotaResetsAt).toBe(quotaResetsAt);

    expect(canceledSubscription.body.data.hasActiveSubscription).toBe(true);
    expect(canceledSubscription.body.data.subscription.status).toBe('CANCELED');
    expect(canceledEntitlements.body.data.tier).toBe('PREMIUM');
    expect(canceledUsage.body.data.dailyLikePass).toEqual({ used: 0, limit: null, remaining: null, isUnlimited: true });
    expect(canceledUsage.body.data.dailyTextMessages).toEqual({ used: 0, limit: null, remaining: null, isUnlimited: true });
    expect(canceledUsage.body.data.quotaResetsAt).toBe(quotaResetsAt);
  });
});
