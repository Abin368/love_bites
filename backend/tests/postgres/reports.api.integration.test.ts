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
import { Report, ReportReason } from '../../src/database/models/report.model';
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
const REASONS: ReportReason[] = [
  'FAKE_PROFILE',
  'HARASSMENT',
  'SPAM',
  'INAPPROPRIATE_CONTENT',
  'SCAM',
  'OTHER'
];

interface Point {
  latitude: number;
  longitude: number;
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
  return Gender.create({ code: `report-${randomUUID()}`, name: 'Woman', isActive: true });
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
    email: `report-${randomUUID()}@example.com`,
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

function submitReport(callerId: string, body: Record<string, unknown>) {
  return request(app).post('/api/v1/reports').set(authHeader(callerId)).send(body);
}

function discover(userId: string) {
  return request(app).get('/api/v1/discovery').set(authHeader(userId));
}

async function insertMatch(leftUserId: string, rightUserId: string): Promise<Match> {
  const rows = await sequelize.query<{ id: string }>(
    `INSERT INTO matches (
       id, user_one_id, user_two_id, status, matched_at, unmatched_at, unmatched_by_user_id, created_at, updated_at
     )
     VALUES (
       gen_random_uuid(),
       LEAST(CAST(:leftUserId AS uuid), CAST(:rightUserId AS uuid)),
       GREATEST(CAST(:leftUserId AS uuid), CAST(:rightUserId AS uuid)),
       'ACTIVE',
       CURRENT_TIMESTAMP,
       NULL,
       NULL,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
     )
     RETURNING id`,
    {
      replacements: { leftUserId, rightUserId },
      type: QueryTypes.SELECT
    }
  );
  const match = await Match.findByPk(rows[0].id);
  if (!match) {
    throw new Error('Match was not inserted.');
  }
  return match;
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

describe('report submission', () => {
  it('creates a pending report and returns only the report id and status', async () => {
    const { caller, target } = await pair();
    const response = await submitReport(caller.id, {
      reportedUserId: target.id.toUpperCase(),
      reason: 'HARASSMENT',
      description: '  Sent repeated insults.  '
    }).set('Idempotency-Key', randomUUID());

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Report submitted. Our safety team will review it.');
    expect(response.body.data).toEqual({
      reportId: expect.any(String),
      status: 'PENDING'
    });
    expect(Object.keys(response.body.data).sort()).toEqual(['reportId', 'status']);
    expect(response.body.data.reportId).toBe(response.body.data.reportId.toLowerCase());

    const stored = await Report.findAll();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(response.body.data.reportId);
    expect(stored[0].reporterId).toBe(caller.id);
    expect(stored[0].reportedUserId).toBe(target.id);
    expect(stored[0].reason).toBe('HARASSMENT');
    expect(stored[0].description).toBe('Sent repeated insults.');
    expect(stored[0].status).toBe('PENDING');
    expect(stored[0].adminNotes).toBeNull();
    expect(stored[0].resolvedById).toBeNull();
    expect(stored[0].resolvedAt).toBeNull();
    expect(await Notification.count()).toBe(0);
    expect(await Block.count()).toBe(0);
    expect(await Match.count()).toBe(0);
    expect(await UsageRecord.count()).toBe(0);
    expect(await CreditTransaction.count()).toBe(0);
  });

  it('accepts every report reason when the description rule is satisfied', async () => {
    const catalogGender = await gender();
    const caller = await buildUser({ genderId: catalogGender.id });

    for (const reason of REASONS) {
      const target = await buildUser({ genderId: catalogGender.id });
      const body =
        reason === 'OTHER'
          ? { reportedUserId: target.id, reason, description: 'Something else happened.' }
          : { reportedUserId: target.id, reason };
      const response = await submitReport(caller.id, body);
      expect(response.status).toBe(201);
      expect(response.body.data.status).toBe('PENDING');

      const stored = await Report.findOne({ where: { reportedUserId: target.id } });
      expect(stored?.reason).toBe(reason);
      expect(stored?.status).toBe('PENDING');
      expect(stored?.description).toBe(reason === 'OTHER' ? 'Something else happened.' : null);
      expect(stored?.adminNotes).toBeNull();
      expect(stored?.resolvedById).toBeNull();
      expect(stored?.resolvedAt).toBeNull();
    }

    expect(await Report.count()).toBe(REASONS.length);
    expect(await Notification.count()).toBe(0);
  });

  it('rejects OTHER without a meaningful description', async () => {
    const { caller, target } = await pair();
    const bodies = [
      { reportedUserId: target.id, reason: 'OTHER' },
      { reportedUserId: target.id, reason: 'OTHER', description: '' },
      { reportedUserId: target.id, reason: 'OTHER', description: '   ' }
    ];

    for (const body of bodies) {
      const response = await submitReport(caller.id, body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'description',
            message: 'A description is required when the reason is OTHER.'
          })
        ])
      );
    }

    expect(await Report.count()).toBe(0);
  });

  it('rejects an invalid reason, a malformed id, missing fields, and unknown properties', async () => {
    const { caller, target } = await pair();

    const invalidReason = await submitReport(caller.id, {
      reportedUserId: target.id,
      reason: 'BULLYING'
    });
    expect(invalidReason.status).toBe(400);
    expect(invalidReason.body.error.code).toBe('VALIDATION_ERROR');
    expect(invalidReason.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'reason', message: 'Reason must be a valid report reason.' })
      ])
    );

    const malformed = await submitReport(caller.id, {
      reportedUserId: 'not-a-uuid',
      reason: 'SPAM'
    });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'reportedUserId',
          message: 'Reported user id must be a valid UUID.'
        })
      ])
    );

    const missingUser = await submitReport(caller.id, { reason: 'SPAM' });
    expect(missingUser.status).toBe(400);
    expect(missingUser.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'reportedUserId', message: 'Reported user id is required.' })
      ])
    );

    const missingReason = await submitReport(caller.id, { reportedUserId: target.id });
    expect(missingReason.status).toBe(400);
    expect(missingReason.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'reason', message: 'Reason is required.' })])
    );

    const unknown = await submitReport(caller.id, {
      reportedUserId: target.id,
      reason: 'SPAM',
      extra: true
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe('VALIDATION_ERROR');
    expect(unknown.body.error.details[0].message).toContain('extra');

    const query = await submitReport(caller.id, { reportedUserId: target.id, reason: 'SPAM' }).query({
      limit: '1'
    });
    expect(query.status).toBe(400);
    expect(query.body.error.details).toEqual([{ field: 'limit', message: 'Unsupported query parameter.' }]);

    expect(await Report.count()).toBe(0);
  });

  it('rejects caller-supplied status and resolution fields', async () => {
    const { caller, target } = await pair();
    const forbidden = ['status', 'adminNotes', 'resolvedBy', 'resolvedAt', 'resolvedById', 'reporterId'];

    for (const field of forbidden) {
      const response = await submitReport(caller.id, {
        reportedUserId: target.id,
        reason: 'SCAM',
        [field]: 'PENDING'
      });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details[0].message).toContain(field);
    }

    expect(await Report.count()).toBe(0);
  });

  it('rejects a missing user, a soft-deleted user, and a deleted status', async () => {
    const { caller } = await pair();

    const missing = await submitReport(caller.id, { reportedUserId: randomUUID(), reason: 'SPAM' });
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
    const deletedResponse = await submitReport(caller.id, { reportedUserId: deleted.id, reason: 'SPAM' });
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
    const statusResponse = await submitReport(caller.id, {
      reportedUserId: statusDeleted.id,
      reason: 'SPAM'
    });
    expect(statusResponse.status).toBe(404);
    expect(statusResponse.body.error.code).toBe('USER_NOT_FOUND');
    expect(await Report.count()).toBe(0);
  });

  it('rejects a self report before writing a row', async () => {
    const { caller } = await pair();
    const response = await submitReport(caller.id, {
      reportedUserId: caller.id.toUpperCase(),
      reason: 'FAKE_PROFILE'
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('SELF_INTERACTION');
    expect(response.body.error.message).toBe('You cannot report your own profile.');
    expect(await Report.count()).toBe(0);
  });

  it('allows more than one report for the same pair', async () => {
    const { caller, target } = await pair();
    const first = await submitReport(caller.id, { reportedUserId: target.id, reason: 'SPAM' });
    const second = await submitReport(caller.id, {
      reportedUserId: target.id,
      reason: 'SCAM',
      description: 'Asked for money.'
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.reportId).not.toBe(second.body.data.reportId);

    const stored = await Report.findAll({ order: [['createdAt', 'ASC']] });
    expect(stored).toHaveLength(2);
    expect(stored.map((row) => row.reason)).toEqual(['SPAM', 'SCAM']);
    expect(stored.every((row) => row.reporterId === caller.id && row.reportedUserId === target.id)).toBe(true);
    expect(stored.every((row) => row.status === 'PENDING' && row.resolvedAt === null)).toBe(true);
  });

  it('rejects a missing token and an admin', async () => {
    const { target } = await pair();
    const missing = await request(app).post('/api/v1/reports').send({
      reportedUserId: target.id,
      reason: 'SPAM'
    });
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
      .post('/api/v1/reports')
      .set(authHeader(admin.id, 'ADMIN'))
      .send({ reportedUserId: target.id, reason: 'SPAM' });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
    expect(await Report.count()).toBe(0);
  });

  it('does not require a verified or complete caller', async () => {
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
    const target = await buildUser({ genderId: catalogGender.id, status: 'SUSPENDED' });
    const response = await submitReport(caller.id, { reportedUserId: target.id, reason: 'FAKE_PROFILE' });
    expect(response.status).toBe(201);
    expect(await Report.count()).toBe(1);
  });

  it('leaves blocks, matches, conversations, likes, messages, and discovery unchanged', async () => {
    const { viewer, candidate } = await eligibleDiscoveryPair();
    const before = await discover(viewer.id);
    expect(before.status).toBe(200);
    expect(before.body.data.candidate.id).toBe(candidate.id);

    const reported = await submitReport(viewer.id, {
      reportedUserId: candidate.id,
      reason: 'INAPPROPRIATE_CONTENT',
      description: 'Photo is not appropriate.'
    });
    expect(reported.status).toBe(201);

    const afterReport = await discover(viewer.id);
    expect(afterReport.status).toBe(200);
    expect(afterReport.body.data.candidate.id).toBe(candidate.id);

    const like = await Like.create({
      fromUserId: viewer.id,
      toUserId: candidate.id,
      action: 'LIKE',
      isUndone: false,
      ...timestamps()
    });
    const match = await insertMatch(viewer.id, candidate.id);
    const conversation = await Conversation.create({
      matchId: match.id,
      status: 'ACTIVE',
      lastMessageAt: new Date('2026-03-01T00:00:00.000Z'),
      closedAt: null,
      ...timestamps()
    });
    const message = await Message.create({
      conversationId: conversation.id,
      senderId: viewer.id,
      messageType: 'TEXT',
      content: 'Hello',
      ...timestamps()
    });
    const block = await Block.create({
      blockerId: viewer.id,
      blockedId: candidate.id,
      reason: null,
      createdAt: new Date()
    });

    const likeUpdatedAt = like.updatedAt.getTime();
    const matchUpdatedAt = match.updatedAt.getTime();
    const conversationUpdatedAt = conversation.updatedAt.getTime();
    const messageUpdatedAt = message.updatedAt.getTime();

    const blockedDiscovery = await discover(viewer.id);
    expect(blockedDiscovery.body.data.candidate).toBeNull();

    const second = await submitReport(viewer.id, { reportedUserId: candidate.id, reason: 'SPAM' });
    expect(second.status).toBe(201);

    await like.reload();
    await match.reload();
    await conversation.reload();
    await message.reload();
    await block.reload();

    expect(like.action).toBe('LIKE');
    expect(like.isUndone).toBe(false);
    expect(like.updatedAt.getTime()).toBe(likeUpdatedAt);
    expect(match.status).toBe('ACTIVE');
    expect(match.unmatchedAt).toBeNull();
    expect(match.unmatchedByUserId).toBeNull();
    expect(match.updatedAt.getTime()).toBe(matchUpdatedAt);
    expect(conversation.status).toBe('ACTIVE');
    expect(conversation.closedAt).toBeNull();
    expect(conversation.updatedAt.getTime()).toBe(conversationUpdatedAt);
    expect(message.content).toBe('Hello');
    expect(message.deletedAt).toBeNull();
    expect(message.updatedAt.getTime()).toBe(messageUpdatedAt);
    expect(block.blockerId).toBe(viewer.id);
    expect(block.blockedId).toBe(candidate.id);
    expect(await Block.count()).toBe(1);
    expect(await Match.count()).toBe(1);
    expect(await Conversation.count()).toBe(1);
    expect(await Like.count()).toBe(1);
    expect(await Message.count()).toBe(1);
    expect(await Notification.count()).toBe(0);
    expect(await Report.count()).toBe(2);

    const stillBlocked = await discover(viewer.id);
    expect(stillBlocked.body.data.candidate).toBeNull();
  });
});

describe('report submission socket events', () => {
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
      const timer = setTimeout(() => reject(new Error('Socket connection timed out.')), 5000);
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

  async function waitForUserRoom(userId: string): Promise<void> {
    const room = `user:${userId}`;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const members = await runtime!.io.in(room).fetchSockets();
      if (members.length >= 1) {
        await new Promise((resolve) => setImmediate(resolve));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for ${room}`);
  }

  beforeAll(async () => {
    const reachable = await redisIsReachable();
    if (!reachable) {
      if (process.env.CI) {
        throw new Error('Report socket tests require Redis. CI did not provide a reachable Redis at REDIS_URL.');
      }
      console.warn('Redis is not reachable, so report socket tests were not executed.');
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

  it('does not emit a socket event to either user', async () => {
    if (!runtime) {
      return;
    }

    const { caller, target } = await pair();
    const callerClient = await connectSocket(caller.id);
    const targetClient = await connectSocket(target.id);
    await waitForUserRoom(caller.id);
    await waitForUserRoom(target.id);

    const events: string[] = [];
    callerClient.onAny((eventName: string) => {
      events.push(`caller:${eventName}`);
    });
    targetClient.onAny((eventName: string) => {
      events.push(`target:${eventName}`);
    });

    const response = await submitReport(caller.id, { reportedUserId: target.id, reason: 'HARASSMENT' });
    expect(response.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(events).toEqual([]);
    expect(await Notification.count()).toBe(0);
    expect(await Report.count()).toBe(1);
  });
});
