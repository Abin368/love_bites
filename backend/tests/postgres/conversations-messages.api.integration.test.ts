import { randomUUID } from 'crypto';
import request from 'supertest';
import { literal, QueryTypes } from 'sequelize';
import { sequelize } from '../../src/config/database';
import { Block } from '../../src/database/models/block.model';
import { Conversation } from '../../src/database/models/conversation.model';
import { DatingPreference } from '../../src/database/models/dating-preference.model';
import { Gender } from '../../src/database/models/gender.model';
import { Like } from '../../src/database/models/like.model';
import { Match } from '../../src/database/models/match.model';
import { Message } from '../../src/database/models/message.model';
import { Plan } from '../../src/database/models/plan.model';
import { Profile } from '../../src/database/models/profile.model';
import { ProfilePhoto } from '../../src/database/models/profile-photo.model';
import { Subscription } from '../../src/database/models/subscription.model';
import { UsageRecord } from '../../src/database/models/usage-record.model';
import { User, UserStatus } from '../../src/database/models/user.model';
import {
  currentUtcDayWindow,
  DAILY_TEXT_MESSAGES_METRIC
} from '../../src/modules/likes/likes.data-access';
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
const DAILY_TEXT_LIMIT_MESSAGE = 'You have reached your daily limit of 20 text messages.';

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
  return Gender.create({ code: `chat-${randomUUID()}`, name: 'Woman', isActive: true });
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
    email: input.phoneOnly ? null : `chat-${randomUUID()}@example.com`,
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

async function activeThread() {
  const { caller, target, genderId } = await pair();
  const match = await insertMatch(caller.id, target.id, 'ACTIVE');
  const conversation = await insertConversation(match.id, 'ACTIVE', null, null);
  return { caller, target, genderId, match, conversation };
}

function sendMessage(callerId: string, conversationId: string, body: unknown = { messageType: 'TEXT', content: 'Hello' }) {
  return request(app)
    .post(`/api/v1/conversations/${conversationId}/messages`)
    .set(authHeader(callerId))
    .send(body);
}

