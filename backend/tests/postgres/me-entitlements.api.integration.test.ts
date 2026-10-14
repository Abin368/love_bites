import { randomUUID } from 'crypto';
import request from 'supertest';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../../src/config/database';
import { Plan, PlanBillingInterval } from '../../src/database/models/plan.model';
import { Subscription, SubscriptionStatus } from '../../src/database/models/subscription.model';
import { User, UserRole } from '../../src/database/models/user.model';
import { UserCreditBalance } from '../../src/database/models/user-credit-balance.model';
import { signAccessToken } from '../../src/utils/jwt';
import { app } from '../../src/app';

const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';
const HOUR_MS = 60 * 60 * 1000;

function timestamps(): { createdAt: Date; updatedAt: Date } {
  const now = new Date();
  return { createdAt: now, updatedAt: now };
}

function tokenFor(userId: string, role: 'USER' | 'ADMIN' = 'USER'): string {
  return signAccessToken({
    sub: userId,
    role,
    isVerified: true,
    isProfileComplete: true
  });
}

function authHeader(userId: string, role: 'USER' | 'ADMIN' = 'USER') {
  return { Authorization: `Bearer ${tokenFor(userId, role)}` };
}

function getEntitlements(userId?: string, role: 'USER' | 'ADMIN' = 'USER') {
  const call = request(app).get('/api/v1/me/entitlements');
  if (!userId) {
    return call;
  }
  return call.set(authHeader(userId, role));
}

async function createUser(input: { role?: UserRole; emailVerified?: boolean; status?: 'UNVERIFIED' | 'ACTIVE' } = {}): Promise<User> {
  return User.create({
    email: `entitlements-${randomUUID()}@example.com`,
    phone: null,
    passwordHash: PASSWORD_HASH,
    role: input.role ?? 'USER',
    status: input.status ?? 'ACTIVE',
    emailVerified: input.emailVerified ?? true,
    phoneVerified: false
  });
}

async function ensurePlan(code: 'FREE' | 'PREMIUM_MONTHLY' | 'PREMIUM_YEARLY'): Promise<Plan> {
  const existing = await Plan.findOne({ where: { code } });
  if (existing) {
    return existing;
  }

  const billingInterval: PlanBillingInterval = code === 'PREMIUM_YEARLY' ? 'YEAR' : code === 'PREMIUM_MONTHLY' ? 'MONTH' : 'NONE';
  return Plan.create({
    code,
    name: code,
    billingInterval,
    priceInCents: code === 'FREE' ? 0 : 49900,
    currency: 'INR',
    isActive: true,
    displayOrder: code === 'FREE' ? 0 : 1,
    ...timestamps()
  });
}

async function subscribe(
  userId: string,
  input: {
    code: 'FREE' | 'PREMIUM_MONTHLY' | 'PREMIUM_YEARLY';
    status: SubscriptionStatus;
    currentPeriodEnd: Date;
    gracePeriodEnd?: Date | null;
  }
): Promise<Subscription> {
  const plan = await ensurePlan(input.code);
  const now = new Date();
  return Subscription.create({
    userId,
    planId: plan.id,
    status: input.status,
    autoRenew: input.status !== 'CANCELED',
    currentPeriodStart: new Date(input.currentPeriodEnd.getTime() - 30 * 24 * HOUR_MS),
    currentPeriodEnd: input.currentPeriodEnd,
    gracePeriodEnd: input.gracePeriodEnd ?? null,
    ...timestamps(),
    createdAt: now,
    updatedAt: now
  });
}

function features(premium: boolean) {
  return {
    unlimitedSwipes: premium,
    seeWhoLikedYou: premium,
    advancedFilters: false,
    undoAction: premium,
    chatMedia: premium,
    adFree: false,
    priorityVisibility: false
  };
}

