import { randomUUID } from 'crypto';
import request from 'supertest';
import { literal, QueryTypes } from 'sequelize';
import { sequelize } from '../../src/config/database';
import { Conversation } from '../../src/database/models/conversation.model';
import { DatingPreference } from '../../src/database/models/dating-preference.model';
import { Gender } from '../../src/database/models/gender.model';
import { Like } from '../../src/database/models/like.model';
import { Match } from '../../src/database/models/match.model';
import { Message } from '../../src/database/models/message.model';
import { Plan } from '../../src/database/models/plan.model';
import { Profile } from '../../src/database/models/profile.model';
import { ProfilePhoto } from '../../src/database/models/profile-photo.model';
import { Subscription, SubscriptionStatus } from '../../src/database/models/subscription.model';
import { UsageLimit } from '../../src/database/models/usage-limit.model';
import { UsageRecord } from '../../src/database/models/usage-record.model';
import { User } from '../../src/database/models/user.model';
import { currentUtcDayWindow, DAILY_LIKE_PASS_METRIC, DAILY_TEXT_MESSAGES_METRIC } from '../../src/modules/likes/likes.data-access';
import { signAccessToken } from '../../src/utils/jwt';
import { app } from '../../src/app';
import { ensurePlanCatalog } from './plan-catalog.fixture';

const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';
const ORIGIN = { latitude: 12.9716, longitude: 77.5946 };
const HOUR_MS = 60 * 60 * 1000;
const LIKE_LIMIT_MESSAGE = 'You have reached your daily limit of 10 likes/passes.';
const TEXT_LIMIT_MESSAGE = 'You have reached your daily limit of 20 text messages.';

function timestamps(): { createdAt: Date; updatedAt: Date } {
  const now = new Date();
  return { createdAt: now, updatedAt: now };
}

function authHeader(userId: string) {
  return {
    Authorization: `Bearer ${signAccessToken({
      sub: userId,
      role: 'USER',
      isVerified: true,
      isProfileComplete: true
    })}`
  };
}

async function buildUser(): Promise<User> {
  const gender = await Gender.create({ code: `quota-${randomUUID()}`, name: 'Woman', isActive: true });
  const user = await User.create({
    email: `quota-${randomUUID()}@example.com`,
    phone: null,
    passwordHash: PASSWORD_HASH,
    role: 'USER',
    status: 'ACTIVE',
    emailVerified: true,
    phoneVerified: false
  });
  await Profile.create({
    userId: user.id,
    firstName: 'Jordan',
    dateOfBirth: '1998-04-12',
    genderId: gender.id,
    bio: 'Coffee and long walks.',
    occupation: 'Designer',
    education: 'NID',
    isProfileComplete: true
  });
  await Profile.update(
    {
      city: 'Bengaluru',
      location: literal(`ST_GeogFromText('SRID=4326;POINT(${ORIGIN.longitude} ${ORIGIN.latitude})')`)
    },
    { where: { userId: user.id } }
  );
  await DatingPreference.create({
    userId: user.id,
    minAge: 18,
    maxAge: 100,
    maxDistanceKm: 50,
    ...timestamps()
  });
  await ProfilePhoto.create({
    userId: user.id,
    storageKey: `photos/${user.id}/${randomUUID()}.webp`,
    mimeType: 'image/jpeg',
    fileSizeBytes: 2048,
    displayOrder: 1,
    isPrimary: true,
    ...timestamps()
  });
  return user;
}

async function pair() {
  return { caller: await buildUser(), target: await buildUser() };
}

async function insertMatch(leftUserId: string, rightUserId: string): Promise<Match> {
  const rows = await sequelize.query<{ id: string }>(
    `INSERT INTO matches (
       id, user_one_id, user_two_id, status, matched_at, created_at, updated_at
     )
     VALUES (
       gen_random_uuid(),
       LEAST(CAST(:leftUserId AS uuid), CAST(:rightUserId AS uuid)),
       GREATEST(CAST(:leftUserId AS uuid), CAST(:rightUserId AS uuid)),
       'ACTIVE',
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
     )
     RETURNING id`,
    { replacements: { leftUserId, rightUserId }, type: QueryTypes.SELECT }
  );
  const match = await Match.findByPk(rows[0].id);
  if (!match) {
    throw new Error('Match was not inserted.');
  }
  return match;
}

async function activeThread() {
  const users = await pair();
  const match = await insertMatch(users.caller.id, users.target.id);
  const conversation = await Conversation.create({
    matchId: match.id,
    status: 'ACTIVE',
    lastMessageAt: null,
    closedAt: null,
    ...timestamps()
  });
  return { ...users, conversation };
}

