import { randomUUID } from 'crypto';
import request from 'supertest';
import { literal, QueryTypes } from 'sequelize';
import { sequelize } from '../../src/config/database';
import { Block } from '../../src/database/models/block.model';
import { DatingPreference } from '../../src/database/models/dating-preference.model';
import { Gender } from '../../src/database/models/gender.model';
import { Like } from '../../src/database/models/like.model';
import { Plan } from '../../src/database/models/plan.model';
import { Profile } from '../../src/database/models/profile.model';
import { ProfilePhoto } from '../../src/database/models/profile-photo.model';
import { Subscription } from '../../src/database/models/subscription.model';
import { User, UserStatus } from '../../src/database/models/user.model';
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

jest.setTimeout(120000);

const PATH = '/api/v1/likes/who-liked-me';
const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';
const ORIGIN = { latitude: 12.9716, longitude: 77.5946 };
const HOUR_MS = 60 * 60 * 1000;
const CARD_FIELDS = ['userId', 'firstName', 'age', 'city', 'distanceKm', 'likedAt', 'primaryPhotoUrl'];

interface Point {
  latitude: number;
  longitude: number;
}

interface BuiltUser {
  user: User;
  storageKey: string | null;
  photoId: string | null;
}

interface TableCounts {
  likes: number;
  notifications: number;
  usageRecords: number;
  creditTransactions: number;
  creditBalances: number;
  subscriptions: number;
  matches: number;
}

