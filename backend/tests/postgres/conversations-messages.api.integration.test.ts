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
import { CreditTransaction } from '../../src/database/models/credit-transaction.model';
import { UsageRecord } from '../../src/database/models/usage-record.model';
import { UserCreditBalance } from '../../src/database/models/user-credit-balance.model';
import { User, UserStatus } from '../../src/database/models/user.model';
import { encodeHistoryCursor, encodeInboxCursor } from '../../src/modules/chat/chat.validator';
import type { Server } from 'socket.io';
import {
  currentUtcDayWindow,
  DAILY_TEXT_MESSAGES_METRIC
} from '../../src/modules/likes/likes.data-access';
import { signAccessToken } from '../../src/utils/jwt';
import { StorageObjectMissingError } from '../../src/integrations/storage/storage.interface';
import { InternalServerError } from '../../src/utils/errors';
import { redis, resetMemoryRedis } from '../helpers/memory-redis';

const mockPhotoStorage = {
  createUploadUrl: jest.fn(),
  createDownloadUrl: jest.fn(async () => ({
    url: 'https://download.test/signed',
    expiresInSeconds: 3600
  })),
  headObject: jest.fn()
};

jest.mock('../../src/integrations/storage/s3.provider', () => ({
  photoStorage: mockPhotoStorage
}));
jest.mock('../../src/config/redis', () => jest.requireActual('../helpers/memory-redis'));

import { forgetSocketServer, rememberSocketServer } from '../../src/socket/socket.server';
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
  lastMessageAt: Date | null,
  id?: string
): Promise<Conversation> {
  const conversation = await Conversation.create({
    ...(id ? { id } : {}),
    matchId,
    status,
    lastMessageAt,
    closedAt,
    ...timestamps()
  });
  await sequelize.query(
    `UPDATE conversations
     SET last_message_at = :lastMessageAt
     WHERE id = CAST(:id AS uuid)`,
    { replacements: { id: conversation.id, lastMessageAt } }
  );
  const stored = await Conversation.findByPk(conversation.id);
  if (!stored) {
    throw new Error('Conversation was not inserted.');
  }
  return stored;
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

function listMessages(
  callerId: string,
  conversationId: string,
  query?: Record<string, string>
) {
  const pending = request(app)
    .get(`/api/v1/conversations/${conversationId}/messages`)
    .set(authHeader(callerId));
  return query ? pending.query(query) : pending;
}

function markRead(callerId: string, conversationId: string, body?: unknown) {
  const pending = request(app).patch(`/api/v1/conversations/${conversationId}/read`).set(authHeader(callerId));
  return body === undefined ? pending : pending.send(body);
}

function getUnreadCount(callerId: string, conversationId: string) {
  return request(app).get(`/api/v1/conversations/${conversationId}/unread-count`).set(authHeader(callerId));
}

function getConversation(callerId: string, conversationId: string) {
  return request(app).get(`/api/v1/conversations/${conversationId}`).set(authHeader(callerId));
}

function listInbox(callerId: string, query?: Record<string, string>) {
  const pending = request(app).get('/api/v1/conversations').set(authHeader(callerId));
  return query ? pending.query(query) : pending;
}

async function inboxPeer(genderId: string, firstName = 'Alex'): Promise<User> {
  const user = await User.create({
    email: `inbox-${randomUUID()}@example.com`,
    phone: null,
    passwordHash: PASSWORD_HASH,
    role: 'USER',
    status: 'ACTIVE',
    emailVerified: true,
    phoneVerified: false
  });
  await Profile.create({
    userId: user.id,
    firstName,
    dateOfBirth: '1998-04-12',
    genderId,
    bio: 'hidden-bio',
    occupation: 'hidden-occupation',
    education: 'hidden-education',
    isProfileComplete: true
  });
  return user;
}

async function openInboxThread(input: {
  callerId: string;
  targetId: string;
  conversationId?: string;
  matchStatus?: 'ACTIVE' | 'UNMATCHED' | 'UNDONE';
  conversationStatus?: 'ACTIVE' | 'CLOSED';
  lastMessageAt?: Date | null;
}) {
  const match = await insertMatch(input.callerId, input.targetId, input.matchStatus ?? 'ACTIVE');
  const conversation = await insertConversation(
    match.id,
    input.conversationStatus ?? 'ACTIVE',
    input.conversationStatus === 'CLOSED' ? new Date('2026-10-01T00:00:00.000Z') : null,
    input.lastMessageAt === undefined ? null : input.lastMessageAt,
    input.conversationId
  );
  return { match, conversation };
}

function attachFakeSocket(): { emit: jest.Mock; rooms: string[]; detach: () => void } {
  const emit = jest.fn();
  const rooms: string[] = [];
  const io = {
    to: (room: string) => {
      rooms.push(room);
      return { emit };
    }
  } as unknown as Server;
  rememberSocketServer(io);
  return {
    emit,
    rooms,
    detach: () => {
      forgetSocketServer(io);
    }
  };
}

async function insertHistoryMessage(input: {
  conversationId: string;
  senderId: string;
  content: string | null;
  createdAt: Date;
  id?: string;
  messageType?: 'TEXT' | 'IMAGE' | 'GIF' | 'VIDEO' | 'VOICE';
  readAt?: Date | null;
  mediaStorageKey?: string | null;
}): Promise<Message> {
  const created = await Message.create({
    id: input.id,
    conversationId: input.conversationId,
    senderId: input.senderId,
    messageType: input.messageType ?? 'TEXT',
    content: input.content,
    mediaStorageKey: input.mediaStorageKey ?? null,
    mediaMimeType: input.mediaStorageKey ? 'image/jpeg' : null,
    mediaFileSize: input.mediaStorageKey ? 128 : null,
    readAt: input.readAt ?? null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  });
  await sequelize.query(
    `UPDATE messages
     SET created_at = :createdAt, updated_at = :createdAt
     WHERE id = CAST(:id AS uuid)`,
    { replacements: { id: created.id, createdAt: input.createdAt } }
  );
  const stored = await Message.findByPk(created.id);
  if (!stored) {
    throw new Error('History message was not inserted.');
  }
  return stored;
}

async function historyOrder(conversationId: string): Promise<string[]> {
  const rows = await sequelize.query<{ id: string }>(
    `SELECT id
     FROM messages
     WHERE conversation_id = CAST(:conversationId AS uuid)
       AND deleted_at IS NULL
     ORDER BY created_at DESC, id DESC`,
    { replacements: { conversationId }, type: QueryTypes.SELECT }
  );
  return rows.map((row) => row.id);
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

describe('GET /api/v1/conversations/:conversationId/messages', () => {
  it('returns an empty page for an active conversation with no messages', async () => {
    const { caller, target, conversation } = await activeThread();

    const response = await listMessages(caller.id, conversation.id);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        items: [],
        pagination: { nextCursor: null, hasMore: false, limit: 20 }
      },
      message: 'Messages retrieved.'
    });

    const asTarget = await listMessages(target.id, conversation.id);
    expect(asTarget.status).toBe(200);
    expect(asTarget.body.data.items).toEqual([]);
  });

  it('returns both participants the same history, including non-TEXT rows and stored readAt', async () => {
    const { caller, target, conversation } = await activeThread();
    const older = new Date('2026-10-09T10:00:00.000Z');
    const newer = new Date('2026-10-09T10:05:00.000Z');
    const readAt = new Date('2026-10-09T10:06:00.000Z');
    const storageKey = `private/${randomUUID()}/secret-object`;

    const text = await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: caller.id,
      content: '  hello  ',
      createdAt: older
    });
    const image = await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: null,
      createdAt: newer,
      messageType: 'IMAGE',
      readAt,
      mediaStorageKey: storageKey
    });

    const response = await listMessages(caller.id, conversation.id);
    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Messages retrieved.');
    expect(response.body.data.items).toEqual([
      {
        id: image.id,
        conversationId: conversation.id,
        senderId: target.id,
        messageType: 'IMAGE',
        content: null,
        mediaUrl: null,
        readAt: readAt.toISOString(),
        createdAt: newer.toISOString()
      },
      {
        id: text.id,
        conversationId: conversation.id,
        senderId: caller.id,
        messageType: 'TEXT',
        content: '  hello  ',
        mediaUrl: null,
        readAt: null,
        createdAt: older.toISOString()
      }
    ]);
    expect(JSON.stringify(response.body)).not.toContain(storageKey);
    expect(response.body.data.items[0].remainingDailyMessages).toBeUndefined();

    const asTarget = await listMessages(target.id, conversation.id);
    expect(asTarget.status).toBe(200);
    expect(asTarget.body.data.items.map((item: { id: string }) => item.id)).toEqual([image.id, text.id]);
  });

  it('orders equal timestamps by id descending and pages without gaps or duplicates', async () => {
    const { caller, target, conversation } = await activeThread();
    const shared = new Date('2026-10-09T12:00:00.000Z');
    const older = new Date('2026-10-09T11:00:00.000Z');
    const newer = new Date('2026-10-09T13:00:00.000Z');

    await insertHistoryMessage({
      id: '00000000-0000-4000-8000-000000000001',
      conversationId: conversation.id,
      senderId: caller.id,
      content: 'tie-low',
      createdAt: shared
    });
    await insertHistoryMessage({
      id: '00000000-0000-4000-8000-000000000002',
      conversationId: conversation.id,
      senderId: target.id,
      content: 'tie-high',
      createdAt: shared
    });
    await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: caller.id,
      content: 'older',
      createdAt: older
    });
    await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'newer',
      createdAt: newer
    });

    const expected = await historyOrder(conversation.id);
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    let lastLimit = 0;

    while (pages < 10) {
      const response = await listMessages(
        caller.id,
        conversation.id,
        cursor ? { limit: '1', cursor } : { limit: '1' }
      );
      expect(response.status).toBe(200);
      expect(response.body.data.pagination.limit).toBe(1);
      const items = response.body.data.items as Array<{ id: string }>;
      expect(items.length).toBeGreaterThan(0);
      expect(items.length).toBeLessThanOrEqual(1);
      seen.push(...items.map((item) => item.id));
      pages += 1;
      lastLimit = response.body.data.pagination.limit;
      if (!response.body.data.pagination.hasMore) {
        expect(response.body.data.pagination.nextCursor).toBeNull();
        break;
      }
      expect(typeof response.body.data.pagination.nextCursor).toBe('string');
      cursor = response.body.data.pagination.nextCursor;
    }

    expect(pages).toBe(expected.length);
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(expected.length);
    expect(lastLimit).toBe(1);
    expect(expected.indexOf('00000000-0000-4000-8000-000000000002')).toBeLessThan(
      expected.indexOf('00000000-0000-4000-8000-000000000001')
    );
  });

  it('uses a default limit of 20 and accepts an explicit limit through 50', async () => {
    const { caller, conversation } = await activeThread();
    const base = new Date('2026-10-01T00:00:00.000Z').getTime();
    for (let index = 0; index < 51; index += 1) {
      await insertHistoryMessage({
        conversationId: conversation.id,
        senderId: caller.id,
        content: `message-${index}`,
        createdAt: new Date(base + index * 1000)
      });
    }

    const defaults = await listMessages(caller.id, conversation.id);
    expect(defaults.status).toBe(200);
    expect(defaults.body.data.items).toHaveLength(20);
    expect(defaults.body.data.pagination).toMatchObject({ hasMore: true, limit: 20 });
    expect(typeof defaults.body.data.pagination.nextCursor).toBe('string');

    const page = await listMessages(caller.id, conversation.id, { limit: '50' });
    expect(page.status).toBe(200);
    expect(page.body.data.items).toHaveLength(50);
    expect(page.body.data.pagination).toMatchObject({ hasMore: true, limit: 50 });

    const next = await listMessages(caller.id, conversation.id, {
      limit: '50',
      cursor: page.body.data.pagination.nextCursor
    });
    expect(next.status).toBe(200);
    expect(next.body.data.items).toHaveLength(1);
    expect(next.body.data.pagination).toEqual({ nextCursor: null, hasMore: false, limit: 50 });

    const expected = await historyOrder(conversation.id);
    const combined = [...page.body.data.items, ...next.body.data.items].map((item: { id: string }) => item.id);
    expect(combined).toEqual(expected);
  });

  it('excludes soft-deleted messages', async () => {
    const { caller, conversation } = await activeThread();
    const kept = await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: caller.id,
      content: 'kept',
      createdAt: new Date('2026-10-09T10:00:00.000Z')
    });
    const removed = await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: caller.id,
      content: 'removed',
      createdAt: new Date('2026-10-09T11:00:00.000Z')
    });
    await removed.destroy();

    const response = await listMessages(caller.id, conversation.id);
    expect(response.status).toBe(200);
    expect(response.body.data.items.map((item: { id: string }) => item.id)).toEqual([kept.id]);

    const stored = await Message.findByPk(removed.id, { paranoid: false });
    expect(stored?.deletedAt).toBeInstanceOf(Date);
    expect(stored?.content).toBe('removed');
  });

  it('returns retained messages after unmatch without reopening the conversation', async () => {
    const { caller, target, match, conversation } = await activeThread();
    const sent = await sendMessage(caller.id, conversation.id, { messageType: 'TEXT', content: 'Still here' });
    expect(sent.status).toBe(201);
    await conversation.reload();
    const lastMessageAt = conversation.lastMessageAt?.toISOString();

    const unmatch = await request(app).delete(`/api/v1/matches/${match.id}`).set(authHeader(caller.id));
    expect(unmatch.status).toBe(200);

    const response = await listMessages(target.id, conversation.id);
    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].content).toBe('Still here');
    expect(response.body.data.items[0].readAt).toBeNull();

    await conversation.reload();
    await match.reload();
    expect(conversation.status).toBe('CLOSED');
    expect(conversation.lastMessageAt?.toISOString()).toBe(lastMessageAt);
    expect(match.status).toBe('UNMATCHED');
    const stored = await Message.findByPk(sent.body.data.id);
    expect(stored?.readAt).toBeNull();
    expect(stored?.deletedAt).toBeNull();
    expect(await textMessageUsageCount(target.id)).toBe(0);
  });

  it('rejects invalid identifiers, limits, cursors, and unsupported query parameters', async () => {
    const { caller, conversation } = await activeThread();
    const messageId = '00000000-0000-4000-8000-000000000010';
    await insertHistoryMessage({
      id: messageId,
      conversationId: conversation.id,
      senderId: caller.id,
      content: 'anchor',
      createdAt: new Date('2026-10-09T10:00:00.000Z')
    });
    const validCursor = encodeHistoryCursor(new Date('2026-10-09T10:00:00.000Z'), messageId);

    const invalidId = await listMessages(caller.id, 'not-a-uuid');
    expect(invalidId.status).toBe(400);
    expect(invalidId.body.error.code).toBe('VALIDATION_ERROR');
    expect(invalidId.body.error.message).toBe('Validation failed');
    expect(invalidId.body.error.details).toEqual([
      { field: 'conversationId', message: 'Conversation id must be a valid UUID.' }
    ]);

    for (const limit of ['0', '-1', '51', '1.5', 'abc', '01']) {
      const response = await listMessages(caller.id, conversation.id, { limit });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toEqual([
        { field: 'limit', message: 'Limit must be an integer from 1 to 50.' }
      ]);
    }

    const unsupported = await listMessages(caller.id, conversation.id, { sort: 'desc' });
    expect(unsupported.status).toBe(400);
    expect(unsupported.body.error.details).toEqual([{ field: 'sort', message: 'Unsupported query parameter.' }]);

    const malformed = await listMessages(caller.id, conversation.id, { cursor: '@@@' });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.details[0].field).toBe('cursor');

    const notJson = await listMessages(caller.id, conversation.id, {
      cursor: Buffer.from('not-json', 'utf8').toString('base64')
    });
    expect(notJson.status).toBe(400);
    expect(notJson.body.error.details[0].field).toBe('cursor');

    const badTime = await listMessages(caller.id, conversation.id, {
      cursor: Buffer.from(
        JSON.stringify({ createdAt: '2026-02-31T00:00:00.000Z', id: messageId }),
        'utf8'
      ).toString('base64')
    });
    expect(badTime.status).toBe(400);
    expect(badTime.body.error.details).toEqual([
      { field: 'cursor.createdAt', message: 'Cursor createdAt must be a valid date-time.' }
    ]);

    const badId = await listMessages(caller.id, conversation.id, {
      cursor: Buffer.from(
        JSON.stringify({ createdAt: '2026-10-09T10:00:00.000Z', id: 'not-a-uuid' }),
        'utf8'
      ).toString('base64')
    });
    expect(badId.status).toBe(400);
    expect(badId.body.error.details).toEqual([{ field: 'cursor.id', message: 'Cursor id must be a valid UUID.' }]);

    const missingField = await listMessages(caller.id, conversation.id, {
      cursor: Buffer.from(JSON.stringify({ createdAt: '2026-10-09T10:00:00.000Z' }), 'utf8').toString('base64')
    });
    expect(missingField.status).toBe(400);
    expect(missingField.body.error.details).toEqual([{ field: 'cursor.id', message: 'Cursor id is required.' }]);

    const accepted = await listMessages(caller.id, conversation.id, { cursor: validCursor, limit: '1' });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.pagination.limit).toBe(1);
  });

  it('hides unknown, foreign, and inconsistent conversations', async () => {
    const { caller, target, genderId, conversation } = await activeThread();
    const outsider = await buildUser({ genderId, point: north(3) });

    const missing = await listMessages(caller.id, randomUUID());
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(missing.body.error.message).toBe('Resource not found');

    const foreign = await listMessages(outsider.id, conversation.id);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(foreign.body.error.message).toBe('Resource not found');

    const inactiveMatch = await insertMatch(caller.id, target.id, 'UNMATCHED');
    const inconsistent = await insertConversation(inactiveMatch.id, 'ACTIVE', null, null);
    await insertHistoryMessage({
      conversationId: inconsistent.id,
      senderId: caller.id,
      content: 'hidden',
      createdAt: new Date('2026-10-09T10:00:00.000Z')
    });
    const hidden = await listMessages(caller.id, inconsistent.id);
    expect(hidden.status).toBe(404);
    expect(hidden.body.error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('rejects a block in either direction, including after the conversation is closed', async () => {
    const first = await activeThread();
    await insertHistoryMessage({
      conversationId: first.conversation.id,
      senderId: first.caller.id,
      content: 'before block',
      createdAt: new Date('2026-10-09T10:00:00.000Z')
    });
    await Block.create({
      blockerId: first.caller.id,
      blockedId: first.target.id,
      reason: null,
      createdAt: new Date()
    });
    const callerBlocked = await listMessages(first.target.id, first.conversation.id);
    expect(callerBlocked.status).toBe(409);
    expect(callerBlocked.body.error.code).toBe('BLOCKED_USER');
    expect(callerBlocked.body.error.message).toBe('Interaction prohibited due to an active safety block.');

    const second = await activeThread();
    await sendMessage(second.caller.id, second.conversation.id, { messageType: 'TEXT', content: 'kept' });
    const unmatch = await request(app)
      .delete(`/api/v1/matches/${second.match.id}`)
      .set(authHeader(second.caller.id));
    expect(unmatch.status).toBe(200);
    await Block.create({
      blockerId: second.target.id,
      blockedId: second.caller.id,
      reason: null,
      createdAt: new Date()
    });
    const closedBlocked = await listMessages(second.caller.id, second.conversation.id);
    expect(closedBlocked.status).toBe(409);
    expect(closedBlocked.body.error.code).toBe('BLOCKED_USER');
    await second.conversation.reload();
    expect(second.conversation.status).toBe('CLOSED');
    expect(await Message.count()).toBe(2);
  });

  it('rejects a missing token, an invalid token, a deleted account, an admin, a suspended user, and a banned user', async () => {
    const { conversation } = await activeThread();

    const missing = await request(app).get(`/api/v1/conversations/${conversation.id}/messages`);
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('AUTH_REQUIRED');

    const invalid = await request(app)
      .get(`/api/v1/conversations/${conversation.id}/messages`)
      .set({ Authorization: 'Bearer not-a-token' });
    expect(invalid.status).toBe(401);
    expect(invalid.body.error.code).toBe('INVALID_TOKEN');

    const deleted = await User.create({
      email: `deleted-${randomUUID()}@example.com`,
      passwordHash: PASSWORD_HASH,
      role: 'USER',
      status: 'ACTIVE',
      emailVerified: true,
      phoneVerified: false
    });
    await deleted.destroy();
    const deletedResponse = await listMessages(deleted.id, conversation.id);
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
      .get(`/api/v1/conversations/${conversation.id}/messages`)
      .set(authHeader(admin.id, 'ADMIN'));
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
    const suspendedResponse = await listMessages(suspended.id, conversation.id);
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
    const bannedResponse = await listMessages(banned.id, conversation.id);
    expect(bannedResponse.status).toBe(403);
    expect(bannedResponse.body.error.code).toBe('ACCOUNT_BANNED');
  });

  it('rejects an unverified caller and an incomplete profile', async () => {
    const catalogGender = await gender();
    const target = await buildUser({ genderId: catalogGender.id });
    const emailCaller = await buildUser({ genderId: catalogGender.id, emailVerified: false });
    const emailMatch = await insertMatch(emailCaller.id, target.id, 'ACTIVE');
    const emailConversation = await insertConversation(emailMatch.id, 'ACTIVE', null, null);
    const emailResponse = await listMessages(emailCaller.id, emailConversation.id);
    expect(emailResponse.status).toBe(403);
    expect(emailResponse.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    const phoneCaller = await buildUser({ genderId: catalogGender.id, phoneOnly: true, emailVerified: false });
    const phoneMatch = await insertMatch(phoneCaller.id, target.id, 'ACTIVE');
    const phoneConversation = await insertConversation(phoneMatch.id, 'ACTIVE', null, null);
    const phoneResponse = await listMessages(phoneCaller.id, phoneConversation.id);
    expect(phoneResponse.status).toBe(403);
    expect(phoneResponse.body.error.code).toBe('PHONE_NOT_VERIFIED');

    const incomplete = await buildUser({ genderId: catalogGender.id, complete: false });
    const incompleteMatch = await insertMatch(incomplete.id, target.id, 'ACTIVE');
    const incompleteConversation = await insertConversation(incompleteMatch.id, 'ACTIVE', null, null);
    const incompleteResponse = await listMessages(incomplete.id, incompleteConversation.id);
    expect(incompleteResponse.status).toBe(400);
    expect(incompleteResponse.body.error.code).toBe('PROFILE_INCOMPLETE');

    const missingPreferences = await buildUser({ genderId: catalogGender.id, preferences: false });
    const preferencesMatch = await insertMatch(missingPreferences.id, target.id, 'ACTIVE');
    const preferencesConversation = await insertConversation(preferencesMatch.id, 'ACTIVE', null, null);
    const preferencesResponse = await listMessages(missingPreferences.id, preferencesConversation.id);
    expect(preferencesResponse.status).toBe(400);
    expect(preferencesResponse.body.error.code).toBe('PROFILE_INCOMPLETE');

    const missingLocation = await buildUser({ genderId: catalogGender.id, point: null });
    const locationMatch = await insertMatch(missingLocation.id, target.id, 'ACTIVE');
    const locationConversation = await insertConversation(locationMatch.id, 'ACTIVE', null, null);
    const locationResponse = await listMessages(missingLocation.id, locationConversation.id);
    expect(locationResponse.status).toBe(400);
    expect(locationResponse.body.error.code).toBe('PROFILE_INCOMPLETE');
  });

  it('does not change messages, conversation state, match state, quota, or credits', async () => {
    const { caller, target, match, conversation } = await activeThread();
    const readAt = new Date('2026-10-09T10:01:00.000Z');
    const createdAt = new Date('2026-10-09T10:00:00.000Z');
    const message = await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: caller.id,
      content: 'steady',
      createdAt,
      readAt
    });
    await conversation.update({ lastMessageAt: createdAt });
    await seedTextUsage(caller.id, 4);
    await UserCreditBalance.create({
      userId: caller.id,
      creditType: 'SUPER_LIKE',
      balance: 3,
      ...timestamps()
    });
    await CreditTransaction.create({
      userId: caller.id,
      creditType: 'SUPER_LIKE',
      delta: -1,
      reason: 'CONSUMPTION',
      createdAt: new Date()
    });

    const beforeMessages = await Message.findAll({ paranoid: false });
    const beforeUsage = await UsageRecord.count();
    await conversation.reload();
    await match.reload();
    const beforeConversation = conversation.toJSON();
    const beforeMatch = match.toJSON();

    const response = await listMessages(caller.id, conversation.id);
    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].readAt).toBe(readAt.toISOString());

    const afterMessages = await Message.findAll({ paranoid: false });
    expect(afterMessages.map((row) => row.toJSON())).toEqual(beforeMessages.map((row) => row.toJSON()));
    expect(await UsageRecord.count()).toBe(beforeUsage);
    expect(await textMessageUsageCount(caller.id)).toBe(4);
    expect(await textMessageUsageCount(target.id)).toBe(0);
    expect(await UserCreditBalance.count()).toBe(1);
    expect(await CreditTransaction.count()).toBe(1);
    await conversation.reload();
    await match.reload();
    expect(conversation.toJSON()).toEqual(beforeConversation);
    expect(match.toJSON()).toEqual(beforeMatch);
    const stored = await Message.findByPk(message.id);
    expect(stored?.readAt?.toISOString()).toBe(readAt.toISOString());
    expect(stored?.deletedAt).toBeNull();
  });
});

