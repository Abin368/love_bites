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
import { RelationshipIntention } from '../../src/database/models/relationship-intention.model';
import { Subscription } from '../../src/database/models/subscription.model';
import { UsageRecord } from '../../src/database/models/usage-record.model';
import { UserCreditBalance } from '../../src/database/models/user-credit-balance.model';
import { UserDatingPreferenceGender } from '../../src/database/models/user-dating-preference-gender.model';
import { UserDatingPreferenceIntention } from '../../src/database/models/user-dating-preference-intention.model';
import { UserRelationshipIntention } from '../../src/database/models/user-relationship-intention.model';
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
  return Gender.create({ code: `like-${randomUUID()}`, name: 'Woman', isActive: true });
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
    email: input.phoneOnly ? null : `like-${randomUUID()}@example.com`,
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

async function eligibleDiscoveryPair() {
  const suffix = randomUUID();
  const man = await Gender.create({ code: `man-${suffix}`, name: 'Man', isActive: true });
  const woman = await Gender.create({ code: `woman-${suffix}`, name: 'Woman', isActive: true });
  const intention = await RelationshipIntention.create({
    code: `lt-${suffix}`,
    name: 'Long-term relationship',
    isActive: true,
    displayOrder: 1,
    ...timestamps()
  });
  const caller = await buildUser({ genderId: man.id, point: ORIGIN });
  const target = await buildUser({ genderId: woman.id, point: north(2) });
  await UserDatingPreferenceGender.bulkCreate([
    { userId: caller.id, genderId: woman.id, createdAt: new Date() },
    { userId: target.id, genderId: man.id, createdAt: new Date() }
  ]);
  await UserDatingPreferenceIntention.bulkCreate([
    { userId: caller.id, relationshipIntentionId: intention.id, createdAt: new Date() },
    { userId: target.id, relationshipIntentionId: intention.id, createdAt: new Date() }
  ]);
  await UserRelationshipIntention.bulkCreate([
    { userId: caller.id, relationshipIntentionId: intention.id, createdAt: new Date() },
    { userId: target.id, relationshipIntentionId: intention.id, createdAt: new Date() }
  ]);
  return { caller, target };
}

async function pair() {
  const catalogGender = await gender();
  const caller = await buildUser({ genderId: catalogGender.id, point: ORIGIN });
  const target = await buildUser({ genderId: catalogGender.id, point: north(2) });
  return { caller, target };
}

function like(callerId: string, targetUserId: string) {
  return request(app).post(`/api/v1/discovery/${targetUserId}/like`).set(authHeader(callerId));
}

