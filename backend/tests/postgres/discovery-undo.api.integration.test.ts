import { randomUUID } from 'crypto';
import request from 'supertest';
import { literal, QueryTypes } from 'sequelize';
import { sequelize } from '../../src/config/database';
import { Conversation } from '../../src/database/models/conversation.model';
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
  return Gender.create({ code: `undo-${randomUUID()}`, name: 'Woman', isActive: true });
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
}): Promise<User> {
  const emailVerified = input.emailVerified ?? true;
  const user = await User.create({
    email: input.phoneOnly ? null : `undo-${randomUUID()}@example.com`,
    phone: input.phoneOnly ? `+${randomUUID().replace(/-/g, '').slice(0, 15)}` : null,
    passwordHash: PASSWORD_HASH,
    role: 'USER',
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

function undo(callerId: string) {
  return request(app).post('/api/v1/discovery/undo').set(authHeader(callerId));
}

function like(callerId: string, targetUserId: string) {
  return request(app).post(`/api/v1/discovery/${targetUserId}/like`).set(authHeader(callerId));
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

async function ageLike(likeId: string, interval: string): Promise<void> {
  await sequelize.query(
    `UPDATE likes
     SET created_at = CURRENT_TIMESTAMP - CAST(:interval AS interval)
     WHERE id = :likeId`,
    { replacements: { likeId, interval } }
  );
}

async function insertMatch(
  leftUserId: string,
  rightUserId: string,
  status: 'ACTIVE' | 'UNMATCHED' | 'UNDONE'
): Promise<Match> {
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

describe('POST /api/v1/discovery/undo', () => {
  it('rejects a missing token and an admin', async () => {
    const missing = await request(app).post('/api/v1/discovery/undo');
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
    const forbidden = await undo(admin.id);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
    expect(await Like.count()).toBe(0);
  });

  it('rejects an unverified email caller and an unverified phone caller', async () => {
    const catalogGender = await gender();
    const emailCaller = await buildUser({ genderId: catalogGender.id, emailVerified: false });
    const emailResponse = await undo(emailCaller.id);
    expect(emailResponse.status).toBe(403);
    expect(emailResponse.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    const phoneCaller = await buildUser({ genderId: catalogGender.id, phoneOnly: true, emailVerified: false });
    const phoneResponse = await undo(phoneCaller.id);
    expect(phoneResponse.status).toBe(403);
    expect(phoneResponse.body.error.code).toBe('PHONE_NOT_VERIFIED');
  });

  it('rejects an incomplete caller profile, missing preferences, and a missing location', async () => {
    const catalogGender = await gender();
    const incomplete = await buildUser({ genderId: catalogGender.id, complete: false });
    const incompleteResponse = await undo(incomplete.id);
    expect(incompleteResponse.status).toBe(400);
    expect(incompleteResponse.body.error.code).toBe('PROFILE_INCOMPLETE');

    const missingPreferences = await buildUser({ genderId: catalogGender.id, preferences: false });
    const preferencesResponse = await undo(missingPreferences.id);
    expect(preferencesResponse.status).toBe(400);
    expect(preferencesResponse.body.error.code).toBe('PROFILE_INCOMPLETE');

    const missingLocation = await buildUser({ genderId: catalogGender.id, point: null });
    const locationResponse = await undo(missingLocation.id);
    expect(locationResponse.status).toBe(400);
    expect(locationResponse.body.error.code).toBe('PROFILE_INCOMPLETE');
  });

  it('rejects a non-premium caller without undoing the like', async () => {
    const { caller, target } = await pair();
    const likeRow = await Like.create({
      fromUserId: caller.id,
      toUserId: target.id,
      action: 'LIKE',
      isUndone: false,
      ...timestamps()
    });

    const response = await undo(caller.id);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('PREMIUM_REQUIRED');
    expect(response.body.error.message).toBe('Feature requires an active Premium subscription.');
    await likeRow.reload();
    expect(likeRow.isUndone).toBe(false);
    expect(await Like.count()).toBe(1);
  });

  it('undoes a recent like and keeps the row', async () => {
    const { caller, target } = await pair();
    await grantPremium(caller.id);
    const likeRow = await Like.create({
      fromUserId: caller.id,
      toUserId: target.id,
      action: 'LIKE',
      isUndone: false,
      ...timestamps()
    });

    const response = await undo(caller.id);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        undoneAction: 'LIKE',
        targetUserId: target.id,
        revertedMatch: false
      },
      message: 'Previous action undone.'
    });
    expect(response.body.data).not.toHaveProperty('conversationId');
    expect(response.body.data).not.toHaveProperty('remainingDailyActions');
    await likeRow.reload();
    expect(likeRow.isUndone).toBe(true);
    expect(likeRow.action).toBe('LIKE');
    expect(await Like.count()).toBe(1);
    expect(await Match.count()).toBe(0);
    expect(await Notification.count()).toBe(0);
  });

  it('undoes a recent pass without changing matches', async () => {
    const { caller, target } = await pair();
    await grantPremium(caller.id);
    const historical = await insertMatch(caller.id, target.id, 'UNMATCHED');
    const passRow = await Like.create({
      fromUserId: caller.id,
      toUserId: target.id,
      action: 'PASS',
      isUndone: false,
      ...timestamps()
    });

    const response = await undo(caller.id);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      undoneAction: 'PASS',
      targetUserId: target.id,
      revertedMatch: false
    });
    await passRow.reload();
    expect(passRow.isUndone).toBe(true);
    expect(await Like.count()).toBe(1);
    await historical.reload();
    expect(historical.status).toBe('UNMATCHED');
    expect(historical.unmatchedByUserId).toBe(caller.id);
    expect(await Match.count({ where: { status: 'ACTIVE' } })).toBe(0);
    expect(await Conversation.count()).toBe(0);
  });

  it('returns no undoable action when nothing active can be undone', async () => {
    const { caller, target, genderId } = await pair();
    await grantPremium(caller.id);

    const empty = await undo(caller.id);
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('NO_UNDOABLE_ACTION');
    expect(empty.body.error.message).toBe('There is no action to undo.');

    await Like.create({
      fromUserId: caller.id,
      toUserId: target.id,
      action: 'SUPER_LIKE',
      isUndone: false,
      ...timestamps()
    });
    const superOnly = await undo(caller.id);
    expect(superOnly.status).toBe(400);
    expect(superOnly.body.error.code).toBe('NO_UNDOABLE_ACTION');
    expect(await Like.count({ where: { action: 'SUPER_LIKE', isUndone: false } })).toBe(1);

    const other = await buildUser({ genderId, point: north(3) });
    await Like.create({
      fromUserId: caller.id,
      toUserId: other.id,
      action: 'LIKE',
      isUndone: true,
      ...timestamps()
    });
    const alreadyUndone = await undo(caller.id);
    expect(alreadyUndone.status).toBe(400);
    expect(alreadyUndone.body.error.code).toBe('NO_UNDOABLE_ACTION');
    expect(await Like.count({ where: { isUndone: true } })).toBe(1);
  });

  it('undoes only the newest like or pass and can undo the next one afterwards', async () => {
    const { caller, target, genderId } = await pair();
    const other = await buildUser({ genderId, point: north(3) });
    await grantPremium(caller.id);
    const older = await Like.create({
      fromUserId: caller.id,
      toUserId: target.id,
      action: 'LIKE',
      isUndone: false,
      ...timestamps()
    });
    const newer = await Like.create({
      fromUserId: caller.id,
      toUserId: other.id,
      action: 'PASS',
      isUndone: false,
      ...timestamps()
    });
    await ageLike(older.id, '2 minutes');
    await ageLike(newer.id, '1 minute');

    const first = await undo(caller.id);
    expect(first.status).toBe(200);
    expect(first.body.data.undoneAction).toBe('PASS');
    expect(first.body.data.targetUserId).toBe(other.id);
    await newer.reload();
    await older.reload();
    expect(newer.isUndone).toBe(true);
    expect(older.isUndone).toBe(false);

    const second = await undo(caller.id);
    expect(second.status).toBe(200);
    expect(second.body.data.undoneAction).toBe('LIKE');
    expect(second.body.data.targetUserId).toBe(target.id);
    await older.reload();
    expect(older.isUndone).toBe(true);
  });

  it('skips a newer super like and undoes the latest like or pass', async () => {
    const { caller, target, genderId } = await pair();
    const other = await buildUser({ genderId, point: north(3) });
    await grantPremium(caller.id);
    const likeRow = await Like.create({
      fromUserId: caller.id,
      toUserId: target.id,
      action: 'LIKE',
      isUndone: false,
      ...timestamps()
    });
    const superLike = await Like.create({
      fromUserId: caller.id,
      toUserId: other.id,
      action: 'SUPER_LIKE',
      isUndone: false,
      ...timestamps()
    });
    await ageLike(likeRow.id, '2 minutes');
    await ageLike(superLike.id, '1 minute');

    const response = await undo(caller.id);
    expect(response.status).toBe(200);
    expect(response.body.data.undoneAction).toBe('LIKE');
    expect(response.body.data.targetUserId).toBe(target.id);
    await likeRow.reload();
    await superLike.reload();
    expect(likeRow.isUndone).toBe(true);
    expect(superLike.isUndone).toBe(false);
    expect(superLike.action).toBe('SUPER_LIKE');
  });

  it('does not undo an older action when the newest like or pass is expired', async () => {
    const { caller, target, genderId } = await pair();
    const other = await buildUser({ genderId, point: north(3) });
    await grantPremium(caller.id);
    const older = await Like.create({
      fromUserId: caller.id,
      toUserId: target.id,
      action: 'LIKE',
      isUndone: false,
      ...timestamps()
    });
    const newer = await Like.create({
      fromUserId: caller.id,
      toUserId: other.id,
      action: 'PASS',
      isUndone: false,
      ...timestamps()
    });
    await ageLike(older.id, '7 minutes');
    await ageLike(newer.id, '6 minutes');

    const response = await undo(caller.id);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('UNDO_WINDOW_EXPIRED');
    expect(response.body.error.message).toBe('The undo window for your last action has expired.');
    await older.reload();
    await newer.reload();
    expect(older.isUndone).toBe(false);
    expect(newer.isUndone).toBe(false);
  });

  it('accepts an action inside the window and at the five-minute boundary, and rejects an older one', async () => {
    const { caller, target, genderId } = await pair();
    const boundaryTarget = await buildUser({ genderId, point: north(3) });
    const expiredTarget = await buildUser({ genderId, point: north(4) });
    await grantPremium(caller.id);

    const inside = await Like.create({
      fromUserId: caller.id,
      toUserId: target.id,
      action: 'LIKE',
      isUndone: false,
      ...timestamps()
    });
    await ageLike(inside.id, '1 minute');
    const insideResponse = await undo(caller.id);
    expect(insideResponse.status).toBe(200);
    expect(insideResponse.body.data.targetUserId).toBe(target.id);

    const boundary = await Like.create({
      fromUserId: caller.id,
      toUserId: boundaryTarget.id,
      action: 'PASS',
      isUndone: false,
      ...timestamps()
    });
    await ageLike(boundary.id, '4 minutes 57 seconds');
    const boundaryResponse = await undo(caller.id);
    expect(boundaryResponse.status).toBe(200);
    expect(boundaryResponse.body.data.undoneAction).toBe('PASS');
    expect(boundaryResponse.body.data.targetUserId).toBe(boundaryTarget.id);

    const expired = await Like.create({
      fromUserId: caller.id,
      toUserId: expiredTarget.id,
      action: 'LIKE',
      isUndone: false,
      ...timestamps()
    });
    await ageLike(expired.id, '5 minutes 2 seconds');
    const expiredResponse = await undo(caller.id);
    expect(expiredResponse.status).toBe(400);
    expect(expiredResponse.body.error.code).toBe('UNDO_WINDOW_EXPIRED');
    await expired.reload();
    expect(expired.isUndone).toBe(false);
  });

  it('reverts the active match and closes its conversation without changing history or the reciprocal like', async () => {
    const { caller, target } = await pair();
    await grantPremium(caller.id);
    const historicalUndone = await insertMatch(caller.id, target.id, 'UNDONE');
    const historicalUnmatched = await insertMatch(caller.id, target.id, 'UNMATCHED');
    const historicalClosedAt = new Date('2026-01-01T00:00:00.000Z');
    await Conversation.create({
      matchId: historicalUndone.id,
      status: 'CLOSED',
      lastMessageAt: null,
      closedAt: historicalClosedAt,
      ...timestamps()
    });
    await Like.create({
      fromUserId: target.id,
      toUserId: caller.id,
      action: 'SUPER_LIKE',
      isUndone: false,
      ...timestamps()
    });

    const liked = await like(caller.id, target.id);
    expect(liked.status).toBe(200);
    expect(liked.body.data.isMatch).toBe(true);

    const response = await undo(caller.id);
    expect(response.status).toBe(200);
    expect(response.body.data.undoneAction).toBe('LIKE');
    expect(response.body.data.targetUserId).toBe(target.id);
    expect(response.body.data.revertedMatch).toBe(true);

    const callerLike = await Like.findOne({ where: { fromUserId: caller.id, toUserId: target.id } });
    expect(callerLike?.isUndone).toBe(true);
    expect(callerLike?.action).toBe('LIKE');
    const reciprocal = await Like.findOne({ where: { fromUserId: target.id, toUserId: caller.id } });
    expect(reciprocal?.action).toBe('SUPER_LIKE');
    expect(reciprocal?.isUndone).toBe(false);

    const active = await Match.findOne({ where: { id: liked.body.data.matchId } });
    expect(active?.status).toBe('UNDONE');
    expect(active?.unmatchedAt).toBeNull();
    expect(active?.unmatchedByUserId).toBeNull();
    const conversation = await Conversation.findOne({ where: { matchId: liked.body.data.matchId } });
    expect(conversation?.status).toBe('CLOSED');
    expect(conversation?.closedAt).not.toBeNull();

    await historicalUndone.reload();
    await historicalUnmatched.reload();
    expect(historicalUndone.status).toBe('UNDONE');
    expect(historicalUnmatched.status).toBe('UNMATCHED');
    expect(historicalUnmatched.unmatchedByUserId).toBe(caller.id);
    const historicalConversation = await Conversation.findOne({ where: { matchId: historicalUndone.id } });
    expect(historicalConversation?.status).toBe('CLOSED');
    expect(historicalConversation?.closedAt?.toISOString()).toBe(historicalClosedAt.toISOString());
    expect(await Notification.count()).toBe(0);
  });

  it('leaves the daily like and pass usage unchanged', async () => {
    const { caller, target } = await pair();
    await grantPremium(caller.id);
    await seedUsage(caller.id, 4);
    await Like.create({
      fromUserId: caller.id,
      toUserId: target.id,
      action: 'PASS',
      isUndone: false,
      ...timestamps()
    });

    const before = await UsageRecord.count();
    const response = await undo(caller.id);
    expect(response.status).toBe(200);
    expect(await usageCount(caller.id)).toBe(4);
    expect(await UsageRecord.count()).toBe(before);
  });

  it('lets only one of two simultaneous undos change the match and conversation', async () => {
    const { caller, target } = await pair();
    await grantPremium(caller.id);
    await Like.create({
      fromUserId: target.id,
      toUserId: caller.id,
      action: 'LIKE',
      isUndone: false,
      ...timestamps()
    });
    const liked = await like(caller.id, target.id);
    expect(liked.status).toBe(200);
    expect(liked.body.data.isMatch).toBe(true);

    const [first, second] = await Promise.all([undo(caller.id), undo(caller.id)]);
    const statuses = [first.status, second.status].sort((left, right) => left - right);
    expect(statuses).toEqual([200, 400]);
    const rejected = [first, second].find((response) => response.status === 400);
    expect(rejected?.body.error.code).toBe('NO_UNDOABLE_ACTION');
    const succeeded = [first, second].find((response) => response.status === 200);
    expect(succeeded?.body.data.revertedMatch).toBe(true);

    const callerLike = await Like.findOne({ where: { fromUserId: caller.id, toUserId: target.id } });
    expect(callerLike?.isUndone).toBe(true);
    expect(await Match.count({ where: { status: 'UNDONE' } })).toBe(1);
    expect(await Match.count({ where: { status: 'ACTIVE' } })).toBe(0);
    expect(await Conversation.count({ where: { status: 'CLOSED' } })).toBe(1);
    expect(await Conversation.count({ where: { status: 'ACTIVE' } })).toBe(0);
    const reciprocal = await Like.findOne({ where: { fromUserId: target.id, toUserId: caller.id } });
    expect(reciprocal?.isUndone).toBe(false);
  });
});
