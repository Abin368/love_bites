import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import request from 'supertest';
import { literal, QueryTypes } from 'sequelize';
import { sequelize } from '../../src/config/database';
import { env } from '../../src/config/env';
import { redis } from '../../src/config/redis';
import { Block } from '../../src/database/models/block.model';
import { Conversation } from '../../src/database/models/conversation.model';
import { CreditTransaction } from '../../src/database/models/credit-transaction.model';
import { DatingPreference } from '../../src/database/models/dating-preference.model';
import { Gender } from '../../src/database/models/gender.model';
import { Like } from '../../src/database/models/like.model';
import { Match } from '../../src/database/models/match.model';
import { Notification } from '../../src/database/models/notification.model';
import { Plan } from '../../src/database/models/plan.model';
import { Profile } from '../../src/database/models/profile.model';
import { ProfilePhoto } from '../../src/database/models/profile-photo.model';
import { Subscription } from '../../src/database/models/subscription.model';
import { UsageRecord } from '../../src/database/models/usage-record.model';
import { UserCreditBalance } from '../../src/database/models/user-credit-balance.model';
import { User, UserStatus } from '../../src/database/models/user.model';
import { currentUtcDayWindow, DAILY_LIKE_PASS_METRIC } from '../../src/modules/likes/likes.data-access';
import { signAccessToken } from '../../src/utils/jwt';

const mockPhotoStorage = {
  createUploadUrl: jest.fn(),
  createDownloadUrl: jest.fn(async () => ({
    url: 'https://download.test/signed',
    expiresInSeconds: 3600
  }))
};

jest.mock('../../src/integrations/storage/s3.provider', () => ({
  photoStorage: mockPhotoStorage
}));

import { app } from '../../src/app';

const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';
const ORIGIN = { latitude: 12.9716, longitude: 77.5946 };

interface Point {
  latitude: number;
  longitude: number;
}

function north(kilometres: number): Point {
  return {
    latitude: ORIGIN.latitude + kilometres / 111.32,
    longitude: ORIGIN.longitude
  };
}

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

async function setLocation(userId: string, point: Point, city = 'Bengaluru'): Promise<void> {
  await Profile.update(
    {
      city,
      location: literal(`ST_GeogFromText('SRID=4326;POINT(${point.longitude} ${point.latitude})')`)
    },
    { where: { userId } }
  );
}

async function gender(): Promise<Gender> {
  return Gender.create({ code: `super-${randomUUID()}`, name: 'Woman', isActive: true });
}

async function buildUser(input: {
  genderId: string;
  complete?: boolean;
  primaryPhoto?: boolean;
  status?: UserStatus;
  emailVerified?: boolean;
  phoneOnly?: boolean;
  point?: Point | null;
  preferences?: boolean;
  role?: 'USER' | 'ADMIN';
}): Promise<User> {
  const emailVerified = input.emailVerified ?? true;
  const user = await User.create({
    email: input.phoneOnly ? null : `super-${randomUUID()}@example.com`,
    phone: input.phoneOnly ? `+${randomUUID().replace(/-/g, '').slice(0, 15)}` : null,
    passwordHash: PASSWORD_HASH,
    role: input.role ?? 'USER',
    status: input.status ?? 'ACTIVE',
    emailVerified: input.phoneOnly ? false : emailVerified,
    phoneVerified: input.phoneOnly ? emailVerified : false
  });
  await Profile.create({
    userId: user.id,
    firstName: 'Jordan',
    dateOfBirth: '1998-04-12',
    genderId: input.genderId,
    bio: 'Coffee and long walks.',
    occupation: 'Designer',
    education: 'NID',
    isProfileComplete: input.complete ?? true
  });

  const point = input.point === undefined ? ORIGIN : input.point;
  if (point) {
    await setLocation(user.id, point);
  }

  if (input.preferences !== false) {
    await DatingPreference.create({
      userId: user.id,
      minAge: 18,
      maxAge: 100,
      maxDistanceKm: 50,
      ...timestamps()
    });
  }

  if (input.primaryPhoto !== false) {
    await ProfilePhoto.create({
      userId: user.id,
      storageKey: `photos/${user.id}/${randomUUID()}.webp`,
      mimeType: 'image/jpeg',
      fileSizeBytes: 2048,
      displayOrder: 1,
      isPrimary: true,
      ...timestamps()
    });
  }

  return user;
}

async function pair() {
  const catalogGender = await gender();
  const caller = await buildUser({ genderId: catalogGender.id, point: ORIGIN });
  const target = await buildUser({ genderId: catalogGender.id, point: north(2) });
  return { caller, target, genderId: catalogGender.id };
}