function pass(callerId: string, targetUserId: string) {
  return request(app).post(`/api/v1/discovery/${targetUserId}/pass`).set(authHeader(callerId));
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

async function grantPremium(userId: string): Promise<void> {
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
  await Subscription.create({
    userId,
    planId: plan.id,
    status: 'ACTIVE',
    currentPeriodStart: now,
    currentPeriodEnd: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    ...timestamps()
  });
}

describe('POST /api/v1/discovery/:userId/like', () => {
  it('rejects a missing token, an admin, and a suspended caller without a like or usage row', async () => {
    const catalogGender = await gender();
    const target = await buildUser({ genderId: catalogGender.id });

    const missing = await request(app).post(`/api/v1/discovery/${target.id}/like`);
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
    const forbidden = await like(admin.id, target.id);
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
    const suspendedResponse = await like(suspended.id, target.id);
    expect(suspendedResponse.status).toBe(403);
    expect(suspendedResponse.body.error.code).toBe('ACCOUNT_SUSPENDED');
    expect(await Like.count()).toBe(0);
    expect(await UsageRecord.count()).toBe(0);
  });

  it('rejects an unverified email caller and an unverified phone caller', async () => {
    const catalogGender = await gender();
    const target = await buildUser({ genderId: catalogGender.id });
    const emailCaller = await buildUser({ genderId: catalogGender.id, emailVerified: false });
    const emailResponse = await like(emailCaller.id, target.id);
    expect(emailResponse.status).toBe(403);
    expect(emailResponse.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    const phoneCaller = await buildUser({ genderId: catalogGender.id, phoneOnly: true, emailVerified: false });
    const phoneResponse = await like(phoneCaller.id, target.id);
    expect(phoneResponse.status).toBe(403);
    expect(phoneResponse.body.error.code).toBe('PHONE_NOT_VERIFIED');
    expect(await Like.count()).toBe(0);
    expect(await UsageRecord.count()).toBe(0);
  });

  it('rejects an incomplete caller profile, missing preferences, and a missing location', async () => {
    const catalogGender = await gender();
    const target = await buildUser({ genderId: catalogGender.id });

    const incomplete = await buildUser({ genderId: catalogGender.id, complete: false });
    const incompleteResponse = await like(incomplete.id, target.id);
    expect(incompleteResponse.status).toBe(400);
    expect(incompleteResponse.body.error.code).toBe('PROFILE_INCOMPLETE');

    const missingPreferences = await buildUser({ genderId: catalogGender.id, preferences: false });
    const preferencesResponse = await like(missingPreferences.id, target.id);
    expect(preferencesResponse.status).toBe(400);
    expect(preferencesResponse.body.error.code).toBe('PROFILE_INCOMPLETE');

    const missingLocation = await buildUser({ genderId: catalogGender.id, point: null });
    const locationResponse = await like(missingLocation.id, target.id);
    expect(locationResponse.status).toBe(400);
    expect(locationResponse.body.error.code).toBe('PROFILE_INCOMPLETE');
    expect(await Like.count()).toBe(0);
    expect(await UsageRecord.count()).toBe(0);
  });

  it('rejects an invalid user id, a self like, and an invalid idempotency key', async () => {
    const { caller } = await pair();

    const invalid = await like(caller.id, 'not-a-uuid');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

    const self = await like(caller.id, caller.id);
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('SELF_INTERACTION');
    expect(self.body.error.message).toBe('You cannot like your own profile.');

    const badKey = await like(caller.id, randomUUID()).set('Idempotency-Key', 'not-a-uuid');
    expect(badKey.status).toBe(400);
    expect(badKey.body.error.code).toBe('VALIDATION_ERROR');
    expect(await Like.count()).toBe(0);
    expect(await UsageRecord.count()).toBe(0);
  });

  it('rejects a missing, deleted, inactive, incomplete, or photo-less target', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });

    const missing = await like(caller.id, randomUUID());
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('USER_NOT_FOUND');

    const deleted = await buildUser({ genderId: catalogGender.id });
    await deleted.destroy();
    const deletedResponse = await like(caller.id, deleted.id);
    expect(deletedResponse.status).toBe(404);
    expect(deletedResponse.body.error.code).toBe('USER_NOT_FOUND');

    const inactive = await buildUser({ genderId: catalogGender.id, status: 'SUSPENDED' });
    const inactiveResponse = await like(caller.id, inactive.id);
    expect(inactiveResponse.status).toBe(404);
    expect(inactiveResponse.body.error.code).toBe('INVALID_TARGET');
    expect(inactiveResponse.body.error.message).toBe('This profile cannot be liked.');

    const incomplete = await buildUser({ genderId: catalogGender.id, complete: false });
    const incompleteResponse = await like(caller.id, incomplete.id);
    expect(incompleteResponse.status).toBe(404);
    expect(incompleteResponse.body.error.code).toBe('INVALID_TARGET');

    const withoutPhoto = await buildUser({ genderId: catalogGender.id, primaryPhoto: false });
    const photoResponse = await like(caller.id, withoutPhoto.id);
    expect(photoResponse.status).toBe(404);
    expect(photoResponse.body.error.code).toBe('INVALID_TARGET');
    expect(await Like.count({ where: { fromUserId: caller.id } })).toBe(0);
    expect(await usageCount(caller.id)).toBe(0);
  });

  it('rejects a block in either direction', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    const blockedByCaller = await buildUser({ genderId: catalogGender.id });
    const blockedCaller = await buildUser({ genderId: catalogGender.id });
    await Block.create({ blockerId: caller.id, blockedId: blockedByCaller.id, createdAt: new Date() });
    await Block.create({ blockerId: blockedCaller.id, blockedId: caller.id, createdAt: new Date() });

    const outgoing = await like(caller.id, blockedByCaller.id);
    expect(outgoing.status).toBe(409);
    expect(outgoing.body.error.code).toBe('BLOCKED_USER');

    const incoming = await like(caller.id, blockedCaller.id);
    expect(incoming.status).toBe(409);
    expect(incoming.body.error.code).toBe('BLOCKED_USER');
    expect(await Like.count({ where: { fromUserId: caller.id } })).toBe(0);
    expect(await usageCount(caller.id)).toBe(0);
  });

  it('rejects an active like, pass, or super like and keeps an undone row', async () => {
    const { caller, target } = await pair();
    await Like.create({ fromUserId: caller.id, toUserId: target.id, action: 'LIKE', isUndone: false, ...timestamps() });
    const likeResponse = await like(caller.id, target.id);
    expect(likeResponse.status).toBe(409);
    expect(likeResponse.body.error.code).toBe('ALREADY_SWIPED');
    await Like.destroy({ where: { fromUserId: caller.id, toUserId: target.id } });

    await Like.create({ fromUserId: caller.id, toUserId: target.id, action: 'PASS', isUndone: false, ...timestamps() });
    const passResponse = await like(caller.id, target.id);
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
    const superResponse = await like(caller.id, target.id);
    expect(superResponse.status).toBe(409);
    expect(superResponse.body.error.code).toBe('ALREADY_SWIPED');
    await Like.destroy({ where: { fromUserId: caller.id, toUserId: target.id } });

    const undone = await Like.create({
      fromUserId: caller.id,
      toUserId: target.id,
      action: 'PASS',
      isUndone: true,
      ...timestamps()
    });
    const allowed = await like(caller.id, target.id);
    expect(allowed.status).toBe(200);
    await undone.reload();
    expect(undone.isUndone).toBe(true);
    expect(undone.action).toBe('PASS');
    const active = await Like.findOne({
      where: { fromUserId: caller.id, toUserId: target.id, action: 'LIKE', isUndone: false }
    });
    expect(active).not.toBeNull();
    expect(await usageCount(caller.id)).toBe(1);
  });

  it('allows a like when the target has passed the caller and does not create a match', async () => {
    const { caller, target } = await pair();
    await Like.create({
      fromUserId: target.id,
      toUserId: caller.id,
      action: 'PASS',
      isUndone: false,
      ...timestamps()
    });

    const response = await like(caller.id, target.id);
    expect(response.status).toBe(200);
    expect(response.body.data.isMatch).toBe(false);
    expect(response.body.data.matchId).toBeNull();
    expect(await Like.count({ where: { fromUserId: caller.id, toUserId: target.id, action: 'LIKE', isUndone: false } })).toBe(1);
    expect(await Match.count()).toBe(0);
    expect(await Conversation.count()).toBe(0);
  });

  it('counts the first free like, shares the pass quota, allows the 10th, and rejects the 11th', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    const firstTarget = await buildUser({ genderId: catalogGender.id });
    const passedTarget = await buildUser({ genderId: catalogGender.id });
    const tenthTarget = await buildUser({ genderId: catalogGender.id });
    const eleventhTarget = await buildUser({ genderId: catalogGender.id });

    const first = await like(caller.id, firstTarget.id);
    expect(first.status).toBe(200);
    expect(first.body.data.remainingDailyActions).toBe(9);
    expect(await usageCount(caller.id)).toBe(1);

    const passed = await pass(caller.id, passedTarget.id);
    expect(passed.status).toBe(200);
    expect(await usageCount(caller.id)).toBe(2);
    expect(
      await UsageRecord.count({ where: { userId: caller.id, metricKey: DAILY_LIKE_PASS_METRIC } })
    ).toBe(1);

    await UsageRecord.update(
      { usageCount: 9 },
      { where: { userId: caller.id, metricKey: DAILY_LIKE_PASS_METRIC } }
    );
    const tenth = await like(caller.id, tenthTarget.id);
    expect(tenth.status).toBe(200);
    expect(tenth.body.data.remainingDailyActions).toBe(0);
    expect(await usageCount(caller.id)).toBe(10);

    const before = await Like.count({ where: { toUserId: eleventhTarget.id } });
    const eleventh = await like(caller.id, eleventhTarget.id);
    expect(eleventh.status).toBe(429);
    expect(eleventh.body.error.code).toBe('DAILY_LIMIT_REACHED');
    expect(eleventh.body.error.message).toBe('You have reached your daily limit of 10 likes/passes.');
    expect(await Like.count({ where: { toUserId: eleventhTarget.id } })).toBe(before);
    expect(await usageCount(caller.id)).toBe(10);
  });

  it('does not limit a premium caller and leaves remainingDailyActions null', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    const target = await buildUser({ genderId: catalogGender.id });
    await grantPremium(caller.id);
    await seedUsage(caller.id, 10);

    const response = await like(caller.id, target.id);
    expect(response.status).toBe(200);
    expect(response.body.data.remainingDailyActions).toBeNull();
    expect(await usageCount(caller.id)).toBe(10);
    expect(await Like.count({ where: { fromUserId: caller.id, toUserId: target.id, action: 'LIKE' } })).toBe(1);
  });

  it('rolls back the like, match, conversation, and quota when conversation creation fails', async () => {
    const { caller, target } = await pair();
    await Like.create({ fromUserId: target.id, toUserId: caller.id, action: 'LIKE', isUndone: false, ...timestamps() });
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
    expect(await usageCount(caller.id)).toBe(0);
    const reciprocal = await Like.findOne({ where: { fromUserId: target.id, toUserId: caller.id } });
    expect(reciprocal?.action).toBe('LIKE');
    expect(reciprocal?.isUndone).toBe(false);
  });

  it('records a like without a match and does not call Redis when no idempotency key is sent', async () => {
    const { caller, target } = await pair();
    const getSpy = jest.spyOn(redis, 'get');
    const setSpy = jest.spyOn(redis, 'set');
    const delSpy = jest.spyOn(redis, 'del');

    try {
      const response = await like(caller.id, target.id.toUpperCase());
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        data: {
          action: 'LIKE',
          targetUserId: target.id,
          isMatch: false,
          matchId: null,
          remainingDailyActions: 9
        },
        message: 'Profile liked.'
      });
      expect(getSpy).not.toHaveBeenCalled();
      expect(setSpy).not.toHaveBeenCalled();
      expect(delSpy).not.toHaveBeenCalled();
    } finally {
      getSpy.mockRestore();
      setSpy.mockRestore();
      delSpy.mockRestore();
    }

    expect(await Like.count({ where: { fromUserId: caller.id, toUserId: target.id, action: 'LIKE', isUndone: false } })).toBe(1);
    expect(await Match.count()).toBe(0);
    expect(await Conversation.count()).toBe(0);
    expect(await Notification.count()).toBe(0);
  });

  it('creates one canonical active match and conversation for a reciprocal like', async () => {
    const { caller, target } = await pair();
    await Like.create({ fromUserId: target.id, toUserId: caller.id, action: 'LIKE', isUndone: false, ...timestamps() });

    const response = await like(caller.id, target.id);
    expect(response.status).toBe(200);
    expect(response.body.message).toBe("It's a Match!");
    expect(response.body.data.isMatch).toBe(true);
    expect(response.body.data.action).toBe('LIKE');

    const likes = await Like.findAll({ where: { isUndone: false } });
    expect(likes).toHaveLength(2);
    expect(likes.map((row) => row.action).sort()).toEqual(['LIKE', 'LIKE']);

    const matches = await Match.findAll();
    expect(matches).toHaveLength(1);
    const match = matches[0];
    expect(match.status).toBe('ACTIVE');
    expect(match.id).toBe(response.body.data.matchId);
    expect(match.userOneId < match.userTwoId).toBe(true);
    expect([match.userOneId, match.userTwoId].sort()).toEqual([caller.id, target.id].sort());
    expect(match.unmatchedAt).toBeNull();
    expect(match.unmatchedByUserId).toBeNull();

    const conversations = await Conversation.findAll();
    expect(conversations).toHaveLength(1);
    expect(conversations[0].matchId).toBe(match.id);
    expect(conversations[0].status).toBe('ACTIVE');
    expect(conversations[0].lastMessageAt).toBeNull();
    expect(conversations[0].closedAt).toBeNull();
    expect(await Notification.count()).toBe(0);
  });

  it('matches a reciprocal super like without consuming super like credits', async () => {
    const { caller, target } = await pair();
    await Like.create({
      fromUserId: target.id,
      toUserId: caller.id,
      action: 'SUPER_LIKE',
      isUndone: false,
      ...timestamps()
    });
    await UserCreditBalance.create({
      userId: caller.id,
      creditType: 'SUPER_LIKE',
      balance: 3,
      ...timestamps()
    });

    const response = await like(caller.id, target.id);
    expect(response.status).toBe(200);
    expect(response.body.data.isMatch).toBe(true);
    expect(response.body.message).toBe("It's a Match!");

    const callerLike = await Like.findOne({ where: { fromUserId: caller.id, toUserId: target.id } });
    expect(callerLike?.action).toBe('LIKE');
    const reciprocal = await Like.findOne({ where: { fromUserId: target.id, toUserId: caller.id } });
    expect(reciprocal?.action).toBe('SUPER_LIKE');
    expect(reciprocal?.isUndone).toBe(false);
    expect(await Match.count({ where: { status: 'ACTIVE' } })).toBe(1);
    expect(await Conversation.count({ where: { status: 'ACTIVE' } })).toBe(1);
    const balance = await UserCreditBalance.findOne({ where: { userId: caller.id, creditType: 'SUPER_LIKE' } });
    expect(balance?.balance).toBe(3);
    expect(await CreditTransaction.count()).toBe(0);
  });

  it('creates a new active match after an unmatched or undone history and leaves the old row unchanged', async () => {
    const { caller, target } = await pair();
    const unmatched = await insertMatch(caller.id, target.id, 'UNMATCHED');
    await Like.create({ fromUserId: target.id, toUserId: caller.id, action: 'LIKE', isUndone: false, ...timestamps() });

    const afterUnmatch = await like(caller.id, target.id);
    expect(afterUnmatch.status).toBe(200);
    expect(afterUnmatch.body.data.isMatch).toBe(true);
    await unmatched.reload();
    expect(unmatched.status).toBe('UNMATCHED');
    expect(unmatched.unmatchedByUserId).toBe(caller.id);
    const activeAfterUnmatch = await Match.findAll({ where: { status: 'ACTIVE' } });
    expect(activeAfterUnmatch).toHaveLength(1);
    expect(activeAfterUnmatch[0].id).not.toBe(unmatched.id);
    const conversation = await Conversation.findOne({ where: { matchId: activeAfterUnmatch[0].id } });
    expect(conversation?.status).toBe('ACTIVE');
    expect(await Conversation.count({ where: { matchId: unmatched.id } })).toBe(0);

    await Match.destroy({ where: { id: activeAfterUnmatch[0].id } });
    await Like.destroy({ where: { fromUserId: caller.id, toUserId: target.id } });

    const undone = await insertMatch(caller.id, target.id, 'UNDONE');
    const afterUndo = await like(caller.id, target.id);
    expect(afterUndo.status).toBe(200);
    expect(afterUndo.body.data.isMatch).toBe(true);
    await undone.reload();
    expect(undone.status).toBe('UNDONE');
    const activeAfterUndo = await Match.findAll({ where: { status: 'ACTIVE' } });
    expect(activeAfterUndo).toHaveLength(1);
    expect(activeAfterUndo[0].id).not.toBe(undone.id);
    expect(await Conversation.count({ where: { matchId: activeAfterUndo[0].id, status: 'ACTIVE' } })).toBe(1);
  });

  it('rejects an existing active match without a new like, match, conversation, or quota increment', async () => {
    const { caller, target } = await pair();
    const existing = await insertMatch(caller.id, target.id, 'ACTIVE');

    const response = await like(caller.id, target.id);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ACTIVE_MATCH_EXISTS');
    expect(await Like.count({ where: { fromUserId: caller.id } })).toBe(0);
    expect(await Match.count()).toBe(1);
    expect((await Match.findByPk(existing.id))?.status).toBe('ACTIVE');
    expect(await Conversation.count()).toBe(0);
    expect(await usageCount(caller.id)).toBe(0);
  });

  it('hides a liked target from discovery until that like is undone', async () => {
    const { caller, target } = await eligibleDiscoveryPair();
    const before = await request(app).get('/api/v1/discovery').set(authHeader(caller.id));
    expect(before.status).toBe(200);
    expect(before.body.data.candidate.id).toBe(target.id);

    const response = await like(caller.id, target.id);
    expect(response.status).toBe(200);

    const hidden = await request(app).get('/api/v1/discovery').set(authHeader(caller.id));
    expect(hidden.status).toBe(200);
    expect(hidden.body.data.candidate).toBeNull();

    await Like.update({ isUndone: true }, { where: { fromUserId: caller.id, toUserId: target.id } });
    const restored = await request(app).get('/api/v1/discovery').set(authHeader(caller.id));
    expect(restored.status).toBe(200);
    expect(restored.body.data.candidate.id).toBe(target.id);
  });

  it('creates one match when both users like each other at the same time', async () => {
    const { caller, target } = await pair();
    const [first, second] = await Promise.all([like(caller.id, target.id), like(target.id, caller.id)]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const flags = [first.body.data.isMatch, second.body.data.isMatch].sort();
    expect(flags).toEqual([false, true]);
    const matched = [first, second].find((response) => response.body.data.isMatch === true);
    const unmatched = [first, second].find((response) => response.body.data.isMatch === false);
    expect(matched?.body.message).toBe("It's a Match!");
    expect(unmatched?.body.data.matchId).toBeNull();
    expect(unmatched?.body.message).toBe('Profile liked.');
    expect(matched?.body.data.matchId).toEqual(expect.any(String));

    expect(await Like.count({ where: { isUndone: false, action: 'LIKE' } })).toBe(2);
    expect(await Match.count({ where: { status: 'ACTIVE' } })).toBe(1);
    expect(await Conversation.count({ where: { status: 'ACTIVE' } })).toBe(1);
    const match = await Match.findOne({ where: { status: 'ACTIVE' } });
    expect(match?.id).toBe(matched?.body.data.matchId);
    expect(await Conversation.count({ where: { matchId: match?.id } })).toBe(1);
    expect(await usageCount(caller.id)).toBe(1);
    expect(await usageCount(target.id)).toBe(1);
  });

  it('allows only one of two simultaneous likes from the same caller to the same target', async () => {
    const { caller, target } = await pair();
    const [first, second] = await Promise.all([like(caller.id, target.id), like(caller.id, target.id)]);
    const statuses = [first.status, second.status].sort((left, right) => left - right);
    expect(statuses).toEqual([200, 409]);
    const rejected = [first, second].find((response) => response.status === 409);
    expect(rejected?.body.error.code).toBe('ALREADY_SWIPED');
    expect(await Like.count({ where: { fromUserId: caller.id, toUserId: target.id, action: 'LIKE', isUndone: false } })).toBe(1);
    expect(await usageCount(caller.id)).toBe(1);
    expect(await Match.count()).toBe(0);
  });

  it('replays a stored idempotent success and rejects an in-flight key', async () => {
    if (!(await redisIsReachable())) {
      console.warn(
        'Redis is not reachable, so LIKE idempotency replay and in-flight assertions were not executed.'
      );
      return;
    }

    const { caller, target } = await pair();
    const other = await buildUser({ genderId: (await gender()).id });
    const key = randomUUID();

    const first = await like(caller.id, target.id).set('Idempotency-Key', key);
    expect(first.status).toBe(200);
    const replay = await like(caller.id, other.id).set('Idempotency-Key', key);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(await Like.count({ where: { fromUserId: caller.id, action: 'LIKE', isUndone: false } })).toBe(1);
    expect(await usageCount(caller.id)).toBe(1);
    expect(await Match.count()).toBe(0);
    expect(await Conversation.count()).toBe(0);

    const pendingKey = randomUUID();
    await redis.set(`idempotency:${caller.id}:${pendingKey}`, 'pending', 'EX', 120);
    const conflict = await like(caller.id, other.id).set('Idempotency-Key', pendingKey);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await Like.count({ where: { fromUserId: caller.id, toUserId: other.id } })).toBe(0);
    expect(await usageCount(caller.id)).toBe(1);
  });
});