describe('PATCH /api/v1/conversations/:conversationId/read', () => {
  it('marks unread incoming TEXT and non-TEXT messages with one database timestamp', async () => {
    const { caller, target, conversation } = await activeThread();
    const older = new Date('2026-10-09T10:00:00.000Z');
    const newer = new Date('2026-10-09T10:05:00.000Z');
    const own = await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: caller.id,
      content: 'mine',
      createdAt: older
    });
    const text = await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'hello',
      createdAt: older
    });
    const image = await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: null,
      createdAt: newer,
      messageType: 'IMAGE',
      mediaStorageKey: `private/${randomUUID()}/photo`
    });

    const response = await markRead(caller.id, conversation.id);
    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Messages marked as read.');
    expect(response.body.success).toBe(true);
    expect(typeof response.body.data.readAt).toBe('string');

    const storedText = await Message.findByPk(text.id);
    const storedImage = await Message.findByPk(image.id);
    const storedOwn = await Message.findByPk(own.id);
    expect(storedText?.readAt).toBeInstanceOf(Date);
    expect(storedImage?.readAt?.toISOString()).toBe(storedText?.readAt?.toISOString());
    expect(storedText?.updatedAt.toISOString()).toBe(storedText?.readAt?.toISOString());
    expect(storedImage?.updatedAt.toISOString()).toBe(storedText?.readAt?.toISOString());
    expect(response.body.data.readAt).toBe(storedText?.readAt?.toISOString());
    expect(storedOwn?.readAt).toBeNull();
    expect(storedOwn?.updatedAt.toISOString()).toBe(older.toISOString());
    expect(storedText?.content).toBe('hello');
    expect(storedText?.createdAt.toISOString()).toBe(older.toISOString());
    expect(storedText?.deletedAt).toBeNull();
    expect(storedImage?.messageType).toBe('IMAGE');
  });

  it('keeps an existing read timestamp and treats a repeat as a no-op', async () => {
    const { caller, target, conversation } = await activeThread();
    const original = new Date('2026-10-09T09:00:00.000Z');
    const createdAt = new Date('2026-10-09T08:00:00.000Z');
    const already = await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'seen',
      createdAt,
      readAt: original
    });
    const unread = await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'new',
      createdAt: new Date('2026-10-09T08:05:00.000Z')
    });

    const first = await markRead(caller.id, conversation.id);
    expect(first.status).toBe(200);
    const markedAt = first.body.data.readAt as string;
    const storedAlready = await Message.findByPk(already.id);
    const storedUnread = await Message.findByPk(unread.id);
    expect(storedAlready?.readAt?.toISOString()).toBe(original.toISOString());
    expect(storedAlready?.updatedAt.toISOString()).toBe(createdAt.toISOString());
    expect(storedUnread?.readAt?.toISOString()).toBe(markedAt);

    const second = await markRead(caller.id, conversation.id);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({
      success: true,
      data: { readAt: null },
      message: 'Messages marked as read.'
    });
    const afterAlready = await Message.findByPk(already.id);
    const afterUnread = await Message.findByPk(unread.id);
    expect(afterAlready?.readAt?.toISOString()).toBe(original.toISOString());
    expect(afterUnread?.readAt?.toISOString()).toBe(markedAt);
  });

  it('returns readAt null when there are no unread incoming messages', async () => {
    const { caller, conversation } = await activeThread();
    await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: caller.id,
      content: 'only mine',
      createdAt: new Date('2026-10-09T10:00:00.000Z')
    });

    const response = await markRead(caller.id, conversation.id);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ readAt: null });
    expect(await Message.findAll()).toEqual(
      expect.arrayContaining([expect.objectContaining({ readAt: null, senderId: caller.id })])
    );
    expect((await Message.findAll()).every((row) => row.readAt === null)).toBe(true);
  });

  it('excludes soft-deleted messages and leaves another conversation unchanged', async () => {
    const first = await activeThread();
    const second = await activeThread();
    const kept = await insertHistoryMessage({
      conversationId: first.conversation.id,
      senderId: first.target.id,
      content: 'kept',
      createdAt: new Date('2026-10-09T10:00:00.000Z')
    });
    const removed = await insertHistoryMessage({
      conversationId: first.conversation.id,
      senderId: first.target.id,
      content: 'removed',
      createdAt: new Date('2026-10-09T10:01:00.000Z')
    });
    await removed.destroy();
    const other = await insertHistoryMessage({
      conversationId: second.conversation.id,
      senderId: second.target.id,
      content: 'elsewhere',
      createdAt: new Date('2026-10-09T10:02:00.000Z')
    });

    const response = await markRead(first.caller.id, first.conversation.id);
    expect(response.status).toBe(200);
    expect(response.body.data.readAt).toEqual(expect.any(String));

    const storedKept = await Message.findByPk(kept.id);
    const storedRemoved = await Message.findByPk(removed.id, { paranoid: false });
    const storedOther = await Message.findByPk(other.id);
    expect(storedKept?.readAt?.toISOString()).toBe(response.body.data.readAt);
    expect(storedRemoved?.readAt).toBeNull();
    expect(storedRemoved?.deletedAt).toBeInstanceOf(Date);
    expect(storedRemoved?.content).toBe('removed');
    expect(storedOther?.readAt).toBeNull();
  });

  it('hides unknown, foreign, and inconsistent conversations', async () => {
    const { caller, target, genderId, conversation } = await activeThread();
    const outsider = await buildUser({ genderId, point: north(3) });
    await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'hidden',
      createdAt: new Date('2026-10-09T10:00:00.000Z')
    });

    const missing = await markRead(caller.id, randomUUID());
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(missing.body.error.message).toBe('Resource not found');

    const foreign = await markRead(outsider.id, conversation.id);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(foreign.body.error.message).toBe('Resource not found');

    const inactiveMatch = await insertMatch(caller.id, target.id, 'UNMATCHED');
    const inconsistent = await insertConversation(inactiveMatch.id, 'ACTIVE', null, null);
    await insertHistoryMessage({
      conversationId: inconsistent.id,
      senderId: target.id,
      content: 'inconsistent',
      createdAt: new Date('2026-10-09T10:02:00.000Z')
    });
    const hidden = await markRead(caller.id, inconsistent.id);
    expect(hidden.status).toBe(404);
    expect(hidden.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect((await Message.findAll()).every((row) => row.readAt === null)).toBe(true);
  });

  it('rejects a block in either direction, including after the conversation is closed', async () => {
    const outgoing = await activeThread();
    await insertHistoryMessage({
      conversationId: outgoing.conversation.id,
      senderId: outgoing.caller.id,
      content: 'from caller',
      createdAt: new Date('2026-10-09T10:00:00.000Z')
    });
    await Block.create({
      blockerId: outgoing.caller.id,
      blockedId: outgoing.target.id,
      reason: null,
      createdAt: new Date()
    });
    const callerBlocked = await markRead(outgoing.target.id, outgoing.conversation.id);
    expect(callerBlocked.status).toBe(409);
    expect(callerBlocked.body.error.code).toBe('BLOCKED_USER');
    expect(callerBlocked.body.error.message).toBe('Interaction prohibited due to an active safety block.');

    const incoming = await activeThread();
    await insertHistoryMessage({
      conversationId: incoming.conversation.id,
      senderId: incoming.target.id,
      content: 'from target',
      createdAt: new Date('2026-10-09T10:01:00.000Z')
    });
    await Block.create({
      blockerId: incoming.target.id,
      blockedId: incoming.caller.id,
      reason: null,
      createdAt: new Date()
    });
    const recipientBlocked = await markRead(incoming.caller.id, incoming.conversation.id);
    expect(recipientBlocked.status).toBe(409);
    expect(recipientBlocked.body.error.code).toBe('BLOCKED_USER');

    const closed = await activeThread();
    const message = await insertHistoryMessage({
      conversationId: closed.conversation.id,
      senderId: closed.caller.id,
      content: 'after close',
      createdAt: new Date('2026-10-09T10:02:00.000Z')
    });
    const unmatch = await request(app).delete(`/api/v1/matches/${closed.match.id}`).set(authHeader(closed.caller.id));
    expect(unmatch.status).toBe(200);
    await Block.create({
      blockerId: closed.target.id,
      blockedId: closed.caller.id,
      reason: null,
      createdAt: new Date()
    });
    const closedBlocked = await markRead(closed.target.id, closed.conversation.id);
    expect(closedBlocked.status).toBe(409);
    expect(closedBlocked.body.error.code).toBe('BLOCKED_USER');
    await closed.conversation.reload();
    await closed.match.reload();
    expect(closed.conversation.status).toBe('CLOSED');
    expect(closed.match.status).toBe('UNMATCHED');
    const stored = await Message.findByPk(message.id);
    expect(stored?.readAt).toBeNull();
  });

  it('marks messages read in a closed conversation without reopening it', async () => {
    const { caller, target, match, conversation } = await activeThread();
    const createdAt = new Date('2026-10-09T10:00:00.000Z');
    const message = await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: caller.id,
      content: 'kept',
      createdAt
    });
    await conversation.update({ lastMessageAt: createdAt });
    const unmatch = await request(app).delete(`/api/v1/matches/${match.id}`).set(authHeader(caller.id));
    expect(unmatch.status).toBe(200);
    await conversation.reload();
    await match.reload();
    const closedAt = conversation.closedAt?.toISOString();
    const lastMessageAt = conversation.lastMessageAt?.toISOString();
    const conversationUpdatedAt = conversation.updatedAt.toISOString();

    const response = await markRead(target.id, conversation.id);
    expect(response.status).toBe(200);
    expect(typeof response.body.data.readAt).toBe('string');
    const stored = await Message.findByPk(message.id);
    expect(stored?.readAt?.toISOString()).toBe(response.body.data.readAt);
    await conversation.reload();
    await match.reload();
    expect(conversation.status).toBe('CLOSED');
    expect(conversation.closedAt?.toISOString()).toBe(closedAt);
    expect(conversation.lastMessageAt?.toISOString()).toBe(lastMessageAt);
    expect(conversation.updatedAt.toISOString()).toBe(conversationUpdatedAt);
    expect(match.status).toBe('UNMATCHED');
  });

  it('rejects an unverified caller and an incomplete profile', async () => {
    const catalogGender = await gender();
    const target = await buildUser({ genderId: catalogGender.id });
    const emailCaller = await buildUser({ genderId: catalogGender.id, emailVerified: false });
    const emailMatch = await insertMatch(emailCaller.id, target.id, 'ACTIVE');
    const emailConversation = await insertConversation(emailMatch.id, 'ACTIVE', null, null);
    const emailResponse = await markRead(emailCaller.id, emailConversation.id);
    expect(emailResponse.status).toBe(403);
    expect(emailResponse.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    const phoneCaller = await buildUser({ genderId: catalogGender.id, phoneOnly: true, emailVerified: false });
    const phoneMatch = await insertMatch(phoneCaller.id, target.id, 'ACTIVE');
    const phoneConversation = await insertConversation(phoneMatch.id, 'ACTIVE', null, null);
    const phoneResponse = await markRead(phoneCaller.id, phoneConversation.id);
    expect(phoneResponse.status).toBe(403);
    expect(phoneResponse.body.error.code).toBe('PHONE_NOT_VERIFIED');

    const incomplete = await buildUser({ genderId: catalogGender.id, complete: false });
    const incompleteMatch = await insertMatch(incomplete.id, target.id, 'ACTIVE');
    const incompleteConversation = await insertConversation(incompleteMatch.id, 'ACTIVE', null, null);
    const incompleteResponse = await markRead(incomplete.id, incompleteConversation.id);
    expect(incompleteResponse.status).toBe(400);
    expect(incompleteResponse.body.error.code).toBe('PROFILE_INCOMPLETE');

    const missingPreferences = await buildUser({ genderId: catalogGender.id, preferences: false });
    const preferencesMatch = await insertMatch(missingPreferences.id, target.id, 'ACTIVE');
    const preferencesConversation = await insertConversation(preferencesMatch.id, 'ACTIVE', null, null);
    const preferencesResponse = await markRead(missingPreferences.id, preferencesConversation.id);
    expect(preferencesResponse.status).toBe(400);
    expect(preferencesResponse.body.error.code).toBe('PROFILE_INCOMPLETE');

    const missingLocation = await buildUser({ genderId: catalogGender.id, point: null });
    const locationMatch = await insertMatch(missingLocation.id, target.id, 'ACTIVE');
    const locationConversation = await insertConversation(locationMatch.id, 'ACTIVE', null, null);
    const locationResponse = await markRead(missingLocation.id, locationConversation.id);
    expect(locationResponse.status).toBe(400);
    expect(locationResponse.body.error.code).toBe('PROFILE_INCOMPLETE');
  });

  it('rejects a missing token, an invalid token, a deleted account, an admin, a suspended user, and a banned user', async () => {
    const { conversation } = await activeThread();

    const missing = await request(app).patch(`/api/v1/conversations/${conversation.id}/read`);
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('AUTH_REQUIRED');

    const invalid = await request(app)
      .patch(`/api/v1/conversations/${conversation.id}/read`)
      .set({ Authorization: 'Bearer not-a-token' });
    expect(invalid.status).toBe(401);
    expect(invalid.body.error.code).toBe('INVALID_TOKEN');

    const deleted = await User.create({
      email: `deleted-${randomUUID()}@example.com`,
      passwordHash: PASSWORD_HASH,
      role: 'USER',
      status: 'ACTIVE',
      emailVerified: true,
      phoneVerified: false
    });
    await deleted.destroy();
    const deletedResponse = await markRead(deleted.id, conversation.id);
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
      .patch(`/api/v1/conversations/${conversation.id}/read`)
      .set(authHeader(admin.id, 'ADMIN'));
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
    const suspendedResponse = await markRead(suspended.id, conversation.id);
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
    const bannedResponse = await markRead(banned.id, conversation.id);
    expect(bannedResponse.status).toBe(403);
    expect(bannedResponse.body.error.code).toBe('ACCOUNT_BANNED');
  });

  it('rejects an invalid conversation id, an unsupported query, a non-empty body, and malformed JSON', async () => {
    const { caller, target, conversation } = await activeThread();
    await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'stay',
      createdAt: new Date('2026-10-09T10:00:00.000Z')
    });

    const invalidId = await markRead(caller.id, 'not-a-uuid');
    expect(invalidId.status).toBe(400);
    expect(invalidId.body.error.code).toBe('VALIDATION_ERROR');
    expect(invalidId.body.error.message).toBe('Validation failed');
    expect(invalidId.body.error.details).toEqual([
      { field: 'conversationId', message: 'Conversation id must be a valid UUID.' }
    ]);

    const unsupported = await request(app)
      .patch(`/api/v1/conversations/${conversation.id}/read`)
      .query({ sort: 'desc' })
      .set(authHeader(caller.id));
    expect(unsupported.status).toBe(400);
    expect(unsupported.body.error.code).toBe('VALIDATION_ERROR');
    expect(unsupported.body.error.details).toEqual([{ field: 'sort', message: 'Unsupported query parameter.' }]);

    const extra = await markRead(caller.id, conversation.id, { readAt: '2026-10-09T10:00:00.000Z' });
    expect(extra.status).toBe(400);
    expect(extra.body.error.code).toBe('VALIDATION_ERROR');
    expect(extra.body.error.message).toBe('Validation failed');

    const malformed = await request(app)
      .patch(`/api/v1/conversations/${conversation.id}/read`)
      .set(authHeader(caller.id))
      .set('Content-Type', 'application/json')
      .send('{not-json');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
    expect(malformed.body.error.message).toBe('Invalid JSON payload structure');

    expect((await Message.findAll()).every((row) => row.readAt === null)).toBe(true);
  });

  it('does not change quota, credits, last_message_at, conversation status, or match status', async () => {
    const { caller, target, match, conversation } = await activeThread();
    const createdAt = new Date('2026-10-09T10:00:00.000Z');
    await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'steady',
      createdAt
    });
    await conversation.update({ lastMessageAt: createdAt });
    await seedTextUsage(caller.id, 4);
    await UserCreditBalance.create({
      userId: caller.id,
      creditType: 'SUPER_LIKE',
      balance: 3,
      ...timestamps()
    });
    await CreditTransaction.create({
      userId: caller.id,
      creditType: 'SUPER_LIKE',
      delta: -1,
      reason: 'CONSUMPTION',
      createdAt: new Date()
    });
    await conversation.reload();
    await match.reload();
    const beforeConversation = conversation.toJSON();
    const beforeMatch = match.toJSON();
    const beforeUsage = await UsageRecord.count();

    const response = await markRead(caller.id, conversation.id);
    expect(response.status).toBe(200);
    expect(typeof response.body.data.readAt).toBe('string');
    expect(await UsageRecord.count()).toBe(beforeUsage);
    expect(await textMessageUsageCount(caller.id)).toBe(4);
    expect(await textMessageUsageCount(target.id)).toBe(0);
    expect(await UserCreditBalance.count()).toBe(1);
    expect(await CreditTransaction.count()).toBe(1);
    await conversation.reload();
    await match.reload();
    expect(conversation.toJSON()).toEqual(beforeConversation);
    expect(match.toJSON()).toEqual(beforeMatch);
    expect(await Message.count()).toBe(1);
  });

  it('lets concurrent requests mark each unread message once', async () => {
    const { caller, target, conversation } = await activeThread();
    const original = new Date('2026-10-09T09:00:00.000Z');
    const already = await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'already',
      createdAt: new Date('2026-10-09T08:00:00.000Z'),
      readAt: original
    });
    const first = await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'one',
      createdAt: new Date('2026-10-09T08:01:00.000Z')
    });
    const second = await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'two',
      createdAt: new Date('2026-10-09T08:02:00.000Z')
    });
    const own = await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: caller.id,
      content: 'own',
      createdAt: new Date('2026-10-09T08:03:00.000Z')
    });

    const [left, right] = await Promise.all([
      markRead(caller.id, conversation.id),
      markRead(caller.id, conversation.id)
    ]);
    expect(left.status).toBe(200);
    expect(right.status).toBe(200);
    const stamps = [left.body.data.readAt, right.body.data.readAt].filter((value) => value !== null);
    expect(stamps).toHaveLength(1);

    const storedFirst = await Message.findByPk(first.id);
    const storedSecond = await Message.findByPk(second.id);
    const storedAlready = await Message.findByPk(already.id);
    const storedOwn = await Message.findByPk(own.id);
    expect(storedFirst?.readAt?.toISOString()).toBe(stamps[0]);
    expect(storedSecond?.readAt?.toISOString()).toBe(stamps[0]);
    expect(storedFirst?.updatedAt.toISOString()).toBe(stamps[0]);
    expect(storedSecond?.updatedAt.toISOString()).toBe(stamps[0]);
    expect(storedAlready?.readAt?.toISOString()).toBe(original.toISOString());
    expect(storedOwn?.readAt).toBeNull();
  });
});