function like(callerId: string, targetUserId: string) {
  return request(app).post(`/api/v1/discovery/${targetUserId}/like`).set(authHeader(callerId));
}

function pass(callerId: string, targetUserId: string) {
  return request(app).post(`/api/v1/discovery/${targetUserId}/pass`).set(authHeader(callerId));
}

function sendMessage(callerId: string, conversationId: string) {
  return request(app)
    .post(`/api/v1/conversations/${conversationId}/messages`)
    .set(authHeader(callerId))
    .send({ messageType: 'TEXT', content: 'Hello' });
}

async function usageCount(userId: string, metricKey: string): Promise<number> {
  const { periodStart } = currentUtcDayWindow();
  const row = await UsageRecord.findOne({ where: { userId, metricKey, periodStart } });
  return row?.usageCount ?? 0;
}

async function seedUsage(userId: string, metricKey: string, usageCount: number): Promise<void> {
  const window = currentUtcDayWindow();
  await UsageRecord.create({
    userId,
    metricKey,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    usageCount,
    ...timestamps()
  });
}

async function planByCode(code: string): Promise<Plan> {
  const plan = await Plan.findOne({ where: { code } });
  if (!plan) {
    throw new Error(`${code} plan is missing.`);
  }
  return plan;
}

async function subscribe(
  userId: string,
  code: string,
  status: SubscriptionStatus,
  currentPeriodEnd: Date,
  gracePeriodEnd: Date | null
): Promise<void> {
  const plan = await planByCode(code);
  await Subscription.create({
    userId,
    planId: plan.id,
    status,
    currentPeriodStart: new Date(currentPeriodEnd.getTime() - 30 * 24 * HOUR_MS),
    currentPeriodEnd,
    gracePeriodEnd,
    ...timestamps()
  });
}

async function setLimit(planCode: string, metricKey: string, limitValue: number, periodType: 'DAILY' | 'MONTHLY' | 'LIFETIME'): Promise<void> {
  const plan = await planByCode(planCode);
  const [count] = await UsageLimit.update({ limitValue, periodType }, { where: { planId: plan.id, metricKey } });
  if (count !== 1) {
    throw new Error(`Expected one ${planCode} ${metricKey} limit to update.`);
  }
}

