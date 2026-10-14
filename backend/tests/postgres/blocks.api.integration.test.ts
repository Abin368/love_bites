import { randomUUID } from 'crypto';
import http from 'http';
import Redis from 'ioredis';
import request from 'supertest';
import { literal, QueryTypes } from 'sequelize';
import { io as createClient, Socket as ClientSocket } from 'socket.io-client';
import { env } from '../../src/config/env';
import { sequelize } from '../../src/config/database';
import { Block } from '../../src/database/models/block.model';
import { Conversation } from '../../src/database/models/conversation.model';
import { CreditTransaction } from '../../src/database/models/credit-transaction.model';
import { DatingPreference } from '../../src/database/models/dating-preference.model';
import { Gender } from '../../src/database/models/gender.model';
import { Like } from '../../src/database/models/like.model';
import { Match } from '../../src/database/models/match.model';
import { Message } from '../../src/database/models/message.model';
import { Notification } from '../../src/database/models/notification.model';
import { Profile } from '../../src/database/models/profile.model';
import { ProfilePhoto } from '../../src/database/models/profile-photo.model';
import { RelationshipIntention } from '../../src/database/models/relationship-intention.model';
import { UsageRecord } from '../../src/database/models/usage-record.model';
import { User, UserStatus } from '../../src/database/models/user.model';
import { UserDatingPreferenceGender } from '../../src/database/models/user-dating-preference-gender.model';
import { UserDatingPreferenceIntention } from '../../src/database/models/user-dating-preference-intention.model';
import { UserRelationshipIntention } from '../../src/database/models/user-relationship-intention.model';
import { attachSocketServer, closeSocketServer, SocketRuntime } from '../../src/socket/socket.server';
import { signAccessToken } from '../../src/utils/jwt';

jest.mock('../../src/integrations/storage/s3.provider', () => ({
  photoStorage: {
    createUploadUrl: jest.fn(),
    createDownloadUrl: jest.fn(async () => ({
      url: 'https://download.test/signed',
      expiresInSeconds: 3600
    }))
  }
}));

import { app } from '../../src/app';

const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';
const ORIGIN = { latitude: 12.9716, longitude: 77.5946 };
const BLOCKED_USER_MESSAGE = 'Interaction prohibited due to an active safety block.';
const CONVERSATION_CLOSED_MESSAGE = 'Conversation is closed due to unmatch or safety block.';

interface Point {
  latitude: number;
  longitude: number;
}

interface UnmatchEvent {
  matchId: string;
  conversationId: string;
}

function timestamps(): { createdAt: Date; updatedAt: Date } {
  const now = new Date();
  return { createdAt: now, updatedAt: now };
}

function north(kilometres: number): Point {
  return {
    latitude: ORIGIN.latitude + kilometres / 111.32,
    longitude: ORIGIN.longitude
  };
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
  return Gender.create({ code: `block-${randomUUID()}`, name: 'Woman', isActive: true });
}