function superLike(callerId: string, targetUserId: string) {
  return request(app).post(`/api/v1/discovery/${targetUserId}/super-like`).set(authHeader(callerId));
}

async function usageCount(userId: string): Promise<number> {
  const { periodStart } = currentUtcDayWindow();
  const row = await UsageRecord.findOne({
    where: { userId, metricKey: DAILY_LIKE_PASS_METRIC, periodStart }
  });
  return row?.usageCount ?? 0;
}

async function seedUsage(userId: string, count: number): Promise<void> {
  const window = currentUtcDayWindow();
  await UsageRecord.create({
    userId,
    metricKey: DAILY_LIKE_PASS_METRIC,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    usageCount: count,
    ...timestamps()
  });
}

async function grantPremium(userIds: string | string[]): Promise<void> {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  const plan = await Plan.create({
    code: 'PREMIUM_MONTHLY',
    name: 'Love Bite Premium (Monthly)',
    billingInterval: 'MONTH',
    priceInCents: 49900,
    currency: 'INR',
    isActive: true,
    displayOrder: 1,
    ...timestamps()
  });
  const now = new Date();
  for (const userId of ids) {
    await Subscription.create({
      userId,
      planId: plan.id,
      status: 'ACTIVE',
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      ...timestamps()
    });
  }
}

async function seedCredits(userId: string, balance: number, creditType = 'SUPER_LIKE'): Promise<void> {
  await UserCreditBalance.create({
    userId,
    creditType,
    balance,
    ...timestamps()
  });
}

async function superLikeBalance(userId: string): Promise<number | null> {
  const row = await UserCreditBalance.findOne({ where: { userId, creditType: 'SUPER_LIKE' } });
  return row?.balance ?? null;
}

async function insertMatch(leftUserId: string, rightUserId: string, status: 'ACTIVE' | 'UNMATCHED' | 'UNDONE'): Promise<Match> {
  const rows = await sequelize.query<{ id: string }>(
    `INSERT INTO matches (
       id, user_one_id, user_two_id, status, matched_at, unmatched_at, unmatched_by_user_id, created_at, updated_at
     )
     VALUES (
       gen_random_uuid(),
       LEAST(CAST(:leftUserId AS uuid), CAST(:rightUserId AS uuid)),
       GREATEST(CAST(:leftUserId AS uuid), CAST(:rightUserId AS uuid)),
       :status,
       CURRENT_TIMESTAMP,
       CASE WHEN :status = 'UNMATCHED' THEN CURRENT_TIMESTAMP ELSE NULL END,
       CASE WHEN :status = 'UNMATCHED' THEN CAST(:leftUserId AS uuid) ELSE NULL END,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
     )
     RETURNING id`,
    {
      replacements: { leftUserId, rightUserId, status },
      type: QueryTypes.SELECT
    }
  );
  const match = await Match.findByPk(rows[0].id);
  if (!match) {
    throw new Error('Historical match was not inserted.');
  }
  return match;
}

