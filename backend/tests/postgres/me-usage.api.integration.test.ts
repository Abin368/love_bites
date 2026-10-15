import { randomUUID } from 'crypto';
import request from 'supertest';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../../src/config/database';
import { Plan, PlanBillingInterval } from '../../src/database/models/plan.model';
import { Subscription, SubscriptionStatus } from '../../src/database/models/subscription.model';
import { UsageRecord } from '../../src/database/models/usage-record.model';
import { User, UserRole } from '../../src/database/models/user.model';
import {
  currentUtcDayWindow,
  DAILY_LIKE_PASS_METRIC,
  DAILY_TEXT_MESSAGES_METRIC,
  FREE_DAILY_LIKE_PASS_LIMIT,
  FREE_DAILY_TEXT_MESSAGES_LIMIT
} from '../../src/modules/likes/likes.data-access';
import { signAccessToken } from '../../src/utils/jwt';
import { app } from '../../src/app';

const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

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

function getUsage(userId?: string, role: 'USER' | 'ADMIN' = 'USER') {
  const call = request(app).get('/api/v1/me/usage');
  if (!userId) {
    return call;
  }
  return call.set(authHeader(userId, role));
}

async function createUser(input: { role?: UserRole; emailVerified?: boolean; status?: 'UNVERIFIED' | 'ACTIVE' } = {}): Promise<User> {
  return User.create({
    email: `usage-${randomUUID()}@example.com`,
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
    currentPeriodStart: new Date(input.currentPeriodEnd.getTime() - 30 * DAY_MS),
    currentPeriodEnd: input.currentPeriodEnd,
    gracePeriodEnd: input.gracePeriodEnd ?? null,
    ...timestamps(),
    createdAt: now,
    updatedAt: now
  });
}

async function seedUsage(
  userId: string,
  metricKey: string,
  usageCount: number,
  periodStart: Date,
  periodEnd: Date
): Promise<UsageRecord> {
  return UsageRecord.create({
    userId,
    metricKey,
    periodStart,
    periodEnd,
    usageCount,
    ...timestamps()
  });
}

async function seedCurrentUsage(userId: string, likePass: number, textMessages: number): Promise<void> {
  const window = currentUtcDayWindow();
  await seedUsage(userId, DAILY_LIKE_PASS_METRIC, likePass, window.periodStart, window.periodEnd);
  await seedUsage(userId, DAILY_TEXT_MESSAGES_METRIC, textMessages, window.periodStart, window.periodEnd);
}

function limitedMetric(used: number, limit: number) {
  return { used, limit, remaining: limit - used, isUnlimited: false as const };
}

function unlimitedMetric(used: number) {
  return { used, limit: null, remaining: null, isUnlimited: true as const };
}

async function expectUsage(
  userId: string,
  dailyLikePass: ReturnType<typeof limitedMetric> | ReturnType<typeof unlimitedMetric>,
  dailyTextMessages: ReturnType<typeof limitedMetric> | ReturnType<typeof unlimitedMetric>
) {
  const resetBefore = currentUtcDayWindow().periodEnd.toISOString();
  const response = await getUsage(userId);
  const resetAfter = currentUtcDayWindow().periodEnd.toISOString();

  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    success: true,
    data: {
      dailyLikePass,
      dailyTextMessages,
      quotaResetsAt: response.body.data?.quotaResetsAt
    },
    message: 'Usage retrieved.'
  });
  expect([resetBefore, resetAfter]).toContain(response.body.data.quotaResetsAt);
  return response;
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

