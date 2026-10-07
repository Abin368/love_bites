import { randomUUID } from 'crypto';
import request from 'supertest';
import { literal, QueryTypes } from 'sequelize';
import { sequelize } from '../../src/config/database';
import { Conversation } from '../../src/database/models/conversation.model';
import { CreditTransaction } from '../../src/database/models/credit-transaction.model';
import { DatingPreference } from '../../src/database/models/dating-preference.model';
import { Gender } from '../../src/database/models/gender.model';
import { Like } from '../../src/database/models/like.model';
import { Match } from '../../src/database/models/match.model';
import { Message } from '../../src/database/models/message.model';
import { Profile } from '../../src/database/models/profile.model';
import { ProfilePhoto } from '../../src/database/models/profile-photo.model';
import { RelationshipIntention } from '../../src/database/models/relationship-intention.model';
import { UsageRecord } from '../../src/database/models/usage-record.model';
import { User, UserStatus } from '../../src/database/models/user.model';
import { UserCreditBalance } from '../../src/database/models/user-credit-balance.model';
import { UserDatingPreferenceGender } from '../../src/database/models/user-dating-preference-gender.model';
import { UserDatingPreferenceIntention } from '../../src/database/models/user-dating-preference-intention.model';
import { UserRelationshipIntention } from '../../src/database/models/user-relationship-intention.model';
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
  return Gender.create({ code: `unmatch-${randomUUID()}`, name: 'Woman', isActive: true });
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
    email: input.phoneOnly ? null : `unmatch-${randomUUID()}@example.com`,
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

function unmatch(callerId: string, matchId: string) {
  return request(app).delete(`/api/v1/matches/${matchId}`).set(authHeader(callerId));
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
    throw new Error('Match was not inserted.');
  }
  return match;
}

async function insertConversation(
  matchId: string,
  status: 'ACTIVE' | 'CLOSED',
  closedAt: Date | null,
  lastMessageAt: Date | null
): Promise<Conversation> {
  return Conversation.create({
    matchId,
    status,
    lastMessageAt,
    closedAt,
    ...timestamps()
  });
}

async function eligibleDiscoveryPair() {
  const suffix = randomUUID();
  const [man, woman, intention] = await Promise.all([
    Gender.create({ code: `man-${suffix}`, name: 'Man', isActive: true }),
    Gender.create({ code: `woman-${suffix}`, name: 'Woman', isActive: true }),
    RelationshipIntention.create({
      code: `lt-${suffix}`,
      name: 'Long-term relationship',
      isActive: true,
      displayOrder: 1,
      ...timestamps()
    })
  ]);
  const viewer = await buildUser({ genderId: man.id, point: ORIGIN });
  const candidate = await buildUser({ genderId: woman.id, point: north(2) });
  await UserDatingPreferenceGender.bulkCreate([
    { userId: viewer.id, genderId: woman.id, createdAt: new Date() },
    { userId: candidate.id, genderId: man.id, createdAt: new Date() }
  ]);
  await UserRelationshipIntention.bulkCreate([
    { userId: viewer.id, relationshipIntentionId: intention.id, createdAt: new Date() },
    { userId: candidate.id, relationshipIntentionId: intention.id, createdAt: new Date() }
  ]);
  await UserDatingPreferenceIntention.bulkCreate([
    { userId: viewer.id, relationshipIntentionId: intention.id, createdAt: new Date() },
    { userId: candidate.id, relationshipIntentionId: intention.id, createdAt: new Date() }
  ]);
  return { viewer, candidate };
}

function discover(userId: string) {
  return request(app).get('/api/v1/discovery').set(authHeader(userId));
}