async function redisIsReachable(): Promise<boolean> {
  const probe = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 1000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null
  });
  try {
    await probe.connect();
    return (await probe.ping()) === 'PONG';
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

describe('POST /api/v1/discovery/:userId/super-like', () => {
  it('rejects a missing token, an admin, and a suspended caller without a super like or credit change', async () => {
    const catalogGender = await gender();
    const target = await buildUser({ genderId: catalogGender.id });
    await seedCredits(target.id, 2);

    const missing = await request(app).post(`/api/v1/discovery/${target.id}/super-like`);
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('AUTH_REQUIRED');

    const admin = await User.create({
      email: `admin-${randomUUID()}@example.com`,
      passwordHash: PASSWORD_HASH,
      role: 'ADMIN',
      status: 'ACTIVE',
      emailVerified: true,
      phoneVerified: false
    });
    const forbidden = await superLike(admin.id, target.id);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');

    const suspended = await User.create({
      email: `suspended-${randomUUID()}@example.com`,
      passwordHash: PASSWORD_HASH,
      role: 'USER',
      status: 'SUSPENDED',
      emailVerified: true,
      phoneVerified: false
    });
    const suspendedResponse = await superLike(suspended.id, target.id);
    expect(suspendedResponse.status).toBe(403);
    expect(suspendedResponse.body.error.code).toBe('ACCOUNT_SUSPENDED');
    expect(await Like.count()).toBe(0);
    expect(await CreditTransaction.count()).toBe(0);
    expect(await superLikeBalance(target.id)).toBe(2);
  });

  it('records a super like, spends one credit, and leaves boost balance and daily usage unchanged', async () => {
    const { caller, target } = await pair();
    await grantPremium(caller.id);
    await seedCredits(caller.id, 5);
    await seedCredits(caller.id, 5, 'BOOST');
    await seedUsage(caller.id, 4);

    const response = await superLike(caller.id, target.id.toUpperCase());
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        action: 'SUPER_LIKE',
        targetUserId: target.id,
        isMatch: false,
        matchId: null,
        remainingSuperLikeCredits: 4
      },
      message: 'Profile super liked.'
    });
    expect(response.body.data).not.toHaveProperty('remainingDailyActions');
    expect(response.body.data).not.toHaveProperty('conversationId');

    const like = await Like.findOne({ where: { fromUserId: caller.id, toUserId: target.id } });
    expect(like?.action).toBe('SUPER_LIKE');
    expect(like?.isUndone).toBe(false);
    expect(await superLikeBalance(caller.id)).toBe(4);
    expect(await superLikeBalance(caller.id)).toBe(response.body.data.remainingSuperLikeCredits);

    const boost = await UserCreditBalance.findOne({ where: { userId: caller.id, creditType: 'BOOST' } });
    expect(boost?.balance).toBe(5);

    const ledger = await CreditTransaction.findAll({ where: { userId: caller.id } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].creditType).toBe('SUPER_LIKE');
    expect(ledger[0].delta).toBe(-1);
    expect(ledger[0].reason).toBe('CONSUMPTION');
    expect(ledger[0].referenceId).toBe(like?.id);
    expect(await usageCount(caller.id)).toBe(4);
    expect(await UsageRecord.count({ where: { userId: caller.id, metricKey: DAILY_LIKE_PASS_METRIC } })).toBe(1);
    expect(await Match.count()).toBe(0);
    expect(await Conversation.count()).toBe(0);
    expect(await Notification.count()).toBe(0);
  });

  it('rejects a non-premium caller and does not spend an existing super like balance', async () => {
    const catalogGender = await gender();
    const withoutCredits = await buildUser({ genderId: catalogGender.id });
    const withCredits = await buildUser({ genderId: catalogGender.id });
    const firstTarget = await buildUser({ genderId: catalogGender.id });
    const secondTarget = await buildUser({ genderId: catalogGender.id });
    await seedCredits(withCredits.id, 4);

    const missingBalance = await superLike(withoutCredits.id, firstTarget.id);
    expect(missingBalance.status).toBe(403);
    expect(missingBalance.body.error.code).toBe('PREMIUM_REQUIRED');
    expect(missingBalance.body.error.message).toBe('Feature requires an active Premium subscription.');
    expect(await superLikeBalance(withoutCredits.id)).toBeNull();

    const funded = await superLike(withCredits.id, secondTarget.id);
    expect(funded.status).toBe(403);
    expect(funded.body.error.code).toBe('PREMIUM_REQUIRED');
    expect(await superLikeBalance(withCredits.id)).toBe(4);
    expect(await Like.count()).toBe(0);
    expect(await CreditTransaction.count()).toBe(0);
  });

  it('rejects a premium caller with a zero balance or no balance row', async () => {
    const catalogGender = await gender();
    const zeroCaller = await buildUser({ genderId: catalogGender.id });
    const missingCaller = await buildUser({ genderId: catalogGender.id });
    const zeroTarget = await buildUser({ genderId: catalogGender.id });
    const missingTarget = await buildUser({ genderId: catalogGender.id });
    await grantPremium([zeroCaller.id, missingCaller.id]);
    await seedCredits(zeroCaller.id, 0);

    const zero = await superLike(zeroCaller.id, zeroTarget.id);
    expect(zero.status).toBe(409);
    expect(zero.body.error.code).toBe('INSUFFICIENT_SUPER_LIKE_CREDITS');
    expect(zero.body.error.message).toBe('You do not have any Super Like credits.');
    expect(await superLikeBalance(zeroCaller.id)).toBe(0);

    const missing = await superLike(missingCaller.id, missingTarget.id);
    expect(missing.status).toBe(409);
    expect(missing.body.error.code).toBe('INSUFFICIENT_SUPER_LIKE_CREDITS');
    expect(await superLikeBalance(missingCaller.id)).toBeNull();
    expect(await Like.count()).toBe(0);
    expect(await CreditTransaction.count()).toBe(0);
  });

  it('rejects an active like, pass, or super like without spending a credit', async () => {
    const { caller, target } = await pair();
    await grantPremium(caller.id);
    await seedCredits(caller.id, 3);

    await Like.create({ fromUserId: caller.id, toUserId: target.id, action: 'LIKE', isUndone: false, ...timestamps() });
    const likeResponse = await superLike(caller.id, target.id);
    expect(likeResponse.status).toBe(409);
    expect(likeResponse.body.error.code).toBe('ALREADY_SWIPED');
    expect(likeResponse.body.error.message).toBe('Target user has already been liked or permanently passed.');
    await Like.destroy({ where: { fromUserId: caller.id, toUserId: target.id } });

    await Like.create({ fromUserId: caller.id, toUserId: target.id, action: 'PASS', isUndone: false, ...timestamps() });
    const passResponse = await superLike(caller.id, target.id);
    expect(passResponse.status).toBe(409);
    expect(passResponse.body.error.code).toBe('ALREADY_SWIPED');
    await Like.destroy({ where: { fromUserId: caller.id, toUserId: target.id } });

    await Like.create({
      fromUserId: caller.id,
      toUserId: target.id,
      action: 'SUPER_LIKE',
      isUndone: false,
      ...timestamps()
    });
    const superResponse = await superLike(caller.id, target.id);
    expect(superResponse.status).toBe(409);
    expect(superResponse.body.error.code).toBe('ALREADY_SWIPED');

    expect(await superLikeBalance(caller.id)).toBe(3);
    expect(await CreditTransaction.count()).toBe(0);
    expect(await Like.count({ where: { fromUserId: caller.id, toUserId: target.id, action: 'SUPER_LIKE', isUndone: false } })).toBe(1);
  });

  it('allows a super like after an undone like or an undone pass', async () => {
    const { caller, target, genderId } = await pair();
    const other = await buildUser({ genderId, point: north(3) });
    await grantPremium(caller.id);
    await seedCredits(caller.id, 3);

    const undoneLike = await Like.create({
      fromUserId: caller.id,
      toUserId: target.id,
      action: 'LIKE',
      isUndone: true,
      ...timestamps()
    });
    const afterLike = await superLike(caller.id, target.id);
    expect(afterLike.status).toBe(200);
    expect(afterLike.body.data.action).toBe('SUPER_LIKE');
    expect(afterLike.body.data.remainingSuperLikeCredits).toBe(2);
    await undoneLike.reload();
    expect(undoneLike.isUndone).toBe(true);
    expect(undoneLike.action).toBe('LIKE');
    expect(
      await Like.count({ where: { fromUserId: caller.id, toUserId: target.id, action: 'SUPER_LIKE', isUndone: false } })
    ).toBe(1);

    const undonePass = await Like.create({
      fromUserId: caller.id,
      toUserId: other.id,
      action: 'PASS',
      isUndone: true,
      ...timestamps()
    });
    const afterPass = await superLike(caller.id, other.id);
    expect(afterPass.status).toBe(200);
    expect(afterPass.body.data.remainingSuperLikeCredits).toBe(1);
    await undonePass.reload();
    expect(undonePass.isUndone).toBe(true);
    expect(undonePass.action).toBe('PASS');
    expect(await superLikeBalance(caller.id)).toBe(1);
    expect(await CreditTransaction.count({ where: { userId: caller.id, reason: 'CONSUMPTION' } })).toBe(2);
  });

  it('creates one canonical active match and conversation for a reciprocal like', async () => {
    const { caller, target } = await pair();
    await grantPremium(caller.id);
    await seedCredits(caller.id, 2);
    await Like.create({ fromUserId: target.id, toUserId: caller.id, action: 'LIKE', isUndone: false, ...timestamps() });

    const response = await superLike(caller.id, target.id);
    expect(response.status).toBe(200);
    expect(response.body.message).toBe("It's a Match!");
    expect(response.body.data.isMatch).toBe(true);
    expect(response.body.data.action).toBe('SUPER_LIKE');
    expect(response.body.data.remainingSuperLikeCredits).toBe(1);
    expect(response.body.data).not.toHaveProperty('remainingDailyActions');

    const callerLike = await Like.findOne({ where: { fromUserId: caller.id, toUserId: target.id } });
    expect(callerLike?.action).toBe('SUPER_LIKE');
    expect(callerLike?.isUndone).toBe(false);

    const matches = await Match.findAll();
    expect(matches).toHaveLength(1);
    const match = matches[0];
    expect(match.status).toBe('ACTIVE');
    expect(match.id).toBe(response.body.data.matchId);
    expect(match.userOneId < match.userTwoId).toBe(true);
    expect([match.userOneId, match.userTwoId].sort()).toEqual([caller.id, target.id].sort());

    const conversations = await Conversation.findAll();
    expect(conversations).toHaveLength(1);
    expect(conversations[0].matchId).toBe(match.id);
    expect(conversations[0].status).toBe('ACTIVE');
    expect(await superLikeBalance(caller.id)).toBe(1);
    expect(await CreditTransaction.count({ where: { userId: caller.id, referenceId: callerLike?.id } })).toBe(1);
    expect(await Notification.count()).toBe(0);
  });

  it('matches a reciprocal super like and spends one credit for each successful caller', async () => {
    const { caller, target } = await pair();
    await grantPremium([caller.id, target.id]);
    await seedCredits(caller.id, 3);
    await seedCredits(target.id, 3);

    const first = await superLike(caller.id, target.id);
    expect(first.status).toBe(200);
    expect(first.body.data.isMatch).toBe(false);
    expect(first.body.data.matchId).toBeNull();
    expect(first.body.message).toBe('Profile super liked.');
    expect(await superLikeBalance(caller.id)).toBe(2);
    expect(await superLikeBalance(target.id)).toBe(3);

    const second = await superLike(target.id, caller.id);
    expect(second.status).toBe(200);
    expect(second.body.data.isMatch).toBe(true);
    expect(second.body.message).toBe("It's a Match!");
    expect(second.body.data.action).toBe('SUPER_LIKE');
    expect(await superLikeBalance(target.id)).toBe(2);

    const likes = await Like.findAll({ where: { isUndone: false, action: 'SUPER_LIKE' } });
    expect(likes).toHaveLength(2);
    const matches = await Match.findAll({ where: { status: 'ACTIVE' } });
    expect(matches).toHaveLength(1);
    expect(second.body.data.matchId).toBe(matches[0].id);
    expect(await Conversation.count({ where: { matchId: matches[0].id, status: 'ACTIVE' } })).toBe(1);
    expect(await CreditTransaction.count({ where: { reason: 'CONSUMPTION', delta: -1 } })).toBe(2);
    expect(await Notification.count()).toBe(0);
  });

  it('allows a super like when the target has passed the caller and does not create a match', async () => {
    const { caller, target } = await pair();
    await grantPremium(caller.id);
    await seedCredits(caller.id, 2);
    await Like.create({
      fromUserId: target.id,
      toUserId: caller.id,
      action: 'PASS',
      isUndone: false,
      ...timestamps()
    });

    const response = await superLike(caller.id, target.id);
    expect(response.status).toBe(200);
    expect(response.body.data.isMatch).toBe(false);
    expect(response.body.data.matchId).toBeNull();
    expect(response.body.message).toBe('Profile super liked.');
    expect(await Like.count({ where: { fromUserId: caller.id, toUserId: target.id, action: 'SUPER_LIKE', isUndone: false } })).toBe(1);
    expect(await Match.count()).toBe(0);
    expect(await Conversation.count()).toBe(0);
    expect(await superLikeBalance(caller.id)).toBe(1);
  });

  it('rejects a block in either direction without spending a credit', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    const blockedByCaller = await buildUser({ genderId: catalogGender.id });
    const blockedCaller = await buildUser({ genderId: catalogGender.id });
    await grantPremium(caller.id);
    await seedCredits(caller.id, 2);
    await Block.create({ blockerId: caller.id, blockedId: blockedByCaller.id, createdAt: new Date() });
    await Block.create({ blockerId: blockedCaller.id, blockedId: caller.id, createdAt: new Date() });

    const outgoing = await superLike(caller.id, blockedByCaller.id);
    expect(outgoing.status).toBe(409);
    expect(outgoing.body.error.code).toBe('BLOCKED_USER');

    const incoming = await superLike(caller.id, blockedCaller.id);
    expect(incoming.status).toBe(409);
    expect(incoming.body.error.code).toBe('BLOCKED_USER');
    expect(await Like.count({ where: { fromUserId: caller.id } })).toBe(0);
    expect(await superLikeBalance(caller.id)).toBe(2);
    expect(await CreditTransaction.count()).toBe(0);
  });

  it('rejects an incomplete caller profile, missing preferences, and a missing location', async () => {
    const catalogGender = await gender();
    const target = await buildUser({ genderId: catalogGender.id });

    const incomplete = await buildUser({ genderId: catalogGender.id, complete: false });
    await grantPremium(incomplete.id);
    await seedCredits(incomplete.id, 2);
    const incompleteResponse = await superLike(incomplete.id, target.id);
    expect(incompleteResponse.status).toBe(400);
    expect(incompleteResponse.body.error.code).toBe('PROFILE_INCOMPLETE');

    const missingPreferences = await buildUser({ genderId: catalogGender.id, preferences: false });
    const preferencesResponse = await superLike(missingPreferences.id, target.id);
    expect(preferencesResponse.status).toBe(400);
    expect(preferencesResponse.body.error.code).toBe('PROFILE_INCOMPLETE');

    const missingLocation = await buildUser({ genderId: catalogGender.id, point: null });
    const locationResponse = await superLike(missingLocation.id, target.id);
    expect(locationResponse.status).toBe(400);
    expect(locationResponse.body.error.code).toBe('PROFILE_INCOMPLETE');
    expect(await Like.count()).toBe(0);
    expect(await superLikeBalance(incomplete.id)).toBe(2);
    expect(await CreditTransaction.count()).toBe(0);
  });

  it('rejects an unverified email caller and an unverified phone caller', async () => {
    const catalogGender = await gender();
    const target = await buildUser({ genderId: catalogGender.id });
    const emailCaller = await buildUser({ genderId: catalogGender.id, emailVerified: false });
    const emailResponse = await superLike(emailCaller.id, target.id);
    expect(emailResponse.status).toBe(403);
    expect(emailResponse.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    const phoneCaller = await buildUser({ genderId: catalogGender.id, phoneOnly: true, emailVerified: false });
    const phoneResponse = await superLike(phoneCaller.id, target.id);
    expect(phoneResponse.status).toBe(403);
    expect(phoneResponse.body.error.code).toBe('PHONE_NOT_VERIFIED');
    expect(await Like.count()).toBe(0);
    expect(await CreditTransaction.count()).toBe(0);
  });

  it('rejects an invalid user id, a self super like, and an invalid idempotency key', async () => {
    const { caller } = await pair();
    await grantPremium(caller.id);
    await seedCredits(caller.id, 2);

    const invalid = await superLike(caller.id, 'not-a-uuid');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

    const self = await superLike(caller.id, caller.id);
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('SELF_INTERACTION');
    expect(self.body.error.message).toBe('You cannot super like your own profile.');

    const badKey = await superLike(caller.id, randomUUID()).set('Idempotency-Key', 'not-a-uuid');
    expect(badKey.status).toBe(400);
    expect(badKey.body.error.code).toBe('VALIDATION_ERROR');
    expect(await Like.count()).toBe(0);
    expect(await superLikeBalance(caller.id)).toBe(2);
    expect(await CreditTransaction.count()).toBe(0);
  });

  it('rejects a missing, deleted, inactive, incomplete, or photo-less target', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    await grantPremium(caller.id);
    await seedCredits(caller.id, 2);

    const missing = await superLike(caller.id, randomUUID());
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('USER_NOT_FOUND');

    const deleted = await buildUser({ genderId: catalogGender.id });
    await deleted.destroy();
    const deletedResponse = await superLike(caller.id, deleted.id);
    expect(deletedResponse.status).toBe(404);
    expect(deletedResponse.body.error.code).toBe('USER_NOT_FOUND');

    const inactive = await buildUser({ genderId: catalogGender.id, status: 'SUSPENDED' });
    const inactiveResponse = await superLike(caller.id, inactive.id);
    expect(inactiveResponse.status).toBe(404);
    expect(inactiveResponse.body.error.code).toBe('INVALID_TARGET');
    expect(inactiveResponse.body.error.message).toBe('This profile cannot be super liked.');

    const incomplete = await buildUser({ genderId: catalogGender.id, complete: false });
    const incompleteResponse = await superLike(caller.id, incomplete.id);
    expect(incompleteResponse.status).toBe(404);
    expect(incompleteResponse.body.error.code).toBe('INVALID_TARGET');

    const withoutPhoto = await buildUser({ genderId: catalogGender.id, primaryPhoto: false });
    const photoResponse = await superLike(caller.id, withoutPhoto.id);
    expect(photoResponse.status).toBe(404);
    expect(photoResponse.body.error.code).toBe('INVALID_TARGET');
    expect(await Like.count({ where: { fromUserId: caller.id } })).toBe(0);
    expect(await superLikeBalance(caller.id)).toBe(2);
    expect(await CreditTransaction.count()).toBe(0);
  });

  it('rejects an existing active match without a super like, ledger row, or credit change', async () => {
    const { caller, target } = await pair();
    await grantPremium(caller.id);
    await seedCredits(caller.id, 2);
    const existing = await insertMatch(caller.id, target.id, 'ACTIVE');

    const response = await superLike(caller.id, target.id);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ACTIVE_MATCH_EXISTS');
    expect(response.body.error.message).toBe('Users are already in an active mutual match.');
    expect(await Like.count({ where: { fromUserId: caller.id } })).toBe(0);
    expect(await Match.count()).toBe(1);
    expect((await Match.findByPk(existing.id))?.status).toBe('ACTIVE');
    expect(await Conversation.count()).toBe(0);
    expect(await superLikeBalance(caller.id)).toBe(2);
    expect(await CreditTransaction.count()).toBe(0);
  });

  it('allows only one of two simultaneous super likes from the same caller to the same target', async () => {
    const { caller, target } = await pair();
    await grantPremium(caller.id);
    await seedCredits(caller.id, 2);

    const [first, second] = await Promise.all([superLike(caller.id, target.id), superLike(caller.id, target.id)]);
    const statuses = [first.status, second.status].sort((left, right) => left - right);
    expect(statuses).toEqual([200, 409]);
    const rejected = [first, second].find((response) => response.status === 409);
    expect(rejected?.body.error.code).toBe('ALREADY_SWIPED');
    expect(await Like.count({ where: { fromUserId: caller.id, toUserId: target.id, action: 'SUPER_LIKE', isUndone: false } })).toBe(1);
    expect(await superLikeBalance(caller.id)).toBe(1);
    expect(await CreditTransaction.count({ where: { userId: caller.id, delta: -1 } })).toBe(1);
    expect(await Match.count()).toBe(0);
    expect(await Notification.count()).toBe(0);
  });

  it('creates one match when both users super like each other at the same time', async () => {
    const { caller, target } = await pair();
    await grantPremium([caller.id, target.id]);
    await seedCredits(caller.id, 1);
    await seedCredits(target.id, 1);

    const [first, second] = await Promise.all([superLike(caller.id, target.id), superLike(target.id, caller.id)]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const flags = [first.body.data.isMatch, second.body.data.isMatch].sort();
    expect(flags).toEqual([false, true]);
    const matched = [first, second].find((response) => response.body.data.isMatch === true);
    expect(matched?.body.message).toBe("It's a Match!");
    expect(matched?.body.data.matchId).toEqual(expect.any(String));

    expect(await Like.count({ where: { isUndone: false, action: 'SUPER_LIKE' } })).toBe(2);
    expect(await Match.count({ where: { status: 'ACTIVE' } })).toBe(1);
    expect(await Conversation.count({ where: { status: 'ACTIVE' } })).toBe(1);
    const match = await Match.findOne({ where: { status: 'ACTIVE' } });
    expect(match?.id).toBe(matched?.body.data.matchId);
    expect(await Conversation.count({ where: { matchId: match?.id } })).toBe(1);
    expect(await superLikeBalance(caller.id)).toBe(0);
    expect(await superLikeBalance(target.id)).toBe(0);
    expect(await CreditTransaction.count({ where: { userId: caller.id, delta: -1 } })).toBe(1);
    expect(await CreditTransaction.count({ where: { userId: target.id, delta: -1 } })).toBe(1);
    expect(await Notification.count()).toBe(0);
  });

  it('spends one credit per successful super like when two different targets are requested together', async () => {
    const { caller, target, genderId } = await pair();
    const other = await buildUser({ genderId, point: north(4) });
    await grantPremium(caller.id);
    await seedCredits(caller.id, 2);

    const [first, second] = await Promise.all([superLike(caller.id, target.id), superLike(caller.id, other.id)]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect([first.body.data.remainingSuperLikeCredits, second.body.data.remainingSuperLikeCredits].sort()).toEqual([0, 1]);
    expect(await superLikeBalance(caller.id)).toBe(0);
    expect(await Like.count({ where: { fromUserId: caller.id, action: 'SUPER_LIKE', isUndone: false } })).toBe(2);
    expect(await CreditTransaction.count({ where: { userId: caller.id, delta: -1 } })).toBe(2);
    expect(await Match.count()).toBe(0);
  });

  it('rejects the second of two different targets when only one super like credit remains', async () => {
    const { caller, target, genderId } = await pair();
    const other = await buildUser({ genderId, point: north(4) });
    await grantPremium(caller.id);
    await seedCredits(caller.id, 1);

    const [first, second] = await Promise.all([superLike(caller.id, target.id), superLike(caller.id, other.id)]);
    const statuses = [first.status, second.status].sort((left, right) => left - right);
    expect(statuses).toEqual([200, 409]);
    const rejected = [first, second].find((response) => response.status === 409);
    expect(rejected?.body.error.code).toBe('INSUFFICIENT_SUPER_LIKE_CREDITS');
    expect(await superLikeBalance(caller.id)).toBe(0);
    expect(await Like.count({ where: { fromUserId: caller.id, action: 'SUPER_LIKE', isUndone: false } })).toBe(1);
    expect(await CreditTransaction.count({ where: { userId: caller.id, delta: -1 } })).toBe(1);
    expect(await Match.count()).toBe(0);
  });

  it('rolls back the super like, match, conversation, credit, and ledger when conversation creation fails', async () => {
    const { caller, target } = await pair();
    await grantPremium(caller.id);
    await seedCredits(caller.id, 5);
    await Like.create({ fromUserId: target.id, toUserId: caller.id, action: 'LIKE', isUndone: false, ...timestamps() });
    Conversation.addHook('beforeCreate', 'force-super-like-conversation-failure', () => {
      throw new Error('forced conversation failure');
    });

    try {
      const response = await superLike(caller.id, target.id);
      expect(response.status).toBe(500);
    } finally {
      Conversation.removeHook('beforeCreate', 'force-super-like-conversation-failure');
    }

    expect(await Like.count({ where: { fromUserId: caller.id, toUserId: target.id } })).toBe(0);
    expect(await Match.count()).toBe(0);
    expect(await Conversation.count()).toBe(0);
    expect(await superLikeBalance(caller.id)).toBe(5);
    expect(await CreditTransaction.count()).toBe(0);
    const reciprocal = await Like.findOne({ where: { fromUserId: target.id, toUserId: caller.id } });
    expect(reciprocal?.action).toBe('LIKE');
    expect(reciprocal?.isUndone).toBe(false);
    expect(await Notification.count()).toBe(0);
  });

  it('does not call Redis when no idempotency key is sent', async () => {
    const { caller, target } = await pair();
    await grantPremium(caller.id);
    await seedCredits(caller.id, 2);
    const getSpy = jest.spyOn(redis, 'get');
    const setSpy = jest.spyOn(redis, 'set');
    const delSpy = jest.spyOn(redis, 'del');

    try {
      const response = await superLike(caller.id, target.id);
      expect(response.status).toBe(200);
      expect(response.body.data.remainingSuperLikeCredits).toBe(1);
      expect(getSpy).not.toHaveBeenCalled();
      expect(setSpy).not.toHaveBeenCalled();
      expect(delSpy).not.toHaveBeenCalled();
    } finally {
      getSpy.mockRestore();
      setSpy.mockRestore();
      delSpy.mockRestore();
    }

    expect(await superLikeBalance(caller.id)).toBe(1);
    expect(await CreditTransaction.count()).toBe(1);
  });

  it('replays a stored idempotent success and rejects an in-flight key', async () => {
    if (!(await redisIsReachable())) {
      console.warn(
        'Redis is not reachable, so SUPER LIKE idempotency replay and in-flight assertions were not executed.'
      );
      return;
    }

    const { caller, target, genderId } = await pair();
    const other = await buildUser({ genderId, point: north(4) });
    await grantPremium(caller.id);
    await seedCredits(caller.id, 3);
    const key = randomUUID();

    const first = await superLike(caller.id, target.id).set('Idempotency-Key', key);
    expect(first.status).toBe(200);
    const replay = await superLike(caller.id, other.id).set('Idempotency-Key', key);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(await Like.count({ where: { fromUserId: caller.id, action: 'SUPER_LIKE', isUndone: false } })).toBe(1);
    expect(await superLikeBalance(caller.id)).toBe(2);
    expect(await CreditTransaction.count({ where: { userId: caller.id } })).toBe(1);
    expect(await Match.count()).toBe(0);

    const pendingKey = randomUUID();
    await redis.set(`idempotency:${caller.id}:super-like:${pendingKey}`, 'pending', 'EX', 120);
    const conflict = await superLike(caller.id, other.id).set('Idempotency-Key', pendingKey);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await Like.count({ where: { fromUserId: caller.id, toUserId: other.id } })).toBe(0);
    expect(await superLikeBalance(caller.id)).toBe(2);
    expect(await CreditTransaction.count({ where: { userId: caller.id } })).toBe(1);
  });
});
