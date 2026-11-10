import { randomUUID } from 'crypto';
import request from 'supertest';
import type { Server } from 'socket.io';
import { QueryTypes } from 'sequelize';
import { literal } from 'sequelize';
import { sequelize } from '../../src/config/database';
import { Block } from '../../src/database/models/block.model';
import { Conversation } from '../../src/database/models/conversation.model';
import { CreditTransaction } from '../../src/database/models/credit-transaction.model';
import { DatingPreference } from '../../src/database/models/dating-preference.model';
import { Gender } from '../../src/database/models/gender.model';
import { Match } from '../../src/database/models/match.model';
import { Message } from '../../src/database/models/message.model';
import { Notification } from '../../src/database/models/notification.model';
import { Plan } from '../../src/database/models/plan.model';
import { Profile } from '../../src/database/models/profile.model';
import { ProfilePhoto } from '../../src/database/models/profile-photo.model';
import { Subscription } from '../../src/database/models/subscription.model';
import { UsageRecord } from '../../src/database/models/usage-record.model';
import { User, UserStatus } from '../../src/database/models/user.model';
import { UserCreditBalance } from '../../src/database/models/user-credit-balance.model';
import { currentUtcDayWindow, DAILY_LIKE_PASS_METRIC } from '../../src/modules/likes/likes.data-access';
import { encodeMatchListCursor } from '../../src/modules/likes/likes.validator';
import { InternalServerError } from '../../src/utils/errors';
import { signAccessToken } from '../../src/utils/jwt';
import { redis, resetMemoryRedis } from '../helpers/memory-redis';

const mockPhotoStorage = {
  createUploadUrl: jest.fn(),
  createDownloadUrl: jest.fn()
};

jest.mock('../../src/integrations/storage/s3.provider', () => ({
  photoStorage: mockPhotoStorage
}));
jest.mock('../../src/config/redis', () => jest.requireActual('../helpers/memory-redis'));

import { app } from '../../src/app';
import { forgetSocketServer, rememberSocketServer } from '../../src/socket/socket.server';

jest.setTimeout(120000);

const PATH = '/api/v1/matches';
const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';
const ORIGIN = { latitude: 12.9716, longitude: 77.5946 };
const HIDDEN_BIO = 'hidden-bio-match-list';
const HIDDEN_OCCUPATION = 'hidden-occupation-match-list';
const LIMIT_MESSAGE = 'Limit must be an integer from 1 to 50.';

interface Point {
  latitude: number;
  longitude: number;
}