describe('GET /api/v1/conversations/:conversationId/unread-count', () => {
  it('returns zero when an active conversation has no incoming unread messages', async () => {
    const { caller, target, conversation } = await activeThread();

    const empty = await getUnreadCount(caller.id, conversation.id);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({
      success: true,
      data: { unreadCount: 0 },
      message: 'Unread count retrieved.'
    });

    const asTarget = await getUnreadCount(target.id, conversation.id);
    expect(asTarget.status).toBe(200);
    expect(asTarget.body.data).toEqual({ unreadCount: 0 });
  });

  it('counts one incoming unread message', async () => {
    const { caller, target, conversation } = await activeThread();
    await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'hello',
      createdAt: new Date('2026-10-12T10:00:00.000Z')
    });

    const response = await getUnreadCount(caller.id, conversation.id);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ unreadCount: 1 });
    expect(response.body.message).toBe('Unread count retrieved.');
  });

  it("excludes the caller's own messages when read_at is null", async () => {
    const { caller, target, conversation } = await activeThread();
    await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: caller.id,
      content: 'mine',
      createdAt: new Date('2026-10-12T10:00:00.000Z')
    });
    await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'theirs',
      createdAt: new Date('2026-10-12T10:01:00.000Z')
    });

    const response = await getUnreadCount(caller.id, conversation.id);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ unreadCount: 1 });

    const asTarget = await getUnreadCount(target.id, conversation.id);
    expect(asTarget.status).toBe(200);
    expect(asTarget.body.data).toEqual({ unreadCount: 1 });
  });

  it('excludes incoming messages that already have read_at', async () => {
    const { caller, target, conversation } = await activeThread();
    await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'seen',
      createdAt: new Date('2026-10-12T10:00:00.000Z'),
      readAt: new Date('2026-10-12T10:05:00.000Z')
    });

    const response = await getUnreadCount(caller.id, conversation.id);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ unreadCount: 0 });
  });

  it('excludes soft-deleted incoming messages', async () => {
    const { caller, target, conversation } = await activeThread();
    const kept = await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'kept',
      createdAt: new Date('2026-10-12T10:00:00.000Z')
    });
    const removed = await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'removed',
      createdAt: new Date('2026-10-12T10:01:00.000Z')
    });
    await removed.destroy();

    const response = await getUnreadCount(caller.id, conversation.id);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ unreadCount: 1 });

    const storedKept = await Message.findByPk(kept.id);
    const storedRemoved = await Message.findByPk(removed.id, { paranoid: false });
    expect(storedKept?.readAt).toBeNull();
    expect(storedKept?.deletedAt).toBeNull();
    expect(storedRemoved?.readAt).toBeNull();
    expect(storedRemoved?.deletedAt).toBeInstanceOf(Date);
    expect(storedRemoved?.content).toBe('removed');
  });

  it('counts multiple incoming unread messages', async () => {
    const { caller, target, conversation } = await activeThread();
    await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'one',
      createdAt: new Date('2026-10-12T10:00:00.000Z')
    });
    await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'two',
      createdAt: new Date('2026-10-12T10:01:00.000Z')
    });
    await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'three',
      createdAt: new Date('2026-10-12T10:02:00.000Z'),
      readAt: new Date('2026-10-12T10:03:00.000Z')
    });

    const response = await getUnreadCount(caller.id, conversation.id);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ unreadCount: 2 });
  });

  it('counts every stored message type, including IMAGE, GIF, VIDEO, and VOICE', async () => {
    const { caller, target, conversation } = await activeThread();
    const createdAt = new Date('2026-10-12T10:00:00.000Z');
    await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'text',
      createdAt
    });
    for (const messageType of ['IMAGE', 'GIF', 'VIDEO', 'VOICE'] as const) {
      await insertHistoryMessage({
        conversationId: conversation.id,
        senderId: target.id,
        content: null,
        createdAt,
        messageType,
        mediaStorageKey: `private/${randomUUID()}/${messageType.toLowerCase()}`
      });
    }
    await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: null,
      createdAt,
      messageType: 'IMAGE',
      readAt: new Date('2026-10-12T10:05:00.000Z'),
      mediaStorageKey: `private/${randomUUID()}/seen`
    });
    await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: caller.id,
      content: 'own',
      createdAt
    });

    const response = await getUnreadCount(caller.id, conversation.id);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ unreadCount: 5 });
  });

  it('keeps unread counts separated by conversation', async () => {
    const first = await activeThread();
    const second = await activeThread();
    await insertHistoryMessage({
      conversationId: first.conversation.id,
      senderId: first.target.id,
      content: 'a1',
      createdAt: new Date('2026-10-12T10:00:00.000Z')
    });
    await insertHistoryMessage({
      conversationId: first.conversation.id,
      senderId: first.target.id,
      content: 'a2',
      createdAt: new Date('2026-10-12T10:01:00.000Z')
    });
    await insertHistoryMessage({
      conversationId: first.conversation.id,
      senderId: first.caller.id,
      content: 'from-caller',
      createdAt: new Date('2026-10-12T10:02:00.000Z')
    });
    await insertHistoryMessage({
      conversationId: second.conversation.id,
      senderId: second.target.id,
      content: 'b1',
      createdAt: new Date('2026-10-12T10:03:00.000Z')
    });

    const firstCaller = await getUnreadCount(first.caller.id, first.conversation.id);
    const firstTarget = await getUnreadCount(first.target.id, first.conversation.id);
    const secondCaller = await getUnreadCount(second.caller.id, second.conversation.id);
    expect(firstCaller.status).toBe(200);
    expect(firstCaller.body.data).toEqual({ unreadCount: 2 });
    expect(firstTarget.status).toBe(200);
    expect(firstTarget.body.data).toEqual({ unreadCount: 1 });
    expect(secondCaller.status).toBe(200);
    expect(secondCaller.body.data).toEqual({ unreadCount: 1 });
  });

  it('hides unknown and foreign conversations with the same not-found response', async () => {
    const { caller, target, genderId, conversation } = await activeThread();
    const outsider = await buildUser({ genderId, point: north(3) });
    await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'hidden',
      createdAt: new Date('2026-10-12T10:00:00.000Z')
    });

    const missing = await getUnreadCount(caller.id, randomUUID());
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(missing.body.error.message).toBe('Resource not found');

    const foreign = await getUnreadCount(outsider.id, conversation.id);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(foreign.body.error.message).toBe('Resource not found');
    expect(foreign.body.error.details).toEqual(missing.body.error.details);
  });

  it('hides an active conversation whose match is not active', async () => {
    const { caller, target, conversation } = await activeThread();
    const inactiveMatch = await insertMatch(caller.id, target.id, 'UNMATCHED');
    const inconsistent = await insertConversation(inactiveMatch.id, 'ACTIVE', null, null);
    await insertHistoryMessage({
      conversationId: inconsistent.id,
      senderId: target.id,
      content: 'inconsistent',
      createdAt: new Date('2026-10-12T10:00:00.000Z')
    });

    const hidden = await getUnreadCount(caller.id, inconsistent.id);
    expect(hidden.status).toBe(404);
    expect(hidden.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(hidden.body.error.message).toBe('Resource not found');

    const visible = await getUnreadCount(caller.id, conversation.id);
    expect(visible.status).toBe(200);
    expect(visible.body.data).toEqual({ unreadCount: 0 });
  });

  it('rejects a block in either direction, including after the conversation is closed', async () => {
    const outgoing = await activeThread();
    await insertHistoryMessage({
      conversationId: outgoing.conversation.id,
      senderId: outgoing.target.id,
      content: 'from target',
      createdAt: new Date('2026-10-12T10:00:00.000Z')
    });
    await Block.create({
      blockerId: outgoing.caller.id,
      blockedId: outgoing.target.id,
      reason: null,
      createdAt: new Date()
    });
    const callerBlocked = await getUnreadCount(outgoing.target.id, outgoing.conversation.id);
    expect(callerBlocked.status).toBe(409);
    expect(callerBlocked.body.error.code).toBe('BLOCKED_USER');
    expect(callerBlocked.body.error.message).toBe('Interaction prohibited due to an active safety block.');

    const incoming = await activeThread();
    await insertHistoryMessage({
      conversationId: incoming.conversation.id,
      senderId: incoming.target.id,
      content: 'from target',
      createdAt: new Date('2026-10-12T10:01:00.000Z')
    });
    await Block.create({
      blockerId: incoming.target.id,
      blockedId: incoming.caller.id,
      reason: null,
      createdAt: new Date()
    });
    const recipientBlocked = await getUnreadCount(incoming.caller.id, incoming.conversation.id);
    expect(recipientBlocked.status).toBe(409);
    expect(recipientBlocked.body.error.code).toBe('BLOCKED_USER');

    const closed = await activeThread();
    await insertHistoryMessage({
      conversationId: closed.conversation.id,
      senderId: closed.target.id,
      content: 'kept',
      createdAt: new Date('2026-10-12T10:02:00.000Z')
    });
    const unmatch = await request(app).delete(`/api/v1/matches/${closed.match.id}`).set(authHeader(closed.caller.id));
    expect(unmatch.status).toBe(200);
    await Block.create({
      blockerId: closed.caller.id,
      blockedId: closed.target.id,
      reason: null,
      createdAt: new Date()
    });
    const closedBlocked = await getUnreadCount(closed.caller.id, closed.conversation.id);
    expect(closedBlocked.status).toBe(409);
    expect(closedBlocked.body.error.code).toBe('BLOCKED_USER');
    await closed.conversation.reload();
    expect(closed.conversation.status).toBe('CLOSED');
  });

  it('returns the retained unread count for a closed conversation when no block exists', async () => {
    const unmatched = await activeThread();
    await insertHistoryMessage({
      conversationId: unmatched.conversation.id,
      senderId: unmatched.target.id,
      content: 'still unread',
      createdAt: new Date('2026-10-12T10:00:00.000Z')
    });
    await insertHistoryMessage({
      conversationId: unmatched.conversation.id,
      senderId: unmatched.caller.id,
      content: 'own',
      createdAt: new Date('2026-10-12T10:01:00.000Z')
    });
    const unmatch = await request(app)
      .delete(`/api/v1/matches/${unmatched.match.id}`)
      .set(authHeader(unmatched.caller.id));
    expect(unmatch.status).toBe(200);

    const afterUnmatch = await getUnreadCount(unmatched.caller.id, unmatched.conversation.id);
    expect(afterUnmatch.status).toBe(200);
    expect(afterUnmatch.body.data).toEqual({ unreadCount: 1 });
    await unmatched.conversation.reload();
    await unmatched.match.reload();
    expect(unmatched.conversation.status).toBe('CLOSED');
    expect(unmatched.match.status).toBe('UNMATCHED');

    const undone = await activeThread();
    await insertHistoryMessage({
      conversationId: undone.conversation.id,
      senderId: undone.target.id,
      content: 'one',
      createdAt: new Date('2026-10-12T11:00:00.000Z')
    });
    await insertHistoryMessage({
      conversationId: undone.conversation.id,
      senderId: undone.target.id,
      content: 'two',
      createdAt: new Date('2026-10-12T11:01:00.000Z')
    });
    await undone.match.update({ status: 'UNDONE' });
    await undone.conversation.update({ status: 'CLOSED', closedAt: new Date('2026-10-12T11:02:00.000Z') });

    const afterUndo = await getUnreadCount(undone.caller.id, undone.conversation.id);
    expect(afterUndo.status).toBe(200);
    expect(afterUndo.body.data).toEqual({ unreadCount: 2 });
  });

  it('reflects a read receipt on the next count request', async () => {
    const { caller, target, conversation } = await activeThread();
    await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'one',
      createdAt: new Date('2026-10-12T10:00:00.000Z')
    });
    await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'two',
      createdAt: new Date('2026-10-12T10:01:00.000Z')
    });
    await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: caller.id,
      content: 'own',
      createdAt: new Date('2026-10-12T10:02:00.000Z')
    });

    const before = await getUnreadCount(caller.id, conversation.id);
    expect(before.status).toBe(200);
    expect(before.body.data).toEqual({ unreadCount: 2 });

    const marked = await markRead(caller.id, conversation.id);
    expect(marked.status).toBe(200);
    expect(typeof marked.body.data.readAt).toBe('string');

    const after = await getUnreadCount(caller.id, conversation.id);
    expect(after.status).toBe(200);
    expect(after.body.data).toEqual({ unreadCount: 0 });
  });

  it('keeps a repeated read receipt idempotent and the count at zero', async () => {
    const { caller, target, conversation } = await activeThread();
    const original = new Date('2026-10-12T09:00:00.000Z');
    const already = await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'seen',
      createdAt: new Date('2026-10-12T08:00:00.000Z'),
      readAt: original
    });
    const unread = await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'new',
      createdAt: new Date('2026-10-12T08:05:00.000Z')
    });

    const first = await markRead(caller.id, conversation.id);
    expect(first.status).toBe(200);
    const markedAt = first.body.data.readAt as string;
    const afterFirst = await getUnreadCount(caller.id, conversation.id);
    expect(afterFirst.body.data).toEqual({ unreadCount: 0 });

    const second = await markRead(caller.id, conversation.id);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({
      success: true,
      data: { readAt: null },
      message: 'Messages marked as read.'
    });
    const afterSecond = await getUnreadCount(caller.id, conversation.id);
    expect(afterSecond.status).toBe(200);
    expect(afterSecond.body.data).toEqual({ unreadCount: 0 });

    const storedAlready = await Message.findByPk(already.id);
    const storedUnread = await Message.findByPk(unread.id);
    expect(storedAlready?.readAt?.toISOString()).toBe(original.toISOString());
    expect(storedUnread?.readAt?.toISOString()).toBe(markedAt);
  });

  it('rejects unsupported query parameters, including history pagination fields', async () => {
    const { caller, conversation } = await activeThread();

    for (const query of [{ sort: 'desc' }, { limit: '20' }, { cursor: 'abc' }]) {
      const response = await request(app)
        .get(`/api/v1/conversations/${conversation.id}/unread-count`)
        .query(query)
        .set(authHeader(caller.id));
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toBe('Validation failed');
      expect(response.body.error.details).toEqual([
        { field: Object.keys(query)[0], message: 'Unsupported query parameter.' }
      ]);
    }
  });

  it('rejects an invalid conversation id', async () => {
    const { caller } = await activeThread();
    const response = await getUnreadCount(caller.id, 'not-a-uuid');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toBe('Validation failed');
    expect(response.body.error.details).toEqual([
      { field: 'conversationId', message: 'Conversation id must be a valid UUID.' }
    ]);
  });

  it('rejects a missing token, an invalid token, a deleted account, an admin, a suspended user, and a banned user', async () => {
    const { conversation } = await activeThread();

    const missing = await request(app).get(`/api/v1/conversations/${conversation.id}/unread-count`);
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('AUTH_REQUIRED');

    const invalid = await request(app)
      .get(`/api/v1/conversations/${conversation.id}/unread-count`)
      .set({ Authorization: 'Bearer not-a-token' });
    expect(invalid.status).toBe(401);
    expect(invalid.body.error.code).toBe('INVALID_TOKEN');

    const deleted = await User.create({
      email: `deleted-${randomUUID()}@example.com`,
      passwordHash: PASSWORD_HASH,
      role: 'USER',
      status: 'ACTIVE',
      emailVerified: true,
      phoneVerified: false
    });
    await deleted.destroy();
    const deletedResponse = await getUnreadCount(deleted.id, conversation.id);
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
      .get(`/api/v1/conversations/${conversation.id}/unread-count`)
      .set(authHeader(admin.id, 'ADMIN'));
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
    const suspendedResponse = await getUnreadCount(suspended.id, conversation.id);
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
    const bannedResponse = await getUnreadCount(banned.id, conversation.id);
    expect(bannedResponse.status).toBe(403);
    expect(bannedResponse.body.error.code).toBe('ACCOUNT_BANNED');
  });

  it('rejects an unverified caller and an incomplete profile', async () => {
    const catalogGender = await gender();
    const target = await buildUser({ genderId: catalogGender.id });
    const emailCaller = await buildUser({ genderId: catalogGender.id, emailVerified: false });
    const emailMatch = await insertMatch(emailCaller.id, target.id, 'ACTIVE');
    const emailConversation = await insertConversation(emailMatch.id, 'ACTIVE', null, null);
    const emailResponse = await getUnreadCount(emailCaller.id, emailConversation.id);
    expect(emailResponse.status).toBe(403);
    expect(emailResponse.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    const phoneCaller = await buildUser({ genderId: catalogGender.id, phoneOnly: true, emailVerified: false });
    const phoneMatch = await insertMatch(phoneCaller.id, target.id, 'ACTIVE');
    const phoneConversation = await insertConversation(phoneMatch.id, 'ACTIVE', null, null);
    const phoneResponse = await getUnreadCount(phoneCaller.id, phoneConversation.id);
    expect(phoneResponse.status).toBe(403);
    expect(phoneResponse.body.error.code).toBe('PHONE_NOT_VERIFIED');

    const incomplete = await buildUser({ genderId: catalogGender.id, complete: false });
    const incompleteMatch = await insertMatch(incomplete.id, target.id, 'ACTIVE');
    const incompleteConversation = await insertConversation(incompleteMatch.id, 'ACTIVE', null, null);
    const incompleteResponse = await getUnreadCount(incomplete.id, incompleteConversation.id);
    expect(incompleteResponse.status).toBe(400);
    expect(incompleteResponse.body.error.code).toBe('PROFILE_INCOMPLETE');

    const missingPreferences = await buildUser({ genderId: catalogGender.id, preferences: false });
    const preferencesMatch = await insertMatch(missingPreferences.id, target.id, 'ACTIVE');
    const preferencesConversation = await insertConversation(preferencesMatch.id, 'ACTIVE', null, null);
    const preferencesResponse = await getUnreadCount(missingPreferences.id, preferencesConversation.id);
    expect(preferencesResponse.status).toBe(400);
    expect(preferencesResponse.body.error.code).toBe('PROFILE_INCOMPLETE');

    const missingLocation = await buildUser({ genderId: catalogGender.id, point: null });
    const locationMatch = await insertMatch(missingLocation.id, target.id, 'ACTIVE');
    const locationConversation = await insertConversation(locationMatch.id, 'ACTIVE', null, null);
    const locationResponse = await getUnreadCount(missingLocation.id, locationConversation.id);
    expect(locationResponse.status).toBe(400);
    expect(locationResponse.body.error.code).toBe('PROFILE_INCOMPLETE');
  });

  it('does not change messages, quota, last_message_at, or conversation and match state', async () => {
    const { caller, target, match, conversation } = await activeThread();
    const readAt = new Date('2026-10-12T10:01:00.000Z');
    const createdAt = new Date('2026-10-12T10:00:00.000Z');
    const message = await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'steady',
      createdAt,
      readAt
    });
    await conversation.update({ lastMessageAt: createdAt });
    await seedTextUsage(caller.id, 4);
    await UserCreditBalance.create({
      userId: caller.id,
      creditType: 'SUPER_LIKE',
      balance: 3,
      ...timestamps()
    });
    await CreditTransaction.create({
      userId: caller.id,
      creditType: 'SUPER_LIKE',
      delta: -1,
      reason: 'CONSUMPTION',
      createdAt: new Date()
    });

    const beforeMessages = await Message.findAll({ paranoid: false });
    const beforeUsage = await UsageRecord.count();
    await conversation.reload();
    await match.reload();
    const beforeConversation = conversation.toJSON();
    const beforeMatch = match.toJSON();

    const response = await getUnreadCount(caller.id, conversation.id);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ unreadCount: 0 });

    const afterMessages = await Message.findAll({ paranoid: false });
    expect(afterMessages.map((row) => row.toJSON())).toEqual(beforeMessages.map((row) => row.toJSON()));
    expect(await UsageRecord.count()).toBe(beforeUsage);
    expect(await textMessageUsageCount(caller.id)).toBe(4);
    expect(await textMessageUsageCount(target.id)).toBe(0);
    expect(await UserCreditBalance.count()).toBe(1);
    expect(await CreditTransaction.count()).toBe(1);
    await conversation.reload();
    await match.reload();
    expect(conversation.toJSON()).toEqual(beforeConversation);
    expect(match.toJSON()).toEqual(beforeMatch);
    const stored = await Message.findByPk(message.id);
    expect(stored?.readAt?.toISOString()).toBe(readAt.toISOString());
    expect(stored?.deletedAt).toBeNull();
  });

  it('returns the full unread count regardless of history page size', async () => {
    const { caller, target, conversation } = await activeThread();
    const createdAt = new Date('2026-10-12T10:00:00.000Z');
    for (let index = 0; index < 21; index += 1) {
      await insertHistoryMessage({
        conversationId: conversation.id,
        senderId: target.id,
        content: `message-${index}`,
        createdAt: new Date(createdAt.getTime() + index * 1000)
      });
    }

    const history = await listMessages(caller.id, conversation.id, { limit: '1' });
    expect(history.status).toBe(200);
    expect(history.body.data.items).toHaveLength(1);
    expect(history.body.data.pagination.limit).toBe(1);
    expect(history.body.data.pagination.hasMore).toBe(true);

    const response = await getUnreadCount(caller.id, conversation.id);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ unreadCount: 21 });
  });
});