async function buildUser(input: {
  genderId: string;
  complete?: boolean;
  primaryPhoto?: boolean;
  status?: UserStatus;
  emailVerified?: boolean;
  point?: Point | null;
  preferences?: boolean;
}): Promise<User> {
  const emailVerified = input.emailVerified ?? true;
  const user = await User.create({
    email: `block-${randomUUID()}@example.com`,
    phone: null,
    passwordHash: PASSWORD_HASH,
    role: 'USER',
    status: input.status ?? 'ACTIVE',
    emailVerified,
    phoneVerified: false
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

function blockUser(callerId: string, targetUserId: string) {
  return request(app).post(`/api/v1/blocks/${targetUserId}`).set(authHeader(callerId));
}

function listBlocks(callerId: string) {
  return request(app).get('/api/v1/blocks').set(authHeader(callerId));
}

function unblockUser(callerId: string, targetUserId: string) {
  return request(app).delete(`/api/v1/blocks/${targetUserId}`).set(authHeader(callerId));
}

function unmatch(callerId: string, matchId: string) {
  return request(app).delete(`/api/v1/matches/${matchId}`).set(authHeader(callerId));
}

function discover(userId: string) {
  return request(app).get('/api/v1/discovery').set(authHeader(userId));
}

function sendMessage(callerId: string, conversationId: string) {
  return request(app)
    .post(`/api/v1/conversations/${conversationId}/messages`)
    .set(authHeader(callerId))
    .send({ messageType: 'TEXT', content: 'Hello' });
}

function readHistory(callerId: string, conversationId: string) {
  return request(app).get(`/api/v1/conversations/${conversationId}/messages`).set(authHeader(callerId));
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

describe('block management', () => {
  it('rejects a missing token and an admin', async () => {
    const { caller, target } = await pair();

    const missing = await request(app).post(`/api/v1/blocks/${target.id}`);
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('AUTH_REQUIRED');

    const missingList = await request(app).get('/api/v1/blocks');
    expect(missingList.status).toBe(401);
    expect(missingList.body.error.code).toBe('AUTH_REQUIRED');

    const missingDelete = await request(app).delete(`/api/v1/blocks/${target.id}`);
    expect(missingDelete.status).toBe(401);
    expect(missingDelete.body.error.code).toBe('AUTH_REQUIRED');

    const admin = await User.create({
      email: `admin-${randomUUID()}@example.com`,
      passwordHash: PASSWORD_HASH,
      role: 'ADMIN',
      status: 'ACTIVE',
      emailVerified: true,
      phoneVerified: false
    });
    const forbidden = await request(app).post(`/api/v1/blocks/${target.id}`).set(authHeader(admin.id, 'ADMIN'));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');

    const forbiddenList = await request(app).get('/api/v1/blocks').set(authHeader(admin.id, 'ADMIN'));
    expect(forbiddenList.status).toBe(403);
    expect(forbiddenList.body.error.code).toBe('FORBIDDEN');

    const forbiddenDelete = await request(app)
      .delete(`/api/v1/blocks/${caller.id}`)
      .set(authHeader(admin.id, 'ADMIN'));
    expect(forbiddenDelete.status).toBe(403);
    expect(forbiddenDelete.body.error.code).toBe('FORBIDDEN');
    expect(await Block.count()).toBe(0);
  });

  it('blocks a user, stores a null reason, and ignores Idempotency-Key', async () => {
    const { caller, target } = await pair();
    const response = await blockUser(caller.id, target.id.toUpperCase()).set('Idempotency-Key', randomUUID());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { blocked: true, targetUserId: target.id },
      message: 'User blocked successfully.'
    });

    const stored = await Block.findAll();
    expect(stored).toHaveLength(1);
    expect(stored[0].blockerId).toBe(caller.id);
    expect(stored[0].blockedId).toBe(target.id);
    expect(stored[0].reason).toBeNull();
    expect(await Match.count()).toBe(0);
    expect(await UsageRecord.count()).toBe(0);
    expect(await CreditTransaction.count()).toBe(0);
    expect(await Notification.count()).toBe(0);
  });

  it('does not require a complete caller profile', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({
      genderId: catalogGender.id,
      complete: false,
      primaryPhoto: false,
      preferences: false,
      point: null,
      emailVerified: false,
      status: 'UNVERIFIED'
    });
    const target = await buildUser({ genderId: catalogGender.id });

    const response = await blockUser(caller.id, target.id);
    expect(response.status).toBe(200);
    expect(await Block.count()).toBe(1);
  });

  it('blocks suspended, banned, unverified, and incomplete targets', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    const suspended = await buildUser({ genderId: catalogGender.id, status: 'SUSPENDED' });
    const banned = await buildUser({ genderId: catalogGender.id, status: 'BANNED' });
    const unverified = await buildUser({
      genderId: catalogGender.id,
      status: 'UNVERIFIED',
      emailVerified: false
    });
    const incomplete = await buildUser({
      genderId: catalogGender.id,
      complete: false,
      primaryPhoto: false,
      preferences: false,
      point: null
    });

    for (const target of [suspended, banned, unverified, incomplete]) {
      const response = await blockUser(caller.id, target.id);
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({ blocked: true, targetUserId: target.id });
    }
    expect(await Block.count()).toBe(4);
  });

  it('rejects a duplicate block without a second status change', async () => {
    const { caller, target } = await pair();
    const match = await insertMatch(caller.id, target.id, 'ACTIVE');
    const conversation = await insertConversation(match.id, 'ACTIVE', null, new Date('2026-02-01T00:00:00.000Z'));

    const first = await blockUser(caller.id, target.id);
    expect(first.status).toBe(200);
    await match.reload();
    await conversation.reload();
    const unmatchedAt = match.unmatchedAt?.getTime();
    const closedAt = conversation.closedAt?.getTime();

    const second = await blockUser(caller.id, target.id);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');
    expect(second.body.error.message).toBe('User is already blocked.');

    await match.reload();
    await conversation.reload();
    expect(await Block.count()).toBe(1);
    expect(match.status).toBe('UNMATCHED');
    expect(match.unmatchedAt?.getTime()).toBe(unmatchedAt);
    expect(conversation.status).toBe('CLOSED');
    expect(conversation.closedAt?.getTime()).toBe(closedAt);
  });

  it('rejects a self block before writing a row', async () => {
    const { caller } = await pair();
    const response = await blockUser(caller.id, caller.id);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('SELF_INTERACTION');
    expect(response.body.error.message).toBe('You cannot block your own profile.');
    expect(await Block.count()).toBe(0);
  });

  it('rejects an invalid user id, a missing user, a soft-deleted user, and a deleted status', async () => {
    const { caller } = await pair();
    const invalid = await blockUser(caller.id, 'not-a-uuid');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    expect(invalid.body.error.message).toBe('Validation failed');
    expect(invalid.body.error.details).toEqual([{ field: 'userId', message: 'User id must be a valid UUID.' }]);

    const missing = await blockUser(caller.id, randomUUID());
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('USER_NOT_FOUND');
    expect(missing.body.error.message).toBe('Target user profile not found.');

    const deleted = await User.create({
      email: `deleted-${randomUUID()}@example.com`,
      passwordHash: PASSWORD_HASH,
      role: 'USER',
      status: 'ACTIVE',
      emailVerified: true,
      phoneVerified: false
    });
    await deleted.destroy();
    const deletedResponse = await blockUser(caller.id, deleted.id);
    expect(deletedResponse.status).toBe(404);
    expect(deletedResponse.body.error.code).toBe('USER_NOT_FOUND');

    const statusDeleted = await User.create({
      email: `status-deleted-${randomUUID()}@example.com`,
      passwordHash: PASSWORD_HASH,
      role: 'USER',
      status: 'DELETED',
      emailVerified: true,
      phoneVerified: false
    });
    const statusResponse = await blockUser(caller.id, statusDeleted.id);
    expect(statusResponse.status).toBe(404);
    expect(statusResponse.body.error.code).toBe('USER_NOT_FOUND');
    expect(await Block.count()).toBe(0);
  });

  it('accepts an empty body and rejects a JSON property or query parameter', async () => {
    const { caller, target } = await pair();
    const other = await buildUser({ genderId: (await gender()).id });

    const empty = await blockUser(caller.id, target.id).send({});
    expect(empty.status).toBe(200);

    const property = await blockUser(caller.id, other.id).send({ reason: 'spam' });
    expect(property.status).toBe(400);
    expect(property.body.error.code).toBe('VALIDATION_ERROR');

    const query = await blockUser(caller.id, other.id).query({ extra: '1' });
    expect(query.status).toBe(400);
    expect(query.body.error.code).toBe('VALIDATION_ERROR');
    expect(query.body.error.details).toEqual([{ field: 'extra', message: 'Unsupported query parameter.' }]);

    const listQuery = await listBlocks(caller.id).query({ limit: '1' });
    expect(listQuery.status).toBe(400);
    expect(listQuery.body.error.details).toEqual([{ field: 'limit', message: 'Unsupported query parameter.' }]);

    expect(await Block.count({ where: { blockedId: other.id } })).toBe(0);
    expect(await Block.count({ where: { blockedId: target.id } })).toBe(1);
  });

  it('lists only the caller’s outgoing blocks, newest first, with id as the tie breaker', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    const olderTarget = await buildUser({ genderId: catalogGender.id });
    const lowTarget = await buildUser({ genderId: catalogGender.id });
    const highTarget = await buildUser({ genderId: catalogGender.id });
    const outsider = await buildUser({ genderId: catalogGender.id });
    const sameTime = new Date('2026-03-01T00:00:00.000Z');

    await Block.create({
      blockerId: caller.id,
      blockedId: olderTarget.id,
      reason: 'hidden',
      createdAt: new Date()
    });
    await Block.create({
      id: '00000000-0000-4000-8000-000000000010',
      blockerId: caller.id,
      blockedId: lowTarget.id,
      reason: null,
      createdAt: new Date()
    });
    await Block.create({
      id: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
      blockerId: caller.id,
      blockedId: highTarget.id,
      reason: null,
      createdAt: new Date()
    });
    await Block.create({
      blockerId: highTarget.id,
      blockedId: caller.id,
      reason: null,
      createdAt: new Date()
    });
    await Block.create({
      blockerId: outsider.id,
      blockedId: caller.id,
      reason: null,
      createdAt: new Date()
    });
    await sequelize.query(
      `UPDATE blocks SET created_at = :createdAt WHERE id = CAST(:id AS uuid)`,
      { replacements: { createdAt: new Date('2026-01-01T00:00:00.000Z'), id: (await Block.findOne({ where: { blockerId: caller.id, blockedId: olderTarget.id } }))!.id } }
    );
    await sequelize.query(
      `UPDATE blocks SET created_at = :createdAt WHERE id = CAST(:id AS uuid)`,
      { replacements: { createdAt: sameTime, id: '00000000-0000-4000-8000-000000000010' } }
    );
    await sequelize.query(
      `UPDATE blocks SET created_at = :createdAt WHERE id = CAST(:id AS uuid)`,
      { replacements: { createdAt: sameTime, id: 'ffffffff-ffff-4fff-bfff-ffffffffffff' } }
    );
    await sequelize.query(
      `UPDATE blocks SET created_at = :createdAt WHERE id = CAST(:id AS uuid)`,
      { replacements: { createdAt: new Date('2026-04-01T00:00:00.000Z'), id: (await Block.findOne({ where: { blockerId: highTarget.id, blockedId: caller.id } }))!.id } }
    );

    const response = await listBlocks(caller.id);
    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Blocked users retrieved.');
    expect(response.body.data).toEqual([
      { userId: highTarget.id, createdAt: sameTime.toISOString() },
      { userId: lowTarget.id, createdAt: sameTime.toISOString() },
      { userId: olderTarget.id, createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString() }
    ]);
    expect(JSON.stringify(response.body)).not.toContain('hidden');
    expect(JSON.stringify(response.body)).not.toContain(outsider.id);

    const reverseList = await listBlocks(highTarget.id);
    expect(reverseList.body.data).toEqual([
      { userId: caller.id, createdAt: new Date('2026-04-01T00:00:00.000Z').toISOString() }
    ]);
  });

  it('deletes only the caller’s outgoing block', async () => {
    const { caller, target } = await pair();
    await blockUser(caller.id, target.id);
    await Block.create({
      blockerId: target.id,
      blockedId: caller.id,
      reason: null,
      createdAt: new Date()
    });

    const response = await unblockUser(caller.id, target.id.toUpperCase());
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { blocked: false, targetUserId: target.id },
      message: 'User unblocked successfully.'
    });

    const remaining = await Block.findAll();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].blockerId).toBe(target.id);
    expect(remaining[0].blockedId).toBe(caller.id);
  });

  it('returns the same not-found response for a missing outgoing row, a reverse-only row, and an unknown id', async () => {
    const { caller, target } = await pair();
    await Block.create({
      blockerId: target.id,
      blockedId: caller.id,
      reason: null,
      createdAt: new Date()
    });

    const missing = await unblockUser(caller.id, target.id);
    const reverseOnly = missing;
    const unknown = await unblockUser(caller.id, randomUUID());
    const invalid = await unblockUser(caller.id, 'not-a-uuid');

    expect(reverseOnly.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(reverseOnly.body.error).toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Resource not found.'
    });
    expect(unknown.body.error).toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Resource not found.'
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    expect(await Block.count()).toBe(1);

    const property = await unblockUser(caller.id, target.id).send({ blocked: false });
    expect(property.status).toBe(400);
    expect(property.body.error.code).toBe('VALIDATION_ERROR');
    expect(await Block.count()).toBe(1);
  });

  it('hides both users from discovery for a block in either direction', async () => {
    const outgoing = await eligibleDiscoveryPair();
    expect((await discover(outgoing.viewer.id)).body.data.candidate.id).toBe(outgoing.candidate.id);
    expect((await discover(outgoing.candidate.id)).body.data.candidate.id).toBe(outgoing.viewer.id);

    const outgoingBlock = await blockUser(outgoing.viewer.id, outgoing.candidate.id);
    expect(outgoingBlock.status).toBe(200);
    expect((await discover(outgoing.viewer.id)).body.data.candidate).toBeNull();
    expect((await discover(outgoing.candidate.id)).body.data.candidate).toBeNull();

    const incoming = await eligibleDiscoveryPair();
    const incomingBlock = await blockUser(incoming.candidate.id, incoming.viewer.id);
    expect(incomingBlock.status).toBe(200);
    expect((await discover(incoming.viewer.id)).body.data.candidate).toBeNull();
    expect((await discover(incoming.candidate.id)).body.data.candidate).toBeNull();
  });

  it('rejects chat for both participants after a block in either direction', async () => {
    const outgoing = await pair();
    const outgoingMatch = await insertMatch(outgoing.caller.id, outgoing.target.id, 'ACTIVE');
    const outgoingConversation = await insertConversation(outgoingMatch.id, 'ACTIVE', null, null);
    expect((await sendMessage(outgoing.caller.id, outgoingConversation.id)).status).toBe(201);

    expect((await blockUser(outgoing.caller.id, outgoing.target.id)).status).toBe(200);
    const callerSend = await sendMessage(outgoing.caller.id, outgoingConversation.id);
    const targetSend = await sendMessage(outgoing.target.id, outgoingConversation.id);
    expect(callerSend.status).toBe(404);
    expect(callerSend.body.error.code).toBe('CONVERSATION_CLOSED');
    expect(callerSend.body.error.message).toBe(CONVERSATION_CLOSED_MESSAGE);
    expect(targetSend.status).toBe(404);
    expect(targetSend.body.error.code).toBe('CONVERSATION_CLOSED');

    const callerHistory = await readHistory(outgoing.caller.id, outgoingConversation.id);
    const targetHistory = await readHistory(outgoing.target.id, outgoingConversation.id);
    expect(callerHistory.status).toBe(409);
    expect(callerHistory.body.error).toMatchObject({ code: 'BLOCKED_USER', message: BLOCKED_USER_MESSAGE });
    expect(targetHistory.status).toBe(409);
    expect(targetHistory.body.error.code).toBe('BLOCKED_USER');

    const incoming = await pair();
    const incomingMatch = await insertMatch(incoming.caller.id, incoming.target.id, 'ACTIVE');
    const incomingConversation = await insertConversation(incomingMatch.id, 'ACTIVE', null, null);
    expect((await blockUser(incoming.target.id, incoming.caller.id)).status).toBe(200);
    expect((await sendMessage(incoming.caller.id, incomingConversation.id)).body.error.code).toBe('CONVERSATION_CLOSED');
    expect((await sendMessage(incoming.target.id, incomingConversation.id)).body.error.code).toBe('CONVERSATION_CLOSED');
    expect((await readHistory(incoming.caller.id, incomingConversation.id)).body.error.code).toBe('BLOCKED_USER');
    expect((await readHistory(incoming.target.id, incomingConversation.id)).body.error.code).toBe('BLOCKED_USER');
  });

  it('unmatches an active match, closes its conversation, and keeps likes and messages', async () => {
    const { caller, target } = await pair();
    const historical = await insertMatch(caller.id, target.id, 'UNDONE');
    const match = await insertMatch(caller.id, target.id, 'ACTIVE');
    const matchedAt = match.matchedAt.getTime();
    const lastMessageAt = new Date('2026-02-01T00:00:00.000Z');
    const conversation = await insertConversation(match.id, 'ACTIVE', null, lastMessageAt);
    const message = await Message.create({
      conversationId: conversation.id,
      senderId: caller.id,
      messageType: 'TEXT',
      content: 'Still here',
      ...timestamps()
    });
    const callerLike = await Like.create({
      fromUserId: caller.id,
      toUserId: target.id,
      action: 'LIKE',
      isUndone: false,
      ...timestamps()
    });
    const reciprocalLike = await Like.create({
      fromUserId: target.id,
      toUserId: caller.id,
      action: 'SUPER_LIKE',
      isUndone: false,
      ...timestamps()
    });

    const response = await blockUser(caller.id, target.id);
    expect(response.status).toBe(200);

    await match.reload();
    await historical.reload();
    await conversation.reload();
    expect(match.status).toBe('UNMATCHED');
    expect(match.unmatchedByUserId).toBe(caller.id);
    expect(match.unmatchedAt).toBeInstanceOf(Date);
    expect(match.matchedAt.getTime()).toBe(matchedAt);
    expect(historical.status).toBe('UNDONE');
    expect(historical.unmatchedAt).toBeNull();
    expect(historical.unmatchedByUserId).toBeNull();
    expect(conversation.status).toBe('CLOSED');
    expect(conversation.closedAt).toBeInstanceOf(Date);
    expect(conversation.lastMessageAt?.getTime()).toBe(lastMessageAt.getTime());

    const storedMessage = await Message.findByPk(message.id);
    expect(storedMessage?.content).toBe('Still here');
    expect(storedMessage?.deletedAt).toBeNull();
    await callerLike.reload();
    await reciprocalLike.reload();
    expect(callerLike.action).toBe('LIKE');
    expect(callerLike.isUndone).toBe(false);
    expect(reciprocalLike.action).toBe('SUPER_LIKE');
    expect(reciprocalLike.isUndone).toBe(false);
    expect(await UsageRecord.count()).toBe(0);
    expect(await CreditTransaction.count()).toBe(0);
    expect(await Notification.count()).toBe(0);
  });

  it('keeps an already closed conversation unchanged and unmatches a match with no conversation', async () => {
    const { caller, target } = await pair();
    const closedAt = new Date('2026-03-01T00:00:00.000Z');
    const lastMessageAt = new Date('2026-02-15T00:00:00.000Z');
    const closedMatch = await insertMatch(caller.id, target.id, 'ACTIVE');
    const closedConversation = await insertConversation(closedMatch.id, 'CLOSED', closedAt, lastMessageAt);

    const closedResponse = await blockUser(caller.id, target.id);
    expect(closedResponse.status).toBe(200);
    await closedMatch.reload();
    await closedConversation.reload();
    expect(closedMatch.status).toBe('UNMATCHED');
    expect(closedMatch.unmatchedByUserId).toBe(caller.id);
    expect(closedConversation.status).toBe('CLOSED');
    expect(closedConversation.closedAt?.getTime()).toBe(closedAt.getTime());
    expect(closedConversation.lastMessageAt?.getTime()).toBe(lastMessageAt.getTime());

    const { caller: otherCaller, target: otherTarget } = await pair();
    const bareMatch = await insertMatch(otherCaller.id, otherTarget.id, 'ACTIVE');
    const bareResponse = await blockUser(otherCaller.id, otherTarget.id);
    expect(bareResponse.status).toBe(200);
    await bareMatch.reload();
    expect(bareMatch.status).toBe('UNMATCHED');
    expect(await Conversation.count({ where: { matchId: bareMatch.id } })).toBe(0);
  });

  it('leaves an already unmatched row unchanged when no active match exists', async () => {
    const { caller, target } = await pair();
    const match = await insertMatch(caller.id, target.id, 'UNMATCHED');
    const fixed = new Date('2026-01-15T00:00:00.000Z');
    await sequelize.query(
      `UPDATE matches
       SET unmatched_at = :fixed, updated_at = :fixed, unmatched_by_user_id = CAST(:callerId AS uuid)
       WHERE id = CAST(:matchId AS uuid)`,
      { replacements: { fixed, callerId: caller.id, matchId: match.id } }
    );

    const response = await blockUser(caller.id, target.id);
    expect(response.status).toBe(200);
    await match.reload();
    expect(match.status).toBe('UNMATCHED');
    expect(match.unmatchedByUserId).toBe(caller.id);
    expect(match.unmatchedAt?.getTime()).toBe(fixed.getTime());
    expect(match.updatedAt.getTime()).toBe(fixed.getTime());
    expect(await Block.count()).toBe(1);
  });

  it('does not restore the match or conversation on unblock', async () => {
    const { caller, target } = await pair();
    const match = await insertMatch(caller.id, target.id, 'ACTIVE');
    const conversation = await insertConversation(match.id, 'ACTIVE', null, null);
    expect((await blockUser(caller.id, target.id)).status).toBe(200);

    const response = await unblockUser(caller.id, target.id);
    expect(response.status).toBe(200);
    await match.reload();
    await conversation.reload();
    expect(match.status).toBe('UNMATCHED');
    expect(conversation.status).toBe('CLOSED');
    expect(await Block.count()).toBe(0);
    expect(await Match.count({ where: { status: 'ACTIVE' } })).toBe(0);
  });

  it('hides discovery after unblock while an active like remains, and shows the pair when it does not', async () => {
    const liked = await eligibleDiscoveryPair();
    await Like.create({
      fromUserId: liked.viewer.id,
      toUserId: liked.candidate.id,
      action: 'LIKE',
      isUndone: false,
      ...timestamps()
    });
    await Like.create({
      fromUserId: liked.candidate.id,
      toUserId: liked.viewer.id,
      action: 'LIKE',
      isUndone: false,
      ...timestamps()
    });
    expect((await blockUser(liked.viewer.id, liked.candidate.id)).status).toBe(200);
    expect((await unblockUser(liked.viewer.id, liked.candidate.id)).status).toBe(200);
    expect((await discover(liked.viewer.id)).body.data.candidate).toBeNull();
    expect((await discover(liked.candidate.id)).body.data.candidate).toBeNull();
    const storedLikes = await Like.findAll();
    expect(storedLikes).toHaveLength(2);
    expect(storedLikes.every((like) => like.isUndone === false)).toBe(true);

    const clear = await eligibleDiscoveryPair();
    expect((await discover(clear.viewer.id)).body.data.candidate.id).toBe(clear.candidate.id);
    expect((await blockUser(clear.viewer.id, clear.candidate.id)).status).toBe(200);
    expect((await discover(clear.viewer.id)).body.data.candidate).toBeNull();
    expect((await unblockUser(clear.viewer.id, clear.candidate.id)).status).toBe(200);
    expect((await discover(clear.viewer.id)).body.data.candidate.id).toBe(clear.candidate.id);
    expect((await discover(clear.candidate.id)).body.data.candidate.id).toBe(clear.viewer.id);
  });

  it('allows block, unblock, and block again without reopening the old match', async () => {
    const { caller, target } = await pair();
    const match = await insertMatch(caller.id, target.id, 'ACTIVE');
    const conversation = await insertConversation(match.id, 'ACTIVE', null, null);

    expect((await blockUser(caller.id, target.id)).status).toBe(200);
    expect((await unblockUser(caller.id, target.id)).status).toBe(200);
    await match.reload();
    const unmatchedAt = match.unmatchedAt?.getTime();

    const again = await blockUser(caller.id, target.id);
    expect(again.status).toBe(200);
    expect(await Block.count()).toBe(1);
    await match.reload();
    await conversation.reload();
    expect(match.status).toBe('UNMATCHED');
    expect(match.unmatchedAt?.getTime()).toBe(unmatchedAt);
    expect(conversation.status).toBe('CLOSED');
    expect(await Match.count()).toBe(1);
  });

  it('lets one of two simultaneous block requests win', async () => {
    const { caller, target } = await pair();
    const [first, second] = await Promise.all([blockUser(caller.id, target.id), blockUser(caller.id, target.id)]);
    const statuses = [first.status, second.status].sort((left, right) => left - right);
    expect(statuses).toEqual([200, 409]);
    const failure = first.status === 409 ? first : second;
    expect(failure.body.error.code).toBe('CONFLICT');
    expect(await Block.count()).toBe(1);
  });

  it('serializes a block and an unmatch without dropping either result', async () => {
    const { caller, target } = await pair();
    const match = await insertMatch(caller.id, target.id, 'ACTIVE');
    const conversation = await insertConversation(match.id, 'ACTIVE', null, null);

    const [blocked, unmatched] = await Promise.all([
      blockUser(caller.id, target.id),
      unmatch(target.id, match.id)
    ]);

    expect(blocked.status).toBe(200);
    expect([200, 404]).toContain(unmatched.status);
    if (unmatched.status === 404) {
      expect(unmatched.body.error.code).toBe('MATCH_NOT_FOUND');
    }

    await match.reload();
    await conversation.reload();
    expect(match.status).toBe('UNMATCHED');
    expect(conversation.status).toBe('CLOSED');
    expect(await Block.count()).toBe(1);
    expect(await Match.count({ where: { status: 'UNMATCHED' } })).toBe(1);
    if (unmatched.status === 200) {
      expect(match.unmatchedByUserId).toBe(target.id);
    } else {
      expect(match.unmatchedByUserId).toBe(caller.id);
    }
  });
});