function successBody(tier: 'PREMIUM' | 'FREE', credits: { boostBalance: number; superLikeBalance: number }) {
  return {
    success: true,
    data: {
      tier,
      features: features(tier === 'PREMIUM'),
      credits
    },
    message: 'Entitlements retrieved.'
  };
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

describe('GET /api/v1/me/entitlements', () => {
  it('returns 401 when the token is missing', async () => {
    const response = await getEntitlements();

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('returns 403 for an authenticated admin', async () => {
    const admin = await createUser({ role: 'ADMIN' });

    const response = await getEntitlements(admin.id, 'ADMIN');

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('returns FREE with every capability false when no eligible subscription exists', async () => {
    const unverified = await createUser({ emailVerified: false, status: 'UNVERIFIED' });
    const freePlanUser = await createUser();
    const future = new Date(Date.now() + HOUR_MS);
    await subscribe(freePlanUser.id, {
      code: 'FREE',
      status: 'ACTIVE',
      currentPeriodEnd: future,
      gracePeriodEnd: future
    });

    const missing = await getEntitlements(unverified.id);
    const freePlan = await getEntitlements(freePlanUser.id);
    const zeroCredits = { boostBalance: 0, superLikeBalance: 0 };

    expect(missing.status).toBe(200);
    expect(missing.body).toEqual(successBody('FREE', zeroCredits));
    expect(freePlan.status).toBe(200);
    expect(freePlan.body).toEqual(successBody('FREE', zeroCredits));
    expect(await UserCreditBalance.count()).toBe(0);
  });

  it('returns PREMIUM when the current period is still in the future for ACTIVE and PAST_DUE', async () => {
    const activeUser = await createUser();
    const pastDueUser = await createUser();
    const activeWithGraceUser = await createUser();
    const future = new Date(Date.now() + HOUR_MS);
    const past = new Date(Date.now() - HOUR_MS);

    await subscribe(activeUser.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'ACTIVE',
      currentPeriodEnd: future,
      gracePeriodEnd: null
    });
    await subscribe(pastDueUser.id, {
      code: 'PREMIUM_YEARLY',
      status: 'PAST_DUE',
      currentPeriodEnd: future,
      gracePeriodEnd: past
    });
    await subscribe(activeWithGraceUser.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'ACTIVE',
      currentPeriodEnd: past,
      gracePeriodEnd: future
    });

    const active = await getEntitlements(activeUser.id);
    const pastDue = await getEntitlements(pastDueUser.id);
    const activeGrace = await getEntitlements(activeWithGraceUser.id);
    const zeroCredits = { boostBalance: 0, superLikeBalance: 0 };

    expect(active.status).toBe(200);
    expect(active.body).toEqual(successBody('PREMIUM', zeroCredits));
    expect(pastDue.status).toBe(200);
    expect(pastDue.body).toEqual(successBody('PREMIUM', zeroCredits));
    expect(activeGrace.status).toBe(200);
    expect(activeGrace.body).toEqual(successBody('PREMIUM', zeroCredits));
  });

  it('returns PREMIUM for GRACE_PERIOD when grace_period_end is still in the future', async () => {
    const graceOnly = await createUser();
    const graceWithCurrentPeriod = await createUser();
    const future = new Date(Date.now() + HOUR_MS);
    const past = new Date(Date.now() - HOUR_MS);

    await subscribe(graceOnly.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'GRACE_PERIOD',
      currentPeriodEnd: past,
      gracePeriodEnd: future
    });
    await subscribe(graceWithCurrentPeriod.id, {
      code: 'PREMIUM_YEARLY',
      status: 'GRACE_PERIOD',
      currentPeriodEnd: future,
      gracePeriodEnd: null
    });

    const onlyGrace = await getEntitlements(graceOnly.id);
    const currentPeriod = await getEntitlements(graceWithCurrentPeriod.id);
    const zeroCredits = { boostBalance: 0, superLikeBalance: 0 };

    expect(onlyGrace.status).toBe(200);
    expect(onlyGrace.body).toEqual(successBody('PREMIUM', zeroCredits));
    expect(currentPeriod.status).toBe(200);
    expect(currentPeriod.body).toEqual(successBody('PREMIUM', zeroCredits));
  });

  it('returns FREE when both eligibility dates are no longer in the future', async () => {
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

    const zeroCredits = { boostBalance: 0, superLikeBalance: 0 };
    for (const user of [activeUser, pastDueUser, graceUser]) {
      const response = await getEntitlements(user.id);
      expect(response.status).toBe(200);
      expect(response.body).toEqual(successBody('FREE', zeroCredits));
    }
  });

  it('returns FREE for CANCELED and EXPIRED subscriptions under the current predicate', async () => {
    const canceled = await createUser();
    const expired = await createUser();
    const future = new Date(Date.now() + HOUR_MS);

    await subscribe(canceled.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'CANCELED',
      currentPeriodEnd: future,
      gracePeriodEnd: future
    });
    await subscribe(expired.id, {
      code: 'PREMIUM_YEARLY',
      status: 'EXPIRED',
      currentPeriodEnd: future,
      gracePeriodEnd: future
    });

    const canceledResponse = await getEntitlements(canceled.id);
    const expiredResponse = await getEntitlements(expired.id);
    const zeroCredits = { boostBalance: 0, superLikeBalance: 0 };

    expect(canceledResponse.status).toBe(200);
    expect(canceledResponse.body).toEqual(successBody('FREE', zeroCredits));
    expect(expiredResponse.status).toBe(200);
    expect(expiredResponse.body).toEqual(successBody('FREE', zeroCredits));
  });

  it('returns the caller’s stored Super Like and boost balances', async () => {
    const caller = await createUser();
    const other = await createUser();
    await subscribe(caller.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'ACTIVE',
      currentPeriodEnd: new Date(Date.now() + HOUR_MS),
      gracePeriodEnd: null
    });
    await UserCreditBalance.create({ userId: caller.id, creditType: 'SUPER_LIKE', balance: 5, ...timestamps() });
    await UserCreditBalance.create({ userId: caller.id, creditType: 'BOOST', balance: 2, ...timestamps() });
    await UserCreditBalance.create({ userId: other.id, creditType: 'SUPER_LIKE', balance: 9, ...timestamps() });
    await UserCreditBalance.create({ userId: other.id, creditType: 'BOOST', balance: 4, ...timestamps() });

    const response = await getEntitlements(caller.id);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(successBody('PREMIUM', { boostBalance: 2, superLikeBalance: 5 }));
    expect(await UserCreditBalance.count({ where: { userId: caller.id, creditType: 'SUPER_LIKE' } })).toBe(1);
    expect((await UserCreditBalance.findOne({ where: { userId: caller.id, creditType: 'SUPER_LIKE' } }))?.balance).toBe(5);
    expect((await UserCreditBalance.findOne({ where: { userId: caller.id, creditType: 'BOOST' } }))?.balance).toBe(2);
  });

  it('returns zero balances and does not create a row when no credit balance exists', async () => {
    const caller = await createUser();

    const before = await UserCreditBalance.count({ where: { userId: caller.id } });
    const response = await getEntitlements(caller.id);
    const after = await UserCreditBalance.count({ where: { userId: caller.id } });

    expect(before).toBe(0);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(successBody('FREE', { boostBalance: 0, superLikeBalance: 0 }));
    expect(after).toBe(0);
  });

  it('rejects query parameters and a request body with VALIDATION_ERROR', async () => {
    const caller = await createUser();

    const query = await getEntitlements(caller.id).query({ tier: 'PREMIUM' });
    expect(query.status).toBe(400);
    expect(query.body.success).toBe(false);
    expect(query.body.error.code).toBe('VALIDATION_ERROR');
    expect(query.body.error.details).toEqual([{ field: 'tier', message: 'Unsupported query parameter.' }]);

    const body = await getEntitlements(caller.id).send({ tier: 'PREMIUM' });
    expect(body.status).toBe(400);
    expect(body.body.error.code).toBe('VALIDATION_ERROR');
    expect(await UserCreditBalance.count()).toBe(0);
    expect(await Subscription.count()).toBe(0);
  });

  it('does not write database rows or mutate existing subscription and credit rows', async () => {
    const caller = await createUser();
    const subscription = await subscribe(caller.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'ACTIVE',
      currentPeriodEnd: new Date(Date.now() + HOUR_MS),
      gracePeriodEnd: null
    });
    const superLike = await UserCreditBalance.create({
      userId: caller.id,
      creditType: 'SUPER_LIKE',
      balance: 3,
      ...timestamps()
    });
    const boost = await UserCreditBalance.create({
      userId: caller.id,
      creditType: 'BOOST',
      balance: 1,
      ...timestamps()
    });

    const countsBefore = await publicRowCounts();
    const statsBefore = await mutationStats();
    const subscriptionBefore = (await Subscription.findByPk(subscription.id))?.toJSON();
    const superLikeBefore = (await UserCreditBalance.findByPk(superLike.id))?.toJSON();
    const boostBefore = (await UserCreditBalance.findByPk(boost.id))?.toJSON();

    const response = await getEntitlements(caller.id);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(successBody('PREMIUM', { boostBalance: 1, superLikeBalance: 3 }));
    expect(await publicRowCounts()).toEqual(countsBefore);
    expect(await mutationStats()).toEqual(statsBefore);
    expect((await Subscription.findByPk(subscription.id))?.toJSON()).toEqual(subscriptionBefore);
    expect((await UserCreditBalance.findByPk(superLike.id))?.toJSON()).toEqual(superLikeBefore);
    expect((await UserCreditBalance.findByPk(boost.id))?.toJSON()).toEqual(boostBefore);
  });
});