describe('GET /api/v1/conversations', () => {
  it('returns the approved envelope for an eligible conversation', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    await Profile.update({ firstName: 'Jordan' }, { where: { userId: caller.id } });
    const target = await inboxPeer(catalogGender.id, 'Alex');
    const createdAt = new Date('2026-10-12T15:00:00.000Z');
    const { match, conversation } = await openInboxThread({
      callerId: caller.id,
      targetId: target.id,
      lastMessageAt: createdAt
    });
    const message = await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: '  hello  ',
      createdAt
    });

    const response = await listInbox(caller.id);
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Conversations retrieved.');
    expect(response.body.data.pagination).toEqual({ limit: 20, nextCursor: null, hasMore: false });
    expect(response.body.data.conversations).toEqual([
      {
        conversationId: conversation.id,
        matchId: match.id,
        status: 'ACTIVE',
        participant: { userId: target.id, firstName: 'Alex' },
        lastMessage: {
          id: message.id,
          senderId: target.id,
          messageType: 'TEXT',
          content: '  hello  ',
          createdAt: createdAt.toISOString(),
          mediaUrl: null
        },
        unreadCount: 1
      }
    ]);
    expect(Object.keys(response.body.data).sort()).toEqual(['conversations', 'pagination']);
    expect(Object.keys(response.body.data.conversations[0]).sort()).toEqual([
      'conversationId',
      'lastMessage',
      'matchId',
      'participant',
      'status',
      'unreadCount'
    ]);
    expect(Object.keys(response.body.data.conversations[0].participant).sort()).toEqual(['firstName', 'userId']);
    expect(Object.keys(response.body.data.conversations[0].lastMessage).sort()).toEqual([
      'content',
      'createdAt',
      'id',
      'mediaUrl',
      'messageType',
      'senderId'
    ]);
    expect(JSON.stringify(response.body)).not.toContain('hidden-bio');
    expect(JSON.stringify(response.body)).not.toContain('hidden-occupation');
    expect(JSON.stringify(response.body)).not.toContain(caller.email ?? 'missing-email');
  });

  it('returns an empty inbox', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });

    const response = await listInbox(caller.id, { limit: '7' });
    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Conversations retrieved.');
    expect(response.body.data).toEqual({
      conversations: [],
      pagination: { limit: 7, nextCursor: null, hasMore: false }
    });
  });

  it('orders by last_message_at descending with nulls last and pages without gaps', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    const newest = '00000000-0000-4000-8000-000000000006';
    const tieHigh = '00000000-0000-4000-8000-000000000004';
    const tieLow = '00000000-0000-4000-8000-000000000002';
    const nullHigh = '00000000-0000-4000-8000-000000000005';
    const nullLow = '00000000-0000-4000-8000-000000000003';
    const noon = new Date('2026-10-12T12:00:00.000Z');
    const later = new Date('2026-10-12T13:00:00.000Z');
    const specs = [
      { id: newest, lastMessageAt: later },
      { id: tieHigh, lastMessageAt: noon },
      { id: tieLow, lastMessageAt: noon },
      { id: nullHigh, lastMessageAt: null },
      { id: nullLow, lastMessageAt: null }
    ];
    for (const spec of specs) {
      const target = await inboxPeer(catalogGender.id);
      await openInboxThread({
        callerId: caller.id,
        targetId: target.id,
        conversationId: spec.id,
        lastMessageAt: spec.lastMessageAt
      });
    }

    const expected = [newest, tieHigh, tieLow, nullHigh, nullLow];
    const full = await listInbox(caller.id, { limit: '10' });
    expect(full.status).toBe(200);
    expect(full.body.data.conversations.map((item: { conversationId: string }) => item.conversationId)).toEqual(expected);
    expect(full.body.data.pagination).toEqual({ limit: 10, nextCursor: null, hasMore: false });

    const repeated = await listInbox(caller.id, { limit: '10' });
    expect(repeated.body.data.conversations.map((item: { conversationId: string }) => item.conversationId)).toEqual(
      expected
    );

    const seen: string[] = [];
    let cursor: string | undefined;
    while (seen.length < 8) {
      const page = await listInbox(caller.id, cursor ? { limit: '1', cursor } : { limit: '1' });
      expect(page.status).toBe(200);
      expect(page.body.data.pagination.limit).toBe(1);
      const items = page.body.data.conversations as Array<{ conversationId: string }>;
      expect(items).toHaveLength(page.body.data.pagination.hasMore || seen.length < expected.length ? 1 : 0);
      if (items.length === 0) {
        expect(page.body.data.pagination).toEqual({ limit: 1, nextCursor: null, hasMore: false });
        break;
      }
      seen.push(items[0].conversationId);
      if (!page.body.data.pagination.hasMore) {
        expect(page.body.data.pagination.nextCursor).toBeNull();
        break;
      }
      expect(typeof page.body.data.pagination.nextCursor).toBe('string');
      const stored = await Conversation.findByPk(items[0].conversationId);
      expect(page.body.data.pagination.nextCursor).toBe(
        encodeInboxCursor(stored?.lastMessageAt ?? null, items[0].conversationId)
      );
      cursor = page.body.data.pagination.nextCursor;
    }
    expect(seen).toEqual(expected);

    const tieStored = await Conversation.findByPk(tieHigh);
    const tieCursor = encodeInboxCursor(tieStored?.lastMessageAt ?? null, tieHigh);
    const afterTie = await listInbox(caller.id, { cursor: tieCursor, limit: '10' });
    expect(afterTie.status).toBe(200);
    expect(afterTie.body.data.conversations.map((item: { conversationId: string }) => item.conversationId)).toEqual([
      tieLow,
      nullHigh,
      nullLow
    ]);

    const nullCursor = encodeInboxCursor(null, nullHigh);
    const afterNull = await listInbox(caller.id, { cursor: nullCursor, limit: '10' });
    expect(afterNull.status).toBe(200);
    expect(afterNull.body.data.conversations.map((item: { conversationId: string }) => item.conversationId)).toEqual([
      nullLow
    ]);

    const beforeNulls = encodeInboxCursor(null, 'ffffffff-ffff-4fff-bfff-ffffffffffff');
    const onlyNulls = await listInbox(caller.id, { cursor: beforeNulls, limit: '10' });
    expect(onlyNulls.body.data.conversations.map((item: { conversationId: string }) => item.conversationId)).toEqual([
      nullHigh,
      nullLow
    ]);
  });

  it('uses a default limit of 20 and accepts an explicit limit through 50', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    const ids: string[] = [];
    for (let index = 0; index < 51; index += 1) {
      const target = await inboxPeer(catalogGender.id);
      const thread = await openInboxThread({
        callerId: caller.id,
        targetId: target.id,
        lastMessageAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index))
      });
      ids.push(thread.conversation.id);
    }
    const newestFirst = [...ids].reverse();

    const defaults = await listInbox(caller.id);
    expect(defaults.status).toBe(200);
    expect(defaults.body.data.conversations).toHaveLength(20);
    expect(defaults.body.data.pagination.limit).toBe(20);
    expect(defaults.body.data.pagination.hasMore).toBe(true);
    expect(typeof defaults.body.data.pagination.nextCursor).toBe('string');
    expect(defaults.body.data.conversations.map((item: { conversationId: string }) => item.conversationId)).toEqual(
      newestFirst.slice(0, 20)
    );

    const page = await listInbox(caller.id, { limit: '50' });
    expect(page.status).toBe(200);
    expect(page.body.data.conversations).toHaveLength(50);
    expect(page.body.data.pagination).toMatchObject({ hasMore: true, limit: 50 });
    const next = await listInbox(caller.id, { limit: '50', cursor: page.body.data.pagination.nextCursor });
    expect(next.status).toBe(200);
    expect(next.body.data.conversations).toHaveLength(1);
    expect(next.body.data.pagination).toEqual({ limit: 50, nextCursor: null, hasMore: false });
    expect(
      [...page.body.data.conversations, ...next.body.data.conversations].map(
        (item: { conversationId: string }) => item.conversationId
      )
    ).toEqual(newestFirst);

    const one = await listInbox(caller.id, { limit: '1' });
    expect(one.body.data.conversations).toHaveLength(1);
    expect(one.body.data.pagination.limit).toBe(1);
    expect(one.body.data.conversations[0].conversationId).toBe(newestFirst[0]);
  }, 60000);

  it('rejects invalid limits, cursors, and unsupported query parameters', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    const target = await inboxPeer(catalogGender.id);
    const conversationId = '00000000-0000-4000-8000-000000000010';
    await openInboxThread({
      callerId: caller.id,
      targetId: target.id,
      conversationId,
      lastMessageAt: new Date('2026-10-12T10:00:00.000Z')
    });

    for (const limit of ['0', '-1', '51', '1.5', 'abc', '01']) {
      const response = await listInbox(caller.id, { limit });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toBe('Validation failed');
      expect(response.body.error.details).toEqual([{ field: 'limit', message: 'Limit must be an integer from 1 to 50.' }]);
    }

    const unsupported = await listInbox(caller.id, { sort: 'desc' });
    expect(unsupported.status).toBe(400);
    expect(unsupported.body.error.code).toBe('VALIDATION_ERROR');
    expect(unsupported.body.error.details).toEqual([{ field: 'sort', message: 'Unsupported query parameter.' }]);

    const malformed = await listInbox(caller.id, { cursor: '@@@' });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.details).toEqual([
      { field: 'cursor', message: 'Cursor must be a base64-encoded JSON object with lastMessageAt and conversationId.' }
    ]);

    const notJson = await listInbox(caller.id, { cursor: Buffer.from('not-json', 'utf8').toString('base64') });
    expect(notJson.status).toBe(400);
    expect(notJson.body.error.details[0].field).toBe('cursor');

    const badTime = await listInbox(caller.id, {
      cursor: Buffer.from(
        JSON.stringify({ lastMessageAt: '2026-02-31T00:00:00.000Z', conversationId }),
        'utf8'
      ).toString('base64')
    });
    expect(badTime.status).toBe(400);
    expect(badTime.body.error.details).toEqual([
      { field: 'cursor.lastMessageAt', message: 'Cursor lastMessageAt must be a valid date-time or null.' }
    ]);

    const badId = await listInbox(caller.id, {
      cursor: Buffer.from(
        JSON.stringify({ lastMessageAt: '2026-10-12T10:00:00.000Z', conversationId: 'not-a-uuid' }),
        'utf8'
      ).toString('base64')
    });
    expect(badId.status).toBe(400);
    expect(badId.body.error.details).toEqual([
      { field: 'cursor.conversationId', message: 'Cursor conversationId must be a valid UUID.' }
    ]);

    const missingField = await listInbox(caller.id, {
      cursor: Buffer.from(JSON.stringify({ lastMessageAt: null }), 'utf8').toString('base64')
    });
    expect(missingField.status).toBe(400);
    expect(missingField.body.error.details).toEqual([
      { field: 'cursor.conversationId', message: 'Cursor conversationId is required.' }
    ]);

    const extraField = await listInbox(caller.id, {
      cursor: Buffer.from(
        JSON.stringify({ lastMessageAt: null, conversationId, extra: true }),
        'utf8'
      ).toString('base64')
    });
    expect(extraField.status).toBe(400);
    expect(extraField.body.error.details).toEqual([{ field: 'cursor.extra', message: 'Unsupported cursor field.' }]);

    const historyCursor = await listInbox(caller.id, {
      cursor: Buffer.from(
        JSON.stringify({ createdAt: '2026-10-12T10:00:00.000Z', id: conversationId }),
        'utf8'
      ).toString('base64')
    });
    expect(historyCursor.status).toBe(400);
    expect(historyCursor.body.error.code).toBe('VALIDATION_ERROR');
    expect(historyCursor.body.error.details).toEqual([
      { field: 'cursor.createdAt', message: 'Unsupported cursor field.' },
      { field: 'cursor.id', message: 'Unsupported cursor field.' },
      { field: 'cursor.lastMessageAt', message: 'Cursor lastMessageAt is required.' },
      { field: 'cursor.conversationId', message: 'Cursor conversationId is required.' }
    ]);
  });

  it('returns only active conversations with active matches for either participant', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    await Profile.update({ firstName: 'Casey' }, { where: { userId: caller.id } });
    const target = await inboxPeer(catalogGender.id, 'Alex');
    const eligible = await openInboxThread({
      callerId: caller.id,
      targetId: target.id,
      lastMessageAt: new Date('2026-10-12T12:00:00.000Z')
    });
    const closedTarget = await inboxPeer(catalogGender.id);
    await openInboxThread({
      callerId: caller.id,
      targetId: closedTarget.id,
      conversationStatus: 'CLOSED',
      lastMessageAt: new Date('2026-10-12T13:00:00.000Z')
    });
    const unmatchedTarget = await inboxPeer(catalogGender.id);
    await openInboxThread({
      callerId: caller.id,
      targetId: unmatchedTarget.id,
      matchStatus: 'UNMATCHED',
      lastMessageAt: new Date('2026-10-12T14:00:00.000Z')
    });
    const undoneTarget = await inboxPeer(catalogGender.id);
    await openInboxThread({
      callerId: caller.id,
      targetId: undoneTarget.id,
      matchStatus: 'UNDONE',
      lastMessageAt: new Date('2026-10-12T15:00:00.000Z')
    });
    const outsider = await buildUser({ genderId: catalogGender.id });
    const stranger = await inboxPeer(catalogGender.id);
    const foreign = await openInboxThread({
      callerId: outsider.id,
      targetId: stranger.id,
      lastMessageAt: new Date('2026-10-12T16:00:00.000Z')
    });

    const asCaller = await listInbox(caller.id);
    expect(asCaller.status).toBe(200);
    expect(asCaller.body.data.conversations.map((item: { conversationId: string }) => item.conversationId)).toEqual([
      eligible.conversation.id
    ]);
    expect(asCaller.body.data.conversations[0].participant).toEqual({ userId: target.id, firstName: 'Alex' });
    expect(asCaller.body.data.conversations[0].matchId).toBe(eligible.match.id);
    expect(asCaller.body.data.conversations.map((item: { conversationId: string }) => item.conversationId)).not.toContain(
      foreign.conversation.id
    );

    const asOutsider = await listInbox(outsider.id);
    expect(asOutsider.status).toBe(200);
    expect(asOutsider.body.data.conversations.map((item: { conversationId: string }) => item.conversationId)).toEqual([
      foreign.conversation.id
    ]);
    expect(asOutsider.body.data.conversations[0].participant.userId).toBe(stranger.id);
  });

  it('shows the same conversation to both match participants', async () => {
    const catalogGender = await gender();
    const left = await buildUser({ genderId: catalogGender.id });
    const right = await buildUser({ genderId: catalogGender.id });
    await Profile.update({ firstName: 'Left' }, { where: { userId: left.id } });
    await Profile.update({ firstName: 'Right' }, { where: { userId: right.id } });
    const { match, conversation } = await openInboxThread({
      callerId: left.id,
      targetId: right.id,
      lastMessageAt: new Date('2026-10-12T12:00:00.000Z')
    });
    await match.reload();

    const asLeft = await listInbox(left.id);
    const asRight = await listInbox(right.id);
    expect(asLeft.status).toBe(200);
    expect(asRight.status).toBe(200);
    expect(asLeft.body.data.conversations[0].conversationId).toBe(conversation.id);
    expect(asRight.body.data.conversations[0].conversationId).toBe(conversation.id);
    expect(asLeft.body.data.conversations[0].participant).toEqual({ userId: right.id, firstName: 'Right' });
    expect(asRight.body.data.conversations[0].participant).toEqual({ userId: left.id, firstName: 'Left' });
    expect([match.userOneId, match.userTwoId].sort()).toEqual([left.id, right.id].sort());
  });

  it('omits a blocked pair and keeps the other threads', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    const blockedByCaller = await inboxPeer(catalogGender.id, 'Blocked');
    const blockedByOther = await inboxPeer(catalogGender.id, 'Blocker');
    const visible = await inboxPeer(catalogGender.id, 'Visible');
    const callerBlocked = await openInboxThread({
      callerId: caller.id,
      targetId: blockedByCaller.id,
      lastMessageAt: new Date('2026-10-12T15:00:00.000Z')
    });
    const otherBlocked = await openInboxThread({
      callerId: caller.id,
      targetId: blockedByOther.id,
      lastMessageAt: new Date('2026-10-12T14:00:00.000Z')
    });
    const kept = await openInboxThread({
      callerId: caller.id,
      targetId: visible.id,
      lastMessageAt: new Date('2026-10-12T13:00:00.000Z')
    });
    await Block.create({
      blockerId: caller.id,
      blockedId: blockedByCaller.id,
      reason: null,
      createdAt: new Date()
    });
    await Block.create({
      blockerId: blockedByOther.id,
      blockedId: caller.id,
      reason: null,
      createdAt: new Date()
    });

    const response = await listInbox(caller.id);
    expect(response.status).toBe(200);
    expect(response.body.data.conversations.map((item: { conversationId: string }) => item.conversationId)).toEqual([
      kept.conversation.id
    ]);
    expect(response.body.data.conversations[0].participant).toEqual({ userId: visible.id, firstName: 'Visible' });

    await callerBlocked.conversation.reload();
    await otherBlocked.conversation.reload();
    expect(callerBlocked.conversation.status).toBe('ACTIVE');
    expect(otherBlocked.conversation.status).toBe('ACTIVE');
  });

  it('selects the latest non-deleted message and returns null when none are visible', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    const tieTarget = await inboxPeer(catalogGender.id);
    const emptyTarget = await inboxPeer(catalogGender.id);
    const deletedTarget = await inboxPeer(catalogGender.id);
    const replacedTarget = await inboxPeer(catalogGender.id);
    const shared = new Date('2026-10-12T12:00:00.000Z');
    const tieThread = await openInboxThread({
      callerId: caller.id,
      targetId: tieTarget.id,
      lastMessageAt: new Date('2026-10-12T16:00:00.000Z')
    });
    const lowId = '00000000-0000-4000-8000-000000000001';
    const highId = '00000000-0000-4000-8000-000000000002';
    await insertHistoryMessage({
      id: lowId,
      conversationId: tieThread.conversation.id,
      senderId: caller.id,
      content: 'tie-low',
      createdAt: shared
    });
    await insertHistoryMessage({
      id: highId,
      conversationId: tieThread.conversation.id,
      senderId: tieTarget.id,
      content: 'tie-high',
      createdAt: shared
    });

    const emptyThread = await openInboxThread({
      callerId: caller.id,
      targetId: emptyTarget.id,
      lastMessageAt: new Date('2026-10-12T15:00:00.000Z')
    });

    const deletedThread = await openInboxThread({
      callerId: caller.id,
      targetId: deletedTarget.id,
      lastMessageAt: new Date('2026-10-12T14:00:00.000Z')
    });
    const removedOnly = await insertHistoryMessage({
      conversationId: deletedThread.conversation.id,
      senderId: deletedTarget.id,
      content: 'gone',
      createdAt: new Date('2026-10-12T14:00:00.000Z')
    });
    await removedOnly.destroy();

    const replacedThread = await openInboxThread({
      callerId: caller.id,
      targetId: replacedTarget.id,
      lastMessageAt: new Date('2026-10-12T13:00:00.000Z')
    });
    const storageKey = `private/${randomUUID()}/secret-object`;
    const kept = await insertHistoryMessage({
      conversationId: replacedThread.conversation.id,
      senderId: replacedTarget.id,
      content: 'kept',
      createdAt: new Date('2026-10-12T11:00:00.000Z')
    });
    const removedNewest = await insertHistoryMessage({
      conversationId: replacedThread.conversation.id,
      senderId: replacedTarget.id,
      content: null,
      createdAt: new Date('2026-10-12T12:30:00.000Z'),
      messageType: 'IMAGE',
      mediaStorageKey: storageKey
    });
    await removedNewest.destroy();

    const response = await listInbox(caller.id);
    expect(response.status).toBe(200);
    const byId = new Map(
      (response.body.data.conversations as Array<{ conversationId: string; lastMessage: unknown; unreadCount: number }>).map(
        (item) => [item.conversationId, item]
      )
    );
    expect(byId.get(tieThread.conversation.id)?.lastMessage).toEqual({
      id: highId,
      senderId: tieTarget.id,
      messageType: 'TEXT',
      content: 'tie-high',
      createdAt: shared.toISOString(),
      mediaUrl: null
    });
    expect(byId.get(emptyThread.conversation.id)?.lastMessage).toBeNull();
    expect(byId.get(emptyThread.conversation.id)?.unreadCount).toBe(0);
    expect(byId.get(deletedThread.conversation.id)?.lastMessage).toBeNull();
    expect(byId.get(deletedThread.conversation.id)?.unreadCount).toBe(0);
    expect(byId.get(replacedThread.conversation.id)?.lastMessage).toEqual({
      id: kept.id,
      senderId: replacedTarget.id,
      messageType: 'TEXT',
      content: 'kept',
      createdAt: kept.createdAt.toISOString(),
      mediaUrl: null
    });
    expect(JSON.stringify(response.body)).not.toContain(storageKey);
    expect(JSON.stringify(response.body)).not.toContain('gone');
  });

  it('counts every incoming unread message type and ignores own, read, and deleted rows', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    const target = await inboxPeer(catalogGender.id, 'Alex');
    const otherTarget = await inboxPeer(catalogGender.id, 'Blake');
    const thread = await openInboxThread({
      callerId: caller.id,
      targetId: target.id,
      lastMessageAt: new Date('2026-10-12T18:00:00.000Z')
    });
    const otherThread = await openInboxThread({
      callerId: caller.id,
      targetId: otherTarget.id,
      lastMessageAt: new Date('2026-10-12T17:00:00.000Z')
    });
    const base = new Date('2026-10-12T10:00:00.000Z').getTime();
    const types = ['TEXT', 'IMAGE', 'GIF', 'VIDEO', 'VOICE'] as const;
    const storageKey = `private/${randomUUID()}/unread-secret`;
    for (let index = 0; index < types.length; index += 1) {
      const messageType = types[index];
      await insertHistoryMessage({
        conversationId: thread.conversation.id,
        senderId: target.id,
        content: messageType === 'TEXT' ? 'incoming' : null,
        createdAt: new Date(base + index * 1000),
        messageType,
        mediaStorageKey: messageType === 'TEXT' ? null : storageKey
      });
    }
    await insertHistoryMessage({
      conversationId: thread.conversation.id,
      senderId: caller.id,
      content: 'mine',
      createdAt: new Date(base + 6000)
    });
    const readImage = await insertHistoryMessage({
      conversationId: thread.conversation.id,
      senderId: target.id,
      content: null,
      createdAt: new Date(base + 7000),
      messageType: 'IMAGE',
      readAt: new Date(base + 8000),
      mediaStorageKey: storageKey
    });
    const deletedUnread = await insertHistoryMessage({
      conversationId: thread.conversation.id,
      senderId: target.id,
      content: null,
      createdAt: new Date(base + 9000),
      messageType: 'VOICE',
      mediaStorageKey: storageKey
    });
    await deletedUnread.destroy();
    await insertHistoryMessage({
      conversationId: otherThread.conversation.id,
      senderId: otherTarget.id,
      content: 'other-thread',
      createdAt: new Date(base + 1000)
    });

    const response = await listInbox(caller.id);
    expect(response.status).toBe(200);
    const primary = response.body.data.conversations.find(
      (item: { conversationId: string }) => item.conversationId === thread.conversation.id
    );
    const secondary = response.body.data.conversations.find(
      (item: { conversationId: string }) => item.conversationId === otherThread.conversation.id
    );
    expect(primary.unreadCount).toBe(5);
    expect(primary.lastMessage).toEqual({
      id: readImage.id,
      senderId: target.id,
      messageType: 'IMAGE',
      content: null,
      createdAt: readImage.createdAt.toISOString(),
      mediaUrl: null
    });
    expect(secondary.unreadCount).toBe(1);
    expect(secondary.lastMessage).toMatchObject({ messageType: 'TEXT', content: 'other-thread', mediaUrl: null });
    expect(JSON.stringify(response.body)).not.toContain(storageKey);
  });

  it('rejects a missing token, an invalid token, a deleted account, an admin, a suspended user, and a banned user', async () => {
    const missing = await request(app).get('/api/v1/conversations');
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('AUTH_REQUIRED');

    const invalid = await request(app).get('/api/v1/conversations').set({ Authorization: 'Bearer not-a-token' });
    expect(invalid.status).toBe(401);
    expect(invalid.body.error.code).toBe('INVALID_TOKEN');

    const deleted = await User.create({
      email: `deleted-${randomUUID()}@example.com`,
      passwordHash: PASSWORD_HASH,
      role: 'USER',
      status: 'ACTIVE',
      emailVerified: true,
      phoneVerified: false
    });
    await deleted.destroy();
    const deletedResponse = await listInbox(deleted.id);
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
    const forbidden = await request(app).get('/api/v1/conversations').set(authHeader(admin.id, 'ADMIN'));
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
    const suspendedResponse = await listInbox(suspended.id);
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
    const bannedResponse = await listInbox(banned.id);
    expect(bannedResponse.status).toBe(403);
    expect(bannedResponse.body.error.code).toBe('ACCOUNT_BANNED');
  });

  it('rejects an unverified caller and an incomplete profile', async () => {
    const catalogGender = await gender();
    const emailCaller = await buildUser({ genderId: catalogGender.id, emailVerified: false });
    const emailResponse = await listInbox(emailCaller.id);
    expect(emailResponse.status).toBe(403);
    expect(emailResponse.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    const phoneCaller = await buildUser({ genderId: catalogGender.id, phoneOnly: true, emailVerified: false });
    const phoneResponse = await listInbox(phoneCaller.id);
    expect(phoneResponse.status).toBe(403);
    expect(phoneResponse.body.error.code).toBe('PHONE_NOT_VERIFIED');

    const incomplete = await buildUser({ genderId: catalogGender.id, complete: false });
    const incompleteResponse = await listInbox(incomplete.id);
    expect(incompleteResponse.status).toBe(400);
    expect(incompleteResponse.body.error.code).toBe('PROFILE_INCOMPLETE');

    const missingPreferences = await buildUser({ genderId: catalogGender.id, preferences: false });
    const preferencesResponse = await listInbox(missingPreferences.id);
    expect(preferencesResponse.status).toBe(400);
    expect(preferencesResponse.body.error.code).toBe('PROFILE_INCOMPLETE');

    const missingLocation = await buildUser({ genderId: catalogGender.id, point: null });
    const locationResponse = await listInbox(missingLocation.id);
    expect(locationResponse.status).toBe(400);
    expect(locationResponse.body.error.code).toBe('PROFILE_INCOMPLETE');
  });

  it('does not write rows or emit socket events', async () => {
    const { caller, target, match, conversation } = await activeThread();
    const readAt = new Date('2026-10-12T10:01:00.000Z');
    const createdAt = new Date('2026-10-12T10:00:00.000Z');
    const message = await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'steady',
      createdAt,
      readAt
    });
    await conversation.update({ lastMessageAt: createdAt });
    await sequelize.query(
      `UPDATE conversations SET last_message_at = :createdAt WHERE id = CAST(:id AS uuid)`,
      { replacements: { id: conversation.id, createdAt } }
    );
    await seedTextUsage(caller.id, 4);
    await UserCreditBalance.create({
      userId: caller.id,
      creditType: 'SUPER_LIKE',
      balance: 3,
      ...timestamps()
    });
    await CreditTransaction.create({
      userId: caller.id,
      creditType: 'SUPER_LIKE',
      delta: -1,
      reason: 'CONSUMPTION',
      createdAt: new Date()
    });

    const beforeMessages = await Message.findAll({ paranoid: false });
    const beforeUsage = await UsageRecord.count();
    const beforeBlocks = await Block.count();
    await conversation.reload();
    await match.reload();
    const beforeConversation = conversation.toJSON();
    const beforeMatch = match.toJSON();
    const socket = attachFakeSocket();

    try {
      const response = await listInbox(caller.id);
      expect(response.status).toBe(200);
      expect(response.body.data.conversations).toHaveLength(1);
      expect(response.body.data.conversations[0].unreadCount).toBe(0);
      expect(socket.emit).not.toHaveBeenCalled();
    } finally {
      socket.detach();
    }

    const afterMessages = await Message.findAll({ paranoid: false });
    expect(afterMessages.map((row) => row.toJSON())).toEqual(beforeMessages.map((row) => row.toJSON()));
    expect(await UsageRecord.count()).toBe(beforeUsage);
    expect(await textMessageUsageCount(caller.id)).toBe(4);
    expect(await textMessageUsageCount(target.id)).toBe(0);
    expect(await UserCreditBalance.count()).toBe(1);
    expect(await CreditTransaction.count()).toBe(1);
    expect(await Block.count()).toBe(beforeBlocks);
    await conversation.reload();
    await match.reload();
    expect(conversation.toJSON()).toEqual(beforeConversation);
    expect(match.toJSON()).toEqual(beforeMatch);
    const stored = await Message.findByPk(message.id);
    expect(stored?.readAt?.toISOString()).toBe(readAt.toISOString());
    expect(stored?.deletedAt).toBeNull();
  });
});