describe('block match:unmatch socket event', () => {
  let httpServer: http.Server | undefined;
  let runtime: SocketRuntime | null = null;
  let port = 0;
  const openClients: ClientSocket[] = [];

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

  function listen(server: http.Server): Promise<number> {
    return new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Socket.IO test server did not bind a TCP port.'));
          return;
        }
        resolve(address.port);
      });
    });
  }

  function connectSocket(userId: string): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
      const client = createClient(`http://127.0.0.1:${port}`, {
        auth: { token: tokenFor(userId) },
        reconnection: false,
        timeout: 5000,
        forceNew: true,
        transports: ['websocket']
      });
      openClients.push(client);
      const timer = setTimeout(() => {
        reject(new Error('Socket connection timed out.'));
      }, 5000);
      client.once('connect', () => {
        clearTimeout(timer);
        resolve(client);
      });
      client.once('connect_error', (error: Error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  async function waitForUserRoom(userId: string, count: number): Promise<void> {
    const room = `user:${userId}`;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const members = await runtime!.io.in(room).fetchSockets();
      if (members.length >= count) {
        await new Promise((resolve) => setImmediate(resolve));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for ${room}`);
  }

  async function connectReady(userId: string, count = 1): Promise<ClientSocket> {
    const client = await connectSocket(userId);
    await waitForUserRoom(userId, count);
    return client;
  }

  function waitForUnmatch(client: ClientSocket, timeoutMs = 5000): Promise<UnmatchEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('match:unmatch timed out.')), timeoutMs);
      client.once('match:unmatch', (body: UnmatchEvent) => {
        clearTimeout(timer);
        resolve(body);
      });
    });
  }

  async function expectNoUnmatch(client: ClientSocket): Promise<void> {
    let seen = false;
    const onEvent = () => {
      seen = true;
    };
    client.on('match:unmatch', onEvent);
    await new Promise((resolve) => setTimeout(resolve, 300));
    client.off('match:unmatch', onEvent);
    expect(seen).toBe(false);
  }

  beforeAll(async () => {
    const reachable = await redisIsReachable();
    if (!reachable) {
      if (process.env.CI) {
        throw new Error('Block socket tests require Redis. CI did not provide a reachable Redis at REDIS_URL.');
      }
      console.warn('Redis is not reachable, so block socket tests were not executed.');
      return;
    }

    httpServer = http.createServer(app);
    runtime = await attachSocketServer(httpServer);
    port = await listen(httpServer);
  });

  afterEach(() => {
    for (const client of openClients) {
      client.close();
    }
    openClients.length = 0;
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (runtime) {
      await closeSocketServer(runtime);
      runtime = null;
    }
    if (httpServer?.listening) {
      await new Promise<void>((resolve, reject) => {
        httpServer?.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
    httpServer = undefined;
  });

  it('emits match:unmatch to the blocked user only after the match commit', async () => {
    if (!runtime) {
      return;
    }

    const { caller, target } = await pair();
    const match = await insertMatch(caller.id, target.id, 'ACTIVE');
    const conversation = await insertConversation(match.id, 'ACTIVE', null, null);
    const blockedClient = await connectReady(target.id);
    const callerClient = await connectReady(caller.id);
    let callerSawEvent = false;
    callerClient.on('match:unmatch', () => {
      callerSawEvent = true;
    });

    const incoming = new Promise<{ body: UnmatchEvent; status: string | undefined }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('match:unmatch timed out.')), 5000);
      blockedClient.once('match:unmatch', (body: UnmatchEvent) => {
        clearTimeout(timer);
        void Match.findByPk(match.id)
          .then((stored) => resolve({ body, status: stored?.status }))
          .catch(reject);
      });
    });

    const response = await blockUser(caller.id, target.id);
    const event = await incoming;
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(response.status).toBe(200);
    expect(event.status).toBe('UNMATCHED');
    expect(event.body).toEqual({ matchId: match.id, conversationId: conversation.id });
    expect(Object.keys(event.body).sort()).toEqual(['conversationId', 'matchId']);
    expect(callerSawEvent).toBe(false);
  });

  it('emits when the conversation is already closed and stays quiet when there is no conversation', async () => {
    if (!runtime) {
      return;
    }

    const { caller, target } = await pair();
    const closedAt = new Date('2026-03-01T00:00:00.000Z');
    const match = await insertMatch(caller.id, target.id, 'ACTIVE');
    const conversation = await insertConversation(match.id, 'CLOSED', closedAt, null);
    const blockedClient = await connectReady(target.id);
    const incoming = waitForUnmatch(blockedClient);

    const response = await blockUser(caller.id, target.id);
    expect(response.status).toBe(200);
    expect(await incoming).toEqual({ matchId: match.id, conversationId: conversation.id });
    await conversation.reload();
    expect(conversation.closedAt?.getTime()).toBe(closedAt.getTime());

    const quietPair = await pair();
    const bareMatch = await insertMatch(quietPair.caller.id, quietPair.target.id, 'ACTIVE');
    const quietClient = await connectReady(quietPair.target.id);
    const bareResponse = await blockUser(quietPair.caller.id, quietPair.target.id);
    expect(bareResponse.status).toBe(200);
    await expectNoUnmatch(quietClient);
    await bareMatch.reload();
    expect(bareMatch.status).toBe('UNMATCHED');
  });

  it('does not emit for a block with no match, a duplicate, a delete, or a second block', async () => {
    if (!runtime) {
      return;
    }

    const { caller, target } = await pair();
    const noMatchClient = await connectReady(target.id);
    expect((await blockUser(caller.id, target.id)).status).toBe(200);
    await expectNoUnmatch(noMatchClient);

    const matched = await pair();
    const match = await insertMatch(matched.caller.id, matched.target.id, 'ACTIVE');
    const conversation = await insertConversation(match.id, 'ACTIVE', null, null);
    const blockedClient = await connectReady(matched.target.id);
    const firstEvent = waitForUnmatch(blockedClient);
    expect((await blockUser(matched.caller.id, matched.target.id)).status).toBe(200);
    expect(await firstEvent).toEqual({ matchId: match.id, conversationId: conversation.id });

    const duplicateClient = await connectReady(matched.target.id, 2);
    const duplicate = await blockUser(matched.caller.id, matched.target.id);
    expect(duplicate.status).toBe(409);
    await expectNoUnmatch(duplicateClient);

    const deleteClient = await connectReady(matched.target.id, 3);
    expect((await unblockUser(matched.caller.id, matched.target.id)).status).toBe(200);
    await expectNoUnmatch(deleteClient);

    const againClient = await connectReady(matched.target.id, 4);
    expect((await blockUser(matched.caller.id, matched.target.id)).status).toBe(200);
    await expectNoUnmatch(againClient);
    expect((await listBlocks(matched.caller.id)).status).toBe(200);
    await expectNoUnmatch(againClient);
  });

  it('does not emit when the transaction rolls back', async () => {
    if (!runtime) {
      return;
    }

    const { caller, target } = await pair();
    const match = await insertMatch(caller.id, target.id, 'ACTIVE');
    await insertConversation(match.id, 'ACTIVE', null, null);
    const blockedClient = await connectReady(target.id);
    jest.spyOn(Conversation, 'update').mockRejectedValueOnce(new Error('close failed'));

    const response = await blockUser(caller.id, target.id);
    expect(response.status).toBe(500);
    await expectNoUnmatch(blockedClient);
    await match.reload();
    expect(match.status).toBe('ACTIVE');
    expect(await Block.count()).toBe(0);
  });

  it('still returns 200 when socket delivery throws', async () => {
    if (!runtime) {
      return;
    }

    const { caller, target } = await pair();
    const match = await insertMatch(caller.id, target.id, 'ACTIVE');
    await insertConversation(match.id, 'ACTIVE', null, null);
    const blockedClient = await connectReady(target.id);
    jest.spyOn(runtime.io, 'to').mockImplementation(() => {
      throw new Error('delivery failed');
    });

    const response = await blockUser(caller.id, target.id);
    expect(response.status).toBe(200);
    await expectNoUnmatch(blockedClient);
    await match.reload();
    expect(match.status).toBe('UNMATCHED');
    expect(await Block.count()).toBe(1);
  });
});