interface BuiltUser {
  user: User;
  storageKey: string | null;
  extraStorageKey: string | null;
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

function listMatches(userId: string, query?: Record<string, string>) {
  const call = request(app).get(PATH).set(authHeader(userId));
  return query ? call.query(query) : call;
}

function encodeCursor(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

async function setLocation(userId: string, point: Point, city: string | null = 'Bengaluru'): Promise<void> {
  await Profile.update(
    {
      city,
      location: literal(`ST_GeogFromText('SRID=4326;POINT(${point.longitude} ${point.latitude})')`)
    },
    { where: { userId } }
  );
}

async function gender(): Promise<Gender> {
  return Gender.create({ code: `match-list-${randomUUID()}`, name: 'HiddenGenderName', isActive: true });
}

async function buildUser(input: {
  genderId: string;
  id?: string;
  firstName?: string;
  dateOfBirth?: string;
  complete?: boolean;
  primaryPhoto?: boolean;
  extraPhoto?: boolean;
  status?: UserStatus;
  emailVerified?: boolean;
  phoneOnly?: boolean;
  point?: Point | null;
  preferences?: boolean;
  city?: string | null;
}): Promise<BuiltUser> {
  const emailVerified = input.emailVerified ?? true;
  const user = await User.create({
    id: input.id,
    email: input.phoneOnly ? null : `match-list-${randomUUID()}@example.com`,
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
    dateOfBirth: input.dateOfBirth ?? '1998-04-12',
    genderId: input.genderId,
    bio: HIDDEN_BIO,
    occupation: HIDDEN_OCCUPATION,
    education: 'NID',
    isProfileComplete: input.complete ?? true
  });

  const point = input.point === undefined ? ORIGIN : input.point;
  if (point) {
    await setLocation(user.id, point, input.city === undefined ? 'Bengaluru' : input.city);
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
  if (input.primaryPhoto !== false) {
    storageKey = `photos/${user.id}/${randomUUID()}.webp`;
    await ProfilePhoto.create({
      userId: user.id,
      storageKey,
      mimeType: 'image/jpeg',
      fileSizeBytes: 2048,
      displayOrder: 1,
      isPrimary: true,
      ...timestamps()
    });
  }

  let extraStorageKey: string | null = null;
  if (input.extraPhoto) {
    extraStorageKey = `photos/${user.id}/extra-${randomUUID()}.webp`;
    await ProfilePhoto.create({
      userId: user.id,
      storageKey: extraStorageKey,
      mimeType: 'image/jpeg',
      fileSizeBytes: 1024,
      displayOrder: 2,
      isPrimary: false,
      ...timestamps()
    });
  }

  return { user, storageKey, extraStorageKey };
}

async function insertMatch(
  leftUserId: string,
  rightUserId: string,
  status: 'ACTIVE' | 'UNMATCHED' | 'UNDONE',
  options?: { id?: string; matchedAt?: Date }
): Promise<Match> {
  const id = options?.id ?? randomUUID();
  const matchedAt = options?.matchedAt ?? new Date();
  const [userOneId, userTwoId] = [leftUserId.toLowerCase(), rightUserId.toLowerCase()].sort();
  return Match.create({
    id,
    userOneId,
    userTwoId,
    status,
    matchedAt,
    unmatchedAt: status === 'UNMATCHED' ? matchedAt : null,
    unmatchedByUserId: status === 'UNMATCHED' ? leftUserId : null,
    createdAt: matchedAt,
    updatedAt: matchedAt
  });
}

async function insertConversation(matchId: string, status: 'ACTIVE' | 'CLOSED' = 'ACTIVE'): Promise<Conversation> {
  return Conversation.create({
    matchId,
    status,
    lastMessageAt: null,
    closedAt: status === 'CLOSED' ? new Date() : null,
    ...timestamps()
  });
}

async function openMatch(input: {
  callerId: string;
  partnerId: string;
  status?: 'ACTIVE' | 'UNMATCHED' | 'UNDONE';
  id?: string;
  matchedAt?: Date;
  conversation?: boolean;
}): Promise<{ match: Match; conversation: Conversation | null }> {
  const match = await insertMatch(input.callerId, input.partnerId, input.status ?? 'ACTIVE', {
    id: input.id,
    matchedAt: input.matchedAt
  });
  const conversation = input.conversation === false ? null : await insertConversation(match.id);
  return { match, conversation };
}

async function insertMessage(input: {
  conversationId: string;
  senderId: string;
  content: string | null;
  createdAt: Date;
  messageType?: 'TEXT' | 'IMAGE' | 'GIF' | 'VIDEO' | 'VOICE';
  readAt?: Date | null;
  mediaStorageKey?: string | null;
  deleted?: boolean;
}): Promise<Message> {
  const created = await Message.create({
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
     SET created_at = :createdAt, updated_at = :createdAt, read_at = :readAt
     WHERE id = CAST(:id AS uuid)`,
    { replacements: { id: created.id, createdAt: input.createdAt, readAt: input.readAt ?? null } }
  );
  if (input.deleted) {
    await created.destroy();
  }
  const stored = await Message.findByPk(created.id, { paranoid: false });
  if (!stored) {
    throw new Error('Message was not inserted.');
  }
  return stored;
}

function itemIds(body: { data: { items: Array<{ matchId: string }> } }): string[] {
  return body.data.items.map((item) => item.matchId);
}

beforeEach(() => {
  resetMemoryRedis();
  mockPhotoStorage.createDownloadUrl.mockReset();
  mockPhotoStorage.createUploadUrl.mockReset();
  mockPhotoStorage.createDownloadUrl.mockImplementation(async () => ({
    url: `https://download.test/${randomUUID()}`,
    expiresInSeconds: 3600
  }));
});

describe('GET /api/v1/matches', () => {
  it('returns an empty list when the caller has no matches', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });

    const response = await listMatches(caller.user.id);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        items: [],
        pagination: { limit: 20, nextCursor: null, hasMore: false }
      },
      message: 'Matches retrieved.'
    });
    expect(mockPhotoStorage.createDownloadUrl).not.toHaveBeenCalled();
  });

  it('returns one active match to a free caller and the same match to a premium caller', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id, firstName: 'Alex' });
    const partner = await buildUser({ genderId: catalogGender.id, firstName: 'Jordan', primaryPhoto: true });
    const { match, conversation } = await openMatch({ callerId: caller.user.id, partnerId: partner.user.id });

    const response = await listMatches(caller.user.id);
    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Matches retrieved.');
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].matchId).toBe(match.id);
    expect(response.body.data.items[0].conversationId).toBe(conversation?.id);
    expect(response.body.data.items[0].user.id).toBe(partner.user.id);
    expect(response.body.data.items[0].lastMessage).toBeNull();
    expect(response.body.data.items[0].unreadCount).toBe(0);
    expect(response.body.data.pagination).toEqual({ limit: 20, nextCursor: null, hasMore: false });

    const plan = await Plan.create({
      code: `monthly-${randomUUID().slice(0, 12)}`,
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
      userId: caller.user.id,
      planId: plan.id,
      status: 'ACTIVE',
      autoRenew: false,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      ...timestamps()
    });
    const premium = await listMatches(caller.user.id);
    expect(premium.status).toBe(200);
    expect(premium.body.data.items.map((item: { matchId: string }) => item.matchId)).toEqual([match.id]);
  });

  it('returns every active match and hides the caller from the card', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id, firstName: 'Alex' });
    const first = await buildUser({ genderId: catalogGender.id, firstName: 'Jordan' });
    const second = await buildUser({ genderId: catalogGender.id, firstName: 'Sam' });
    const older = await openMatch({
      callerId: caller.user.id,
      partnerId: first.user.id,
      matchedAt: new Date('2026-09-01T08:00:00.000Z')
    });
    const newer = await openMatch({
      callerId: caller.user.id,
      partnerId: second.user.id,
      matchedAt: new Date('2026-09-02T08:00:00.000Z')
    });

    const response = await listMatches(caller.user.id);
    expect(response.status).toBe(200);
    expect(itemIds(response.body)).toEqual([newer.match.id, older.match.id]);
    const names = response.body.data.items.map((item: { user: { id: string; firstName: string } }) => item.user);
    expect(names).toEqual([
      expect.objectContaining({ id: second.user.id, firstName: 'Sam' }),
      expect.objectContaining({ id: first.user.id, firstName: 'Jordan' })
    ]);
    expect(names.map((user: { id: string }) => user.id)).not.toContain(caller.user.id);
  });

  it('shows each participant the other person on the same match', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id, firstName: 'Alex' });
    const partner = await buildUser({ genderId: catalogGender.id, firstName: 'Jordan' });
    const { match, conversation } = await openMatch({ callerId: caller.user.id, partnerId: partner.user.id });

    const asCaller = await listMatches(caller.user.id);
    const asPartner = await listMatches(partner.user.id);
    expect(asCaller.status).toBe(200);
    expect(asPartner.status).toBe(200);
    expect(asCaller.body.data.items[0].matchId).toBe(match.id);
    expect(asPartner.body.data.items[0].matchId).toBe(match.id);
    expect(asCaller.body.data.items[0].conversationId).toBe(conversation?.id);
    expect(asPartner.body.data.items[0].conversationId).toBe(conversation?.id);
    expect(asCaller.body.data.items[0].user).toEqual(expect.objectContaining({ id: partner.user.id, firstName: 'Jordan' }));
    expect(asPartner.body.data.items[0].user).toEqual(expect.objectContaining({ id: caller.user.id, firstName: 'Alex' }));
  });

  it('hides a match from a third user', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    const partner = await buildUser({ genderId: catalogGender.id });
    const stranger = await buildUser({ genderId: catalogGender.id, firstName: 'Stranger' });
    const { match } = await openMatch({ callerId: caller.user.id, partnerId: partner.user.id });

    const response = await listMatches(stranger.user.id);
    expect(response.status).toBe(200);
    expect(response.body.data.items).toEqual([]);
    expect(JSON.stringify(response.body)).not.toContain(match.id);
    expect(JSON.stringify(response.body)).not.toContain(caller.user.id);
    expect(JSON.stringify(response.body)).not.toContain(partner.user.id);
  });

  it('returns only active matches and omits unmatched and undone rows', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    const activePartner = await buildUser({ genderId: catalogGender.id, firstName: 'Active' });
    const unmatchedPartner = await buildUser({ genderId: catalogGender.id, firstName: 'Unmatched' });
    const undonePartner = await buildUser({ genderId: catalogGender.id, firstName: 'Undone' });
    const active = await openMatch({ callerId: caller.user.id, partnerId: activePartner.user.id, status: 'ACTIVE' });
    const unmatched = await openMatch({
      callerId: caller.user.id,
      partnerId: unmatchedPartner.user.id,
      status: 'UNMATCHED'
    });
    const undone = await openMatch({ callerId: caller.user.id, partnerId: undonePartner.user.id, status: 'UNDONE' });

    const response = await listMatches(caller.user.id);
    expect(response.status).toBe(200);
    expect(itemIds(response.body)).toEqual([active.match.id]);
    expect(JSON.stringify(response.body)).not.toContain(unmatched.match.id);
    expect(JSON.stringify(response.body)).not.toContain(undone.match.id);
    expect(JSON.stringify(response.body)).not.toContain('Unmatched');
    expect(JSON.stringify(response.body)).not.toContain('Undone');
  });

  it('omits a pair blocked in either direction and keeps an unrelated match', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    const blockedByCaller = await buildUser({ genderId: catalogGender.id, firstName: 'BlockedOut' });
    const blockedByPartner = await buildUser({ genderId: catalogGender.id, firstName: 'BlockedIn' });
    const kept = await buildUser({ genderId: catalogGender.id, firstName: 'Kept' });
    const outgoing = await openMatch({ callerId: caller.user.id, partnerId: blockedByCaller.user.id });
    const incoming = await openMatch({ callerId: caller.user.id, partnerId: blockedByPartner.user.id });
    const visible = await openMatch({
      callerId: caller.user.id,
      partnerId: kept.user.id,
      matchedAt: new Date('2026-10-01T00:00:00.000Z')
    });
    await Block.create({ blockerId: caller.user.id, blockedId: blockedByCaller.user.id, createdAt: new Date() });
    await Block.create({ blockerId: blockedByPartner.user.id, blockedId: caller.user.id, createdAt: new Date() });

    const response = await listMatches(caller.user.id);
    expect(response.status).toBe(200);
    expect(itemIds(response.body)).toEqual([visible.match.id]);
    expect(JSON.stringify(response.body)).not.toContain(outgoing.match.id);
    expect(JSON.stringify(response.body)).not.toContain(incoming.match.id);
    expect((await Match.findByPk(outgoing.match.id))?.status).toBe('ACTIVE');
    expect((await Match.findByPk(incoming.match.id))?.status).toBe('ACTIVE');
  });

  it('omits a soft-deleted partner, a deleted-status partner, and suspended, banned, and unverified partners', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    const visible = await buildUser({ genderId: catalogGender.id, firstName: 'Visible' });
    const softDeleted = await buildUser({ genderId: catalogGender.id, firstName: 'SoftDeleted' });
    const deletedStatus = await buildUser({ genderId: catalogGender.id, firstName: 'StatusDeleted' });
    const suspended = await buildUser({ genderId: catalogGender.id, firstName: 'SuspendedPartner' });
    const banned = await buildUser({ genderId: catalogGender.id, firstName: 'BannedPartner' });
    const unverified = await buildUser({ genderId: catalogGender.id, firstName: 'UnverifiedPartner', status: 'UNVERIFIED' });
    const kept = await openMatch({
      callerId: caller.user.id,
      partnerId: visible.user.id,
      matchedAt: new Date('2026-10-02T00:00:00.000Z')
    });
    await openMatch({ callerId: caller.user.id, partnerId: softDeleted.user.id });
    await openMatch({ callerId: caller.user.id, partnerId: deletedStatus.user.id });
    await openMatch({ callerId: caller.user.id, partnerId: suspended.user.id });
    await openMatch({ callerId: caller.user.id, partnerId: banned.user.id });
    await openMatch({ callerId: caller.user.id, partnerId: unverified.user.id });
    await softDeleted.user.destroy();
    await deletedStatus.user.update({ status: 'DELETED' });
    await suspended.user.update({ status: 'SUSPENDED' });
    await banned.user.update({ status: 'BANNED' });

    const response = await listMatches(caller.user.id);
    expect(response.status).toBe(200);
    expect(itemIds(response.body)).toEqual([kept.match.id]);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('SoftDeleted');
    expect(serialized).not.toContain('StatusDeleted');
    expect(serialized).not.toContain('SuspendedPartner');
    expect(serialized).not.toContain('BannedPartner');
    expect(serialized).not.toContain('UnverifiedPartner');
  });

  it('omits an active match that has no conversation', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    const missingConversation = await buildUser({ genderId: catalogGender.id, firstName: 'NoThread' });
    const withConversation = await buildUser({ genderId: catalogGender.id, firstName: 'HasThread' });
    const orphan = await openMatch({
      callerId: caller.user.id,
      partnerId: missingConversation.user.id,
      conversation: false
    });
    const kept = await openMatch({ callerId: caller.user.id, partnerId: withConversation.user.id });

    const response = await listMatches(caller.user.id);
    expect(response.status).toBe(200);
    expect(itemIds(response.body)).toEqual([kept.match.id]);
    expect(JSON.stringify(response.body)).not.toContain(orphan.match.id);
    expect(await Conversation.count({ where: { matchId: orphan.match.id } })).toBe(0);
  });

  it('rejects an unverified caller and an incomplete profile, missing location, or missing dating preferences', async () => {
    const catalogGender = await gender();
    const emailCaller = await buildUser({ genderId: catalogGender.id, emailVerified: false });
    const emailResponse = await listMatches(emailCaller.user.id);
    expect(emailResponse.status).toBe(403);
    expect(emailResponse.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    const phoneCaller = await buildUser({ genderId: catalogGender.id, phoneOnly: true, emailVerified: false });
    const phoneResponse = await listMatches(phoneCaller.user.id);
    expect(phoneResponse.status).toBe(403);
    expect(phoneResponse.body.error.code).toBe('PHONE_NOT_VERIFIED');

    const incomplete = await buildUser({ genderId: catalogGender.id, complete: false });
    const incompleteResponse = await listMatches(incomplete.user.id);
    expect(incompleteResponse.status).toBe(400);
    expect(incompleteResponse.body.error.code).toBe('PROFILE_INCOMPLETE');

    const missingLocation = await buildUser({ genderId: catalogGender.id, point: null });
    const locationResponse = await listMatches(missingLocation.user.id);
    expect(locationResponse.status).toBe(400);
    expect(locationResponse.body.error.code).toBe('PROFILE_INCOMPLETE');

    const missingPreferences = await buildUser({ genderId: catalogGender.id, preferences: false });
    const preferencesResponse = await listMatches(missingPreferences.user.id);
    expect(preferencesResponse.status).toBe(400);
    expect(preferencesResponse.body.error.code).toBe('PROFILE_INCOMPLETE');
    expect(mockPhotoStorage.createDownloadUrl).not.toHaveBeenCalled();
  });

  it('selects the other participant when the caller is either side of the canonical pair', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({
      genderId: catalogGender.id,
      id: '00000000-0000-4000-8000-000000000010',
      firstName: 'Alex'
    });
    const lower = await buildUser({
      genderId: catalogGender.id,
      id: '00000000-0000-4000-8000-000000000001',
      firstName: 'Lower'
    });
    const higher = await buildUser({
      genderId: catalogGender.id,
      id: '00000000-0000-4000-8000-0000000000f0',
      firstName: 'Higher'
    });
    const callerIsUserTwo = await openMatch({
      callerId: caller.user.id,
      partnerId: lower.user.id,
      matchedAt: new Date('2026-08-02T00:00:00.000Z')
    });
    const callerIsUserOne = await openMatch({
      callerId: caller.user.id,
      partnerId: higher.user.id,
      matchedAt: new Date('2026-08-03T00:00:00.000Z')
    });
    expect(callerIsUserTwo.match.userOneId).toBe(lower.user.id);
    expect(callerIsUserTwo.match.userTwoId).toBe(caller.user.id);
    expect(callerIsUserOne.match.userOneId).toBe(caller.user.id);
    expect(callerIsUserOne.match.userTwoId).toBe(higher.user.id);

    const response = await listMatches(caller.user.id);
    expect(response.status).toBe(200);
    expect(response.body.data.items.map((item: { user: { id: string; firstName: string } }) => item.user)).toEqual([
      expect.objectContaining({ id: higher.user.id, firstName: 'Higher' }),
      expect.objectContaining({ id: lower.user.id, firstName: 'Lower' })
    ]);
  });

  it('returns completed years, a city, and a null city', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    const withCity = await buildUser({
      genderId: catalogGender.id,
      firstName: 'Jordan',
      dateOfBirth: '2000-01-15',
      city: 'Mysuru'
    });
    const withoutCity = await buildUser({
      genderId: catalogGender.id,
      firstName: 'Sam',
      dateOfBirth: '1990-06-01',
      city: null
    });
    await openMatch({
      callerId: caller.user.id,
      partnerId: withCity.user.id,
      matchedAt: new Date('2026-07-02T00:00:00.000Z')
    });
    await openMatch({
      callerId: caller.user.id,
      partnerId: withoutCity.user.id,
      matchedAt: new Date('2026-07-01T00:00:00.000Z')
    });
    const ages = await sequelize.query<{ dob: string; age: number }>(
      `SELECT dob::text AS dob, CAST(EXTRACT(YEAR FROM AGE(dob)) AS int) AS age
       FROM (VALUES (DATE '2000-01-15'), (DATE '1990-06-01')) AS birthdays(dob)`,
      { type: QueryTypes.SELECT }
    );
    const ageByDob = new Map(ages.map((row) => [row.dob, Number(row.age)]));

    const response = await listMatches(caller.user.id);
    expect(response.status).toBe(200);
    expect(response.body.data.items[0].user).toEqual(
      expect.objectContaining({ firstName: 'Jordan', age: ageByDob.get('2000-01-15'), city: 'Mysuru' })
    );
    expect(response.body.data.items[1].user).toEqual(
      expect.objectContaining({ firstName: 'Sam', age: ageByDob.get('1990-06-01'), city: null })
    );
    expect(JSON.stringify(response.body)).not.toContain('2000-01-15');
    expect(JSON.stringify(response.body)).not.toContain('1990-06-01');
  });

  it('signs only the active primary photo and returns null when that photo is missing', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id, primaryPhoto: false });
    const withPhoto = await buildUser({
      genderId: catalogGender.id,
      firstName: 'Jordan',
      extraPhoto: true
    });
    const withoutPhoto = await buildUser({
      genderId: catalogGender.id,
      firstName: 'Sam',
      primaryPhoto: false
    });
    const signed = new Map<string, string>();
    mockPhotoStorage.createDownloadUrl.mockImplementation(async (input: { storageKey: string; expiresInSeconds: number }) => {
      const url = `https://download.test/opaque/${randomUUID()}`;
      signed.set(input.storageKey, url);
      return { url, expiresInSeconds: input.expiresInSeconds };
    });
    const pictured = await openMatch({
      callerId: caller.user.id,
      partnerId: withPhoto.user.id,
      matchedAt: new Date('2026-06-02T00:00:00.000Z')
    });
    await openMatch({
      callerId: caller.user.id,
      partnerId: withoutPhoto.user.id,
      matchedAt: new Date('2026-06-01T00:00:00.000Z')
    });

    const response = await listMatches(caller.user.id);
    expect(response.status).toBe(200);
    expect(response.body.data.items[0].user.primaryPhotoUrl).toBe(signed.get(withPhoto.storageKey ?? ''));
    expect(response.body.data.items[1].user.primaryPhotoUrl).toBeNull();
    expect(mockPhotoStorage.createDownloadUrl).toHaveBeenCalledTimes(1);
    expect(mockPhotoStorage.createDownloadUrl).toHaveBeenCalledWith({
      storageKey: withPhoto.storageKey,
      expiresInSeconds: 3600
    });
    expect(mockPhotoStorage.createDownloadUrl).not.toHaveBeenCalledWith(
      expect.objectContaining({ storageKey: withPhoto.extraStorageKey })
    );
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(withPhoto.storageKey);
    expect(serialized).not.toContain(withPhoto.extraStorageKey);
    expect(serialized).not.toContain(HIDDEN_BIO);
    expect(serialized).not.toContain(HIDDEN_OCCUPATION);
    expect(serialized).not.toContain('HiddenGenderName');
    expect(serialized).not.toContain('77.5946');
    expect(serialized).not.toContain('distanceKm');
    expect(serialized).not.toContain(caller.user.email ?? 'missing-email');
    expect(Object.keys(response.body.data.items[0]).sort()).toEqual(
      ['conversationId', 'lastMessage', 'matchId', 'matchedAt', 'unreadCount', 'user'].sort()
    );
    expect(Object.keys(response.body.data.items[0].user).sort()).toEqual(
      ['age', 'city', 'firstName', 'id', 'primaryPhotoUrl'].sort()
    );
    expect(response.body.data.items[0].matchedAt).toBe(pictured.match.matchedAt.toISOString());
  });

  it('returns an error and no item list when photo signing fails', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    const first = await buildUser({ genderId: catalogGender.id, firstName: 'Jordan' });
    const second = await buildUser({ genderId: catalogGender.id, firstName: 'Sam' });
    await openMatch({ callerId: caller.user.id, partnerId: first.user.id });
    await openMatch({ callerId: caller.user.id, partnerId: second.user.id });
    mockPhotoStorage.createDownloadUrl.mockRejectedValue(
      new InternalServerError('Photo storage is not configured.', [], 'STORAGE_NOT_CONFIGURED', true)
    );

    const response = await listMatches(caller.user.id);
    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('STORAGE_NOT_CONFIGURED');
    expect(response.body.data).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('Jordan');
    expect(JSON.stringify(response.body)).not.toContain('Sam');
  });

  it('returns a null preview when the conversation has no messages', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    const partner = await buildUser({ genderId: catalogGender.id });
    await openMatch({ callerId: caller.user.id, partnerId: partner.user.id });

    const response = await listMatches(caller.user.id);
    expect(response.status).toBe(200);
    expect(response.body.data.items[0].lastMessage).toBeNull();
    expect(response.body.data.items[0].unreadCount).toBe(0);
  });

  it('returns the latest non-deleted message and skips a newer soft-deleted row', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    const partner = await buildUser({ genderId: catalogGender.id });
    const { conversation } = await openMatch({ callerId: caller.user.id, partnerId: partner.user.id });
    const visible = await insertMessage({
      conversationId: conversation!.id,
      senderId: partner.user.id,
      content: 'visible-preview',
      createdAt: new Date('2026-09-15T08:35:00.000Z')
    });
    await insertMessage({
      conversationId: conversation!.id,
      senderId: partner.user.id,
      content: 'deleted-preview',
      createdAt: new Date('2026-09-15T09:00:00.000Z'),
      deleted: true
    });

    const response = await listMatches(caller.user.id);
    expect(response.status).toBe(200);
    expect(response.body.data.items[0].lastMessage).toEqual({
      id: visible.id,
      senderId: partner.user.id,
      messageType: 'TEXT',
      content: 'visible-preview',
      createdAt: '2026-09-15T08:35:00.000Z',
      mediaUrl: null
    });
    expect(JSON.stringify(response.body)).not.toContain('deleted-preview');
  });

  it('returns a media preview with a null download url and does not expose the storage key', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    const partner = await buildUser({ genderId: catalogGender.id });
    const { conversation } = await openMatch({ callerId: caller.user.id, partnerId: partner.user.id });
    const mediaKey = `chat-media/${conversation!.id}/${randomUUID()}`;
    const media = await insertMessage({
      conversationId: conversation!.id,
      senderId: partner.user.id,
      content: null,
      messageType: 'IMAGE',
      mediaStorageKey: mediaKey,
      createdAt: new Date('2026-09-16T08:35:00.000Z')
    });

    const response = await listMatches(caller.user.id);
    expect(response.status).toBe(200);
    expect(response.body.data.items[0].lastMessage).toEqual({
      id: media.id,
      senderId: partner.user.id,
      messageType: 'IMAGE',
      content: null,
      createdAt: '2026-09-16T08:35:00.000Z',
      mediaUrl: null
    });
    expect(JSON.stringify(response.body)).not.toContain(mediaKey);
  });

  it('limits the preview and unread queries to the current page', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    const first = await buildUser({ genderId: catalogGender.id });
    const second = await buildUser({ genderId: catalogGender.id });
    const newer = await openMatch({
      callerId: caller.user.id,
      partnerId: first.user.id,
      matchedAt: new Date('2026-09-20T00:00:00.000Z')
    });
    const older = await openMatch({
      callerId: caller.user.id,
      partnerId: second.user.id,
      matchedAt: new Date('2026-09-10T00:00:00.000Z')
    });
    await insertMessage({
      conversationId: newer.conversation!.id,
      senderId: first.user.id,
      content: 'page-one-preview',
      createdAt: new Date('2026-09-20T01:00:00.000Z')
    });
    await insertMessage({
      conversationId: older.conversation!.id,
      senderId: second.user.id,
      content: 'page-two-secret',
      createdAt: new Date('2026-09-10T01:00:00.000Z')
    });

    const response = await listMatches(caller.user.id, { limit: '1' });
    expect(response.status).toBe(200);
    expect(itemIds(response.body)).toEqual([newer.match.id]);
    expect(response.body.data.items[0].lastMessage.content).toBe('page-one-preview');
    expect(JSON.stringify(response.body)).not.toContain('page-two-secret');
    expect(JSON.stringify(response.body)).not.toContain(older.conversation!.id);
  });

  it('counts only the other participant unread messages for each caller', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id, firstName: 'Alex' });
    const partner = await buildUser({ genderId: catalogGender.id, firstName: 'Jordan' });
    const { conversation } = await openMatch({ callerId: caller.user.id, partnerId: partner.user.id });
    await insertMessage({
      conversationId: conversation!.id,
      senderId: partner.user.id,
      content: 'unread-one',
      createdAt: new Date('2026-09-01T00:00:00.000Z')
    });
    await insertMessage({
      conversationId: conversation!.id,
      senderId: partner.user.id,
      content: 'unread-two',
      createdAt: new Date('2026-09-01T00:01:00.000Z')
    });
    await insertMessage({
      conversationId: conversation!.id,
      senderId: caller.user.id,
      content: 'from-caller',
      createdAt: new Date('2026-09-01T00:02:00.000Z')
    });
    await insertMessage({
      conversationId: conversation!.id,
      senderId: partner.user.id,
      content: 'already-read',
      createdAt: new Date('2026-09-01T00:03:00.000Z'),
      readAt: new Date('2026-09-01T00:04:00.000Z')
    });
    await insertMessage({
      conversationId: conversation!.id,
      senderId: partner.user.id,
      content: 'deleted-unread',
      createdAt: new Date('2026-09-01T00:05:00.000Z'),
      deleted: true
    });

    const asCaller = await listMatches(caller.user.id);
    const asPartner = await listMatches(partner.user.id);
    expect(asCaller.body.data.items[0].unreadCount).toBe(2);
    expect(asPartner.body.data.items[0].unreadCount).toBe(1);
    const readAt = await Message.findOne({ where: { content: 'unread-one' } });
    expect(readAt?.readAt).toBeNull();
  });

  it('uses a default limit of 20 and a maximum of 50', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id, primaryPhoto: false });
    const ids: string[] = [];
    for (let index = 0; index < 51; index += 1) {
      const partner = await buildUser({ genderId: catalogGender.id, primaryPhoto: false, firstName: `P${index}` });
      const opened = await openMatch({
        callerId: caller.user.id,
        partnerId: partner.user.id,
        matchedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index))
      });
      ids.push(opened.match.id);
    }
    const newestFirst = [...ids].reverse();

    const defaults = await listMatches(caller.user.id);
    expect(defaults.status).toBe(200);
    expect(defaults.body.data.pagination.limit).toBe(20);
    expect(defaults.body.data.pagination.hasMore).toBe(true);
    expect(itemIds(defaults.body)).toEqual(newestFirst.slice(0, 20));

    const maximum = await listMatches(caller.user.id, { limit: '50' });
    expect(maximum.status).toBe(200);
    expect(maximum.body.data.pagination).toEqual(
      expect.objectContaining({ limit: 50, hasMore: true })
    );
    expect(itemIds(maximum.body)).toEqual(newestFirst.slice(0, 50));
    expect(maximum.body.data.pagination.nextCursor).toBe(
      encodeMatchListCursor(new Date(Date.UTC(2026, 0, 1, 0, 0, 1)), newestFirst[49])
    );
  });

  it('rejects an invalid limit, an invalid cursor, and an unsupported query parameter', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });

    const zero = await listMatches(caller.user.id, { limit: '0' });
    expect(zero.status).toBe(400);
    expect(zero.body.error.code).toBe('VALIDATION_ERROR');
    expect(zero.body.error.details).toEqual(expect.arrayContaining([{ field: 'limit', message: LIMIT_MESSAGE }]));

    const above = await listMatches(caller.user.id, { limit: '51' });
    expect(above.status).toBe(400);
    expect(above.body.error.details).toEqual(expect.arrayContaining([{ field: 'limit', message: LIMIT_MESSAGE }]));

    const malformed = await listMatches(caller.user.id, { cursor: 'not-a-cursor' });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
    expect(malformed.body.error.details).toEqual(
      expect.arrayContaining([
        {
          field: 'cursor',
          message: 'Cursor must be a base64-encoded JSON object with matchedAt and matchId.'
        }
      ])
    );

    const badUuid = await listMatches(caller.user.id, {
      cursor: encodeCursor({ matchedAt: '2026-09-15T08:30:00.000Z', matchId: 'not-a-uuid' })
    });
    expect(badUuid.status).toBe(400);
    expect(badUuid.body.error.details).toEqual(
      expect.arrayContaining([{ field: 'cursor.matchId', message: 'Cursor matchId must be a valid UUID.' }])
    );

    const badTime = await listMatches(caller.user.id, {
      cursor: encodeCursor({ matchedAt: '15 September 2026', matchId: randomUUID() })
    });
    expect(badTime.status).toBe(400);
    expect(badTime.body.error.details).toEqual(
      expect.arrayContaining([{ field: 'cursor.matchedAt', message: 'Cursor matchedAt must be a valid date-time.' }])
    );

    const extra = await listMatches(caller.user.id, {
      cursor: encodeCursor({
        matchedAt: '2026-09-15T08:30:00.000Z',
        matchId: randomUUID(),
        userId: randomUUID()
      })
    });
    expect(extra.status).toBe(400);
    expect(extra.body.error.details).toEqual(
      expect.arrayContaining([{ field: 'cursor.userId', message: 'Unsupported cursor field.' }])
    );

    const unsupported = await listMatches(caller.user.id, { userId: randomUUID() });
    expect(unsupported.status).toBe(400);
    expect(unsupported.body.error.code).toBe('VALIDATION_ERROR');
    expect(unsupported.body.error.details).toEqual(
      expect.arrayContaining([{ field: 'userId', message: 'Unsupported query parameter.' }])
    );
  });

  it('orders by matched_at descending then match id and pages without gaps or duplicates', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id, primaryPhoto: false });
    const newest = '00000000-0000-4000-8000-000000000001';
    const tieHigh = '00000000-0000-4000-8000-000000000004';
    const tieLow = '00000000-0000-4000-8000-000000000002';
    const noon = new Date('2026-10-12T12:00:00.000Z');
    const later = new Date('2026-10-12T13:00:00.000Z');
    const specs = [
      { id: tieLow, matchedAt: noon },
      { id: newest, matchedAt: later },
      { id: tieHigh, matchedAt: noon }
    ];
    for (const spec of specs) {
      const partner = await buildUser({ genderId: catalogGender.id, primaryPhoto: false });
      await openMatch({
        callerId: caller.user.id,
        partnerId: partner.user.id,
        id: spec.id,
        matchedAt: spec.matchedAt
      });
    }
    const expected = [newest, tieHigh, tieLow];

    const full = await listMatches(caller.user.id, { limit: '10' });
    expect(full.status).toBe(200);
    expect(itemIds(full.body)).toEqual(expected);
    expect(full.body.data.pagination).toEqual({ limit: 10, nextCursor: null, hasMore: false });

    const seen: string[] = [];
    let cursor: string | undefined;
    while (seen.length < 5) {
      const page = await listMatches(caller.user.id, cursor ? { limit: '1', cursor } : { limit: '1' });
      expect(page.status).toBe(200);
      expect(page.body.data.pagination.limit).toBe(1);
      const items = page.body.data.items as Array<{ matchId: string; matchedAt: string }>;
      if (items.length === 0) {
        expect(page.body.data.pagination).toEqual({ limit: 1, nextCursor: null, hasMore: false });
        break;
      }
      seen.push(items[0].matchId);
      if (!page.body.data.pagination.hasMore) {
        expect(page.body.data.pagination.nextCursor).toBeNull();
        break;
      }
      expect(page.body.data.pagination.nextCursor).toBe(
        encodeMatchListCursor(new Date(items[0].matchedAt), items[0].matchId)
      );
      cursor = page.body.data.pagination.nextCursor;
    }
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(expected.length);

    const afterTie = await listMatches(caller.user.id, {
      limit: '10',
      cursor: encodeMatchListCursor(noon, tieHigh)
    });
    expect(afterTie.status).toBe(200);
    expect(itemIds(afterTie.body)).toEqual([tieLow]);
    expect(afterTie.body.data.pagination).toEqual({ limit: 10, nextCursor: null, hasMore: false });
  });

  it('rejects a missing token, an invalid token, an admin, a suspended caller, a banned caller, and a deleted caller', async () => {
    const missing = await request(app).get(PATH);
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('AUTH_REQUIRED');

    const invalid = await request(app).get(PATH).set({ Authorization: 'Bearer not-a-token' });
    expect(invalid.status).toBe(401);
    expect(invalid.body.error.code).toBe('INVALID_TOKEN');

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

    const suspended = await User.create({
      email: `suspended-${randomUUID()}@example.com`,
      passwordHash: PASSWORD_HASH,
      role: 'USER',
      status: 'SUSPENDED',
      emailVerified: true,
      phoneVerified: false
    });
    const suspendedResponse = await listMatches(suspended.id);
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
    const bannedResponse = await listMatches(banned.id);
    expect(bannedResponse.status).toBe(403);
    expect(bannedResponse.body.error.code).toBe('ACCOUNT_BANNED');

    const deleted = await User.create({
      email: `deleted-${randomUUID()}@example.com`,
      passwordHash: PASSWORD_HASH,
      role: 'USER',
      status: 'ACTIVE',
      emailVerified: true,
      phoneVerified: false
    });
    await deleted.destroy();
    const deletedResponse = await listMatches(deleted.id);
    expect(deletedResponse.status).toBe(401);
    expect(deletedResponse.body.error.code).toBe('INVALID_TOKEN');
  });

  it('does not write rows, redis keys, or socket events', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });
    const partner = await buildUser({ genderId: catalogGender.id });
    const { match, conversation } = await openMatch({ callerId: caller.user.id, partnerId: partner.user.id });
    const message = await insertMessage({
      conversationId: conversation!.id,
      senderId: partner.user.id,
      content: 'steady',
      createdAt: new Date('2026-09-15T08:35:00.000Z')
    });
    const window = currentUtcDayWindow();
    await UsageRecord.create({
      userId: caller.user.id,
      metricKey: DAILY_LIKE_PASS_METRIC,
      periodStart: window.periodStart,
      periodEnd: window.periodEnd,
      usageCount: 4,
      ...timestamps()
    });
    await UserCreditBalance.create({
      userId: caller.user.id,
      creditType: 'SUPER_LIKE',
      balance: 3,
      ...timestamps()
    });
    await CreditTransaction.create({
      userId: caller.user.id,
      creditType: 'SUPER_LIKE',
      delta: 3,
      reason: 'MONTHLY_GRANT',
      referenceId: null,
      createdAt: new Date()
    });
    const plan = await Plan.create({
      code: `plan-${randomUUID()}`,
      name: 'Premium',
      billingInterval: 'MONTH',
      priceInCents: 49900,
      currency: 'INR',
      isActive: true,
      displayOrder: 1,
      ...timestamps()
    });
    const now = new Date();
    await Subscription.create({
      userId: caller.user.id,
      planId: plan.id,
      status: 'ACTIVE',
      autoRenew: true,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      ...timestamps()
    });
    await Notification.create({
      userId: caller.user.id,
      type: 'NEW_MATCH',
      title: 'Existing',
      message: 'Already stored',
      data: {},
      createdAt: new Date()
    });

    const before = {
      matches: await Match.findAll({ order: [['id', 'ASC']] }),
      conversations: await Conversation.findAll({ order: [['id', 'ASC']] }),
      messages: await Message.findAll({ paranoid: false, order: [['id', 'ASC']] }),
      notifications: await Notification.count(),
      usage: await UsageRecord.count(),
      credits: await CreditTransaction.count(),
      balances: await UserCreditBalance.findAll(),
      subscriptions: await Subscription.findAll()
    };
    const setSpy = jest.spyOn(redis, 'set');
    const delSpy = jest.spyOn(redis, 'del');
    const socket = attachFakeSocket();

    try {
      const response = await listMatches(caller.user.id);
      expect(response.status).toBe(200);
      expect(response.body.data.items[0].matchId).toBe(match.id);

      const matches = await Match.findAll({ order: [['id', 'ASC']] });
      const conversations = await Conversation.findAll({ order: [['id', 'ASC']] });
      const messages = await Message.findAll({ paranoid: false, order: [['id', 'ASC']] });
      expect(matches.map(stampMatch)).toEqual(before.matches.map(stampMatch));
      expect(conversations.map(stampConversation)).toEqual(before.conversations.map(stampConversation));
      expect(messages.map(stampMessage)).toEqual(before.messages.map(stampMessage));
      expect(await Notification.count()).toBe(before.notifications);
      expect(await UsageRecord.count()).toBe(before.usage);
      expect(await CreditTransaction.count()).toBe(before.credits);
      expect((await UserCreditBalance.findAll()).map((row) => row.toJSON())).toEqual(before.balances.map((row) => row.toJSON()));
      expect((await Subscription.findAll()).map((row) => ({ id: row.id, updatedAt: row.updatedAt.toISOString(), status: row.status }))).toEqual(
        before.subscriptions.map((row) => ({ id: row.id, updatedAt: row.updatedAt.toISOString(), status: row.status }))
      );
      expect((await Message.findByPk(message.id))?.readAt).toBeNull();
      expect(setSpy).not.toHaveBeenCalled();
      expect(delSpy).not.toHaveBeenCalled();
      expect(socket.emit).not.toHaveBeenCalled();
    } finally {
      setSpy.mockRestore();
      delSpy.mockRestore();
      socket.detach();
    }
  });
});

function stampMatch(row: Match) {
  return {
    id: row.id,
    status: row.status,
    matchedAt: row.matchedAt.toISOString(),
    unmatchedAt: row.unmatchedAt ? row.unmatchedAt.toISOString() : null,
    unmatchedByUserId: row.unmatchedByUserId,
    updatedAt: row.updatedAt.toISOString()
  };
}

function stampConversation(row: Conversation) {
  return {
    id: row.id,
    matchId: row.matchId,
    status: row.status,
    lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString()
  };
}

function stampMessage(row: Message) {
  return {
    id: row.id,
    content: row.content,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString()
  };
}

function attachFakeSocket(): { emit: jest.Mock; detach: () => void } {
  const emit = jest.fn();
  const io = {
    to: () => ({ emit })
  } as unknown as Server;
  rememberSocketServer(io);
  return {
    emit,
    detach: () => {
      forgetSocketServer(io);
    }
  };
}