describe('GET /api/v1/conversations/:conversationId', () => {
  it('returns the approved fields for an active conversation with an active match', async () => {
    const { caller, target, match, conversation } = await activeThread();
    await Profile.update(
      { firstName: 'Alex', bio: 'hidden-bio', occupation: 'hidden-occupation' },
      { where: { userId: target.id } }
    );

    const response = await getConversation(caller.id, conversation.id);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        conversationId: conversation.id,
        matchId: match.id,
        status: 'ACTIVE',
        participant: { userId: target.id, firstName: 'Alex' },
        unreadCount: 0
      },
      message: 'Conversation retrieved.'
    });
    expect(Object.keys(response.body).sort()).toEqual(['data', 'message', 'success']);
    expect(Object.keys(response.body.data).sort()).toEqual([
      'conversationId',
      'matchId',
      'participant',
      'status',
      'unreadCount'
    ]);
    expect(Object.keys(response.body.data.participant).sort()).toEqual(['firstName', 'userId']);
    expect(JSON.stringify(response.body)).not.toContain('hidden-bio');
    expect(JSON.stringify(response.body)).not.toContain('hidden-occupation');
    expect(JSON.stringify(response.body)).not.toContain('lastMessage');
    expect(JSON.stringify(response.body)).not.toContain(caller.email ?? 'missing-email');
  });

  it('returns the other participant to either match member', async () => {
    const catalogGender = await gender();
    const left = await buildUser({ genderId: catalogGender.id });
    const right = await buildUser({ genderId: catalogGender.id });
    await Profile.update({ firstName: 'Left' }, { where: { userId: left.id } });
    await Profile.update({ firstName: 'Right' }, { where: { userId: right.id } });
    const { match, conversation } = await openInboxThread({
      callerId: left.id,
      targetId: right.id
    });

    const asLeft = await getConversation(left.id, conversation.id);
    const asRight = await getConversation(right.id, conversation.id);
    expect(asLeft.status).toBe(200);
    expect(asRight.status).toBe(200);
    expect(asLeft.body.data).toEqual({
      conversationId: conversation.id,
      matchId: match.id,
      status: 'ACTIVE',
      participant: { userId: right.id, firstName: 'Right' },
      unreadCount: 0
    });
    expect(asRight.body.data.participant).toEqual({ userId: left.id, firstName: 'Left' });
    expect(asRight.body.data.status).toBe('ACTIVE');
    expect(asRight.body.data.matchId).toBe(match.id);
  });

  it('returns a closed conversation after unmatch', async () => {
    const { caller, target, match, conversation } = await activeThread();
    await Profile.update({ firstName: 'Alex' }, { where: { userId: target.id } });
    await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'still unread',
      createdAt: new Date('2026-10-12T10:00:00.000Z')
    });
    const unmatch = await request(app).delete(`/api/v1/matches/${match.id}`).set(authHeader(caller.id));
    expect(unmatch.status).toBe(200);

    const response = await getConversation(caller.id, conversation.id);
    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Conversation retrieved.');
    expect(response.body.data).toEqual({
      conversationId: conversation.id,
      matchId: match.id,
      status: 'CLOSED',
      participant: { userId: target.id, firstName: 'Alex' },
      unreadCount: 1
    });
    await conversation.reload();
    await match.reload();
    expect(conversation.status).toBe('CLOSED');
    expect(match.status).toBe('UNMATCHED');
  });

  it('returns a closed conversation when the match is undone', async () => {
    const { caller, target, match, conversation } = await activeThread();
    await Profile.update({ firstName: 'Alex' }, { where: { userId: target.id } });
    await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'one',
      createdAt: new Date('2026-10-12T11:00:00.000Z')
    });
    await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'two',
      createdAt: new Date('2026-10-12T11:01:00.000Z')
    });
    await match.update({ status: 'UNDONE' });
    await conversation.update({ status: 'CLOSED', closedAt: new Date('2026-10-12T11:02:00.000Z') });

    const response = await getConversation(caller.id, conversation.id);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      conversationId: conversation.id,
      matchId: match.id,
      status: 'CLOSED',
      participant: { userId: target.id, firstName: 'Alex' },
      unreadCount: 2
    });
    await match.reload();
    expect(match.status).toBe('UNDONE');
  });

  it('hides an active conversation whose match is not active', async () => {
    const { caller, target, conversation } = await activeThread();
    const inactiveMatch = await insertMatch(caller.id, target.id, 'UNMATCHED');
    const inconsistent = await insertConversation(inactiveMatch.id, 'ACTIVE', null, null);

    const hidden = await getConversation(caller.id, inconsistent.id);
    expect(hidden.status).toBe(404);
    expect(hidden.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(hidden.body.error.message).toBe('Resource not found');

    const visible = await getConversation(caller.id, conversation.id);
    expect(visible.status).toBe(200);
    expect(visible.body.data.status).toBe('ACTIVE');
  });

  it('hides unknown and foreign conversations with the same not-found response', async () => {
    const { caller, target, genderId, conversation } = await activeThread();
    const outsider = await buildUser({ genderId, point: north(3) });
    await Profile.update({ firstName: 'Alex', bio: 'hidden-bio' }, { where: { userId: target.id } });

    const missing = await getConversation(caller.id, randomUUID());
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(missing.body.error.message).toBe('Resource not found');

    const foreign = await getConversation(outsider.id, conversation.id);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(foreign.body.error.message).toBe('Resource not found');
    expect(foreign.body.error.details).toEqual(missing.body.error.details);
    expect(JSON.stringify(foreign.body)).not.toContain('Alex');
    expect(JSON.stringify(foreign.body)).not.toContain('hidden-bio');
  });

  it('rejects a block in either direction, including after the conversation is closed', async () => {
    const outgoing = await activeThread();
    await Block.create({
      blockerId: outgoing.caller.id,
      blockedId: outgoing.target.id,
      reason: null,
      createdAt: new Date()
    });
    const callerBlocked = await getConversation(outgoing.target.id, outgoing.conversation.id);
    expect(callerBlocked.status).toBe(409);
    expect(callerBlocked.body.error.code).toBe('BLOCKED_USER');
    expect(callerBlocked.body.error.message).toBe('Interaction prohibited due to an active safety block.');

    const incoming = await activeThread();
    await Block.create({
      blockerId: incoming.target.id,
      blockedId: incoming.caller.id,
      reason: null,
      createdAt: new Date()
    });
    const recipientBlocked = await getConversation(incoming.caller.id, incoming.conversation.id);
    expect(recipientBlocked.status).toBe(409);
    expect(recipientBlocked.body.error.code).toBe('BLOCKED_USER');

    const closed = await activeThread();
    const unmatch = await request(app).delete(`/api/v1/matches/${closed.match.id}`).set(authHeader(closed.caller.id));
    expect(unmatch.status).toBe(200);
    await Block.create({
      blockerId: closed.caller.id,
      blockedId: closed.target.id,
      reason: null,
      createdAt: new Date()
    });
    const closedBlocked = await getConversation(closed.caller.id, closed.conversation.id);
    expect(closedBlocked.status).toBe(409);
    expect(closedBlocked.body.error.code).toBe('BLOCKED_USER');
    await closed.conversation.reload();
    expect(closed.conversation.status).toBe('CLOSED');
  });

  it('rejects an unverified caller and an incomplete profile', async () => {
    const catalogGender = await gender();
    const target = await buildUser({ genderId: catalogGender.id });
    const emailCaller = await buildUser({ genderId: catalogGender.id, emailVerified: false });
    const emailMatch = await insertMatch(emailCaller.id, target.id, 'ACTIVE');
    const emailConversation = await insertConversation(emailMatch.id, 'ACTIVE', null, null);
    const emailResponse = await getConversation(emailCaller.id, emailConversation.id);
    expect(emailResponse.status).toBe(403);
    expect(emailResponse.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(emailResponse.body.error.message).toBe('Email verification is required.');

    const phoneCaller = await buildUser({ genderId: catalogGender.id, phoneOnly: true, emailVerified: false });
    const phoneMatch = await insertMatch(phoneCaller.id, target.id, 'ACTIVE');
    const phoneConversation = await insertConversation(phoneMatch.id, 'ACTIVE', null, null);
    const phoneResponse = await getConversation(phoneCaller.id, phoneConversation.id);
    expect(phoneResponse.status).toBe(403);
    expect(phoneResponse.body.error.code).toBe('PHONE_NOT_VERIFIED');
    expect(phoneResponse.body.error.message).toBe('Phone verification is required.');

    const incomplete = await buildUser({ genderId: catalogGender.id, complete: false });
    const incompleteMatch = await insertMatch(incomplete.id, target.id, 'ACTIVE');
    const incompleteConversation = await insertConversation(incompleteMatch.id, 'ACTIVE', null, null);
    const incompleteResponse = await getConversation(incomplete.id, incompleteConversation.id);
    expect(incompleteResponse.status).toBe(400);
    expect(incompleteResponse.body.error.code).toBe('PROFILE_INCOMPLETE');
    expect(incompleteResponse.body.error.message).toBe('Onboarding is incomplete.');

    const missingPreferences = await buildUser({ genderId: catalogGender.id, preferences: false });
    const preferencesMatch = await insertMatch(missingPreferences.id, target.id, 'ACTIVE');
    const preferencesConversation = await insertConversation(preferencesMatch.id, 'ACTIVE', null, null);
    const preferencesResponse = await getConversation(missingPreferences.id, preferencesConversation.id);
    expect(preferencesResponse.status).toBe(400);
    expect(preferencesResponse.body.error.code).toBe('PROFILE_INCOMPLETE');

    const missingLocation = await buildUser({ genderId: catalogGender.id, point: null });
    const locationMatch = await insertMatch(missingLocation.id, target.id, 'ACTIVE');
    const locationConversation = await insertConversation(locationMatch.id, 'ACTIVE', null, null);
    const locationResponse = await getConversation(missingLocation.id, locationConversation.id);
    expect(locationResponse.status).toBe(400);
    expect(locationResponse.body.error.code).toBe('PROFILE_INCOMPLETE');
  });

  it('rejects a missing token, an invalid token, a deleted account, an admin, a suspended user, and a banned user', async () => {
    const { conversation } = await activeThread();

    const missing = await request(app).get(`/api/v1/conversations/${conversation.id}`);
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('AUTH_REQUIRED');

    const invalid = await request(app)
      .get(`/api/v1/conversations/${conversation.id}`)
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
    const deletedResponse = await getConversation(deleted.id, conversation.id);
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
      .get(`/api/v1/conversations/${conversation.id}`)
      .set(authHeader(admin.id, 'ADMIN'));
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
    const suspendedResponse = await getConversation(suspended.id, conversation.id);
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
    const bannedResponse = await getConversation(banned.id, conversation.id);
    expect(bannedResponse.status).toBe(403);
    expect(bannedResponse.body.error.code).toBe('ACCOUNT_BANNED');
  });

  it('rejects an invalid conversation id before an unsupported query parameter', async () => {
    const { caller } = await activeThread();
    const response = await request(app)
      .get('/api/v1/conversations/not-a-uuid')
      .query({ limit: '20' })
      .set(authHeader(caller.id));
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.message).toBe('Validation failed');
    expect(response.body.error.details).toEqual([
      { field: 'conversationId', message: 'Conversation id must be a valid UUID.' }
    ]);
  });

  it('rejects any query parameter', async () => {
    const { caller, conversation } = await activeThread();

    for (const query of [{ sort: 'desc' }, { limit: '20' }, { cursor: 'abc' }]) {
      const response = await request(app)
        .get(`/api/v1/conversations/${conversation.id}`)
        .query(query)
        .set(authHeader(caller.id));
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toBe('Validation failed');
      expect(response.body.error.details).toEqual([
        { field: Object.keys(query)[0], message: 'Unsupported query parameter.' }
      ]);
    }
  });

  it('counts every incoming unread message type and ignores own, read, and deleted rows', async () => {
    const { caller, target, conversation } = await activeThread();
    const createdAt = new Date('2026-10-12T10:00:00.000Z');
    const storageKey = `private/${randomUUID()}/details-secret`;
    await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'text',
      createdAt
    });
    for (const messageType of ['IMAGE', 'GIF', 'VIDEO', 'VOICE'] as const) {
      await insertHistoryMessage({
        conversationId: conversation.id,
        senderId: target.id,
        content: null,
        createdAt,
        messageType,
        mediaStorageKey: storageKey
      });
    }
    await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: null,
      createdAt: new Date('2026-10-12T10:05:00.000Z'),
      messageType: 'IMAGE',
      readAt: new Date('2026-10-12T10:06:00.000Z'),
      mediaStorageKey: storageKey
    });
    const removed = await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'gone',
      createdAt: new Date('2026-10-12T10:07:00.000Z')
    });
    await removed.destroy();
    await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: caller.id,
      content: 'own',
      createdAt: new Date('2026-10-12T10:08:00.000Z')
    });

    const response = await getConversation(caller.id, conversation.id);
    expect(response.status).toBe(200);
    expect(response.body.data.unreadCount).toBe(5);
    expect(response.body.data).not.toHaveProperty('lastMessage');
    expect(JSON.stringify(response.body)).not.toContain(storageKey);
    expect(JSON.stringify(response.body)).not.toContain('gone');
    expect(JSON.stringify(response.body)).not.toContain('own');
  });

  it('hides a conversation when the other participant has no profile', async () => {
    const { caller, target, conversation } = await activeThread();
    await Profile.destroy({ where: { userId: target.id } });

    const response = await getConversation(caller.id, conversation.id);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(response.body.error.message).toBe('Resource not found');
    expect(JSON.stringify(response.body)).not.toContain(target.id);
  });

  it('does not write rows or emit socket events', async () => {
    const { caller, target, match, conversation } = await activeThread();
    const readAt = new Date('2026-10-12T10:01:00.000Z');
    const createdAt = new Date('2026-10-12T10:00:00.000Z');
    const message = await insertHistoryMessage({
      conversationId: conversation.id,
      senderId: target.id,
      content: 'steady',
      createdAt,
      readAt
    });
    await conversation.update({ lastMessageAt: createdAt });
    await sequelize.query(`UPDATE conversations SET last_message_at = :createdAt WHERE id = CAST(:id AS uuid)`, {
      replacements: { id: conversation.id, createdAt }
    });
    await seedTextUsage(caller.id, 4);
    await UserCreditBalance.create({
      userId: caller.id,
      creditType: 'SUPER_LIKE',
      balance: 3,
      ...timestamps()
    });
    await CreditTransaction.create({
      userId: caller.id,
      creditType: 'SUPER_LIKE',
      delta: -1,
      reason: 'CONSUMPTION',
      createdAt: new Date()
    });

    const beforeMessages = await Message.findAll({ paranoid: false });
    const beforeUsage = await UsageRecord.count();
    const beforeBlocks = await Block.count();
    await conversation.reload();
    await match.reload();
    const beforeConversation = conversation.toJSON();
    const beforeMatch = match.toJSON();
    const socket = attachFakeSocket();

    try {
      const response = await getConversation(caller.id, conversation.id);
      expect(response.status).toBe(200);
      expect(response.body.data.unreadCount).toBe(0);
      expect(socket.emit).not.toHaveBeenCalled();
    } finally {
      socket.detach();
    }

    const afterMessages = await Message.findAll({ paranoid: false });
    expect(afterMessages.map((row) => row.toJSON())).toEqual(beforeMessages.map((row) => row.toJSON()));
    expect(await UsageRecord.count()).toBe(beforeUsage);
    expect(await textMessageUsageCount(caller.id)).toBe(4);
    expect(await textMessageUsageCount(target.id)).toBe(0);
    expect(await UserCreditBalance.count()).toBe(1);
    expect(await CreditTransaction.count()).toBe(1);
    expect(await Block.count()).toBe(beforeBlocks);
    await conversation.reload();
    await match.reload();
    expect(conversation.toJSON()).toEqual(beforeConversation);
    expect(match.toJSON()).toEqual(beforeMatch);
    const stored = await Message.findByPk(message.id);
    expect(stored?.readAt?.toISOString()).toBe(readAt.toISOString());
    expect(stored?.deletedAt).toBeNull();
  });
});