interface LikeStamp {
  id: string;
  isUndone: boolean;
  updatedAt: string;
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

function whoLiked(userId: string) {
  return request(app).get(PATH).set(authHeader(userId));
}

async function gender(): Promise<Gender> {
  return Gender.create({ code: `who-${randomUUID()}`, name: 'Who', isActive: true });
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

async function ageOf(userId: string): Promise<number> {
  const rows = await sequelize.query<{ age: number | string }>(
    `SELECT CAST(EXTRACT(YEAR FROM AGE(date_of_birth)) AS int) AS age
     FROM profiles
     WHERE user_id = CAST(:userId AS uuid)`,
    { replacements: { userId }, type: QueryTypes.SELECT }
  );
  return Number(rows[0].age);
}

async function distanceKm(leftUserId: string, rightUserId: string): Promise<number> {
  const rows = await sequelize.query<{ km: string | number }>(
    `SELECT ROUND(CAST(ST_Distance(a.location, b.location) / 1000.0 AS numeric), 1) AS km
     FROM profiles a
     INNER JOIN profiles b ON b.user_id = CAST(:rightUserId AS uuid)
     WHERE a.user_id = CAST(:leftUserId AS uuid)`,
    { replacements: { leftUserId, rightUserId }, type: QueryTypes.SELECT }
  );
  return Number(rows[0].km);
}

async function buildUser(input: {
  genderId: string;
  point?: Point | null;
  dateOfBirth?: string;
  firstName?: string;
  city?: string;
  complete?: boolean;
  primaryPhoto?: boolean;
  status?: UserStatus;
  emailVerified?: boolean;
  phoneOnly?: boolean;
  preferences?: boolean;
  bio?: string | null;
}): Promise<BuiltUser> {
  const emailVerified = input.emailVerified ?? true;
  const user = await User.create({
    email: input.phoneOnly ? null : `who-${randomUUID()}@example.com`,
    phone: input.phoneOnly ? `+${randomUUID().replace(/-/g, '').slice(0, 15)}` : null,
    passwordHash: PASSWORD_HASH,
    role: 'USER',
    status: input.status ?? 'ACTIVE',
    emailVerified: input.phoneOnly ? false : emailVerified,
    phoneVerified: input.phoneOnly ? emailVerified : false
  });
  await Profile.create({
    userId: user.id,
    firstName: input.firstName ?? 'Jordan',
    dateOfBirth: input.dateOfBirth ?? '2000-06-15',
    genderId: input.genderId,
    bio: input.bio === undefined ? 'Coffee and long walks.' : input.bio,
    occupation: 'Designer',
    education: 'NID',
    isProfileComplete: input.complete ?? true
  });

  const point = input.point === undefined ? ORIGIN : input.point;
  if (point) {
    await setLocation(user.id, point, input.city ?? 'Bengaluru');
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

  let storageKey: string | null = null;
  let photoId: string | null = null;
  if (input.primaryPhoto !== false) {
    storageKey = `photos/${user.id}/${randomUUID()}.webp`;
    const photo = await ProfilePhoto.create({
      userId: user.id,
      storageKey,
      mimeType: 'image/jpeg',
      fileSizeBytes: 2048,
      displayOrder: 1,
      isPrimary: true,
      ...timestamps()
    });
    photoId = photo.id;
  }

  return { user, storageKey, photoId };
}

async function caller(genderId: string, overrides: Parameters<typeof buildUser>[0] = { genderId }): Promise<BuiltUser> {
  return buildUser({
    firstName: 'Alex',
    city: 'Bengaluru',
    point: ORIGIN,
    ...overrides,
    genderId
  });
}

async function insertLike(
  fromUserId: string,
  toUserId: string,
  input?: { action?: 'LIKE' | 'PASS' | 'SUPER_LIKE'; undone?: boolean; createdAt?: Date; id?: string }
): Promise<Like> {
  const when = input?.createdAt ?? new Date();
  const like = await Like.create({
    id: input?.id,
    fromUserId,
    toUserId,
    action: input?.action ?? 'LIKE',
    isUndone: input?.undone ?? false,
    createdAt: when,
    updatedAt: when
  });
  if (input?.createdAt) {
    await sequelize.query(
      `UPDATE likes
       SET created_at = :createdAt, updated_at = :createdAt
       WHERE id = :id`,
      { replacements: { id: like.id, createdAt: input.createdAt } }
    );
  }
  return like;
}

async function insertMatch(
  leftUserId: string,
  rightUserId: string,
  status: 'ACTIVE' | 'UNMATCHED' | 'UNDONE'
): Promise<void> {
  await sequelize.query(
    `INSERT INTO matches (
       id, user_one_id, user_two_id, status, matched_at, created_at, updated_at
     )
     VALUES (
       gen_random_uuid(),
       LEAST(CAST(:leftUserId AS uuid), CAST(:rightUserId AS uuid)),
       GREATEST(CAST(:leftUserId AS uuid), CAST(:rightUserId AS uuid)),
       :status,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
     )`,
    { replacements: { leftUserId, rightUserId, status } }
  );
}

async function grantPremium(userId: string): Promise<void> {
  const existing = await Plan.findOne({ where: { code: 'PREMIUM_MONTHLY' } });
  const plan =
    existing ??
    (await Plan.create({
      code: 'PREMIUM_MONTHLY',
      name: 'Love Bite Premium (Monthly)',
      billingInterval: 'MONTH',
      priceInCents: 49900,
      currency: 'INR',
      isActive: true,
      displayOrder: 1,
      ...timestamps()
    }));
  const now = new Date();
  await Subscription.create({
    userId,
    planId: plan.id,
    status: 'ACTIVE',
    autoRenew: false,
    currentPeriodStart: now,
    currentPeriodEnd: new Date(now.getTime() + 24 * HOUR_MS),
    ...timestamps()
  });
}

async function rewriteSubscription(
  userId: string,
  patch: {
    status: 'ACTIVE' | 'PAST_DUE' | 'GRACE_PERIOD' | 'CANCELED' | 'EXPIRED';
    currentPeriodEnd: Date;
    gracePeriodEnd: Date | null;
  }
): Promise<void> {
  const [count] = await Subscription.update(
    {
      status: patch.status,
      autoRenew: false,
      currentPeriodEnd: patch.currentPeriodEnd,
      gracePeriodEnd: patch.gracePeriodEnd,
      canceledAt: patch.status === 'CANCELED' ? new Date() : null,
      endedAt: patch.status === 'EXPIRED' ? new Date() : null
    },
    { where: { userId } }
  );
  if (count !== 1) {
    throw new Error('Expected one subscription to rewrite.');
  }
}

async function orderedAdmirerIds(callerId: string): Promise<string[]> {
  const rows = await sequelize.query<{ userId: string }>(
    `SELECT from_user_id AS "userId"
     FROM likes
     WHERE to_user_id = CAST(:callerId AS uuid)
       AND is_undone = FALSE
       AND action IN ('LIKE', 'SUPER_LIKE')
     ORDER BY created_at DESC, id DESC`,
    { replacements: { callerId }, type: QueryTypes.SELECT }
  );
  return rows.map((row) => row.userId);
}

async function tableCounts(): Promise<TableCounts> {
  const rows = await sequelize.query<TableCounts>(
    `SELECT
       (SELECT COUNT(*)::int FROM likes) AS "likes",
       (SELECT COUNT(*)::int FROM notifications) AS "notifications",
       (SELECT COUNT(*)::int FROM usage_records) AS "usageRecords",
       (SELECT COUNT(*)::int FROM credit_transactions) AS "creditTransactions",
       (SELECT COUNT(*)::int FROM user_credit_balances) AS "creditBalances",
       (SELECT COUNT(*)::int FROM subscriptions) AS "subscriptions",
       (SELECT COUNT(*)::int FROM matches) AS "matches"`,
    { type: QueryTypes.SELECT }
  );
  return rows[0];
}

async function likeStamps(): Promise<LikeStamp[]> {
  const rows = await sequelize.query<{ id: string; isUndone: boolean | string; updatedAt: Date | string }>(
    `SELECT id, is_undone AS "isUndone", updated_at AS "updatedAt"
     FROM likes
     ORDER BY id`,
    { type: QueryTypes.SELECT }
  );
  return rows.map((row) => ({
    id: row.id,
    isUndone: row.isUndone === true || row.isUndone === 't' || row.isUndone === 'true',
    updatedAt: new Date(row.updatedAt).toISOString()
  }));
}

function expectFree(response: request.Response, count: number): void {
  expect(response.status).toBe(200);
  expect(response.body.success).toBe(true);
  expect(response.body.data).toEqual({
    count,
    isUnlocked: false,
    admirers: []
  });
  expect(response.body.message).toBe(`${count} people liked your profile! Upgrade to Premium to see who.`);
  expect(mockPhotoStorage.createDownloadUrl).not.toHaveBeenCalled();
}

function expectPremiumShape(response: request.Response, count: number): void {
  expect(response.status).toBe(200);
  expect(response.body.success).toBe(true);
  expect(response.body.data.count).toBe(count);
  expect(response.body.data.isUnlocked).toBe(true);
  expect(response.body.message).toBe('Admirers retrieved successfully.');
}

beforeEach(() => {
  mockPhotoStorage.createUploadUrl.mockClear();
  mockPhotoStorage.createDownloadUrl.mockClear();
});

describe('GET /api/v1/likes/who-liked-me', () => {
  it('returns a Free zero response when nobody eligible has liked the caller', async () => {
    const catalogGender = await gender();
    const viewer = await caller(catalogGender.id);
    const response = await whoLiked(viewer.user.id);
    expectFree(response, 0);
  });

  it('returns only the count for a Free caller with eligible admirers', async () => {
    const catalogGender = await gender();
    const viewer = await caller(catalogGender.id);
    const admirer = await buildUser({
      genderId: catalogGender.id,
      firstName: 'Zephyr',
      city: 'Udupi',
      point: north(2),
      preferences: false
    });
    const like = await insertLike(admirer.user.id, viewer.user.id, {
      createdAt: new Date('2026-09-15T06:12:00.000Z')
    });
    const beforeCounts = await tableCounts();
    const beforeLikes = await likeStamps();
    const response = await whoLiked(viewer.user.id);

    expectFree(response, 1);
    const serialized = response.text;
    expect(serialized).not.toContain(admirer.user.id);
    expect(serialized).not.toContain('Zephyr');
    expect(serialized).not.toContain('Udupi');
    expect(serialized).not.toContain('2026-09-15T06:12:00.000Z');
    expect(serialized).not.toContain(admirer.storageKey);
    expect(serialized).not.toContain('https://download.test/signed');
    expect(serialized).not.toContain(like.id);
    expect(await tableCounts()).toEqual(beforeCounts);
    expect(await likeStamps()).toEqual(beforeLikes);
  });

  it('returns the Free response to a lapsed Premium caller', async () => {
    const catalogGender = await gender();
    const viewer = await caller(catalogGender.id);
    const admirer = await buildUser({ genderId: catalogGender.id, point: north(2), preferences: false });
    await insertLike(admirer.user.id, viewer.user.id);
    await grantPremium(viewer.user.id);
    await rewriteSubscription(viewer.user.id, {
      status: 'CANCELED',
      currentPeriodEnd: new Date(Date.now() - HOUR_MS),
      gracePeriodEnd: new Date(Date.now() + 24 * HOUR_MS)
    });

    const response = await whoLiked(viewer.user.id);
    expectFree(response, 1);
  });

  it('returns an empty Premium list when the caller qualifies and nobody is eligible', async () => {
    const catalogGender = await gender();
    const viewer = await caller(catalogGender.id);
    await grantPremium(viewer.user.id);
    const response = await whoLiked(viewer.user.id);
    expectPremiumShape(response, 0);
    expect(response.body.data.admirers).toEqual([]);
    expect(mockPhotoStorage.createDownloadUrl).not.toHaveBeenCalled();
  });

  it('returns Premium cards for LIKE and SUPER_LIKE, newest first, with only the seven public fields', async () => {
    const catalogGender = await gender();
    const viewer = await caller(catalogGender.id);
    const older = await buildUser({
      genderId: catalogGender.id,
      firstName: 'Jordan',
      city: 'Mysuru',
      dateOfBirth: '2000-06-15',
      point: north(2),
      bio: 'Secret bio must stay hidden.',
      preferences: false
    });
    const newer = await buildUser({
      genderId: catalogGender.id,
      firstName: 'Rhea',
      city: 'Hassan',
      point: north(4),
      preferences: false
    });
    const secondaryKey = `photos/${older.user.id}/secondary.webp`;
    await ProfilePhoto.create({
      userId: older.user.id,
      storageKey: secondaryKey,
      mimeType: 'image/jpeg',
      fileSizeBytes: 1024,
      displayOrder: 2,
      isPrimary: false,
      ...timestamps()
    });
    await insertLike(older.user.id, viewer.user.id, {
      createdAt: new Date('2026-09-15T06:12:00.000Z')
    });
    await insertLike(newer.user.id, viewer.user.id, {
      action: 'SUPER_LIKE',
      createdAt: new Date('2026-09-16T06:12:00.000Z')
    });
    await grantPremium(viewer.user.id);

    const beforeCounts = await tableCounts();
    const beforeLikes = await likeStamps();
    const response = await whoLiked(viewer.user.id);
    expectPremiumShape(response, 2);
    expect(response.body.data.admirers.map((card: { userId: string }) => card.userId)).toEqual([
      newer.user.id,
      older.user.id
    ]);

    const card = response.body.data.admirers[1];
    expect(Object.keys(card).sort()).toEqual([...CARD_FIELDS].sort());
    expect(card).toEqual({
      userId: older.user.id,
      firstName: 'Jordan',
      age: await ageOf(older.user.id),
      city: 'Mysuru',
      distanceKm: await distanceKm(older.user.id, viewer.user.id),
      likedAt: '2026-09-15T06:12:00.000Z',
      primaryPhotoUrl: 'https://download.test/signed'
    });
    expect(typeof card.distanceKm).toBe('number');
    expect(card.distanceKm).toBe(Math.round(card.distanceKm * 10) / 10);

    expect(mockPhotoStorage.createDownloadUrl).toHaveBeenNthCalledWith(1, {
      storageKey: newer.storageKey,
      expiresInSeconds: 3600
    });
    expect(mockPhotoStorage.createDownloadUrl).toHaveBeenNthCalledWith(2, {
      storageKey: older.storageKey,
      expiresInSeconds: 3600
    });
    expect(mockPhotoStorage.createDownloadUrl).not.toHaveBeenCalledWith(
      expect.objectContaining({ storageKey: secondaryKey })
    );

    const serialized = response.text;
    expect(serialized).not.toContain(older.user.email ?? '');
    expect(serialized).not.toContain(older.storageKey);
    expect(serialized).not.toContain(secondaryKey);
    expect(serialized).not.toContain(older.photoId);
    expect(serialized).not.toContain('Secret bio must stay hidden.');
    expect(serialized).not.toContain('12.9716');
    expect(serialized).not.toContain('77.5946');
    expect(serialized).not.toContain('latitude');
    expect(serialized).not.toContain('longitude');
    expect(await tableCounts()).toEqual(beforeCounts);
    expect(await likeStamps()).toEqual(beforeLikes);
  });

  it('returns a null city when the admirer profile has no city', async () => {
    const catalogGender = await gender();
    const viewer = await caller(catalogGender.id);
    const admirer = await buildUser({ genderId: catalogGender.id, point: north(1), preferences: false });
    await Profile.update({ city: null }, { where: { userId: admirer.user.id } });
    await insertLike(admirer.user.id, viewer.user.id);
    await grantPremium(viewer.user.id);
    const response = await whoLiked(viewer.user.id);
    expectPremiumShape(response, 1);
    expect(response.body.data.admirers[0].city).toBeNull();
  });

  it('excludes PASS and undone likes', async () => {
    const catalogGender = await gender();
    const viewer = await caller(catalogGender.id);
    const passed = await buildUser({ genderId: catalogGender.id, point: north(1), preferences: false });
    const undone = await buildUser({ genderId: catalogGender.id, point: north(2), preferences: false });
    await insertLike(passed.user.id, viewer.user.id, { action: 'PASS' });
    await insertLike(undone.user.id, viewer.user.id, { undone: true });
    const response = await whoLiked(viewer.user.id);
    expectFree(response, 0);
  });

  it('excludes a block in either direction and an ACTIVE match, and keeps UNMATCHED and UNDONE matches', async () => {
    const catalogGender = await gender();
    const viewer = await caller(catalogGender.id);
    const blockedByCaller = await buildUser({ genderId: catalogGender.id, point: north(1), preferences: false });
    const blockedByAdmirer = await buildUser({ genderId: catalogGender.id, point: north(2), preferences: false });
    const matched = await buildUser({ genderId: catalogGender.id, point: north(3), preferences: false });
    const unmatched = await buildUser({ genderId: catalogGender.id, point: north(4), preferences: false });
    const undoneMatch = await buildUser({ genderId: catalogGender.id, point: north(5), preferences: false });
    await insertLike(blockedByCaller.user.id, viewer.user.id);
    await insertLike(blockedByAdmirer.user.id, viewer.user.id);
    await insertLike(matched.user.id, viewer.user.id);
    await insertLike(unmatched.user.id, viewer.user.id);
    await insertLike(undoneMatch.user.id, viewer.user.id);
    await Block.create({ blockerId: viewer.user.id, blockedId: blockedByCaller.user.id, createdAt: new Date() });
    await Block.create({ blockerId: blockedByAdmirer.user.id, blockedId: viewer.user.id, createdAt: new Date() });
    await insertMatch(viewer.user.id, matched.user.id, 'ACTIVE');
    await insertMatch(viewer.user.id, unmatched.user.id, 'UNMATCHED');
    await insertMatch(viewer.user.id, undoneMatch.user.id, 'UNDONE');
    await grantPremium(viewer.user.id);

    const response = await whoLiked(viewer.user.id);
    expectPremiumShape(response, 2);
    expect(response.body.data.admirers.map((card: { userId: string }) => card.userId).sort()).toEqual(
      [unmatched.user.id, undoneMatch.user.id].sort()
    );
  });

  it('excludes deleted, soft-deleted, suspended, banned, and unverified admirers', async () => {
    const catalogGender = await gender();
    const viewer = await caller(catalogGender.id);
    const deleted = await buildUser({ genderId: catalogGender.id, point: north(1), preferences: false });
    const softDeleted = await buildUser({ genderId: catalogGender.id, point: north(2), preferences: false });
    const suspended = await buildUser({ genderId: catalogGender.id, point: north(3), preferences: false, status: 'SUSPENDED' });
    const banned = await buildUser({ genderId: catalogGender.id, point: north(4), preferences: false, status: 'BANNED' });
    const unverified = await buildUser({ genderId: catalogGender.id, point: north(5), preferences: false, status: 'UNVERIFIED' });
    await User.update({ status: 'DELETED' }, { where: { id: deleted.user.id } });
    await sequelize.query(`UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = :id`, {
      replacements: { id: softDeleted.user.id }
    });
    for (const admirer of [deleted, softDeleted, suspended, banned, unverified]) {
      await insertLike(admirer.user.id, viewer.user.id);
    }
    const response = await whoLiked(viewer.user.id);
    expectFree(response, 0);
  });

  it('excludes admirers with no profile, no location, or no active primary photo', async () => {
    const catalogGender = await gender();
    const viewer = await caller(catalogGender.id);
    const noProfile = await User.create({
      email: `bare-${randomUUID()}@example.com`,
      passwordHash: PASSWORD_HASH,
      role: 'USER',
      status: 'ACTIVE',
      emailVerified: true,
      phoneVerified: false
    });
    const noLocation = await buildUser({
      genderId: catalogGender.id,
      point: null,
      preferences: false
    });
    const noPhoto = await buildUser({
      genderId: catalogGender.id,
      point: north(1),
      primaryPhoto: false,
      preferences: false
    });
    await insertLike(noProfile.id, viewer.user.id);
    await insertLike(noLocation.user.id, viewer.user.id);
    await insertLike(noPhoto.user.id, viewer.user.id);
    const response = await whoLiked(viewer.user.id);
    expectFree(response, 0);
  });

  it('keeps an admirer whose profile is not marked complete', async () => {
    const catalogGender = await gender();
    const viewer = await caller(catalogGender.id);
    const admirer = await buildUser({
      genderId: catalogGender.id,
      point: north(1),
      complete: false,
      preferences: false
    });
    await insertLike(admirer.user.id, viewer.user.id);
    const response = await whoLiked(viewer.user.id);
    expectFree(response, 1);
  });

  it('treats in-period canceled, past-due, and grace-period subscriptions as Premium', async () => {
    const catalogGender = await gender();
    const future = new Date(Date.now() + 24 * HOUR_MS);
    const past = new Date(Date.now() - HOUR_MS);

    const active = await caller(catalogGender.id);
    const admirer = await buildUser({ genderId: catalogGender.id, point: north(1), preferences: false });
    await insertLike(admirer.user.id, active.user.id);
    await grantPremium(active.user.id);
    const activeResponse = await whoLiked(active.user.id);
    expectPremiumShape(activeResponse, 1);

    const canceled = await caller(catalogGender.id);
    await insertLike(admirer.user.id, canceled.user.id);
    await grantPremium(canceled.user.id);
    await rewriteSubscription(canceled.user.id, {
      status: 'CANCELED',
      currentPeriodEnd: future,
      gracePeriodEnd: null
    });
    const canceledResponse = await whoLiked(canceled.user.id);
    expectPremiumShape(canceledResponse, 1);

    const pastDue = await caller(catalogGender.id);
    await insertLike(admirer.user.id, pastDue.user.id);
    await grantPremium(pastDue.user.id);
    await rewriteSubscription(pastDue.user.id, {
      status: 'PAST_DUE',
      currentPeriodEnd: past,
      gracePeriodEnd: future
    });
    const pastDueResponse = await whoLiked(pastDue.user.id);
    expectPremiumShape(pastDueResponse, 1);

    const grace = await caller(catalogGender.id);
    await insertLike(admirer.user.id, grace.user.id);
    await grantPremium(grace.user.id);
    await rewriteSubscription(grace.user.id, {
      status: 'GRACE_PERIOD',
      currentPeriodEnd: past,
      gracePeriodEnd: future
    });
    const graceResponse = await whoLiked(grace.user.id);
    expectPremiumShape(graceResponse, 1);
  });

  it('treats an elapsed canceled subscription and an expired subscription as Free', async () => {
    const catalogGender = await gender();
    const past = new Date(Date.now() - HOUR_MS);
    const earlier = new Date(Date.now() - 2 * HOUR_MS);
    const admirer = await buildUser({ genderId: catalogGender.id, point: north(1), preferences: false });

    const elapsed = await caller(catalogGender.id);
    await insertLike(admirer.user.id, elapsed.user.id);
    await grantPremium(elapsed.user.id);
    await rewriteSubscription(elapsed.user.id, {
      status: 'CANCELED',
      currentPeriodEnd: past,
      gracePeriodEnd: earlier
    });
    expectFree(await whoLiked(elapsed.user.id), 1);

    const expired = await caller(catalogGender.id);
    await insertLike(admirer.user.id, expired.user.id);
    await grantPremium(expired.user.id);
    await rewriteSubscription(expired.user.id, {
      status: 'EXPIRED',
      currentPeriodEnd: new Date(Date.now() + 24 * HOUR_MS),
      gracePeriodEnd: new Date(Date.now() + 24 * HOUR_MS)
    });
    expectFree(await whoLiked(expired.user.id), 1);
  });

  it('rejects unverified, banned, invalid, and incomplete callers before signing a photo', async () => {
    const catalogGender = await gender();
    const emailUser = await caller(catalogGender.id, { genderId: catalogGender.id, emailVerified: false });
    const emailResponse = await whoLiked(emailUser.user.id);
    expect(emailResponse.status).toBe(403);
    expect(emailResponse.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(mockPhotoStorage.createDownloadUrl).not.toHaveBeenCalled();

    const phoneUser = await caller(catalogGender.id, {
      genderId: catalogGender.id,
      phoneOnly: true,
      emailVerified: false
    });
    const phoneResponse = await whoLiked(phoneUser.user.id);
    expect(phoneResponse.status).toBe(403);
    expect(phoneResponse.body.error.code).toBe('PHONE_NOT_VERIFIED');

    const banned = await User.create({
      email: `banned-${randomUUID()}@example.com`,
      passwordHash: PASSWORD_HASH,
      role: 'USER',
      status: 'BANNED',
      emailVerified: true,
      phoneVerified: false
    });
    const bannedResponse = await whoLiked(banned.id);
    expect(bannedResponse.status).toBe(403);
    expect(bannedResponse.body.error.code).toBe('ACCOUNT_BANNED');

    const invalid = await request(app).get(PATH).set({ Authorization: 'Bearer not-a-token' });
    expect(invalid.status).toBe(401);
    expect(invalid.body.error.code).toBe('INVALID_TOKEN');

    const incomplete = await caller(catalogGender.id, { genderId: catalogGender.id, complete: false });
    const incompleteResponse = await whoLiked(incomplete.user.id);
    expect(incompleteResponse.status).toBe(400);
    expect(incompleteResponse.body.error.code).toBe('PROFILE_INCOMPLETE');
    expect(incompleteResponse.body.error.message).toBe('Onboarding is incomplete.');

    const missingPreferences = await caller(catalogGender.id, { genderId: catalogGender.id, preferences: false });
    const preferencesResponse = await whoLiked(missingPreferences.user.id);
    expect(preferencesResponse.status).toBe(400);
    expect(preferencesResponse.body.error.code).toBe('PROFILE_INCOMPLETE');

    const missingLocation = await caller(catalogGender.id, { genderId: catalogGender.id, point: null });
    const locationResponse = await whoLiked(missingLocation.user.id);
    expect(locationResponse.status).toBe(400);
    expect(locationResponse.body.error.code).toBe('PROFILE_INCOMPLETE');
    expect(mockPhotoStorage.createDownloadUrl).not.toHaveBeenCalled();
  });

  it('returns the 50 newest cards while count stays the full eligible total', async () => {
    const catalogGender = await gender();
    const viewer = await caller(catalogGender.id);
    for (let index = 0; index < 51; index += 1) {
      const admirer = await buildUser({
        genderId: catalogGender.id,
        firstName: `Admirer${index}`,
        point: north(1),
        preferences: false
      });
      await insertLike(admirer.user.id, viewer.user.id, {
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index))
      });
    }
    await grantPremium(viewer.user.id);
    const response = await whoLiked(viewer.user.id);
    expectPremiumShape(response, 51);
    expect(response.body.data.admirers).toHaveLength(50);
    const expected = await orderedAdmirerIds(viewer.user.id);
    expect(response.body.data.admirers.map((card: { userId: string }) => card.userId)).toEqual(expected.slice(0, 50));
  });

  it('orders admirers with the same likedAt by like id descending', async () => {
    const catalogGender = await gender();
    const viewer = await caller(catalogGender.id);
    const first = await buildUser({ genderId: catalogGender.id, point: north(1), preferences: false });
    const second = await buildUser({ genderId: catalogGender.id, point: north(2), preferences: false });
    const createdAt = new Date('2026-09-15T06:12:00.000Z');
    await insertLike(first.user.id, viewer.user.id, {
      id: '00000000-0000-4000-8000-000000000001',
      createdAt
    });
    await insertLike(second.user.id, viewer.user.id, {
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      createdAt
    });
    await grantPremium(viewer.user.id);
    const response = await whoLiked(viewer.user.id);
    expectPremiumShape(response, 2);
    expect(response.body.data.admirers.map((card: { userId: string }) => card.userId)).toEqual(
      await orderedAdmirerIds(viewer.user.id)
    );
    expect(response.body.data.admirers.map((card: { likedAt: string }) => card.likedAt)).toEqual([
      '2026-09-15T06:12:00.000Z',
      '2026-09-15T06:12:00.000Z'
    ]);
  });

  it('rejects an admin and an unsupported query parameter', async () => {
    const admin = await User.create({
      email: `admin-${randomUUID()}@example.com`,
      passwordHash: PASSWORD_HASH,
      role: 'ADMIN',
      status: 'ACTIVE',
      emailVerified: true,
      phoneVerified: false
    });
    const forbidden = await request(app).get(PATH).set(authHeader(admin.id, 'ADMIN'));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');

    const catalogGender = await gender();
    const viewer = await caller(catalogGender.id);
    const invalidQuery = await request(app).get(`${PATH}?limit=1`).set(authHeader(viewer.user.id));
    expect(invalidQuery.status).toBe(400);
    expect(invalidQuery.body.error.code).toBe('VALIDATION_ERROR');
    expect(invalidQuery.body.error.details).toEqual([{ field: 'limit', message: 'Unsupported query parameter.' }]);
    expect(mockPhotoStorage.createDownloadUrl).not.toHaveBeenCalled();
  });
});
