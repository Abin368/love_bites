import { randomUUID } from 'crypto';
import request from 'supertest';
import { literal, QueryTypes } from 'sequelize';
import { sequelize } from '../../src/config/database';
import { Block } from '../../src/database/models/block.model';
import { Conversation } from '../../src/database/models/conversation.model';
import { DatingPreference } from '../../src/database/models/dating-preference.model';
import { Gender } from '../../src/database/models/gender.model';
import { Like } from '../../src/database/models/like.model';
import { RelationshipIntention } from '../../src/database/models/relationship-intention.model';
import { UserDatingPreferenceGender } from '../../src/database/models/user-dating-preference-gender.model';
import { UserDatingPreferenceIntention } from '../../src/database/models/user-dating-preference-intention.model';
import { UserRelationshipIntention } from '../../src/database/models/user-relationship-intention.model';
import { Match } from '../../src/database/models/match.model';
import { Plan } from '../../src/database/models/plan.model';
import { Profile } from '../../src/database/models/profile.model';
import { ProfilePhoto } from '../../src/database/models/profile-photo.model';
import { Subscription } from '../../src/database/models/subscription.model';
import { UsageRecord } from '../../src/database/models/usage-record.model';
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
  return Gender.create({ code: `pass-${randomUUID()}`, name: 'Woman', isActive: true });
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
    email: input.phoneOnly ? null : `pass-${randomUUID()}@example.com`,
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