const MEDIA_UPLOAD_CASES = [
  { mediaType: 'IMAGE', mimeType: 'image/jpeg', max: 10_485_760 },
  { mediaType: 'IMAGE', mimeType: 'image/png', max: 10_485_760 },
  { mediaType: 'IMAGE', mimeType: 'image/webp', max: 10_485_760 },
  { mediaType: 'GIF', mimeType: 'image/gif', max: 15_728_640 },
  { mediaType: 'VIDEO', mimeType: 'video/mp4', max: 52_428_800 },
  { mediaType: 'VIDEO', mimeType: 'video/webm', max: 52_428_800 },
  { mediaType: 'VOICE', mimeType: 'audio/mpeg', max: 10_485_760 },
  { mediaType: 'VOICE', mimeType: 'audio/mp4', max: 10_485_760 },
  { mediaType: 'VOICE', mimeType: 'audio/ogg', max: 10_485_760 },
  { mediaType: 'VOICE', mimeType: 'audio/webm', max: 10_485_760 },
  { mediaType: 'VOICE', mimeType: 'audio/wav', max: 10_485_760 }
] as const;

function requestMediaUpload(callerId: string | null, conversationId: string, body?: unknown) {
  const pending = request(app).post(`/api/v1/conversations/${conversationId}/media-upload-url`);
  if (callerId) {
    pending.set(authHeader(callerId));
  }
  return body === undefined ? pending : pending.send(body);
}