describe('DELETE /api/v1/matches/:matchId', () => {
  it('rejects a missing token, an invalid token, a deleted account, an admin, a suspended user, and a banned user', async () => {
    const { caller, target } = await pair();
    const match = await insertMatch(caller.id, target.id, 'ACTIVE');

    const missing = await request(app).delete(`/api/v1/matches/${match.id}`);
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('AUTH_REQUIRED');

    const invalid = await request(app)
      .delete(`/api/v1/matches/${match.id}`)
      .set({ Authorization: 'Bearer not-a-token' });
    expect(invalid.status).toBe(401);
    expect(invalid.body.error.code).toBe('INVALID_TOKEN');
    expect(invalid.body.error.message).toBe('Invalid token.');

    const deleted = await User.create({
      email: `deleted-${randomUUID()}@example.com`,
      passwordHash: PASSWORD_HASH,
      role: 'USER',
      status: 'ACTIVE',
      emailVerified: true,
      phoneVerified: false
    });
    await deleted.destroy();
    const deletedResponse = await unmatch(deleted.id, match.id);
    expect(deletedResponse.status).toBe(401);
    expect(deletedResponse.body.error.code).toBe('INVALID_TOKEN');

    const admin = await User.create({
      email: `admin-${randomUUID()}@example.com`,
      passwordHash: PASSWORD_HASH,
      role: 'ADMIN',
      status: 'ACTIVE',
      emailVerified: true,
      phoneVerified: false
    });
    const forbidden = await request(app)
      .delete(`/api/v1/matches/${match.id}`)
      .set(authHeader(admin.id, 'ADMIN'));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
    expect(forbidden.body.error.message).toBe('You do not have permission to perform this action.');

    const suspended = await User.create({
      email: `suspended-${randomUUID()}@example.com`,
      passwordHash: PASSWORD_HASH,
      role: 'USER',
      status: 'SUSPENDED',
      emailVerified: true,
      phoneVerified: false
    });
    const suspendedResponse = await unmatch(suspended.id, match.id);
    expect(suspendedResponse.status).toBe(403);
    expect(suspendedResponse.body.error.code).toBe('ACCOUNT_SUSPENDED');

    const banned = await User.create({
      email: `banned-${randomUUID()}@example.com`,
      passwordHash: PASSWORD_HASH,
      role: 'USER',
      status: 'BANNED',
      emailVerified: true,
      phoneVerified: false
    });
    const bannedResponse = await unmatch(banned.id, match.id);
    expect(bannedResponse.status).toBe(403);
    expect(bannedResponse.body.error.code).toBe('ACCOUNT_BANNED');

    await match.reload();
    expect(match.status).toBe('ACTIVE');
  });

  it('rejects an unverified email caller and an unverified phone caller', async () => {
    const catalogGender = await gender();
    const target = await buildUser({ genderId: catalogGender.id });
    const emailCaller = await buildUser({ genderId: catalogGender.id, emailVerified: false });
    const emailMatch = await insertMatch(emailCaller.id, target.id, 'ACTIVE');
    const emailResponse = await unmatch(emailCaller.id, emailMatch.id);
    expect(emailResponse.status).toBe(403);
    expect(emailResponse.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(emailResponse.body.error.message).toBe('Email verification is required.');

    const phoneCaller = await buildUser({ genderId: catalogGender.id, phoneOnly: true, emailVerified: false });
    const phoneMatch = await insertMatch(phoneCaller.id, target.id, 'ACTIVE');
    const phoneResponse = await unmatch(phoneCaller.id, phoneMatch.id);
    expect(phoneResponse.status).toBe(403);
    expect(phoneResponse.body.error.code).toBe('PHONE_NOT_VERIFIED');
    expect(phoneResponse.body.error.message).toBe('Phone verification is required.');
    expect(await Match.count({ where: { status: 'ACTIVE' } })).toBe(2);
  });

  it('rejects an incomplete caller profile, missing preferences, and a missing location', async () => {
    const catalogGender = await gender();
    const target = await buildUser({ genderId: catalogGender.id });

    const incomplete = await buildUser({ genderId: catalogGender.id, complete: false });
    const incompleteMatch = await insertMatch(incomplete.id, target.id, 'ACTIVE');
    const incompleteResponse = await unmatch(incomplete.id, incompleteMatch.id);
    expect(incompleteResponse.status).toBe(400);
    expect(incompleteResponse.body.error.code).toBe('PROFILE_INCOMPLETE');
    expect(incompleteResponse.body.error.message).toBe('Onboarding is incomplete.');

    const missingPreferences = await buildUser({ genderId: catalogGender.id, preferences: false });
    const preferencesMatch = await insertMatch(missingPreferences.id, target.id, 'ACTIVE');
    const preferencesResponse = await unmatch(missingPreferences.id, preferencesMatch.id);
    expect(preferencesResponse.status).toBe(400);
    expect(preferencesResponse.body.error.code).toBe('PROFILE_INCOMPLETE');

    const missingLocation = await buildUser({ genderId: catalogGender.id, point: null });
    const locationMatch = await insertMatch(missingLocation.id, target.id, 'ACTIVE');
    const locationResponse = await unmatch(missingLocation.id, locationMatch.id);
    expect(locationResponse.status).toBe(400);
    expect(locationResponse.body.error.code).toBe('PROFILE_INCOMPLETE');
    expect(await Match.count({ where: { status: 'ACTIVE' } })).toBe(3);
  });

  it('rejects an invalid match id and an unknown match id', async () => {
    const { caller } = await pair();

    const invalid = await unmatch(caller.id, 'not-a-uuid');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    expect(invalid.body.error.message).toBe('Validation failed');
    expect(invalid.body.error.details).toEqual([
      { field: 'matchId', message: 'Match id must be a valid UUID.' }
    ]);

    const missing = await unmatch(caller.id, randomUUID());
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('MATCH_NOT_FOUND');
    expect(missing.body.error.message).toBe('Active match record does not exist.');
    expect(await Match.count()).toBe(0);
  });

  it('lets either participant unmatch an active match without premium, quota, or credit changes', async () => {
    const { caller, target } = await pair();
    const match = await insertMatch(caller.id, target.id, 'ACTIVE');
    const matchedAt = match.matchedAt.getTime();
    const userOneId = match.userOneId;
    const userTwoId = match.userTwoId;
    const userOne = userOneId === caller.id ? caller : target;
    const userTwo = userTwoId === caller.id ? caller : target;
    const lastMessageAt = new Date('2026-02-01T00:00:00.000Z');
    const conversation = await insertConversation(match.id, 'ACTIVE', null, lastMessageAt);
    const message = await Message.create({
      conversationId: conversation.id,
      senderId: userOne.id,
      messageType: 'TEXT',
      content: 'Still here',
      ...timestamps()
    });
    const callerLike = await Like.create({
      fromUserId: userOne.id,
      toUserId: userTwo.id,
      action: 'LIKE',
      isUndone: false,
      ...timestamps()
    });
    const reciprocalLike = await Like.create({
      fromUserId: userTwo.id,
      toUserId: userOne.id,
      action: 'LIKE',
      isUndone: false,
      ...timestamps()
    });
    await seedUsage(userOne.id, 4);
    await UserCreditBalance.create({
      userId: userOne.id,
      creditType: 'SUPER_LIKE',
      balance: 3,
      ...timestamps()
    });
    await CreditTransaction.create({
      userId: userOne.id,
      creditType: 'SUPER_LIKE',
      delta: -1,
      reason: 'CONSUMPTION',
      createdAt: new Date()
    });

    const response = await unmatch(userOne.id, match.id).set('Idempotency-Key', randomUUID());
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { unmatched: true },
      message: 'Unmatched successfully.'
    });

    await match.reload();
    expect(match.status).toBe('UNMATCHED');
    expect(match.unmatchedAt).toBeInstanceOf(Date);
    expect(match.unmatchedByUserId).toBe(userOne.id);
    expect(match.matchedAt.getTime()).toBe(matchedAt);
    expect(match.userOneId).toBe(userOneId);
    expect(match.userTwoId).toBe(userTwoId);
    expect(await Match.count()).toBe(1);

    await conversation.reload();
    expect(conversation.status).toBe('CLOSED');
    expect(conversation.closedAt).toBeInstanceOf(Date);
    expect(conversation.lastMessageAt?.getTime()).toBe(lastMessageAt.getTime());
    const storedMessage = await Message.findByPk(message.id, { paranoid: false });
    expect(storedMessage?.content).toBe('Still here');
    expect(storedMessage?.deletedAt).toBeNull();
    expect(await Message.count()).toBe(1);

    await callerLike.reload();
    await reciprocalLike.reload();
    expect(callerLike.action).toBe('LIKE');
    expect(callerLike.isUndone).toBe(false);
    expect(reciprocalLike.action).toBe('LIKE');
    expect(reciprocalLike.isUndone).toBe(false);
    expect(await Like.count()).toBe(2);
    expect(await usageCount(userOne.id)).toBe(4);
    expect(await UsageRecord.count()).toBe(1);
    const balance = await UserCreditBalance.findOne({ where: { userId: userOne.id, creditType: 'SUPER_LIKE' } });
    expect(balance?.balance).toBe(3);
    expect(await CreditTransaction.count()).toBe(1);

    const secondPair = await pair();
    const secondMatch = await insertMatch(secondPair.caller.id, secondPair.target.id, 'ACTIVE');
    const secondUserTwoId = secondMatch.userTwoId;
    const secondUserTwo = secondUserTwoId === secondPair.caller.id ? secondPair.caller : secondPair.target;
    const secondUserOne = secondUserTwo.id === secondPair.caller.id ? secondPair.target : secondPair.caller;
    const callerSuperLike = await Like.create({
      fromUserId: secondUserTwo.id,
      toUserId: secondUserOne.id,
      action: 'SUPER_LIKE',
      isUndone: false,
      ...timestamps()
    });
    const reciprocalSuperLike = await Like.create({
      fromUserId: secondUserOne.id,
      toUserId: secondUserTwo.id,
      action: 'SUPER_LIKE',
      isUndone: false,
      ...timestamps()
    });
    const secondResponse = await unmatch(secondUserTwo.id, secondMatch.id);
    expect(secondResponse.status).toBe(200);
    await secondMatch.reload();
    expect(secondMatch.status).toBe('UNMATCHED');
    expect(secondMatch.unmatchedByUserId).toBe(secondUserTwo.id);
    await callerSuperLike.reload();
    await reciprocalSuperLike.reload();
    expect(callerSuperLike.action).toBe('SUPER_LIKE');
    expect(callerSuperLike.isUndone).toBe(false);
    expect(reciprocalSuperLike.action).toBe('SUPER_LIKE');
    expect(reciprocalSuperLike.isUndone).toBe(false);
  });

  it('rejects a third user and leaves the foreign match active', async () => {
    const { caller, target, genderId } = await pair();
    const outsider = await buildUser({ genderId, point: north(3) });
    const match = await insertMatch(caller.id, target.id, 'ACTIVE');
    const conversation = await insertConversation(match.id, 'ACTIVE', null, null);

    const response = await unmatch(outsider.id, match.id);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('MATCH_NOT_FOUND');
    expect(response.body.error.message).toBe('Active match record does not exist.');
    await match.reload();
    expect(match.status).toBe('ACTIVE');
    expect(match.unmatchedAt).toBeNull();
    expect(match.unmatchedByUserId).toBeNull();
    await conversation.reload();
    expect(conversation.status).toBe('ACTIVE');
    expect(conversation.closedAt).toBeNull();
  });

  it('rejects an undone match and an already unmatched match without changing historical rows', async () => {
    const { caller, target } = await pair();
    const active = await insertMatch(caller.id, target.id, 'ACTIVE');
    const historicalUnmatched = await insertMatch(caller.id, target.id, 'UNMATCHED');
    const historicalUndone = await insertMatch(caller.id, target.id, 'UNDONE');
    const unmatchedAt = historicalUnmatched.unmatchedAt?.getTime();
    const unmatchedBy = historicalUnmatched.unmatchedByUserId;

    const undoneResponse = await unmatch(caller.id, historicalUndone.id);
    expect(undoneResponse.status).toBe(404);
    expect(undoneResponse.body.error.code).toBe('MATCH_NOT_FOUND');
    await historicalUndone.reload();
    expect(historicalUndone.status).toBe('UNDONE');
    expect(historicalUndone.unmatchedAt).toBeNull();
    expect(historicalUndone.unmatchedByUserId).toBeNull();

    const unmatchedResponse = await unmatch(caller.id, historicalUnmatched.id);
    expect(unmatchedResponse.status).toBe(404);
    await historicalUnmatched.reload();
    expect(historicalUnmatched.status).toBe('UNMATCHED');
    expect(historicalUnmatched.unmatchedAt?.getTime()).toBe(unmatchedAt);
    expect(historicalUnmatched.unmatchedByUserId).toBe(unmatchedBy);

    const response = await unmatch(caller.id, active.id);
    expect(response.status).toBe(200);
    await active.reload();
    expect(active.status).toBe('UNMATCHED');
    expect(active.unmatchedByUserId).toBe(caller.id);
    await historicalUnmatched.reload();
    await historicalUndone.reload();
    expect(historicalUnmatched.unmatchedByUserId).toBe(unmatchedBy);
    expect(historicalUndone.status).toBe('UNDONE');
    expect(historicalUndone.unmatchedAt).toBeNull();
  });

  it('closes an active conversation, leaves an already closed conversation unchanged, and succeeds when no conversation exists', async () => {
    const { caller, target } = await pair();
    const closedAt = new Date('2026-03-01T00:00:00.000Z');
    const lastMessageAt = new Date('2026-02-15T00:00:00.000Z');
    const alreadyClosedMatch = await insertMatch(caller.id, target.id, 'ACTIVE');
    const alreadyClosed = await insertConversation(alreadyClosedMatch.id, 'CLOSED', closedAt, lastMessageAt);
    const closedResponse = await unmatch(caller.id, alreadyClosedMatch.id);
    expect(closedResponse.status).toBe(200);
    await alreadyClosed.reload();
    expect(alreadyClosed.status).toBe('CLOSED');
    expect(alreadyClosed.closedAt?.getTime()).toBe(closedAt.getTime());
    expect(alreadyClosed.lastMessageAt?.getTime()).toBe(lastMessageAt.getTime());

    const { caller: otherCaller, target: otherTarget } = await pair();
    const bareMatch = await insertMatch(otherCaller.id, otherTarget.id, 'ACTIVE');
    const bareResponse = await unmatch(otherCaller.id, bareMatch.id);
    expect(bareResponse.status).toBe(200);
    expect(await Conversation.count({ where: { matchId: bareMatch.id } })).toBe(0);
    await bareMatch.reload();
    expect(bareMatch.status).toBe('UNMATCHED');
  });

  it('returns not found on a second unmatch and does not replay success', async () => {
    const { caller, target } = await pair();
    const match = await insertMatch(caller.id, target.id, 'ACTIVE');
    await insertConversation(match.id, 'ACTIVE', null, null);

    const first = await unmatch(caller.id, match.id);
    expect(first.status).toBe(200);
    const second = await unmatch(target.id, match.id).set('Idempotency-Key', randomUUID());
    expect(second.status).toBe(404);
    expect(second.body.error.code).toBe('MATCH_NOT_FOUND');
    expect(await Match.count({ where: { status: 'UNMATCHED' } })).toBe(1);
    expect(await Conversation.count({ where: { matchId: match.id, status: 'CLOSED' } })).toBe(1);
  });

  it('lets one of two simultaneous unmatch requests win', async () => {
    const { caller, target } = await pair();
    const match = await insertMatch(caller.id, target.id, 'ACTIVE');
    await insertConversation(match.id, 'ACTIVE', null, null);

    const [first, second] = await Promise.all([unmatch(caller.id, match.id), unmatch(target.id, match.id)]);
    const statuses = [first.status, second.status].sort((left, right) => left - right);
    expect(statuses).toEqual([200, 404]);
    const failure = first.status === 404 ? first : second;
    expect(failure.body.error.code).toBe('MATCH_NOT_FOUND');

    await match.reload();
    expect(match.status).toBe('UNMATCHED');
    expect([caller.id, target.id]).toContain(match.unmatchedByUserId);
    const winner = first.status === 200 ? caller : target;
    expect(match.unmatchedByUserId).toBe(winner.id);
    expect(await Match.count({ where: { id: match.id, status: 'UNMATCHED' } })).toBe(1);
    expect(await Conversation.count({ where: { matchId: match.id, status: 'CLOSED' } })).toBe(1);
  });

  it('allows a later active match row after the old row is unmatched', async () => {
    const { caller, target } = await pair();
    const original = await insertMatch(caller.id, target.id, 'ACTIVE');
    const originalConversation = await insertConversation(original.id, 'ACTIVE', null, null);
    const response = await unmatch(caller.id, original.id);
    expect(response.status).toBe(200);

    const later = await insertMatch(caller.id, target.id, 'ACTIVE');
    const laterConversation = await insertConversation(later.id, 'ACTIVE', null, null);
    expect(later.id).not.toBe(original.id);

    await original.reload();
    await originalConversation.reload();
    expect(original.status).toBe('UNMATCHED');
    expect(originalConversation.status).toBe('CLOSED');
    expect(later.status).toBe('ACTIVE');
    expect(laterConversation.status).toBe('ACTIVE');
    expect(await Match.count({ where: { status: 'ACTIVE' } })).toBe(1);
    expect(await Match.count({ where: { status: 'UNMATCHED' } })).toBe(1);
  });

  it('keeps an active outgoing like excluding discovery after unmatch', async () => {
    const { viewer, candidate } = await eligibleDiscoveryPair();
    const match = await insertMatch(viewer.id, candidate.id, 'ACTIVE');
    await Like.create({
      fromUserId: viewer.id,
      toUserId: candidate.id,
      action: 'LIKE',
      isUndone: false,
      ...timestamps()
    });

    const response = await unmatch(viewer.id, match.id);
    expect(response.status).toBe(200);
    const discovered = await discover(viewer.id);
    expect(discovered.status).toBe(200);
    expect(discovered.body.data.candidate).toBeNull();
    const likeRow = await Like.findOne({ where: { fromUserId: viewer.id, toUserId: candidate.id } });
    expect(likeRow?.isUndone).toBe(false);
  });

  it('does not let a historical unmatched match exclude an eligible candidate', async () => {
    const { viewer, candidate } = await eligibleDiscoveryPair();
    await insertMatch(viewer.id, candidate.id, 'UNMATCHED');

    const discovered = await discover(viewer.id);
    expect(discovered.status).toBe(200);
    expect(discovered.body.data.candidate.id).toBe(candidate.id);
    expect(await Like.count()).toBe(0);
  });
});