describe('catalog-backed daily quota', () => {
  it('starts with an empty catalog and fails closed without a usage write', async () => {
    expect(await Plan.count()).toBe(0);
    expect(await UsageLimit.count()).toBe(0);
    const { caller, target } = await pair();

    const response = await like(caller.id, target.id);

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(await Like.count({ where: { fromUserId: caller.id } })).toBe(0);
    expect(await UsageRecord.count()).toBe(0);
  });

  it('enforces seeded free LIKE, PASS, and TEXT limits', async () => {
    await ensurePlanCatalog();
    const { caller, target } = await pair();
    const passed = await buildUser();
    const thread = await activeThread();

    const liked = await like(caller.id, target.id);
    expect(liked.status).toBe(200);
    expect(liked.body.data.remainingDailyActions).toBe(9);
    expect(await usageCount(caller.id, DAILY_LIKE_PASS_METRIC)).toBe(1);

    const passedResponse = await pass(caller.id, passed.id);
    expect(passedResponse.status).toBe(200);
    expect(passedResponse.body.data.remainingDailyActions).toBe(8);
    expect(await usageCount(caller.id, DAILY_LIKE_PASS_METRIC)).toBe(2);

    const sent = await sendMessage(thread.caller.id, thread.conversation.id);
    expect(sent.status).toBe(201);
    expect(sent.body.data.remainingDailyMessages).toBe(19);
    expect(await usageCount(thread.caller.id, DAILY_TEXT_MESSAGES_METRIC)).toBe(1);

    const exhaustedCaller = await buildUser();
    const exhaustedTarget = await buildUser();
    await seedUsage(exhaustedCaller.id, DAILY_LIKE_PASS_METRIC, 10);
    const blockedLike = await like(exhaustedCaller.id, exhaustedTarget.id);
    expect(blockedLike.status).toBe(429);
    expect(blockedLike.body.error.code).toBe('DAILY_LIMIT_REACHED');
    expect(blockedLike.body.error.message).toBe(LIKE_LIMIT_MESSAGE);
    expect(await usageCount(exhaustedCaller.id, DAILY_LIKE_PASS_METRIC)).toBe(10);
    expect(await Like.count({ where: { fromUserId: exhaustedCaller.id } })).toBe(0);

    const exhaustedThread = await activeThread();
    await seedUsage(exhaustedThread.caller.id, DAILY_TEXT_MESSAGES_METRIC, 20);
    const blockedText = await sendMessage(exhaustedThread.caller.id, exhaustedThread.conversation.id);
    expect(blockedText.status).toBe(429);
    expect(blockedText.body.error.code).toBe('DAILY_LIMIT_REACHED');
    expect(blockedText.body.error.message).toBe(TEXT_LIMIT_MESSAGE);
    expect(await usageCount(exhaustedThread.caller.id, DAILY_TEXT_MESSAGES_METRIC)).toBe(20);
    expect(await Message.count({ where: { conversationId: exhaustedThread.conversation.id } })).toBe(0);
  });

  it('keeps qualifying monthly and yearly Premium limits unlimited without a usage write', async () => {
    await ensurePlanCatalog();
    const future = new Date(Date.now() + HOUR_MS);
    const monthly = await pair();
    const yearly = await pair();
    await subscribe(monthly.caller.id, 'PREMIUM_MONTHLY', 'ACTIVE', future, null);
    await subscribe(yearly.caller.id, 'PREMIUM_YEARLY', 'ACTIVE', future, null);
    await seedUsage(monthly.caller.id, DAILY_LIKE_PASS_METRIC, 10);
    await seedUsage(yearly.caller.id, DAILY_TEXT_MESSAGES_METRIC, 20);
    const yearlyThread = await activeThread();
    await subscribe(yearlyThread.caller.id, 'PREMIUM_YEARLY', 'ACTIVE', future, null);

    const monthlyLike = await like(monthly.caller.id, monthly.target.id);
    expect(monthlyLike.status).toBe(200);
    expect(monthlyLike.body.data.remainingDailyActions).toBeNull();
    expect(await usageCount(monthly.caller.id, DAILY_LIKE_PASS_METRIC)).toBe(10);

    const yearlyLike = await pass(yearly.caller.id, yearly.target.id);
    expect(yearlyLike.status).toBe(200);
    expect(yearlyLike.body.data.remainingDailyActions).toBeNull();
    expect(await usageCount(yearly.caller.id, DAILY_LIKE_PASS_METRIC)).toBe(0);

    const yearlyText = await sendMessage(yearlyThread.caller.id, yearlyThread.conversation.id);
    expect(yearlyText.status).toBe(201);
    expect(yearlyText.body.data.remainingDailyMessages).toBeNull();
    expect(await usageCount(yearlyThread.caller.id, DAILY_TEXT_MESSAGES_METRIC)).toBe(0);

    const monthlyThread = await activeThread();
    await subscribe(monthlyThread.caller.id, 'PREMIUM_MONTHLY', 'ACTIVE', future, null);
    await seedUsage(monthlyThread.caller.id, DAILY_TEXT_MESSAGES_METRIC, 20);
    const monthlyText = await sendMessage(monthlyThread.caller.id, monthlyThread.conversation.id);
    expect(monthlyText.status).toBe(201);
    expect(monthlyText.body.data.remainingDailyMessages).toBeNull();
    expect(await usageCount(monthlyThread.caller.id, DAILY_TEXT_MESSAGES_METRIC)).toBe(20);
  });

  it('keeps nonqualifying subscriptions on the free catalog limits', async () => {
    await ensurePlanCatalog();
    const future = new Date(Date.now() + HOUR_MS);
    const past = new Date(Date.now() - HOUR_MS);
    const cases: Array<{ code: string; status: SubscriptionStatus; currentPeriodEnd: Date; gracePeriodEnd: Date | null }> = [
      { code: 'FREE', status: 'ACTIVE', currentPeriodEnd: future, gracePeriodEnd: future },
      { code: 'PREMIUM_MONTHLY', status: 'CANCELED', currentPeriodEnd: future, gracePeriodEnd: future },
      { code: 'PREMIUM_YEARLY', status: 'EXPIRED', currentPeriodEnd: future, gracePeriodEnd: future },
      { code: 'PREMIUM_MONTHLY', status: 'ACTIVE', currentPeriodEnd: past, gracePeriodEnd: null }
    ];

    for (const input of cases) {
      const users = await pair();
      await subscribe(users.caller.id, input.code, input.status, input.currentPeriodEnd, input.gracePeriodEnd);
      const response = await pass(users.caller.id, users.target.id);
      expect(response.status).toBe(200);
      expect(response.body.data.remainingDailyActions).toBe(9);
      expect(await usageCount(users.caller.id, DAILY_LIKE_PASS_METRIC)).toBe(1);
    }

    const otherPlan = await Plan.create({
      code: 'OTHER_PLAN',
      name: 'Other plan',
      billingInterval: 'NONE',
      priceInCents: 100,
      currency: 'INR',
      isActive: true,
      displayOrder: 9,
      ...timestamps()
    });
    const other = await pair();
    await Subscription.create({
      userId: other.caller.id,
      planId: otherPlan.id,
      status: 'ACTIVE',
      currentPeriodStart: past,
      currentPeriodEnd: future,
      gracePeriodEnd: null,
      ...timestamps()
    });
    const otherResponse = await pass(other.caller.id, other.target.id);
    expect(otherResponse.status).toBe(200);
    expect(otherResponse.body.data.remainingDailyActions).toBe(9);
    expect(await usageCount(other.caller.id, DAILY_LIKE_PASS_METRIC)).toBe(1);
  });

  it('treats past-due, grace, and inactive Premium plans with -1 as unlimited', async () => {
    await ensurePlanCatalog();
    const future = new Date(Date.now() + HOUR_MS);
    const past = new Date(Date.now() - HOUR_MS);
    await Plan.update({ isActive: false }, { where: { code: 'PREMIUM_MONTHLY' } });

    const pastDue = await pair();
    await subscribe(pastDue.caller.id, 'PREMIUM_YEARLY', 'PAST_DUE', future, past);
    const grace = await pair();
    await subscribe(grace.caller.id, 'PREMIUM_MONTHLY', 'GRACE_PERIOD', past, future);
    const inactive = await pair();
    await subscribe(inactive.caller.id, 'PREMIUM_MONTHLY', 'ACTIVE', future, null);

    for (const users of [pastDue, grace, inactive]) {
      await seedUsage(users.caller.id, DAILY_LIKE_PASS_METRIC, 10);
      const response = await like(users.caller.id, users.target.id);
      expect(response.status).toBe(200);
      expect(response.body.data.remainingDailyActions).toBeNull();
      expect(await usageCount(users.caller.id, DAILY_LIKE_PASS_METRIC)).toBe(10);
    }
  });

  it('still enforces an inactive free plan', async () => {
    await ensurePlanCatalog();
    await Plan.update({ isActive: false }, { where: { code: 'FREE' } });
    const { caller, target } = await pair();

    const response = await pass(caller.id, target.id);

    expect(response.status).toBe(200);
    expect(response.body.data.remainingDailyActions).toBe(9);
    expect(await usageCount(caller.id, DAILY_LIKE_PASS_METRIC)).toBe(1);
  });

  it('fails closed for a missing limit, a non-daily period, a limit below -1, and free -1', async () => {
    await ensurePlanCatalog();
    const free = await planByCode('FREE');
    const missing = await pair();
    await UsageLimit.destroy({ where: { planId: free.id, metricKey: DAILY_LIKE_PASS_METRIC } });
    const missingResponse = await like(missing.caller.id, missing.target.id);
    expect(missingResponse.status).toBe(500);
    expect(missingResponse.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(await Like.count({ where: { fromUserId: missing.caller.id } })).toBe(0);
    expect(await UsageRecord.count({ where: { userId: missing.caller.id } })).toBe(0);

    await ensurePlanCatalog();
    await setLimit('FREE', DAILY_LIKE_PASS_METRIC, 10, 'MONTHLY');
    const monthly = await pair();
    const monthlyResponse = await pass(monthly.caller.id, monthly.target.id);
    expect(monthlyResponse.status).toBe(500);
    expect(monthlyResponse.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(await usageCount(monthly.caller.id, DAILY_LIKE_PASS_METRIC)).toBe(0);
    expect(await Like.count({ where: { fromUserId: monthly.caller.id } })).toBe(0);

    await setLimit('FREE', DAILY_TEXT_MESSAGES_METRIC, -2, 'DAILY');
    const negative = await activeThread();
    const negativeResponse = await sendMessage(negative.caller.id, negative.conversation.id);
    expect(negativeResponse.status).toBe(500);
    expect(negativeResponse.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(await usageCount(negative.caller.id, DAILY_TEXT_MESSAGES_METRIC)).toBe(0);
    expect(await Message.count({ where: { senderId: negative.caller.id } })).toBe(0);

    await setLimit('FREE', DAILY_LIKE_PASS_METRIC, -1, 'DAILY');
    const unlimitedFree = await pair();
    const unlimitedResponse = await like(unlimitedFree.caller.id, unlimitedFree.target.id);
    expect(unlimitedResponse.status).toBe(500);
    expect(unlimitedResponse.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(await usageCount(unlimitedFree.caller.id, DAILY_LIKE_PASS_METRIC)).toBe(0);
    expect(await Like.count({ where: { fromUserId: unlimitedFree.caller.id } })).toBe(0);
  });

  it('blocks a zero catalog limit before any usage write', async () => {
    await ensurePlanCatalog();
    await setLimit('FREE', DAILY_LIKE_PASS_METRIC, 0, 'DAILY');
    await setLimit('FREE', DAILY_TEXT_MESSAGES_METRIC, 0, 'DAILY');
    const { caller, target } = await pair();
    const thread = await activeThread();

    const passed = await pass(caller.id, target.id);
    expect(passed.status).toBe(429);
    expect(passed.body.error.code).toBe('DAILY_LIMIT_REACHED');
    expect(passed.body.error.message).toBe('You have reached your daily limit of 0 likes/passes.');
    expect(await Like.count({ where: { fromUserId: caller.id } })).toBe(0);
    expect(await usageCount(caller.id, DAILY_LIKE_PASS_METRIC)).toBe(0);

    const sent = await sendMessage(thread.caller.id, thread.conversation.id);
    expect(sent.status).toBe(429);
    expect(sent.body.error.code).toBe('DAILY_LIMIT_REACHED');
    expect(sent.body.error.message).toBe('You have reached your daily limit of 0 text messages.');
    expect(await Message.count({ where: { senderId: thread.caller.id } })).toBe(0);
    expect(await usageCount(thread.caller.id, DAILY_TEXT_MESSAGES_METRIC)).toBe(0);
  });

  it('rolls back the like and the quota write when a later write fails', async () => {
    await ensurePlanCatalog();
    const { caller, target } = await pair();
    await Like.create({
      fromUserId: target.id,
      toUserId: caller.id,
      action: 'LIKE',
      isUndone: false,
      ...timestamps()
    });
    Conversation.addHook('beforeCreate', 'force-conversation-failure', () => {
      throw new Error('forced conversation failure');
    });

    try {
      const response = await like(caller.id, target.id);
      expect(response.status).toBe(500);
    } finally {
      Conversation.removeHook('beforeCreate', 'force-conversation-failure');
    }

    expect(await Like.count({ where: { fromUserId: caller.id, toUserId: target.id } })).toBe(0);
    expect(await Match.count()).toBe(0);
    expect(await Conversation.count()).toBe(0);
    expect(await usageCount(caller.id, DAILY_LIKE_PASS_METRIC)).toBe(0);
  });

  it('allows only one of two concurrent free passes once nine catalog actions are used', async () => {
    await ensurePlanCatalog();
    const caller = await buildUser();
    const firstTarget = await buildUser();
    const secondTarget = await buildUser();
    await seedUsage(caller.id, DAILY_LIKE_PASS_METRIC, 9);

    const [first, second] = await Promise.all([pass(caller.id, firstTarget.id), pass(caller.id, secondTarget.id)]);
    const statuses = [first.status, second.status].sort((left, right) => left - right);

    expect(statuses).toEqual([200, 429]);
    const success = [first, second].find((response) => response.status === 200);
    const failure = [first, second].find((response) => response.status === 429);
    expect(success?.body.data.remainingDailyActions).toBe(0);
    expect(failure?.body.error.code).toBe('DAILY_LIMIT_REACHED');
    expect(failure?.body.error.message).toBe(LIKE_LIMIT_MESSAGE);
    expect(await usageCount(caller.id, DAILY_LIKE_PASS_METRIC)).toBe(10);
    expect(await Like.count({ where: { fromUserId: caller.id, action: 'PASS', isUndone: false } })).toBe(1);
  });

  it('allows only one of two concurrent free text sends once nineteen catalog messages are used', async () => {
    await ensurePlanCatalog();
    const thread = await activeThread();
    await seedUsage(thread.caller.id, DAILY_TEXT_MESSAGES_METRIC, 19);

    const [first, second] = await Promise.all([
      sendMessage(thread.caller.id, thread.conversation.id),
      sendMessage(thread.caller.id, thread.conversation.id)
    ]);
    const statuses = [first.status, second.status].sort((left, right) => left - right);

    expect(statuses).toEqual([201, 429]);
    const success = [first, second].find((response) => response.status === 201);
    const failure = [first, second].find((response) => response.status === 429);
    expect(success?.body.data.remainingDailyMessages).toBe(0);
    expect(failure?.body.error.code).toBe('DAILY_LIMIT_REACHED');
    expect(failure?.body.error.message).toBe(TEXT_LIMIT_MESSAGE);
    expect(await usageCount(thread.caller.id, DAILY_TEXT_MESSAGES_METRIC)).toBe(20);
    expect(await Message.count({ where: { senderId: thread.caller.id } })).toBe(1);
  });
});