describe('POST /api/v1/conversations/:conversationId/media-upload-url', () => {
  let setSpy: jest.SpyInstance;

  beforeEach(() => {
    resetMemoryRedis();
    setSpy = jest.spyOn(redis, 'set');
    mockPhotoStorage.createUploadUrl.mockReset();
    mockPhotoStorage.createUploadUrl.mockImplementation(
      async (input: { storageKey: string; mimeType: string; expiresInSeconds: number }) => ({
        url: `https://upload.test/${input.storageKey}`,
        expiresInSeconds: input.expiresInSeconds
      })
    );
  });

  afterEach(() => {
    setSpy.mockRestore();
  });

  it('rejects mismatched MIME types, bad sizes, missing fields, and unknown fields', async () => {
    const { caller, conversation } = await activeThread();
    const mismatches = [
      { mediaType: 'IMAGE', mimeType: 'image/gif', message: 'Mime type must be image/jpeg, image/png, or image/webp.' },
      { mediaType: 'GIF', mimeType: 'image/jpeg', message: 'Mime type must be image/gif.' },
      { mediaType: 'VIDEO', mimeType: 'audio/mpeg', message: 'Mime type must be video/mp4 or video/webm.' },
      {
        mediaType: 'VOICE',
        mimeType: 'video/mp4',
        message: 'Mime type must be audio/mpeg, audio/mp4, audio/ogg, audio/webm, or audio/wav.'
      }
    ];

    for (const mismatch of mismatches) {
      const response = await requestMediaUpload(caller.id, conversation.id, {
        mediaType: mismatch.mediaType,
        mimeType: mismatch.mimeType,
        fileSizeBytes: 128
      });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'mimeType', message: mismatch.message })])
      );
    }

    const zero = await requestMediaUpload(caller.id, conversation.id, {
      mediaType: 'IMAGE',
      mimeType: 'image/jpeg',
      fileSizeBytes: 0
    });
    expect(zero.status).toBe(400);
    expect(zero.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'fileSizeBytes', message: 'File size must be at least 1 byte.' })
      ])
    );

    const negative = await requestMediaUpload(caller.id, conversation.id, {
      mediaType: 'IMAGE',
      mimeType: 'image/jpeg',
      fileSizeBytes: -1
    });
    expect(negative.status).toBe(400);
    expect(negative.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'fileSizeBytes', message: 'File size must be at least 1 byte.' })
      ])
    );

    const decimal = await requestMediaUpload(caller.id, conversation.id, {
      mediaType: 'IMAGE',
      mimeType: 'image/jpeg',
      fileSizeBytes: 1.5
    });
    expect(decimal.status).toBe(400);
    expect(decimal.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'fileSizeBytes', message: 'File size must be a whole number of bytes.' })
      ])
    );

    const nonNumeric = await requestMediaUpload(caller.id, conversation.id, {
      mediaType: 'IMAGE',
      mimeType: 'image/jpeg',
      fileSizeBytes: '2048'
    });
    expect(nonNumeric.status).toBe(400);
    expect(nonNumeric.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'fileSizeBytes', message: 'File size must be a number of bytes.' })
      ])
    );

    for (const mediaCase of MEDIA_UPLOAD_CASES) {
      const over = await requestMediaUpload(caller.id, conversation.id, {
        mediaType: mediaCase.mediaType,
        mimeType: mediaCase.mimeType,
        fileSizeBytes: mediaCase.max + 1
      });
      expect(over.status).toBe(400);
      expect(over.body.error.code).toBe('VALIDATION_ERROR');
      expect(over.body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'fileSizeBytes',
            message: `File size must be at most ${mediaCase.max} bytes.`
          })
        ])
      );
    }

    const missing = await requestMediaUpload(caller.id, conversation.id, {});
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');
    expect(missing.body.error.details.map((detail: { field: string }) => detail.field).sort()).toEqual([
      'fileSizeBytes',
      'mediaType',
      'mimeType'
    ]);

    const unknown = await requestMediaUpload(caller.id, conversation.id, {
      mediaType: 'IMAGE',
      mimeType: 'image/jpeg',
      fileSizeBytes: 128,
      storageKey: 'client/chosen',
      caption: 'hello',
      filename: 'photo.jpg',
      senderId: caller.id,
      uploadId: randomUUID()
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('VALIDATION_ERROR');
    expect(unknown.body.error.details[0].message).toContain('storageKey');
    expect(unknown.body.error.details[0].message).toContain('caption');
    expect(unknown.body.error.details[0].message).toContain('filename');
    expect(unknown.body.error.details[0].message).toContain('senderId');
    expect(unknown.body.error.details[0].message).toContain('uploadId');

    expect(mockPhotoStorage.createUploadUrl).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
    expect(await Message.count()).toBe(0);
    expect(await textMessageUsageCount(caller.id)).toBe(0);
  });

  it('rejects unauthenticated, non-USER, unverified, and incomplete callers before signing', async () => {
    const { caller, conversation } = await activeThread();
    const body = { mediaType: 'IMAGE', mimeType: 'image/jpeg', fileSizeBytes: 128 };

    const missing = await requestMediaUpload(null, conversation.id, body);
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
    const forbidden = await request(app)
      .post(`/api/v1/conversations/${conversation.id}/media-upload-url`)
      .set(authHeader(admin.id, 'ADMIN'))
      .send(body);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');

    const catalogGender = await gender();
    const target = await buildUser({ genderId: catalogGender.id });
    const emailCaller = await buildUser({ genderId: catalogGender.id, emailVerified: false });
    const emailMatch = await insertMatch(emailCaller.id, target.id, 'ACTIVE');
    const emailConversation = await insertConversation(emailMatch.id, 'ACTIVE', null, null);
    const emailResponse = await requestMediaUpload(emailCaller.id, emailConversation.id, body);
    expect(emailResponse.status).toBe(403);
    expect(emailResponse.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    const phoneCaller = await buildUser({ genderId: catalogGender.id, phoneOnly: true, emailVerified: false });
    const phoneMatch = await insertMatch(phoneCaller.id, target.id, 'ACTIVE');
    const phoneConversation = await insertConversation(phoneMatch.id, 'ACTIVE', null, null);
    const phoneResponse = await requestMediaUpload(phoneCaller.id, phoneConversation.id, body);
    expect(phoneResponse.status).toBe(403);
    expect(phoneResponse.body.error.code).toBe('PHONE_NOT_VERIFIED');

    const incomplete = await buildUser({ genderId: catalogGender.id, complete: false });
    const incompleteMatch = await insertMatch(incomplete.id, target.id, 'ACTIVE');
    const incompleteConversation = await insertConversation(incompleteMatch.id, 'ACTIVE', null, null);
    const incompleteResponse = await requestMediaUpload(incomplete.id, incompleteConversation.id, body);
    expect(incompleteResponse.status).toBe(400);
    expect(incompleteResponse.body.error.code).toBe('PROFILE_INCOMPLETE');

    const missingPreferences = await buildUser({ genderId: catalogGender.id, preferences: false });
    const preferencesMatch = await insertMatch(missingPreferences.id, target.id, 'ACTIVE');
    const preferencesConversation = await insertConversation(preferencesMatch.id, 'ACTIVE', null, null);
    const preferencesResponse = await requestMediaUpload(missingPreferences.id, preferencesConversation.id, body);
    expect(preferencesResponse.status).toBe(400);
    expect(preferencesResponse.body.error.code).toBe('PROFILE_INCOMPLETE');

    const missingLocation = await buildUser({ genderId: catalogGender.id, point: null });
    const locationMatch = await insertMatch(missingLocation.id, target.id, 'ACTIVE');
    const locationConversation = await insertConversation(locationMatch.id, 'ACTIVE', null, null);
    const locationResponse = await requestMediaUpload(missingLocation.id, locationConversation.id, body);
    expect(locationResponse.status).toBe(400);
    expect(locationResponse.body.error.code).toBe('PROFILE_INCOMPLETE');

    expect(mockPhotoStorage.createUploadUrl).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
    expect(await Message.count()).toBe(0);
    expect(await textMessageUsageCount(caller.id)).toBe(0);
  });

  it('rejects a non-participant, a closed conversation, an inactive match, and either block', async () => {
    const { caller, target, genderId, conversation } = await activeThread();
    await grantPremium(caller.id);
    const body = { mediaType: 'IMAGE', mimeType: 'image/png', fileSizeBytes: 64 };
    const outsider = await buildUser({ genderId, point: north(3) });
    await grantPremium(outsider.id);

    const foreign = await requestMediaUpload(outsider.id, conversation.id, body);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(foreign.body.error.message).toBe('Resource not found');

    const closedPair = await pair();
    await grantPremium(closedPair.caller.id);
    const closedMatch = await insertMatch(closedPair.caller.id, closedPair.target.id, 'ACTIVE');
    const closed = await insertConversation(closedMatch.id, 'CLOSED', new Date(), null);
    const closedResponse = await requestMediaUpload(closedPair.caller.id, closed.id, body);
    expect(closedResponse.status).toBe(404);
    expect(closedResponse.body.error.code).toBe('CONVERSATION_CLOSED');
    expect(closedResponse.body.error.message).toBe('Conversation is closed due to unmatch or safety block.');

    const inactiveMatch = await insertMatch(caller.id, target.id, 'UNMATCHED');
    const inactiveConversation = await insertConversation(inactiveMatch.id, 'ACTIVE', null, null);
    const inactiveResponse = await requestMediaUpload(caller.id, inactiveConversation.id, body);
    expect(inactiveResponse.status).toBe(404);
    expect(inactiveResponse.body.error.code).toBe('RESOURCE_NOT_FOUND');

    await Block.create({
      blockerId: caller.id,
      blockedId: target.id,
      reason: null,
      createdAt: new Date()
    });
    const callerBlocked = await requestMediaUpload(caller.id, conversation.id, body);
    expect(callerBlocked.status).toBe(409);
    expect(callerBlocked.body.error.code).toBe('BLOCKED_USER');

    const reverse = await activeThread();
    await grantPremium(reverse.caller.id);
    await Block.create({
      blockerId: reverse.target.id,
      blockedId: reverse.caller.id,
      reason: null,
      createdAt: new Date()
    });
    const recipientBlocked = await requestMediaUpload(reverse.caller.id, reverse.conversation.id, body);
    expect(recipientBlocked.status).toBe(409);
    expect(recipientBlocked.body.error.code).toBe('BLOCKED_USER');
    expect(recipientBlocked.body.error.message).toBe('Interaction prohibited due to an active safety block.');

    expect(mockPhotoStorage.createUploadUrl).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
    expect(await Message.count()).toBe(0);
    await conversation.reload();
    expect(conversation.lastMessageAt).toBeNull();
    expect(await textMessageUsageCount(caller.id)).toBe(0);
  });

  it('rejects a free caller with PREMIUM_REQUIRED and does not reserve an upload', async () => {
    const { caller, conversation } = await activeThread();
    const socket = attachFakeSocket();

    const response = await requestMediaUpload(caller.id, conversation.id, {
      mediaType: 'VIDEO',
      mimeType: 'video/mp4',
      fileSizeBytes: 1024
    });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('PREMIUM_REQUIRED');
    expect(response.body.error.message).toBe('Feature requires an active Premium subscription.');
    expect(mockPhotoStorage.createUploadUrl).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
    expect(await Message.count()).toBe(0);
    await conversation.reload();
    expect(conversation.lastMessageAt).toBeNull();
    expect(await textMessageUsageCount(caller.id)).toBe(0);
    socket.detach();
  });

  it('issues a private upload URL and a 300-second reservation without writing a message', async () => {
    const { caller, conversation } = await activeThread();
    await grantPremium(caller.id);
    const socket = attachFakeSocket();
    const priorLastMessageAt = conversation.lastMessageAt;

    const response = await requestMediaUpload(caller.id, conversation.id, {
      mediaType: 'IMAGE',
      mimeType: 'image/jpeg',
      fileSizeBytes: 2048
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Upload URL created.');
    expect(Object.keys(response.body.data).sort()).toEqual([
      'expiresInSeconds',
      'storageKey',
      'uploadId',
      'uploadUrl'
    ]);
    const uploadId = response.body.data.uploadId as string;
    const storageKey = response.body.data.storageKey as string;
    expect(uploadId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(storageKey).toBe(`chat-media/${conversation.id}/${uploadId}`);
    expect(storageKey.startsWith('photos/')).toBe(false);
    expect(storageKey.endsWith('.webp')).toBe(false);
    expect(storageKey.length).toBeLessThanOrEqual(512);
    expect(response.body.data.uploadUrl).toBe(`https://upload.test/${storageKey}`);
    expect(response.body.data.expiresInSeconds).toBe(300);
    expect(mockPhotoStorage.createUploadUrl).toHaveBeenCalledTimes(1);
    expect(mockPhotoStorage.createUploadUrl).toHaveBeenCalledWith({
      storageKey,
      mimeType: 'image/jpeg',
      expiresInSeconds: 300
    });
    expect(mockPhotoStorage.createUploadUrl.mock.calls[0][0]).not.toHaveProperty('ACL');

    const reservation = JSON.parse((await redis.get(`chat-media:upload:${uploadId}`)) ?? 'null');
    expect(reservation).toEqual({
      uploadId,
      userId: caller.id,
      conversationId: conversation.id,
      storageKey,
      mediaType: 'IMAGE',
      mimeType: 'image/jpeg',
      fileSizeBytes: 2048
    });
    const ttl = await redis.ttl(`chat-media:upload:${uploadId}`);
    expect(ttl).toBeGreaterThanOrEqual(299);
    expect(ttl).toBeLessThanOrEqual(300);

    expect(socket.emit).not.toHaveBeenCalled();
    expect(await Message.count()).toBe(0);
    await conversation.reload();
    expect(conversation.lastMessageAt).toEqual(priorLastMessageAt);
    expect(await textMessageUsageCount(caller.id)).toBe(0);
    expect(await textMessageUsageRowCount()).toBe(0);
    socket.detach();
  });

  it('accepts every allowed media type at the minimum and maximum size', async () => {
    const { caller, conversation } = await activeThread();
    await grantPremium(caller.id);

    for (const mediaCase of MEDIA_UPLOAD_CASES) {
      for (const fileSizeBytes of [1, mediaCase.max]) {
        const response = await requestMediaUpload(caller.id, conversation.id, {
          mediaType: mediaCase.mediaType,
          mimeType: mediaCase.mimeType,
          fileSizeBytes
        });
        expect(response.status).toBe(200);
        const uploadId = response.body.data.uploadId as string;
        expect(response.body.data.storageKey).toBe(`chat-media/${conversation.id}/${uploadId}`);
        expect(mockPhotoStorage.createUploadUrl).toHaveBeenCalledWith({
          storageKey: response.body.data.storageKey,
          mimeType: mediaCase.mimeType,
          expiresInSeconds: 300
        });
        const reservation = JSON.parse((await redis.get(`chat-media:upload:${uploadId}`)) ?? 'null');
        expect(reservation).toMatchObject({
          uploadId,
          userId: caller.id,
          conversationId: conversation.id,
          mediaType: mediaCase.mediaType,
          mimeType: mediaCase.mimeType,
          fileSizeBytes
        });
      }
    }

    expect(await Message.count()).toBe(0);
    expect(await textMessageUsageCount(caller.id)).toBe(0);
  });

  it('does not reserve an upload when signing fails and does not return a URL when Redis fails', async () => {
    const { caller, conversation } = await activeThread();
    await grantPremium(caller.id);
    const body = { mediaType: 'VOICE', mimeType: 'audio/ogg', fileSizeBytes: 32 };

    mockPhotoStorage.createUploadUrl.mockRejectedValueOnce(
      new InternalServerError('Photo storage is not configured.', [], 'STORAGE_NOT_CONFIGURED', true)
    );
    const unconfigured = await requestMediaUpload(caller.id, conversation.id, body);
    expect(unconfigured.status).toBe(500);
    expect(unconfigured.body.error.code).toBe('STORAGE_NOT_CONFIGURED');
    expect(unconfigured.body.error.message).toBe('Photo storage is not configured.');
    expect(unconfigured.body.success).toBe(false);
    expect(setSpy).not.toHaveBeenCalled();

    const reservationError = new InternalServerError('Reservation store failed.', [], 'RESERVATION_STORE_FAILED', true);
    const cleanupError = new InternalServerError('Cleanup failed.', [], 'CLEANUP_FAILED', true);
    setSpy.mockRejectedValueOnce(reservationError);
    const delSpy = jest.spyOn(redis, 'del').mockRejectedValueOnce(cleanupError);
    const failedReservation = await requestMediaUpload(caller.id, conversation.id, body);
    expect(failedReservation.status).toBe(500);
    expect(failedReservation.body.success).toBe(false);
    expect(failedReservation.body.error.code).toBe('RESERVATION_STORE_FAILED');
    expect(failedReservation.body.error.message).toBe('Reservation store failed.');
    expect(failedReservation.body.data).toBeUndefined();
    expect(delSpy).toHaveBeenCalled();
    delSpy.mockRestore();

    expect(await Message.count()).toBe(0);
    await conversation.reload();
    expect(conversation.lastMessageAt).toBeNull();
    expect(await textMessageUsageCount(caller.id)).toBe(0);
  });
});

const MEDIA_CONFIRM_CASES = [
  { mediaType: 'IMAGE', mimeType: 'image/jpeg', fileSizeBytes: 2048 },
  { mediaType: 'GIF', mimeType: 'image/gif', fileSizeBytes: 15_728_640 },
  { mediaType: 'VIDEO', mimeType: 'video/mp4', fileSizeBytes: 52_428_800 },
  { mediaType: 'VOICE', mimeType: 'audio/ogg', fileSizeBytes: 32 }
] as const;

function confirmMedia(callerId: string | null, conversationId: string, body?: unknown) {
  const pending = request(app).post(`/api/v1/conversations/${conversationId}/media-confirm`);
  if (callerId) {
    pending.set(authHeader(callerId));
  }
  return body === undefined ? pending : pending.send(body);
}

function stubMediaHead(contentType: string, contentLength: number): void {
  mockPhotoStorage.headObject.mockResolvedValue({ contentType, contentLength });
}

describe('POST /api/v1/conversations/:conversationId/media-confirm', () => {
  beforeEach(() => {
    resetMemoryRedis();
    mockPhotoStorage.headObject.mockReset();
    mockPhotoStorage.createUploadUrl.mockReset();
    mockPhotoStorage.createUploadUrl.mockImplementation(
      async (input: { storageKey: string; mimeType: string; expiresInSeconds: number }) => ({
        url: `https://upload.test/${input.storageKey}`,
        expiresInSeconds: input.expiresInSeconds
      })
    );
  });

  it('rejects an invalid body or conversation id before storage or persistence', async () => {
    const { caller, conversation } = await activeThread();
    await grantPremium(caller.id);
    const uploadId = randomUUID();

    const missing = await confirmMedia(caller.id, conversation.id, {});
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');
    expect(missing.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'uploadId', message: 'Upload id is required.' })])
    );

    const malformed = await confirmMedia(caller.id, conversation.id, { uploadId: 'not-a-uuid' });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'uploadId', message: 'Upload id must be a valid UUID.' })
      ])
    );

    const unknown = await confirmMedia(caller.id, conversation.id, {
      uploadId,
      storageKey: 'client/key',
      mimeType: 'image/jpeg',
      fileSizeBytes: 10,
      senderId: caller.id,
      filename: 'a.jpg',
      caption: 'hello'
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('VALIDATION_ERROR');
    expect(unknown.body.error.details[0].message).toContain('storageKey');
    expect(unknown.body.error.details[0].message).toContain('caption');

    const badConversation = await confirmMedia(caller.id, 'not-a-uuid', { uploadId });
    expect(badConversation.status).toBe(400);
    expect(badConversation.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'conversationId', message: 'Conversation id must be a valid UUID.' })
      ])
    );

    expect(mockPhotoStorage.headObject).not.toHaveBeenCalled();
    expect(await Message.count()).toBe(0);
  });

  it('confirms each media type, persists verified metadata, and leaves the text quota unchanged', async () => {
    const { caller, conversation } = await activeThread();
    await grantPremium(caller.id);

    for (const mediaCase of MEDIA_CONFIRM_CASES) {
      stubMediaHead(mediaCase.mimeType, mediaCase.fileSizeBytes);
      const issued = await requestMediaUpload(caller.id, conversation.id, mediaCase);
      expect(issued.status).toBe(200);
      const uploadId = (issued.body.data.uploadId as string).toUpperCase();
      const storageKey = issued.body.data.storageKey as string;

      const response = await confirmMedia(caller.id, conversation.id, { uploadId });
      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Message sent.');
      expect(Object.keys(response.body.data).sort()).toEqual([
        'content',
        'conversationId',
        'createdAt',
        'id',
        'mediaUrl',
        'messageType',
        'readAt',
        'senderId'
      ]);
      expect(response.body.data).toMatchObject({
        id: uploadId.toLowerCase(),
        conversationId: conversation.id,
        senderId: caller.id,
        messageType: mediaCase.mediaType,
        content: null,
        mediaUrl: null,
        readAt: null
      });
      expect(response.body.data.storageKey).toBeUndefined();
      expect(response.body.data.remainingDailyMessages).toBeUndefined();

      const stored = await Message.findByPk(uploadId.toLowerCase());
      expect(stored?.messageType).toBe(mediaCase.mediaType);
      expect(stored?.content).toBeNull();
      expect(stored?.readAt).toBeNull();
      expect(stored?.mediaStorageKey).toBe(storageKey);
      expect(stored?.mediaStorageKey).toBe(`chat-media/${conversation.id}/${uploadId.toLowerCase()}`);
      expect(stored?.mediaMimeType).toBe(mediaCase.mimeType);
      expect(stored?.mediaFileSize).toBe(mediaCase.fileSizeBytes);
      expect(response.body.data.createdAt).toBe(stored?.createdAt.toISOString());
      await conversation.reload();
      expect(conversation.lastMessageAt?.toISOString()).toBe(stored?.createdAt.toISOString());
      expect(mockPhotoStorage.headObject).toHaveBeenCalledWith({ storageKey });
      expect(await redis.get(`chat-media:upload:${uploadId.toLowerCase()}`)).toBeNull();
    }

    expect(await Message.count()).toBe(MEDIA_CONFIRM_CASES.length);
    expect(await textMessageUsageCount(caller.id)).toBe(0);
    expect(await textMessageUsageRowCount()).toBe(0);
  });

  it('replays a matching message after reservation deletion or expiry without another insert or event', async () => {
    const { caller, target, conversation } = await activeThread();
    await grantPremium(caller.id);
    stubMediaHead('image/png', 64);
    const socket = attachFakeSocket();
    const issued = await requestMediaUpload(caller.id, conversation.id, {
      mediaType: 'IMAGE',
      mimeType: 'image/png',
      fileSizeBytes: 64
    });
    const uploadId = issued.body.data.uploadId as string;
    const created = await confirmMedia(caller.id, conversation.id, { uploadId });
    expect(created.status).toBe(201);
    const createdAt = created.body.data.createdAt as string;
    await conversation.reload();
    const lastMessageAt = conversation.lastMessageAt?.toISOString();
    expect(socket.emit).toHaveBeenCalledTimes(1);

    await redis.del(`chat-media:upload:${uploadId}`);
    const headCalls = mockPhotoStorage.headObject.mock.calls.length;
    const replay = await confirmMedia(caller.id, conversation.id, { uploadId });
    expect(replay.status).toBe(200);
    expect(replay.body.message).toBe('Message sent.');
    expect(replay.body.data).toMatchObject({
      id: uploadId,
      messageType: 'IMAGE',
      content: null,
      mediaUrl: null,
      readAt: null,
      createdAt
    });
    expect(mockPhotoStorage.headObject).toHaveBeenCalledTimes(headCalls);
    expect(await Message.count()).toBe(1);
    await conversation.reload();
    expect(conversation.lastMessageAt?.toISOString()).toBe(lastMessageAt);
    expect(socket.emit).toHaveBeenCalledTimes(1);

    const expiredId = randomUUID();
    const expiredKey = `chat-media:upload:${expiredId}`;
    await redis.set(
      expiredKey,
      JSON.stringify({
        uploadId: expiredId,
        userId: caller.id,
        conversationId: conversation.id,
        storageKey: `chat-media/${conversation.id}/${expiredId}`,
        mediaType: 'IMAGE',
        mimeType: 'image/png',
        fileSizeBytes: 64
      }),
      'EX',
      1
    );
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(await redis.get(expiredKey)).toBeNull();
    const expiredMissing = await confirmMedia(caller.id, conversation.id, { uploadId: expiredId });
    expect(expiredMissing.status).toBe(404);
    expect(expiredMissing.body.error.code).toBe('RESOURCE_NOT_FOUND');

    await Message.create({
      id: expiredId,
      conversationId: conversation.id,
      senderId: caller.id,
      messageType: 'IMAGE',
      content: null,
      mediaStorageKey: `chat-media/${conversation.id}/${expiredId}`,
      mediaMimeType: 'image/png',
      mediaFileSize: 64,
      readAt: null,
      ...timestamps()
    });
    const expiredReplay = await confirmMedia(caller.id, conversation.id, { uploadId: expiredId });
    expect(expiredReplay.status).toBe(200);
    expect(expiredReplay.body.data.id).toBe(expiredId);
    expect(await Message.count()).toBe(2);
    expect(socket.emit).toHaveBeenCalledTimes(1);
    expect(socket.rooms).toEqual([`user:${target.id}`]);
    socket.detach();
  });

  it('creates one message when the same upload is confirmed concurrently', async () => {
    const { caller, target, conversation } = await activeThread();
    await grantPremium(caller.id);
    stubMediaHead('video/webm', 128);
    const socket = attachFakeSocket();
    const issued = await requestMediaUpload(caller.id, conversation.id, {
      mediaType: 'VIDEO',
      mimeType: 'video/webm',
      fileSizeBytes: 128
    });
    const uploadId = issued.body.data.uploadId as string;

    const [first, second] = await Promise.all([
      confirmMedia(caller.id, conversation.id, { uploadId }),
      confirmMedia(caller.id, conversation.id, { uploadId })
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 201]);
    expect(await Message.count()).toBe(1);
    expect(socket.emit).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenCalledWith(
      'chat:message:new',
      expect.objectContaining({
        id: uploadId,
        conversationId: conversation.id,
        senderId: caller.id,
        messageType: 'VIDEO',
        content: null
      })
    );
    expect(socket.rooms).toEqual([`user:${target.id}`]);
    const stored = await Message.findByPk(uploadId);
    expect(socket.emit.mock.calls[0][1].createdAt).toBe(stored?.createdAt.toISOString());
    socket.detach();
  });

  it('does not call storage for a missing, malformed, or mismatched reservation', async () => {
    const { caller, target, genderId, conversation } = await activeThread();
    await grantPremium(caller.id);
    const uploadId = randomUUID();
    const key = `chat-media:upload:${uploadId}`;
    const canonical = `chat-media/${conversation.id}/${uploadId}`;
    const reservation = {
      uploadId,
      userId: caller.id,
      conversationId: conversation.id,
      storageKey: canonical,
      mediaType: 'IMAGE',
      mimeType: 'image/jpeg',
      fileSizeBytes: 128
    };

    const missing = await confirmMedia(caller.id, conversation.id, { uploadId });
    expect(missing.status).toBe(404);
    expect(missing.body.error).toMatchObject({ code: 'RESOURCE_NOT_FOUND', message: 'Resource not found' });

    await redis.set(key, '{', 'EX', 300);
    const malformed = await confirmMedia(caller.id, conversation.id, { uploadId });
    expect(malformed.status).toBe(404);
    expect(malformed.body.error.code).toBe('RESOURCE_NOT_FOUND');

    await redis.set(key, JSON.stringify({ ...reservation, userId: target.id }), 'EX', 300);
    const wrongUser = await confirmMedia(caller.id, conversation.id, { uploadId });
    expect(wrongUser.status).toBe(404);

    const other = await buildUser({ genderId, point: north(4) });
    const otherMatch = await insertMatch(caller.id, other.id, 'ACTIVE');
    const otherConversation = await insertConversation(otherMatch.id, 'ACTIVE', null, null);
    await redis.set(key, JSON.stringify(reservation), 'EX', 300);
    const wrongConversation = await confirmMedia(caller.id, otherConversation.id, { uploadId });
    expect(wrongConversation.status).toBe(404);

    await redis.set(key, JSON.stringify({ ...reservation, storageKey: 'photos/not-canonical' }), 'EX', 300);
    const wrongKey = await confirmMedia(caller.id, conversation.id, { uploadId });
    expect(wrongKey.status).toBe(404);
    expect(wrongKey.body.error.message).toBe('Resource not found');

    expect(mockPhotoStorage.headObject).not.toHaveBeenCalled();
    expect(await Message.count()).toBe(0);
  });

  it('rejects missing objects and metadata mismatches without deleting the reservation', async () => {
    const { caller, conversation } = await activeThread();
    await grantPremium(caller.id);
    const issued = await requestMediaUpload(caller.id, conversation.id, {
      mediaType: 'IMAGE',
      mimeType: 'image/jpeg',
      fileSizeBytes: 2048
    });
    const uploadId = issued.body.data.uploadId as string;
    const storageKey = issued.body.data.storageKey as string;
    const socket = attachFakeSocket();

    mockPhotoStorage.headObject.mockRejectedValueOnce(new StorageObjectMissingError());
    const missingObject = await confirmMedia(caller.id, conversation.id, { uploadId });
    expect(missingObject.status).toBe(404);
    expect(missingObject.body.error).toMatchObject({
      code: 'MEDIA_NOT_UPLOADED',
      message: 'Uploaded media was not found.'
    });
    expect(await redis.get(`chat-media:upload:${uploadId}`)).not.toBeNull();

    mockPhotoStorage.headObject.mockResolvedValueOnce({ contentType: 'image/jpeg', contentLength: 100 });
    const smaller = await confirmMedia(caller.id, conversation.id, { uploadId });
    expect(smaller.status).toBe(409);
    expect(smaller.body.error).toMatchObject({
      code: 'MEDIA_SIZE_MISMATCH',
      message: 'Uploaded media size does not match the reservation.'
    });

    mockPhotoStorage.headObject.mockResolvedValueOnce({ contentType: 'image/jpeg' });
    const missingLength = await confirmMedia(caller.id, conversation.id, { uploadId });
    expect(missingLength.status).toBe(409);
    expect(missingLength.body.error.code).toBe('MEDIA_SIZE_MISMATCH');

    mockPhotoStorage.headObject.mockResolvedValueOnce({ contentType: 'image/png', contentLength: 2048 });
    const mime = await confirmMedia(caller.id, conversation.id, { uploadId });
    expect(mime.status).toBe(409);
    expect(mime.body.error).toMatchObject({
      code: 'MEDIA_MIME_MISMATCH',
      message: 'Uploaded media type does not match the reservation.'
    });

    mockPhotoStorage.headObject.mockResolvedValueOnce({ contentLength: 2048 });
    const missingType = await confirmMedia(caller.id, conversation.id, { uploadId });
    expect(missingType.status).toBe(409);
    expect(missingType.body.error.code).toBe('MEDIA_MIME_MISMATCH');

    expect(mockPhotoStorage.headObject).toHaveBeenCalledWith({ storageKey });
    expect(await redis.get(`chat-media:upload:${uploadId}`)).not.toBeNull();
    expect(await Message.count()).toBe(0);
    expect(socket.emit).not.toHaveBeenCalled();
    socket.detach();
  });

  it('preserves storage configuration errors and sanitizes access and transient failures', async () => {
    const { caller, conversation } = await activeThread();
    await grantPremium(caller.id);
    const issued = await requestMediaUpload(caller.id, conversation.id, {
      mediaType: 'VOICE',
      mimeType: 'audio/wav',
      fileSizeBytes: 16
    });
    const uploadId = issued.body.data.uploadId as string;

    mockPhotoStorage.headObject.mockRejectedValueOnce(
      new InternalServerError('Photo storage is not configured.', [], 'STORAGE_NOT_CONFIGURED', true)
    );
    const unconfigured = await confirmMedia(caller.id, conversation.id, { uploadId });
    expect(unconfigured.status).toBe(500);
    expect(unconfigured.body.error).toMatchObject({
      code: 'STORAGE_NOT_CONFIGURED',
      message: 'Photo storage is not configured.'
    });

    mockPhotoStorage.headObject.mockRejectedValueOnce(
      new InternalServerError('Media storage could not be accessed.', [], 'STORAGE_ACCESS_DENIED', true)
    );
    const denied = await confirmMedia(caller.id, conversation.id, { uploadId });
    expect(denied.status).toBe(500);
    expect(denied.body.error.code).toBe('STORAGE_ACCESS_DENIED');
    expect(denied.body.error.message).toBe('Media storage could not be accessed.');
    expect(JSON.stringify(denied.body)).not.toContain('secret');

    mockPhotoStorage.headObject.mockRejectedValueOnce(
      new InternalServerError('Media storage is temporarily unavailable.', [], 'STORAGE_UNAVAILABLE', true)
    );
    const unavailable = await confirmMedia(caller.id, conversation.id, { uploadId });
    expect(unavailable.status).toBe(500);
    expect(unavailable.body.error.code).toBe('STORAGE_UNAVAILABLE');
    expect(unavailable.body.error.message).toBe('Media storage is temporarily unavailable.');

    expect(await redis.get(`chat-media:upload:${uploadId}`)).not.toBeNull();
    expect(await Message.count()).toBe(0);
  });

  it('rechecks verification, profile, premium, conversation, match, and block state', async () => {
    const { caller, target, genderId, match, conversation } = await activeThread();
    await grantPremium(caller.id);
    stubMediaHead('image/webp', 8);
    const issued = await requestMediaUpload(caller.id, conversation.id, {
      mediaType: 'IMAGE',
      mimeType: 'image/webp',
      fileSizeBytes: 8
    });
    const uploadId = issued.body.data.uploadId as string;

    await Subscription.update(
      { currentPeriodEnd: new Date(Date.now() - 60_000), gracePeriodEnd: null },
      { where: { userId: caller.id } }
    );
    const expired = await confirmMedia(caller.id, conversation.id, { uploadId });
    expect(expired.status).toBe(403);
    expect(expired.body.error).toMatchObject({
      code: 'PREMIUM_REQUIRED',
      message: 'Feature requires an active Premium subscription.'
    });
    expect(await Message.count()).toBe(0);
    expect(await redis.get(`chat-media:upload:${uploadId}`)).not.toBeNull();
    await Subscription.update(
      { currentPeriodEnd: new Date(Date.now() + 24 * 60 * 60 * 1000), gracePeriodEnd: null },
      { where: { userId: caller.id } }
    );

    await conversation.update({ status: 'CLOSED', closedAt: new Date() });
    const closed = await confirmMedia(caller.id, conversation.id, { uploadId });
    expect(closed.status).toBe(404);
    expect(closed.body.error).toMatchObject({
      code: 'CONVERSATION_CLOSED',
      message: 'Conversation is closed due to unmatch or safety block.'
    });
    await conversation.update({ status: 'ACTIVE', closedAt: null });

    await match.update({ status: 'UNMATCHED' });
    const inactive = await confirmMedia(caller.id, conversation.id, { uploadId });
    expect(inactive.status).toBe(404);
    expect(inactive.body.error.code).toBe('RESOURCE_NOT_FOUND');
    await match.update({ status: 'ACTIVE' });

    await Block.create({ blockerId: target.id, blockedId: caller.id, reason: null, createdAt: new Date() });
    const blocked = await confirmMedia(caller.id, conversation.id, { uploadId });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatchObject({
      code: 'BLOCKED_USER',
      message: 'Interaction prohibited due to an active safety block.'
    });
    expect(await Message.count()).toBe(0);
    expect(await redis.get(`chat-media:upload:${uploadId}`)).not.toBeNull();

    const outsider = await buildUser({ genderId, point: north(5) });
    await grantPremium(outsider.id);
    const outsiderUploadId = randomUUID();
    await redis.set(
      `chat-media:upload:${outsiderUploadId}`,
      JSON.stringify({
        uploadId: outsiderUploadId,
        userId: outsider.id,
        conversationId: conversation.id,
        storageKey: `chat-media/${conversation.id}/${outsiderUploadId}`,
        mediaType: 'IMAGE',
        mimeType: 'image/webp',
        fileSizeBytes: 8
      }),
      'EX',
      300
    );
    const foreign = await confirmMedia(outsider.id, conversation.id, { uploadId: outsiderUploadId });
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(await redis.get(`chat-media:upload:${outsiderUploadId}`)).not.toBeNull();

    const emailCaller = await buildUser({ genderId, emailVerified: false });
    const emailMatch = await insertMatch(emailCaller.id, target.id, 'ACTIVE');
    const emailConversation = await insertConversation(emailMatch.id, 'ACTIVE', null, null);
    const emailUploadId = randomUUID();
    await redis.set(
      `chat-media:upload:${emailUploadId}`,
      JSON.stringify({
        uploadId: emailUploadId,
        userId: emailCaller.id,
        conversationId: emailConversation.id,
        storageKey: `chat-media/${emailConversation.id}/${emailUploadId}`,
        mediaType: 'IMAGE',
        mimeType: 'image/webp',
        fileSizeBytes: 8
      }),
      'EX',
      300
    );
    const emailResponse = await confirmMedia(emailCaller.id, emailConversation.id, { uploadId: emailUploadId });
    expect(emailResponse.status).toBe(403);
    expect(emailResponse.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    const incomplete = await buildUser({ genderId, complete: false });
    const incompleteMatch = await insertMatch(incomplete.id, target.id, 'ACTIVE');
    const incompleteConversation = await insertConversation(incompleteMatch.id, 'ACTIVE', null, null);
    const incompleteUploadId = randomUUID();
    await redis.set(
      `chat-media:upload:${incompleteUploadId}`,
      JSON.stringify({
        uploadId: incompleteUploadId,
        userId: incomplete.id,
        conversationId: incompleteConversation.id,
        storageKey: `chat-media/${incompleteConversation.id}/${incompleteUploadId}`,
        mediaType: 'IMAGE',
        mimeType: 'image/webp',
        fileSizeBytes: 8
      }),
      'EX',
      300
    );
    const incompleteResponse = await confirmMedia(incomplete.id, incompleteConversation.id, {
      uploadId: incompleteUploadId
    });
    expect(incompleteResponse.status).toBe(400);
    expect(incompleteResponse.body.error.code).toBe('PROFILE_INCOMPLETE');
    expect(mockPhotoStorage.headObject).not.toHaveBeenCalledWith({
      storageKey: `chat-media/${emailConversation.id}/${emailUploadId}`
    });
    expect(mockPhotoStorage.headObject).not.toHaveBeenCalledWith({
      storageKey: `chat-media/${incompleteConversation.id}/${incompleteUploadId}`
    });
  });

  it('keeps the reservation when the database transaction rolls back', async () => {
    const { caller, conversation } = await activeThread();
    await grantPremium(caller.id);
    stubMediaHead('audio/mpeg', 20);
    const socket = attachFakeSocket();
    const issued = await requestMediaUpload(caller.id, conversation.id, {
      mediaType: 'VOICE',
      mimeType: 'audio/mpeg',
      fileSizeBytes: 20
    });
    const uploadId = issued.body.data.uploadId as string;
    const updateSpy = jest.spyOn(Conversation, 'update').mockRejectedValueOnce(new Error('forced database failure'));

    const response = await confirmMedia(caller.id, conversation.id, { uploadId });
    updateSpy.mockRestore();

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(response.body.error.message).toBe('An unexpected error occurred. Please try again later.');
    expect(await Message.count()).toBe(0);
    expect(await redis.get(`chat-media:upload:${uploadId}`)).not.toBeNull();
    expect(socket.emit).not.toHaveBeenCalled();
    await conversation.reload();
    expect(conversation.lastMessageAt).toBeNull();
    socket.detach();
  });

  it('returns the committed message when reservation deletion fails', async () => {
    const { caller, target, conversation } = await activeThread();
    await grantPremium(caller.id);
    stubMediaHead('image/jpeg', 48);
    const socket = attachFakeSocket();
    const issued = await requestMediaUpload(caller.id, conversation.id, {
      mediaType: 'IMAGE',
      mimeType: 'image/jpeg',
      fileSizeBytes: 48
    });
    const uploadId = issued.body.data.uploadId as string;
    const delSpy = jest.spyOn(redis, 'del').mockRejectedValueOnce(new Error('redis unavailable'));

    const response = await confirmMedia(caller.id, conversation.id, { uploadId });
    delSpy.mockRestore();

    expect(response.status).toBe(201);
    expect(response.body.data.id).toBe(uploadId);
    expect(await Message.count()).toBe(1);
    expect(await redis.get(`chat-media:upload:${uploadId}`)).not.toBeNull();
    expect(socket.emit).toHaveBeenCalledTimes(1);
    expect(socket.rooms).toEqual([`user:${target.id}`]);
    socket.detach();
  });

  it('shows a confirmed media message in history, inbox, unread count, and read receipts', async () => {
    const { caller, target, conversation } = await activeThread();
    await grantPremium(caller.id);
    stubMediaHead('image/jpeg', 96);
    const socket = attachFakeSocket();
    const issued = await requestMediaUpload(caller.id, conversation.id, {
      mediaType: 'IMAGE',
      mimeType: 'image/jpeg',
      fileSizeBytes: 96
    });
    const uploadId = issued.body.data.uploadId as string;
    const confirmed = await confirmMedia(caller.id, conversation.id, { uploadId });
    expect(confirmed.status).toBe(201);

    const history = await listMessages(target.id, conversation.id);
    expect(history.status).toBe(200);
    expect(history.body.data.items).toEqual([
      expect.objectContaining({
        id: uploadId,
        senderId: caller.id,
        messageType: 'IMAGE',
        content: null,
        mediaUrl: null,
        readAt: null
      })
    ]);
    expect(history.body.data.items[0].mediaStorageKey).toBeUndefined();

    const inbox = await listInbox(target.id);
    expect(inbox.status).toBe(200);
    expect(inbox.body.data.conversations[0].lastMessage).toMatchObject({
      id: uploadId,
      senderId: caller.id,
      messageType: 'IMAGE',
      content: null,
      mediaUrl: null
    });

    const callerUnread = await getUnreadCount(caller.id, conversation.id);
    const targetUnread = await getUnreadCount(target.id, conversation.id);
    expect(callerUnread.body.data.unreadCount).toBe(0);
    expect(targetUnread.body.data.unreadCount).toBe(1);

    const read = await markRead(target.id, conversation.id);
    expect(read.status).toBe(200);
    expect(read.body.data.readAt).toEqual(expect.any(String));
    const stored = await Message.findByPk(uploadId);
    expect(stored?.readAt).toBeInstanceOf(Date);
    expect(socket.emit).toHaveBeenCalledWith(
      'chat:message:read',
      expect.objectContaining({ conversationId: conversation.id, readerId: target.id })
    );

    const text = await sendMessage(target.id, conversation.id, { messageType: 'TEXT', content: 'After media' });
    expect(text.status).toBe(201);
    expect(text.body.data.messageType).toBe('TEXT');
    expect(text.body.data.remainingDailyMessages).toBe(19);
    expect(await textMessageUsageCount(caller.id)).toBe(0);
    expect(await textMessageUsageCount(target.id)).toBe(1);
    socket.detach();
  });
});