async function grantPremium(userId: string): Promise<void> {
  let plan = await Plan.findOne({ where: { code: 'PREMIUM_MONTHLY' } });
  if (!plan) {
    plan = await Plan.create({
      code: 'PREMIUM_MONTHLY',
      name: 'Love Bite Premium (Monthly)',
      billingInterval: 'MONTH',
      priceInCents: 49900,
      currency: 'INR',
      isActive: true,
      displayOrder: 1,
      ...timestamps()
    });
  }
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

async function textMessageUsageCount(userId: string): Promise<number> {
  const { periodStart } = currentUtcDayWindow();
  const row = await UsageRecord.findOne({
    where: { userId, metricKey: DAILY_TEXT_MESSAGES_METRIC, periodStart }
  });
  return row?.usageCount ?? 0;
}

async function seedTextUsage(userId: string, count: number, period?: { periodStart: Date; periodEnd: Date }): Promise<void> {
  const window = period ?? currentUtcDayWindow();
  await UsageRecord.create({
    userId,
    metricKey: DAILY_TEXT_MESSAGES_METRIC,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    usageCount: count,
    ...timestamps()
  });
}

async function textMessageUsageRowCount(): Promise<number> {
  return UsageRecord.count({ where: { metricKey: DAILY_TEXT_MESSAGES_METRIC } });
}

describe('POST /api/v1/conversations/:conversationId/messages', () => {
  it('lets either participant send a TEXT message and updates last_message_at', async () => {
    const { caller, target, conversation } = await activeThread();

    const first = await sendMessage(caller.id, conversation.id, {
      messageType: 'TEXT',
      content: 'Hello from caller'
    });
    expect(first.status).toBe(201);
    expect(first.body.success).toBe(true);
    expect(first.body.message).toBe('Message sent.');
    expect(first.body.data).toEqual({
      id: first.body.data.id,
      conversationId: conversation.id,
      senderId: caller.id,
      messageType: 'TEXT',
      content: 'Hello from caller',
      mediaUrl: null,
      readAt: null,
      createdAt: first.body.data.createdAt,
      remainingDailyMessages: 19
    });
    expect(await textMessageUsageCount(caller.id)).toBe(1);

    const stored = await Message.findByPk(first.body.data.id);
    expect(stored).not.toBeNull();
    expect(stored?.conversationId).toBe(conversation.id);
    expect(stored?.senderId).toBe(caller.id);
    expect(stored?.messageType).toBe('TEXT');
    expect(stored?.content).toBe('Hello from caller');
    expect(stored?.mediaStorageKey).toBeNull();
    expect(stored?.mediaMimeType).toBeNull();
    expect(stored?.mediaFileSize).toBeNull();
    expect(stored?.readAt).toBeNull();
    expect(stored?.deletedAt).toBeNull();

    await conversation.reload();
    expect(conversation.lastMessageAt?.toISOString()).toBe(stored?.createdAt.toISOString());
    expect(conversation.status).toBe('ACTIVE');
    expect(conversation.closedAt).toBeNull();

    const second = await sendMessage(target.id, conversation.id, {
      messageType: 'TEXT',
      content: 'Hello back'
    });
    expect(second.status).toBe(201);
    expect(second.body.data.senderId).toBe(target.id);
    expect(second.body.data.content).toBe('Hello back');
    expect(second.body.data.remainingDailyMessages).toBe(19);
    expect(await textMessageUsageCount(target.id)).toBe(1);
    expect(await textMessageUsageCount(caller.id)).toBe(1);
    expect(await Message.count()).toBe(2);
  });

  it('accepts empty and whitespace-only content without trimming', async () => {
    const { caller, conversation } = await activeThread();

    const empty = await sendMessage(caller.id, conversation.id, { messageType: 'TEXT', content: '' });
    expect(empty.status).toBe(201);
    expect(empty.body.data.content).toBe('');
    expect(empty.body.data.remainingDailyMessages).toBe(19);
    const emptyRow = await Message.findByPk(empty.body.data.id);
    expect(emptyRow?.content).toBe('');

    const whitespace = await sendMessage(caller.id, conversation.id, {
      messageType: 'TEXT',
      content: '  hello  '
    });
    expect(whitespace.status).toBe(201);
    expect(whitespace.body.data.content).toBe('  hello  ');
    expect(whitespace.body.data.remainingDailyMessages).toBe(18);
    const whitespaceRow = await Message.findByPk(whitespace.body.data.id);
    expect(whitespaceRow?.content).toBe('  hello  ');

    const spacesOnly = await sendMessage(caller.id, conversation.id, {
      messageType: 'TEXT',
      content: '   '
    });
    expect(spacesOnly.status).toBe(201);
    expect(spacesOnly.body.data.content).toBe('   ');
    expect(spacesOnly.body.data.remainingDailyMessages).toBe(17);
    expect(await textMessageUsageCount(caller.id)).toBe(3);
  });

  it('rejects a missing token, an invalid token, a deleted account, an admin, a suspended user, and a banned user', async () => {
    const { caller, conversation } = await activeThread();

    const missing = await request(app)
      .post(`/api/v1/conversations/${conversation.id}/messages`)
      .send({ messageType: 'TEXT', content: 'Hello' });
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('AUTH_REQUIRED');

    const invalid = await request(app)
      .post(`/api/v1/conversations/${conversation.id}/messages`)
      .set({ Authorization: 'Bearer not-a-token' })
      .send({ messageType: 'TEXT', content: 'Hello' });
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
    const deletedResponse = await sendMessage(deleted.id, conversation.id);
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
      .post(`/api/v1/conversations/${conversation.id}/messages`)
      .set(authHeader(admin.id, 'ADMIN'))
      .send({ messageType: 'TEXT', content: 'Hello' });
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
    const suspendedResponse = await sendMessage(suspended.id, conversation.id);
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
    const bannedResponse = await sendMessage(banned.id, conversation.id);
    expect(bannedResponse.status).toBe(403);
    expect(bannedResponse.body.error.code).toBe('ACCOUNT_BANNED');

    expect(await Message.count()).toBe(0);
    await conversation.reload();
    expect(conversation.lastMessageAt).toBeNull();
    expect(await textMessageUsageRowCount()).toBe(0);
  });

  it('rejects an unverified email caller and an unverified phone caller', async () => {
    const catalogGender = await gender();
    const target = await buildUser({ genderId: catalogGender.id });
    const emailCaller = await buildUser({ genderId: catalogGender.id, emailVerified: false });
    const emailMatch = await insertMatch(emailCaller.id, target.id, 'ACTIVE');
    const emailConversation = await insertConversation(emailMatch.id, 'ACTIVE', null, null);
    const emailResponse = await sendMessage(emailCaller.id, emailConversation.id);
    expect(emailResponse.status).toBe(403);
    expect(emailResponse.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(emailResponse.body.error.message).toBe('Email verification is required.');
    expect(await textMessageUsageCount(emailCaller.id)).toBe(0);

    const phoneCaller = await buildUser({ genderId: catalogGender.id, phoneOnly: true, emailVerified: false });
    const phoneMatch = await insertMatch(phoneCaller.id, target.id, 'ACTIVE');
    const phoneConversation = await insertConversation(phoneMatch.id, 'ACTIVE', null, null);
    const phoneResponse = await sendMessage(phoneCaller.id, phoneConversation.id);
    expect(phoneResponse.status).toBe(403);
    expect(phoneResponse.body.error.code).toBe('PHONE_NOT_VERIFIED');
    expect(phoneResponse.body.error.message).toBe('Phone verification is required.');
    expect(await Message.count()).toBe(0);
    expect(await textMessageUsageCount(phoneCaller.id)).toBe(0);
  });

  it('rejects an incomplete caller profile, missing preferences, and a missing location', async () => {
    const catalogGender = await gender();
    const target = await buildUser({ genderId: catalogGender.id });

    const incomplete = await buildUser({ genderId: catalogGender.id, complete: false });
    const incompleteMatch = await insertMatch(incomplete.id, target.id, 'ACTIVE');
    const incompleteConversation = await insertConversation(incompleteMatch.id, 'ACTIVE', null, null);
    const incompleteResponse = await sendMessage(incomplete.id, incompleteConversation.id);
    expect(incompleteResponse.status).toBe(400);
    expect(incompleteResponse.body.error.code).toBe('PROFILE_INCOMPLETE');
    expect(incompleteResponse.body.error.message).toBe('Onboarding is incomplete.');
    expect(await textMessageUsageCount(incomplete.id)).toBe(0);

    const missingPreferences = await buildUser({ genderId: catalogGender.id, preferences: false });
    const preferencesMatch = await insertMatch(missingPreferences.id, target.id, 'ACTIVE');
    const preferencesConversation = await insertConversation(preferencesMatch.id, 'ACTIVE', null, null);
    const preferencesResponse = await sendMessage(missingPreferences.id, preferencesConversation.id);
    expect(preferencesResponse.status).toBe(400);
    expect(preferencesResponse.body.error.code).toBe('PROFILE_INCOMPLETE');
    expect(await textMessageUsageCount(missingPreferences.id)).toBe(0);

    const missingLocation = await buildUser({ genderId: catalogGender.id, point: null });
    const locationMatch = await insertMatch(missingLocation.id, target.id, 'ACTIVE');
    const locationConversation = await insertConversation(locationMatch.id, 'ACTIVE', null, null);
    const locationResponse = await sendMessage(missingLocation.id, locationConversation.id);
    expect(locationResponse.status).toBe(400);
    expect(locationResponse.body.error.code).toBe('PROFILE_INCOMPLETE');
    expect(await Message.count()).toBe(0);
    expect(await textMessageUsageCount(missingLocation.id)).toBe(0);
  });

  it('rejects an invalid conversation id and an unknown conversation with the same not-found response', async () => {
    const { caller } = await pair();

    const invalid = await sendMessage(caller.id, 'not-a-uuid');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    expect(invalid.body.error.message).toBe('Validation failed');
    expect(invalid.body.error.details).toEqual([
      { field: 'conversationId', message: 'Conversation id must be a valid UUID.' }
    ]);

    const missing = await sendMessage(caller.id, randomUUID());
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(missing.body.error.message).toBe('Resource not found');
    expect(await Message.count()).toBe(0);
    expect(await textMessageUsageCount(caller.id)).toBe(0);
  });

  it('rejects a non-participant without revealing the conversation exists', async () => {
    const { caller, target, genderId, conversation } = await activeThread();
    const outsider = await buildUser({ genderId, point: north(3) });

    const response = await sendMessage(outsider.id, conversation.id);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(response.body.error.message).toBe('Resource not found');
    expect(await Message.count()).toBe(0);
    expect(await textMessageUsageCount(outsider.id)).toBe(0);
    await conversation.reload();
    expect(conversation.lastMessageAt).toBeNull();
    expect(conversation.status).toBe('ACTIVE');
    void caller;
    void target;
  });

  it('returns CONVERSATION_CLOSED after UNMATCH and after UNDO', async () => {
    const { caller, target, match, conversation } = await activeThread();

    const unmatchResponse = await request(app)
      .delete(`/api/v1/matches/${match.id}`)
      .set(authHeader(caller.id));
    expect(unmatchResponse.status).toBe(200);

    const afterUnmatch = await sendMessage(caller.id, conversation.id);
    expect(afterUnmatch.status).toBe(404);
    expect(afterUnmatch.body.error.code).toBe('CONVERSATION_CLOSED');
    expect(afterUnmatch.body.error.message).toBe('Conversation is closed due to unmatch or safety block.');
    expect(await Message.count()).toBe(0);
    expect(await textMessageUsageCount(caller.id)).toBe(0);

    const second = await pair();
    await grantPremium(second.caller.id);
    const secondMatch = await insertMatch(second.caller.id, second.target.id, 'ACTIVE');
    const secondConversation = await insertConversation(secondMatch.id, 'ACTIVE', null, null);
    await Like.create({
      fromUserId: second.caller.id,
      toUserId: second.target.id,
      action: 'LIKE',
      isUndone: false,
      ...timestamps()
    });
    await Like.create({
      fromUserId: second.target.id,
      toUserId: second.caller.id,
      action: 'LIKE',
      isUndone: false,
      ...timestamps()
    });

    const undoResponse = await request(app).post('/api/v1/discovery/undo').set(authHeader(second.caller.id));
    expect(undoResponse.status).toBe(200);
    expect(undoResponse.body.data.revertedMatch).toBe(true);

    const afterUndo = await sendMessage(second.caller.id, secondConversation.id);
    expect(afterUndo.status).toBe(404);
    expect(afterUndo.body.error.code).toBe('CONVERSATION_CLOSED');
    expect(afterUndo.body.error.message).toBe('Conversation is closed due to unmatch or safety block.');
    expect(await Message.count()).toBe(0);
    expect(await textMessageUsageCount(second.caller.id)).toBe(0);
    void target;
  });

  it('uses generic not-found for an active conversation with an inactive match', async () => {
    const { caller, target } = await pair();
    const match = await insertMatch(caller.id, target.id, 'UNMATCHED');
    const conversation = await insertConversation(match.id, 'ACTIVE', null, null);

    const response = await sendMessage(caller.id, conversation.id);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(response.body.error.message).toBe('Resource not found');
    expect(await Message.count()).toBe(0);
    expect(await textMessageUsageCount(caller.id)).toBe(0);
  });

  it('rejects blocks in either direction', async () => {
    const first = await activeThread();
    await Block.create({
      blockerId: first.caller.id,
      blockedId: first.target.id,
      reason: null,
      createdAt: new Date()
    });
    const callerBlocked = await sendMessage(first.caller.id, first.conversation.id);
    expect(callerBlocked.status).toBe(409);
    expect(callerBlocked.body.error.code).toBe('BLOCKED_USER');
    expect(callerBlocked.body.error.message).toBe('Interaction prohibited due to an active safety block.');
    expect(await textMessageUsageCount(first.caller.id)).toBe(0);

    const second = await activeThread();
    await Block.create({
      blockerId: second.target.id,
      blockedId: second.caller.id,
      reason: null,
      createdAt: new Date()
    });
    const recipientBlocked = await sendMessage(second.caller.id, second.conversation.id);
    expect(recipientBlocked.status).toBe(409);
    expect(recipientBlocked.body.error.code).toBe('BLOCKED_USER');
    expect(recipientBlocked.body.error.message).toBe('Interaction prohibited due to an active safety block.');
    expect(await Message.count()).toBe(0);
    expect(await textMessageUsageCount(second.caller.id)).toBe(0);
  });

  it('rejects invalid bodies and malformed JSON without writing messages', async () => {
    const { caller, conversation } = await activeThread();
    const priorLastMessageAt = conversation.lastMessageAt;

    const missingType = await sendMessage(caller.id, conversation.id, { content: 'Hello' });
    expect(missingType.status).toBe(400);
    expect(missingType.body.error.code).toBe('VALIDATION_ERROR');

    const invalidType = await sendMessage(caller.id, conversation.id, {
      messageType: 'IMAGE',
      content: 'Hello'
    });
    expect(invalidType.status).toBe(400);
    expect(invalidType.body.error.code).toBe('VALIDATION_ERROR');

    const lowercase = await sendMessage(caller.id, conversation.id, {
      messageType: 'text',
      content: 'Hello'
    });
    expect(lowercase.status).toBe(400);
    expect(lowercase.body.error.code).toBe('VALIDATION_ERROR');

    const missingContent = await sendMessage(caller.id, conversation.id, { messageType: 'TEXT' });
    expect(missingContent.status).toBe(400);
    expect(missingContent.body.error.code).toBe('VALIDATION_ERROR');

    const nonString = await sendMessage(caller.id, conversation.id, {
      messageType: 'TEXT',
      content: 12
    });
    expect(nonString.status).toBe(400);
    expect(nonString.body.error.code).toBe('VALIDATION_ERROR');

    const extra = await sendMessage(caller.id, conversation.id, {
      messageType: 'TEXT',
      content: 'Hello',
      senderId: caller.id
    });
    expect(extra.status).toBe(400);
    expect(extra.body.error.code).toBe('VALIDATION_ERROR');

    const malformed = await request(app)
      .post(`/api/v1/conversations/${conversation.id}/messages`)
      .set(authHeader(caller.id))
      .set('Content-Type', 'application/json')
      .send('{not-json');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
    expect(malformed.body.error.message).toBe('Invalid JSON payload structure');

    expect(await Message.count()).toBe(0);
    await conversation.reload();
    expect(conversation.lastMessageAt).toEqual(priorLastMessageAt);
    expect(await textMessageUsageCount(caller.id)).toBe(0);
  });

  it('lets one concurrent send and unmatch race settle without inserting after close', async () => {
    const { caller, target, match, conversation } = await activeThread();

    const [sendResult, unmatchResult] = await Promise.all([
      sendMessage(caller.id, conversation.id, { messageType: 'TEXT', content: 'Race hello' }),
      request(app).delete(`/api/v1/matches/${match.id}`).set(authHeader(target.id))
    ]);

    expect(unmatchResult.status).toBe(200);
    await match.reload();
    expect(match.status).toBe('UNMATCHED');
    await conversation.reload();
    expect(conversation.status).toBe('CLOSED');

    if (sendResult.status === 201) {
      expect(await Message.count()).toBe(1);
      expect(sendResult.body.data.content).toBe('Race hello');
      expect(conversation.lastMessageAt).toBeInstanceOf(Date);
    } else {
      expect(sendResult.status).toBe(404);
      expect(sendResult.body.error.code).toBe('CONVERSATION_CLOSED');
      expect(await Message.count()).toBe(0);
    }
  });

  it('lets one concurrent send and undo race settle without inserting after close', async () => {
    const { caller, target, match, conversation } = await activeThread();
    await grantPremium(caller.id);
    await Like.create({
      fromUserId: caller.id,
      toUserId: target.id,
      action: 'LIKE',
      isUndone: false,
      ...timestamps()
    });
    await Like.create({
      fromUserId: target.id,
      toUserId: caller.id,
      action: 'LIKE',
      isUndone: false,
      ...timestamps()
    });

    const [sendResult, undoResult] = await Promise.all([
      sendMessage(caller.id, conversation.id, { messageType: 'TEXT', content: 'Undo race' }),
      request(app).post('/api/v1/discovery/undo').set(authHeader(caller.id))
    ]);

    expect(undoResult.status).toBe(200);
    await match.reload();
    expect(match.status).toBe('UNDONE');
    await conversation.reload();
    expect(conversation.status).toBe('CLOSED');

    if (sendResult.status === 201) {
      expect(await Message.count()).toBe(1);
      expect(sendResult.body.data.content).toBe('Undo race');
    } else {
      expect(sendResult.status).toBe(404);
      expect(sendResult.body.error.code).toBe('CONVERSATION_CLOSED');
      expect(await Message.count()).toBe(0);
    }
  });

  it('allows two concurrent valid sends to the same active conversation', async () => {
    const { caller, target, conversation } = await activeThread();

    const [first, second] = await Promise.all([
      sendMessage(caller.id, conversation.id, { messageType: 'TEXT', content: 'One' }),
      sendMessage(target.id, conversation.id, { messageType: 'TEXT', content: 'Two' })
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await Message.count()).toBe(2);
    await conversation.reload();
    expect(conversation.status).toBe('ACTIVE');
    expect(conversation.lastMessageAt).toBeInstanceOf(Date);

    const contents = [first.body.data.content, second.body.data.content].sort();
    expect(contents).toEqual(['One', 'Two']);
    expect(first.body.data.remainingDailyMessages).toBe(19);
    expect(second.body.data.remainingDailyMessages).toBe(19);
    expect(await textMessageUsageCount(caller.id)).toBe(1);
    expect(await textMessageUsageCount(target.id)).toBe(1);
  });

  it('decrements remainingDailyMessages across multiple free sends', async () => {
    const { caller, conversation } = await activeThread();

    const first = await sendMessage(caller.id, conversation.id, { messageType: 'TEXT', content: 'one' });
    expect(first.status).toBe(201);
    expect(first.body.data.remainingDailyMessages).toBe(19);
    expect(await textMessageUsageCount(caller.id)).toBe(1);

    const second = await sendMessage(caller.id, conversation.id, { messageType: 'TEXT', content: 'two' });
    expect(second.status).toBe(201);
    expect(second.body.data.remainingDailyMessages).toBe(18);

    const third = await sendMessage(caller.id, conversation.id, { messageType: 'TEXT', content: 'three' });
    expect(third.status).toBe(201);
    expect(third.body.data.remainingDailyMessages).toBe(17);
    expect(await textMessageUsageCount(caller.id)).toBe(3);
    expect(await Message.count()).toBe(3);
  });

  it('allows the 20th free message and rejects the 21st without writing', async () => {
    const { caller, conversation } = await activeThread();
    await seedTextUsage(caller.id, 19);

    const twentieth = await sendMessage(caller.id, conversation.id, {
      messageType: 'TEXT',
      content: 'twentieth'
    });
    expect(twentieth.status).toBe(201);
    expect(twentieth.body.data.remainingDailyMessages).toBe(0);
    expect(await textMessageUsageCount(caller.id)).toBe(20);

    await conversation.reload();
    const lastMessageAt = conversation.lastMessageAt;
    const beforeCount = await Message.count();

    const twentyFirst = await sendMessage(caller.id, conversation.id, {
      messageType: 'TEXT',
      content: 'twenty-first'
    });
    expect(twentyFirst.status).toBe(429);
    expect(twentyFirst.body.error.code).toBe('DAILY_LIMIT_REACHED');
    expect(twentyFirst.body.error.message).toBe(DAILY_TEXT_LIMIT_MESSAGE);
    expect(twentyFirst.body.error).not.toHaveProperty('remainingDailyMessages');
    expect(twentyFirst.body.data).toBeUndefined();
    expect(await Message.count()).toBe(beforeCount);
    expect(await textMessageUsageCount(caller.id)).toBe(20);
    await conversation.reload();
    expect(conversation.lastMessageAt?.toISOString()).toBe(lastMessageAt?.toISOString());
  });

  it('lets premium callers bypass the free text quota and leave remainingDailyMessages null', async () => {
    const { caller, conversation } = await activeThread();
    await grantPremium(caller.id);
    await seedTextUsage(caller.id, 20);

    const response = await sendMessage(caller.id, conversation.id, {
      messageType: 'TEXT',
      content: 'premium hello'
    });
    expect(response.status).toBe(201);
    expect(response.body.data.remainingDailyMessages).toBeNull();
    expect(response.body.data.content).toBe('premium hello');
    expect(await textMessageUsageCount(caller.id)).toBe(20);
    expect(await Message.count()).toBe(1);

    const second = await activeThread();
    await grantPremium(second.caller.id);
    const withoutUsage = await sendMessage(second.caller.id, second.conversation.id, {
      messageType: 'TEXT',
      content: 'no usage row'
    });
    expect(withoutUsage.status).toBe(201);
    expect(withoutUsage.body.data.remainingDailyMessages).toBeNull();
    expect(await textMessageUsageCount(second.caller.id)).toBe(0);
  });

  it('rolls back quota when message insert fails after consumption', async () => {
    const { caller, conversation } = await activeThread();
    Message.addHook('beforeCreate', 'force-text-message-failure', () => {
      throw new Error('forced message failure');
    });

    try {
      const response = await sendMessage(caller.id, conversation.id, {
        messageType: 'TEXT',
        content: 'should roll back'
      });
      expect(response.status).toBe(500);
    } finally {
      Message.removeHook('beforeCreate', 'force-text-message-failure');
    }

    expect(await Message.count()).toBe(0);
    expect(await textMessageUsageCount(caller.id)).toBe(0);
    await conversation.reload();
    expect(conversation.lastMessageAt).toBeNull();
  });

  it('ignores a previous UTC day usage row for the current free quota', async () => {
    const { caller, conversation } = await activeThread();
    const today = currentUtcDayWindow();
    const previousStart = new Date(today.periodStart.getTime() - 24 * 60 * 60 * 1000);
    const previousEnd = new Date(today.periodStart.getTime());
    await seedTextUsage(caller.id, 20, { periodStart: previousStart, periodEnd: previousEnd });

    const response = await sendMessage(caller.id, conversation.id, {
      messageType: 'TEXT',
      content: 'new day'
    });
    expect(response.status).toBe(201);
    expect(response.body.data.remainingDailyMessages).toBe(19);
    expect(await textMessageUsageCount(caller.id)).toBe(1);

    const rows = await UsageRecord.findAll({
      where: { userId: caller.id, metricKey: DAILY_TEXT_MESSAGES_METRIC },
      order: [['periodStart', 'ASC']]
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].usageCount).toBe(20);
    expect(rows[1].usageCount).toBe(1);
    expect(rows[1].periodStart.toISOString()).toBe(today.periodStart.toISOString());
  });

  it('allows only one of two concurrent free sends once nineteen messages are already used', async () => {
    const { caller, conversation } = await activeThread();
    await seedTextUsage(caller.id, 19);

    const [first, second] = await Promise.all([
      sendMessage(caller.id, conversation.id, { messageType: 'TEXT', content: 'slot-a' }),
      sendMessage(caller.id, conversation.id, { messageType: 'TEXT', content: 'slot-b' })
    ]);

    const statuses = [first.status, second.status].sort((left, right) => left - right);
    expect(statuses).toEqual([201, 429]);
    expect(await textMessageUsageCount(caller.id)).toBe(20);
    expect(await Message.count()).toBe(1);

    const success = first.status === 201 ? first : second;
    const failure = first.status === 429 ? first : second;
    expect(success.body.data.remainingDailyMessages).toBe(0);
    expect(failure.body.error.code).toBe('DAILY_LIMIT_REACHED');
    expect(failure.body.error.message).toBe(DAILY_TEXT_LIMIT_MESSAGE);
  });
});