async function pair(options?: {
  targetComplete?: boolean;
  targetPrimaryPhoto?: boolean;
  targetStatus?: UserStatus;
  targetPoint?: Point | null;
}) {
  const catalogGender = await gender();
  const caller = await buildUser({ genderId: catalogGender.id, point: ORIGIN });
  const target = await buildUser({
    genderId: catalogGender.id,
    point: options?.targetPoint === undefined ? north(2) : options.targetPoint,
    complete: options?.targetComplete,
    primaryPhoto: options?.targetPrimaryPhoto,
    status: options?.targetStatus
  });
  return { caller, target };
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

async function insertMatch(leftUserId: string, rightUserId: string): Promise<void> {
  await sequelize.query(
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
     )`,
    { replacements: { leftUserId, rightUserId } }
  );
}

describe('POST /api/v1/discovery/:userId/pass', () => {
  it('rejects a missing token, an admin, and a suspended caller', async () => {
    const catalogGender = await gender();
    const target = await buildUser({ genderId: catalogGender.id });

    const missing = await request(app).post(`/api/v1/discovery/${target.id}/pass`);
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
    const forbidden = await request(app).post(`/api/v1/discovery/${target.id}/pass`).set(authHeader(admin.id, 'ADMIN'));
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
    const suspendedResponse = await request(app)
      .post(`/api/v1/discovery/${target.id}/pass`)
      .set(authHeader(suspended.id));
    expect(suspendedResponse.status).toBe(403);
    expect(suspendedResponse.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('rejects an unverified email caller and an unverified phone caller', async () => {
    const catalogGender = await gender();
    const target = await buildUser({ genderId: catalogGender.id });
    const emailCaller = await buildUser({ genderId: catalogGender.id, emailVerified: false });
    const emailResponse = await pass(emailCaller.id, target.id);
    expect(emailResponse.status).toBe(403);
    expect(emailResponse.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    const phoneCaller = await buildUser({ genderId: catalogGender.id, phoneOnly: true, emailVerified: false });
    const phoneResponse = await pass(phoneCaller.id, target.id);
    expect(phoneResponse.status).toBe(403);
    expect(phoneResponse.body.error.code).toBe('PHONE_NOT_VERIFIED');
  });

  it('rejects an incomplete caller profile, missing preferences, and a missing location', async () => {
    const catalogGender = await gender();
    const target = await buildUser({ genderId: catalogGender.id });

    const incomplete = await buildUser({ genderId: catalogGender.id, complete: false });
    const incompleteResponse = await pass(incomplete.id, target.id);
    expect(incompleteResponse.status).toBe(400);
    expect(incompleteResponse.body.error.code).toBe('PROFILE_INCOMPLETE');

    const missingPreferences = await buildUser({ genderId: catalogGender.id, preferences: false });
    const preferencesResponse = await pass(missingPreferences.id, target.id);
    expect(preferencesResponse.status).toBe(400);
    expect(preferencesResponse.body.error.code).toBe('PROFILE_INCOMPLETE');

    const missingLocation = await buildUser({ genderId: catalogGender.id, point: null });
    const locationResponse = await pass(missingLocation.id, target.id);
    expect(locationResponse.status).toBe(400);
    expect(locationResponse.body.error.code).toBe('PROFILE_INCOMPLETE');
  });

  it('rejects an invalid user id and a self pass without writing a like or a usage row', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });

    const invalid = await pass(caller.id, 'not-a-uuid');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

    const self = await pass(caller.id, caller.id);
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('SELF_INTERACTION');
    expect(await Like.count()).toBe(0);
    expect(await UsageRecord.count()).toBe(0);
  });

  it('rejects a missing, deleted, inactive, incomplete, or photo-less target', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });

    const missing = await pass(caller.id, randomUUID());
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('USER_NOT_FOUND');

    const deleted = await buildUser({ genderId: catalogGender.id });
    await deleted.destroy();
    const deletedResponse = await pass(caller.id, deleted.id);
    expect(deletedResponse.status).toBe(404);
    expect(deletedResponse.body.error.code).toBe('USER_NOT_FOUND');

    const inactive = await buildUser({ genderId: catalogGender.id, status: 'SUSPENDED' });
    const inactiveResponse = await pass(caller.id, inactive.id);
    expect(inactiveResponse.status).toBe(404);
    expect(inactiveResponse.body.error.code).toBe('INVALID_TARGET');

    const incomplete = await buildUser({ genderId: catalogGender.id, complete: false });
    const incompleteResponse = await pass(caller.id, incomplete.id);
    expect(incompleteResponse.status).toBe(404);
    expect(incompleteResponse.body.error.code).toBe('INVALID_TARGET');

    const withoutPhoto = await buildUser({ genderId: catalogGender.id, primaryPhoto: false });
    const photoResponse = await pass(caller.id, withoutPhoto.id);
    expect(photoResponse.status).toBe(404);
    expect(photoResponse.body.error.code).toBe('INVALID_TARGET');
    expect(await usageCount(caller.id)).toBe(0);
  });

  it('rejects a block in either direction', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    const blockedByCaller = await buildUser({ genderId: catalogGender.id });
    const blockedCaller = await buildUser({ genderId: catalogGender.id });
    await Block.create({ blockerId: caller.id, blockedId: blockedByCaller.id, createdAt: new Date() });
    await Block.create({ blockerId: blockedCaller.id, blockedId: caller.id, createdAt: new Date() });

    const outgoing = await pass(caller.id, blockedByCaller.id);
    expect(outgoing.status).toBe(409);
    expect(outgoing.body.error.code).toBe('BLOCKED_USER');

    const incoming = await pass(caller.id, blockedCaller.id);
    expect(incoming.status).toBe(409);
    expect(incoming.body.error.code).toBe('BLOCKED_USER');
    expect(await usageCount(caller.id)).toBe(0);
  });

  it('rejects an active like, pass, super like, or match and keeps an undone row', async () => {
    const { caller, target } = await pair();
    await Like.create({ fromUserId: caller.id, toUserId: target.id, action: 'LIKE', isUndone: false, ...timestamps() });
    const likeResponse = await pass(caller.id, target.id);
    expect(likeResponse.status).toBe(409);
    expect(likeResponse.body.error.code).toBe('ALREADY_SWIPED');
    await Like.destroy({ where: { fromUserId: caller.id, toUserId: target.id } });

    await Like.create({ fromUserId: caller.id, toUserId: target.id, action: 'PASS', isUndone: false, ...timestamps() });
    const passResponse = await pass(caller.id, target.id);
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
    const superResponse = await pass(caller.id, target.id);
    expect(superResponse.status).toBe(409);
    expect(superResponse.body.error.code).toBe('ALREADY_SWIPED');
    await Like.destroy({ where: { fromUserId: caller.id, toUserId: target.id } });

    await insertMatch(caller.id, target.id);
    const matchResponse = await pass(caller.id, target.id);
    expect(matchResponse.status).toBe(409);
    expect(matchResponse.body.error.code).toBe('ACTIVE_MATCH_EXISTS');
    await Match.destroy({ where: {} });

    const undone = await Like.create({
      fromUserId: caller.id,
      toUserId: target.id,
      action: 'LIKE',
      isUndone: true,
      ...timestamps()
    });
    const allowed = await pass(caller.id, target.id);
    expect(allowed.status).toBe(200);
    await undone.reload();
    expect(undone.isUndone).toBe(true);
    expect(undone.action).toBe('LIKE');
    const active = await Like.findOne({
      where: { fromUserId: caller.id, toUserId: target.id, action: 'PASS', isUndone: false }
    });
    expect(active).not.toBeNull();
    expect(await usageCount(caller.id)).toBe(1);
  });

  it('records a pass, hides the target in discovery, and ignores the target incoming pass', async () => {
    const { caller, target } = await eligibleDiscoveryPair();
    await Like.create({
      fromUserId: target.id,
      toUserId: caller.id,
      action: 'PASS',
      isUndone: false,
      ...timestamps()
    });

    const before = await request(app).get('/api/v1/discovery').set(authHeader(caller.id));
    expect(before.status).toBe(200);
    expect(before.body.data.candidate.id).toBe(target.id);

    const response = await pass(caller.id, target.id);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        action: 'PASS',
        targetUserId: target.id,
        remainingDailyActions: 9
      },
      message: 'Profile passed.'
    });

    const created = await Like.findOne({
      where: { fromUserId: caller.id, toUserId: target.id, action: 'PASS', isUndone: false }
    });
    expect(created).not.toBeNull();
    expect(await Match.count()).toBe(0);
    expect(await Conversation.count()).toBe(0);

    const discovery = await request(app).get('/api/v1/discovery').set(authHeader(caller.id));
    expect(discovery.status).toBe(200);
    expect(discovery.body.data.candidate).toBeNull();
  });

  it('counts the first free pass, allows the 10th, and rejects the 11th without inserting', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    const firstTarget = await buildUser({ genderId: catalogGender.id });
    const tenthTarget = await buildUser({ genderId: catalogGender.id });
    const eleventhTarget = await buildUser({ genderId: catalogGender.id });

    const first = await pass(caller.id, firstTarget.id);
    expect(first.status).toBe(200);
    expect(first.body.data.remainingDailyActions).toBe(9);
    expect(await usageCount(caller.id)).toBe(1);

    await UsageRecord.update(
      { usageCount: 9 },
      { where: { userId: caller.id, metricKey: DAILY_LIKE_PASS_METRIC } }
    );
    const tenth = await pass(caller.id, tenthTarget.id);
    expect(tenth.status).toBe(200);
    expect(tenth.body.data.remainingDailyActions).toBe(0);
    expect(await usageCount(caller.id)).toBe(10);

    const before = await Like.count({ where: { toUserId: eleventhTarget.id } });
    const eleventh = await pass(caller.id, eleventhTarget.id);
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
      userId: caller.id,
      planId: plan.id,
      status: 'ACTIVE',
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      ...timestamps()
    });
    await seedUsage(caller.id, 10);

    const response = await pass(caller.id, target.id);
    expect(response.status).toBe(200);
    expect(response.body.data.remainingDailyActions).toBeNull();
    expect(await usageCount(caller.id)).toBe(10);
    expect(await Like.count({ where: { fromUserId: caller.id, toUserId: target.id, action: 'PASS' } })).toBe(1);
  });

  it('allows only one of two concurrent free passes once nine actions are already used', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    const firstTarget = await buildUser({ genderId: catalogGender.id });
    const secondTarget = await buildUser({ genderId: catalogGender.id });
    await seedUsage(caller.id, 9);

    const [first, second] = await Promise.all([pass(caller.id, firstTarget.id), pass(caller.id, secondTarget.id)]);
    const statuses = [first.status, second.status].sort((left, right) => left - right);
    expect(statuses).toEqual([200, 429]);
    expect(await usageCount(caller.id)).toBe(10);
    expect(await Like.count({ where: { fromUserId: caller.id, action: 'PASS', isUndone: false } })).toBe(1);

    const rows = await sequelize.query<{ usageCount: number }>(
      `SELECT usage_count AS "usageCount"
       FROM usage_records
       WHERE user_id = CAST(:userId AS uuid) AND metric_key = :metricKey`,
      { replacements: { userId: caller.id, metricKey: DAILY_LIKE_PASS_METRIC }, type: QueryTypes.SELECT }
    );
    expect(Number(rows[0].usageCount)).toBe(10);
  });
});