describe('GET /api/v1/me/usage', () => {
  it('returns 401 when the token is missing', async () => {
    const response = await getUsage();

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('returns 403 for an authenticated admin', async () => {
    const admin = await createUser({ role: 'ADMIN' });

    const response = await getUsage(admin.id, 'ADMIN');

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('lets an unverified user retrieve a free usage snapshot', async () => {
    const unverified = await createUser({ emailVerified: false, status: 'UNVERIFIED' });

    await expectUsage(
      unverified.id,
      limitedMetric(0, FREE_DAILY_LIKE_PASS_LIMIT),
      limitedMetric(0, FREE_DAILY_TEXT_MESSAGES_LIMIT)
    );
  });

  it('rejects query parameters and a request body with VALIDATION_ERROR', async () => {
    const caller = await createUser();

    const query = await getUsage(caller.id).query({ userId: caller.id });
    expect(query.status).toBe(400);
    expect(query.body.success).toBe(false);
    expect(query.body.error.code).toBe('VALIDATION_ERROR');
    expect(query.body.error.details).toEqual([{ field: 'userId', message: 'Unsupported query parameter.' }]);

    const body = await getUsage(caller.id).send({ used: 4 });
    expect(body.status).toBe(400);
    expect(body.body.success).toBe(false);
    expect(body.body.error.code).toBe('VALIDATION_ERROR');
    expect(await UsageRecord.count()).toBe(0);
  });

  it('returns zero usage and does not create rows when none exist', async () => {
    const caller = await createUser();

    const before = await UsageRecord.count({ where: { userId: caller.id } });
    await expectUsage(
      caller.id,
      limitedMetric(0, FREE_DAILY_LIKE_PASS_LIMIT),
      limitedMetric(0, FREE_DAILY_TEXT_MESSAGES_LIMIT)
    );
    const after = await UsageRecord.count({ where: { userId: caller.id } });

    expect(before).toBe(0);
    expect(after).toBe(0);
  });

  it('returns remaining counts for current-day usage of 4 likes and passes and 8 text messages', async () => {
    const caller = await createUser();
    await seedCurrentUsage(caller.id, 4, 8);

    await expectUsage(caller.id, limitedMetric(4, FREE_DAILY_LIKE_PASS_LIMIT), limitedMetric(8, FREE_DAILY_TEXT_MESSAGES_LIMIT));
  });

  it('returns remaining zero when the free limits are exhausted', async () => {
    const caller = await createUser();
    await seedCurrentUsage(caller.id, FREE_DAILY_LIKE_PASS_LIMIT, FREE_DAILY_TEXT_MESSAGES_LIMIT);

    await expectUsage(
      caller.id,
      limitedMetric(FREE_DAILY_LIKE_PASS_LIMIT, FREE_DAILY_LIKE_PASS_LIMIT),
      limitedMetric(FREE_DAILY_TEXT_MESSAGES_LIMIT, FREE_DAILY_TEXT_MESSAGES_LIMIT)
    );
  });

  it('ignores usage rows from the previous UTC day', async () => {
    const caller = await createUser();
    const current = currentUtcDayWindow();
    const previousStart = new Date(current.periodStart.getTime() - DAY_MS);

    await seedUsage(caller.id, DAILY_LIKE_PASS_METRIC, 9, previousStart, current.periodStart);
    await seedUsage(caller.id, DAILY_TEXT_MESSAGES_METRIC, 15, previousStart, current.periodStart);
    await seedCurrentUsage(caller.id, 1, 2);

    await expectUsage(caller.id, limitedMetric(1, FREE_DAILY_LIKE_PASS_LIMIT), limitedMetric(2, FREE_DAILY_TEXT_MESSAGES_LIMIT));
  });

  it('does not return another user’s current-window usage', async () => {
    const caller = await createUser();
    const other = await createUser();
    await seedCurrentUsage(caller.id, 2, 3);
    await seedCurrentUsage(other.id, 9, 19);

    await expectUsage(caller.id, limitedMetric(2, FREE_DAILY_LIKE_PASS_LIMIT), limitedMetric(3, FREE_DAILY_TEXT_MESSAGES_LIMIT));
    expect(await UsageRecord.count({ where: { userId: other.id } })).toBe(2);
  });

  it('keeps a free-plan subscriber and an elapsed premium subscription limited', async () => {
    const freePlanUser = await createUser();
    const elapsed = await createUser();
    const future = new Date(Date.now() + HOUR_MS);
    const past = new Date(Date.now() - HOUR_MS);

    await subscribe(freePlanUser.id, {
      code: 'FREE',
      status: 'ACTIVE',
      currentPeriodEnd: future,
      gracePeriodEnd: future
    });
    await subscribe(elapsed.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'ACTIVE',
      currentPeriodEnd: past,
      gracePeriodEnd: null
    });
    await seedCurrentUsage(freePlanUser.id, 4, 8);
    await seedCurrentUsage(elapsed.id, 1, 2);

    await expectUsage(
      freePlanUser.id,
      limitedMetric(4, FREE_DAILY_LIKE_PASS_LIMIT),
      limitedMetric(8, FREE_DAILY_TEXT_MESSAGES_LIMIT)
    );
    await expectUsage(elapsed.id, limitedMetric(1, FREE_DAILY_LIKE_PASS_LIMIT), limitedMetric(2, FREE_DAILY_TEXT_MESSAGES_LIMIT));
  });

  it('keeps CANCELED and EXPIRED subscriptions limited when the period end is still in the future', async () => {
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
    await seedCurrentUsage(canceled.id, 4, 8);
    await seedCurrentUsage(expired.id, 10, 20);

    await expectUsage(canceled.id, limitedMetric(4, FREE_DAILY_LIKE_PASS_LIMIT), limitedMetric(8, FREE_DAILY_TEXT_MESSAGES_LIMIT));
    await expectUsage(
      expired.id,
      limitedMetric(FREE_DAILY_LIKE_PASS_LIMIT, FREE_DAILY_LIKE_PASS_LIMIT),
      limitedMetric(FREE_DAILY_TEXT_MESSAGES_LIMIT, FREE_DAILY_TEXT_MESSAGES_LIMIT)
    );
  });

  it('returns unlimited metrics and the stored current-day count for eligible premium subscriptions', async () => {
    const activeUser = await createUser();
    const pastDueUser = await createUser();
    const graceUser = await createUser();
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
    await subscribe(graceUser.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'GRACE_PERIOD',
      currentPeriodEnd: past,
      gracePeriodEnd: future
    });
    await seedCurrentUsage(activeUser.id, 4, 8);
    await seedCurrentUsage(pastDueUser.id, 1, 0);
    await seedCurrentUsage(graceUser.id, 0, 3);

    await expectUsage(activeUser.id, unlimitedMetric(4), unlimitedMetric(8));
    await expectUsage(pastDueUser.id, unlimitedMetric(1), unlimitedMetric(0));
    await expectUsage(graceUser.id, unlimitedMetric(0), unlimitedMetric(3));
  });

  it('returns used zero for a premium user with no usage rows and does not create them', async () => {
    const caller = await createUser();
    await subscribe(caller.id, {
      code: 'PREMIUM_YEARLY',
      status: 'ACTIVE',
      currentPeriodEnd: new Date(Date.now() + HOUR_MS),
      gracePeriodEnd: null
    });

    const before = await UsageRecord.count({ where: { userId: caller.id } });
    await expectUsage(caller.id, unlimitedMetric(0), unlimitedMetric(0));
    const after = await UsageRecord.count({ where: { userId: caller.id } });

    expect(before).toBe(0);
    expect(after).toBe(0);
  });

  it('does not write database rows or change existing usage records', async () => {
    const caller = await createUser();
    const other = await createUser();
    const window = currentUtcDayWindow();
    const likePass = await seedUsage(caller.id, DAILY_LIKE_PASS_METRIC, 4, window.periodStart, window.periodEnd);
    const text = await seedUsage(caller.id, DAILY_TEXT_MESSAGES_METRIC, 8, window.periodStart, window.periodEnd);
    const otherLikePass = await seedUsage(other.id, DAILY_LIKE_PASS_METRIC, 9, window.periodStart, window.periodEnd);
    await subscribe(caller.id, {
      code: 'PREMIUM_MONTHLY',
      status: 'ACTIVE',
      currentPeriodEnd: new Date(Date.now() + HOUR_MS),
      gracePeriodEnd: null
    });

    const countsBefore = await publicRowCounts();
    const statsBefore = await mutationStats();
    const likePassBefore = (await UsageRecord.findByPk(likePass.id))?.toJSON();
    const textBefore = (await UsageRecord.findByPk(text.id))?.toJSON();
    const otherBefore = (await UsageRecord.findByPk(otherLikePass.id))?.toJSON();

    await expectUsage(caller.id, unlimitedMetric(4), unlimitedMetric(8));

    expect(await publicRowCounts()).toEqual(countsBefore);
    expect(await mutationStats()).toEqual(statsBefore);
    expect((await UsageRecord.findByPk(likePass.id))?.toJSON()).toEqual(likePassBefore);
    expect((await UsageRecord.findByPk(text.id))?.toJSON()).toEqual(textBefore);
    expect((await UsageRecord.findByPk(otherLikePass.id))?.toJSON()).toEqual(otherBefore);
    expect(likePassBefore?.usageCount).toBe(4);
    expect(textBefore?.usageCount).toBe(8);
    expect(otherBefore?.usageCount).toBe(9);
  });
});
