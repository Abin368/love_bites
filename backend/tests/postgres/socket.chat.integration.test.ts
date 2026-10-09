import { randomUUID } from 'crypto';
import http from 'http';
import Redis from 'ioredis';
import request from 'supertest';
import { literal, QueryTypes } from 'sequelize';
import { Server } from 'socket.io';
import { io as createClient, Socket as ClientSocket } from 'socket.io-client';
import { env } from '../../src/config/env';
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
import { app } from '../../src/app';
import {
  currentUtcDayWindow,
  DAILY_TEXT_MESSAGES_METRIC
} from '../../src/modules/likes/likes.data-access';
import * as chatService from '../../src/modules/chat/chat.service';
import { attachSocketServer, closeSocketServer, SocketRuntime } from '../../src/socket/socket.server';
import { signAccessToken } from '../../src/utils/jwt';

const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';
const ORIGIN = { latitude: 12.9716, longitude: 77.5946 };
const DAILY_TEXT_LIMIT_MESSAGE = 'You have reached your daily limit of 20 text messages.';

interface Point {
  latitude: number;
  longitude: number;
}

interface HandshakeError extends Error {
  data?: { code?: string };
}

interface AckError {
  code: string;
  message: string;
  details: Array<{ field?: string; message: string; code?: string }> | null;
}

interface AckBody {
  success: boolean;
  data?: {
    id: string;
    conversationId: string;
    senderId: string;
    messageType: string;
    content: string;
    mediaUrl: null;
    readAt: null;
    createdAt: string;
    remainingDailyMessages: number | null;
  };
  error?: AckError;
}

interface NewMessageEvent {
  id: string;
  conversationId: string;
  senderId: string;
  messageType: string;
  content: string;
  createdAt: string;
}

let httpServer: http.Server | undefined;
let runtime: SocketRuntime | null = null;
let port = 0;
const openClients: ClientSocket[] = [];

function accessToken(userId: string): string {
  return signAccessToken({
    sub: userId,
    role: 'USER',
    isVerified: true,
    isProfileComplete: true
  });
}

function authHeader(userId: string) {
  return { Authorization: `Bearer ${accessToken(userId)}` };
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

function connectSocket(
  targetPort: number,
  auth?: Record<string, unknown>
): Promise<{ client: ClientSocket; error?: HandshakeError }> {
  return new Promise((resolve) => {
    const client = createClient(`http://127.0.0.1:${targetPort}`, {
      auth,
      reconnection: false,
      timeout: 5000,
      forceNew: true,
      transports: ['websocket']
    });
    openClients.push(client);
    const finish = (error?: HandshakeError) => {
      client.off('connect', onConnect);
      client.off('connect_error', onError);
      resolve({ client, error });
    };
    const onConnect = () => finish();
    const onError = (error: HandshakeError) => finish(error);
    client.once('connect', onConnect);
    client.once('connect_error', onError);
  });
}

async function waitForUserRoom(io: Server, userId: string, count = 1): Promise<void> {
  const room = `user:${userId}`;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const members = await io.in(room).fetchSockets();
    if (members.length >= count) {
      await new Promise((resolve) => setImmediate(resolve));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${room}`);
}

async function connectReady(userId: string, targetPort = port): Promise<ClientSocket> {
  const result = await connectSocket(targetPort, { token: accessToken(userId) });
  expect(result.error).toBeUndefined();
  await waitForUserRoom(runtime!.io, userId);
  return result.client;
}

function sendEvent(client: ClientSocket, payload: unknown): Promise<AckBody> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('chat:message:send acknowledgement timed out.')), 5000);
    client.emit('chat:message:send', payload, (body: AckBody) => {
      clearTimeout(timer);
      resolve(body);
    });
  });
}

interface ReadReceiptEvent {
  conversationId: string;
  readerId: string;
  readAt: string;
}

function markConversationRead(callerId: string, conversationId: string) {
  return request(app).patch(`/api/v1/conversations/${conversationId}/read`).set(authHeader(callerId));
}

function waitForNewMessage(client: ClientSocket, timeoutMs = 5000): Promise<NewMessageEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('chat:message:new timed out.')), timeoutMs);
    client.once('chat:message:new', (body: NewMessageEvent) => {
      clearTimeout(timer);
      resolve(body);
    });
  });
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
  return Gender.create({ code: `socket-chat-${randomUUID()}`, name: 'Woman', isActive: true });
}

async function buildUser(input: {
  genderId: string;
  complete?: boolean;
  status?: UserStatus;
  emailVerified?: boolean;
  point?: Point | null;
  preferences?: boolean;
}): Promise<User> {
  const user = await User.create({
    email: `socket-chat-${randomUUID()}@example.com`,
    phone: null,
    passwordHash: PASSWORD_HASH,
    role: 'USER',
    status: input.status ?? 'ACTIVE',
    emailVerified: input.emailVerified ?? true,
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

  await ProfilePhoto.create({
    userId: user.id,
    storageKey: `photos/${user.id}/${randomUUID()}.webp`,
    mimeType: 'image/jpeg',
    fileSizeBytes: 2048,
    displayOrder: 1,
    isPrimary: true,
    ...timestamps()
  });

  return user;
}

async function pair() {
  const catalogGender = await gender();
  const caller = await buildUser({ genderId: catalogGender.id, point: ORIGIN });
  const target = await buildUser({ genderId: catalogGender.id, point: north(2) });
  return { caller, target, genderId: catalogGender.id };
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
    throw new Error('Match was not inserted.');
  }
  return match;
}

async function insertConversation(matchId: string): Promise<Conversation> {
  return Conversation.create({
    matchId,
    status: 'ACTIVE',
    lastMessageAt: null,
    closedAt: null,
    ...timestamps()
  });
}

async function activeThread() {
  const { caller, target, genderId } = await pair();
  const match = await insertMatch(caller.id, target.id, 'ACTIVE');
  const conversation = await insertConversation(match.id);
  return { caller, target, genderId, match, conversation };
}

function httpSend(callerId: string, conversationId: string, content = 'Hello from HTTP') {
  return request(app)
    .post(`/api/v1/conversations/${conversationId}/messages`)
    .set(authHeader(callerId))
    .send({ messageType: 'TEXT', content });
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

async function seedTextUsage(userId: string, count: number): Promise<void> {
  const window = currentUtcDayWindow();
  await UsageRecord.create({
    userId,
    metricKey: DAILY_TEXT_MESSAGES_METRIC,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    usageCount: count,
    ...timestamps()
  });
}

function textPayload(conversationId: string, content: string, extra?: Record<string, unknown>) {
  return {
    conversationId,
    messageType: 'TEXT',
    content,
    ...extra
  };
}

describe('Socket.IO chat:message:send', () => {
  beforeAll(async () => {
    const reachable = await redisIsReachable();
    if (!reachable) {
      if (process.env.CI) {
        throw new Error('Socket.IO chat tests require Redis. CI did not provide a reachable Redis at REDIS_URL.');
      }
      console.warn('Redis is not reachable, so Socket.IO chat tests were not executed.');
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
  });

  it('persists one TEXT message, acks the sender, and emits chat:message:new only to the recipient', async () => {
    if (!runtime) {
      return;
    }

    const { caller, target, conversation } = await activeThread();
    const sender = await connectReady(caller.id);
    const recipient = await connectReady(target.id);
    let senderSawEvent = false;
    sender.on('chat:message:new', () => {
      senderSawEvent = true;
    });
    const incoming = waitForNewMessage(recipient);

    const ack = await sendEvent(sender, textPayload(conversation.id, 'Hello'));

    expect(ack.success).toBe(true);
    expect(ack.data).toEqual({
      id: ack.data?.id,
      conversationId: conversation.id,
      senderId: caller.id,
      messageType: 'TEXT',
      content: 'Hello',
      mediaUrl: null,
      readAt: null,
      createdAt: ack.data?.createdAt,
      remainingDailyMessages: 19
    });
    expect(ack.data).not.toHaveProperty('recipientId');
    expect(ack.data?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const event = await incoming;
    expect(event).toEqual({
      id: ack.data?.id,
      conversationId: conversation.id,
      senderId: caller.id,
      messageType: 'TEXT',
      content: 'Hello',
      createdAt: ack.data?.createdAt
    });
    expect(event).not.toHaveProperty('remainingDailyMessages');
    expect(event).not.toHaveProperty('mediaUrl');
    expect(event).not.toHaveProperty('recipientId');

    expect(await Message.count()).toBe(1);
    const stored = await Message.findByPk(ack.data?.id);
    expect(stored?.content).toBe('Hello');
    expect(stored?.senderId).toBe(caller.id);
    expect(stored?.conversationId).toBe(conversation.id);
    await conversation.reload();
    expect(conversation.lastMessageAt?.toISOString()).toBe(stored?.createdAt.toISOString());
    expect(conversation.lastMessageAt?.toISOString()).toBe(ack.data?.createdAt);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(senderSawEvent).toBe(false);
    expect(sender.connected).toBe(true);
    expect(recipient.connected).toBe(true);
  });

  it('rejects spoofed identity fields and does not emit or insert', async () => {
    if (!runtime) {
      return;
    }

    const { caller, target, conversation } = await activeThread();
    const sender = await connectReady(caller.id);
    const recipient = await connectReady(target.id);
    let delivered = false;
    recipient.on('chat:message:new', () => {
      delivered = true;
    });

    const ack = await sendEvent(
      sender,
      textPayload(conversation.id, 'Hello', { senderId: target.id, recipientId: caller.id, matchId: randomUUID() })
    );

    expect(ack.success).toBe(false);
    expect(ack.error?.code).toBe('VALIDATION_ERROR');
    expect(ack.error?.message).toBe('Validation failed');
    expect(ack.error?.details?.some((detail) => detail.code === 'unrecognized_keys')).toBe(true);
    expect(await Message.count()).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(delivered).toBe(false);
    expect(sender.connected).toBe(true);
  });

  it('hides unknown and foreign conversations and emits nothing', async () => {
    if (!runtime) {
      return;
    }

    const { caller, target, genderId, conversation } = await activeThread();
    const outsider = await buildUser({ genderId, point: north(3) });
    const sender = await connectReady(caller.id);
    const stranger = await connectReady(outsider.id);
    const recipient = await connectReady(target.id);
    let delivered = false;
    recipient.on('chat:message:new', () => {
      delivered = true;
    });

    const missing = await sendEvent(sender, textPayload(randomUUID(), 'Hello'));
    expect(missing.success).toBe(false);
    expect(missing.error).toEqual({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Resource not found',
      details: null
    });

    const foreign = await sendEvent(stranger, textPayload(conversation.id, 'Hello'));
    expect(foreign.success).toBe(false);
    expect(foreign.error).toEqual({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Resource not found',
      details: null
    });
    expect(await Message.count()).toBe(0);
    await conversation.reload();
    expect(conversation.lastMessageAt).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(delivered).toBe(false);
    expect(sender.connected).toBe(true);
    expect(stranger.connected).toBe(true);
  });

  it('returns CONVERSATION_CLOSED for a participant, inserts nothing, and stays connected', async () => {
    if (!runtime) {
      return;
    }

    const { caller, target, match, conversation } = await activeThread();
    const unmatch = await request(app).delete(`/api/v1/matches/${match.id}`).set(authHeader(caller.id));
    expect(unmatch.status).toBe(200);

    const sender = await connectReady(caller.id);
    const recipient = await connectReady(target.id);
    let delivered = false;
    recipient.on('chat:message:new', () => {
      delivered = true;
    });

    const ack = await sendEvent(sender, textPayload(conversation.id, 'Too late'));
    expect(ack.success).toBe(false);
    expect(ack.error).toEqual({
      code: 'CONVERSATION_CLOSED',
      message: 'Conversation is closed due to unmatch or safety block.',
      details: null
    });
    expect(await Message.count()).toBe(0);
    expect(await textMessageUsageCount(caller.id)).toBe(0);
    expect(sender.connected).toBe(true);

    const again = await sendEvent(sender, textPayload(conversation.id, 'Still closed'));
    expect(again.error?.code).toBe('CONVERSATION_CLOSED');
    expect(sender.connected).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(delivered).toBe(false);
  });

  it('returns BLOCKED_USER for a block in either direction and emits nothing', async () => {
    if (!runtime) {
      return;
    }

    const first = await activeThread();
    await Block.create({
      blockerId: first.caller.id,
      blockedId: first.target.id,
      reason: null,
      createdAt: new Date()
    });
    const firstSender = await connectReady(first.caller.id);
    const firstAck = await sendEvent(firstSender, textPayload(first.conversation.id, 'Blocked'));
    expect(firstAck.success).toBe(false);
    expect(firstAck.error).toEqual({
      code: 'BLOCKED_USER',
      message: 'Interaction prohibited due to an active safety block.',
      details: null
    });
    expect(firstSender.connected).toBe(true);

    const second = await activeThread();
    await Block.create({
      blockerId: second.target.id,
      blockedId: second.caller.id,
      reason: null,
      createdAt: new Date()
    });
    const secondSender = await connectReady(second.caller.id);
    const secondRecipient = await connectReady(second.target.id);
    let delivered = false;
    secondRecipient.on('chat:message:new', () => {
      delivered = true;
    });
    const secondAck = await sendEvent(secondSender, textPayload(second.conversation.id, 'Also blocked'));
    expect(secondAck.error?.code).toBe('BLOCKED_USER');
    expect(await Message.count()).toBe(0);
    expect(await textMessageUsageCount(first.caller.id)).toBe(0);
    expect(await textMessageUsageCount(second.caller.id)).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(delivered).toBe(false);
  });

  it('returns the existing verification and profile errors and inserts nothing', async () => {
    if (!runtime) {
      return;
    }

    const catalogGender = await gender();
    const unverified = await buildUser({ genderId: catalogGender.id, emailVerified: false, status: 'UNVERIFIED' });
    const partner = await buildUser({ genderId: catalogGender.id, point: north(2) });
    const unverifiedMatch = await insertMatch(unverified.id, partner.id, 'ACTIVE');
    const unverifiedConversation = await insertConversation(unverifiedMatch.id);
    const unverifiedSocket = await connectReady(unverified.id);
    const unverifiedAck = await sendEvent(unverifiedSocket, textPayload(unverifiedConversation.id, 'Hello'));
    expect(unverifiedAck.success).toBe(false);
    expect(unverifiedAck.error?.code).toBe('EMAIL_NOT_VERIFIED');
    expect(unverifiedAck.error?.message).toBe('Email verification is required.');
    expect(unverifiedSocket.connected).toBe(true);

    const incomplete = await buildUser({ genderId: catalogGender.id, complete: false });
    const incompleteMatch = await insertMatch(incomplete.id, partner.id, 'ACTIVE');
    const incompleteConversation = await insertConversation(incompleteMatch.id);
    const incompleteSocket = await connectReady(incomplete.id);
    const incompleteAck = await sendEvent(incompleteSocket, textPayload(incompleteConversation.id, 'Hello'));
    expect(incompleteAck.error?.code).toBe('PROFILE_INCOMPLETE');
    expect(incompleteAck.error?.message).toBe('Onboarding is incomplete.');

    const { caller, conversation } = await activeThread();
    const sender = await connectReady(caller.id);
    await caller.update({ emailVerified: false });
    const revoked = await sendEvent(sender, textPayload(conversation.id, 'Hello'));
    expect(revoked.error?.code).toBe('EMAIL_NOT_VERIFIED');
    expect(await Message.count()).toBe(0);
    expect(sender.connected).toBe(true);
  });

  it('rejects an invalid UUID, missing fields, a non-TEXT type, unknown fields, and an oversized payload', async () => {
    if (!runtime) {
      return;
    }

    const { caller, conversation } = await activeThread();
    const sender = await connectReady(caller.id);

    const invalidId = await sendEvent(sender, textPayload('not-a-uuid', 'Hello'));
    expect(invalidId.success).toBe(false);
    expect(invalidId.error?.code).toBe('VALIDATION_ERROR');
    expect(invalidId.error?.message).toBe('Validation failed');
    expect(invalidId.error?.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'conversationId',
          message: 'Conversation id must be a valid UUID.'
        })
      ])
    );

    const missing = await sendEvent(sender, { messageType: 'TEXT', content: 'Hello' });
    expect(missing.error?.code).toBe('VALIDATION_ERROR');
    expect(missing.error?.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'conversationId' })])
    );

    const image = await sendEvent(sender, {
      conversationId: conversation.id,
      messageType: 'IMAGE',
      content: 'Hello'
    });
    expect(image.error?.code).toBe('VALIDATION_ERROR');

    const unknown = await sendEvent(sender, textPayload(conversation.id, 'Hello', { extra: true }));
    expect(unknown.error?.code).toBe('VALIDATION_ERROR');
    expect(unknown.error?.details?.some((detail) => detail.code === 'unrecognized_keys')).toBe(true);

    const oversized = await sendEvent(sender, textPayload(conversation.id, 'a'.repeat(100 * 1024)));
    expect(oversized.error?.code).toBe('VALIDATION_ERROR');
    expect(oversized.error?.details).toEqual([
      { field: 'payload', message: 'Payload must not exceed 100 KB.' }
    ]);

    expect(await Message.count()).toBe(0);
    expect(sender.connected).toBe(true);
    const followUp = await sendEvent(sender, { messageType: 'TEXT' });
    expect(followUp.error?.code).toBe('VALIDATION_ERROR');
    expect(sender.connected).toBe(true);
  });

  it('preserves empty and whitespace-only content', async () => {
    if (!runtime) {
      return;
    }

    const { caller, target, conversation } = await activeThread();
    const sender = await connectReady(caller.id);
    const recipient = await connectReady(target.id);

    const emptyIncoming = waitForNewMessage(recipient);
    const emptyAck = await sendEvent(sender, textPayload(conversation.id, ''));
    const emptyEvent = await emptyIncoming;
    expect(emptyAck.data?.content).toBe('');
    expect(emptyEvent.content).toBe('');

    const spaces = '   ';
    const spacesIncoming = waitForNewMessage(recipient);
    const spacesAck = await sendEvent(sender, textPayload(conversation.id, spaces));
    const spacesEvent = await spacesIncoming;
    expect(spacesAck.data?.content).toBe(spaces);
    expect(spacesEvent.content).toBe(spaces);

    const stored = await Message.findAll({ order: [['createdAt', 'ASC']] });
    expect(stored.map((message) => message.content)).toEqual(['', spaces]);
  });

  it('shares the free daily quota with HTTP sends and stops at 20', async () => {
    if (!runtime) {
      return;
    }

    const { caller, target, conversation } = await activeThread();
    await seedTextUsage(caller.id, 18);
    const sender = await connectReady(caller.id);
    const recipient = await connectReady(target.id);
    let deliveries = 0;
    recipient.on('chat:message:new', () => {
      deliveries += 1;
    });

    const httpResponse = await httpSend(caller.id, conversation.id, 'HTTP nineteen');
    expect(httpResponse.status).toBe(201);
    expect(httpResponse.body.data.remainingDailyMessages).toBe(1);
    expect(httpResponse.body.data).not.toHaveProperty('recipientId');

    const socketAck = await sendEvent(sender, textPayload(conversation.id, 'Socket twenty'));
    expect(socketAck.success).toBe(true);
    expect(socketAck.data?.remainingDailyMessages).toBe(0);
    expect(socketAck.data?.content).toBe('Socket twenty');

    const exhausted = await sendEvent(sender, textPayload(conversation.id, 'Socket twenty-one'));
    expect(exhausted.success).toBe(false);
    expect(exhausted.error).toEqual({
      code: 'DAILY_LIMIT_REACHED',
      message: DAILY_TEXT_LIMIT_MESSAGE,
      details: null
    });
    expect(await Message.count()).toBe(2);
    expect(await textMessageUsageCount(caller.id)).toBe(20);
    expect(sender.connected).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(deliveries).toBe(1);
  });

  it('lets premium callers skip the usage row and return remainingDailyMessages null', async () => {
    if (!runtime) {
      return;
    }

    const { caller, target, conversation } = await activeThread();
    await grantPremium(caller.id);
    const sender = await connectReady(caller.id);
    const recipient = await connectReady(target.id);
    const incoming = waitForNewMessage(recipient);

    const ack = await sendEvent(sender, textPayload(conversation.id, 'Premium hello'));
    expect(ack.success).toBe(true);
    expect(ack.data?.remainingDailyMessages).toBeNull();
    expect((await incoming).content).toBe('Premium hello');
    expect(await textMessageUsageCount(caller.id)).toBe(0);
    expect(await UsageRecord.count({ where: { userId: caller.id, metricKey: DAILY_TEXT_MESSAGES_METRIC } })).toBe(0);
  });

  it('lets one of a concurrent HTTP send and socket send consume the last free message', async () => {
    if (!runtime) {
      return;
    }

    const { caller, conversation } = await activeThread();
    await seedTextUsage(caller.id, 19);
    const sender = await connectReady(caller.id);

    const [httpResponse, socketAck] = await Promise.all([
      httpSend(caller.id, conversation.id, 'HTTP race'),
      sendEvent(sender, textPayload(conversation.id, 'Socket race'))
    ]);

    const outcomes = [
      httpResponse.status === 201 ? 'sent' : httpResponse.body.error.code,
      socketAck.success ? 'sent' : socketAck.error?.code
    ];
    expect(outcomes.filter((outcome) => outcome === 'sent')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'DAILY_LIMIT_REACHED')).toHaveLength(1);
    expect(await Message.count()).toBe(1);
    expect(await textMessageUsageCount(caller.id)).toBe(20);
    expect(sender.connected).toBe(true);
  });

  it('does not insert a socket message after UNMATCH or UNDO wins the race', async () => {
    if (!runtime) {
      return;
    }

    const unmatchThread = await activeThread();
    const unmatchSender = await connectReady(unmatchThread.caller.id);
    const [unmatchAck, unmatchResponse] = await Promise.all([
      sendEvent(unmatchSender, textPayload(unmatchThread.conversation.id, 'Unmatch race')),
      request(app).delete(`/api/v1/matches/${unmatchThread.match.id}`).set(authHeader(unmatchThread.target.id))
    ]);
    expect(unmatchResponse.status).toBe(200);
    await unmatchThread.conversation.reload();
    expect(unmatchThread.conversation.status).toBe('CLOSED');
    if (unmatchAck.success) {
      expect(await Message.count()).toBe(1);
      expect(unmatchAck.data?.content).toBe('Unmatch race');
    } else {
      expect(unmatchAck.error?.code).toBe('CONVERSATION_CLOSED');
      expect(await Message.count()).toBe(0);
    }
    expect(unmatchSender.connected).toBe(true);

    const undoThread = await activeThread();
    await grantPremium(undoThread.caller.id);
    await Like.create({
      fromUserId: undoThread.caller.id,
      toUserId: undoThread.target.id,
      action: 'LIKE',
      isUndone: false,
      ...timestamps()
    });
    await Like.create({
      fromUserId: undoThread.target.id,
      toUserId: undoThread.caller.id,
      action: 'LIKE',
      isUndone: false,
      ...timestamps()
    });
    const undoSender = await connectReady(undoThread.caller.id);
    const beforeUndo = await Message.count();
    const [undoAck, undoResponse] = await Promise.all([
      sendEvent(undoSender, textPayload(undoThread.conversation.id, 'Undo race')),
      request(app).post('/api/v1/discovery/undo').set(authHeader(undoThread.caller.id))
    ]);
    expect(undoResponse.status).toBe(200);
    await undoThread.conversation.reload();
    expect(undoThread.conversation.status).toBe('CLOSED');
    if (undoAck.success) {
      expect(await Message.count()).toBe(beforeUndo + 1);
      expect(undoAck.data?.content).toBe('Undo race');
    } else {
      expect(undoAck.error?.code).toBe('CONVERSATION_CLOSED');
      expect(await Message.count()).toBe(beforeUndo);
    }
    expect(undoSender.connected).toBe(true);
  });

  it('delivers chat:message:new to every connected recipient device', async () => {
    if (!runtime) {
      return;
    }

    const { caller, target, conversation } = await activeThread();
    const sender = await connectReady(caller.id);
    const phone = await connectReady(target.id);
    const tablet = await connectReady(target.id);
    await waitForUserRoom(runtime.io, target.id, 2);
    const phoneEvent = waitForNewMessage(phone);
    const tabletEvent = waitForNewMessage(tablet);

    const ack = await sendEvent(sender, textPayload(conversation.id, 'Both devices'));
    expect(ack.success).toBe(true);
    const [phoneBody, tabletBody] = await Promise.all([phoneEvent, tabletEvent]);
    expect(phoneBody).toEqual(tabletBody);
    expect(phoneBody.content).toBe('Both devices');
    expect(phoneBody.senderId).toBe(caller.id);
    expect(await Message.count()).toBe(1);
  });

  it('delivers chat:message:new to a recipient connected on another server', async () => {
    if (!runtime || !httpServer) {
      return;
    }

    const peerHttp = http.createServer(app);
    const peer = await attachSocketServer(peerHttp);
    const peerPort = await listen(peerHttp);

    try {
      const { caller, target, conversation } = await activeThread();
      const sender = await connectReady(caller.id);
      const recipientResult = await connectSocket(peerPort, { token: accessToken(target.id) });
      expect(recipientResult.error).toBeUndefined();
      await waitForUserRoom(runtime.io, target.id);
      const incoming = waitForNewMessage(recipientResult.client);

      const ack = await sendEvent(sender, textPayload(conversation.id, 'Cross node'));
      expect(ack.success).toBe(true);
      await expect(incoming).resolves.toEqual({
        id: ack.data?.id,
        conversationId: conversation.id,
        senderId: caller.id,
        messageType: 'TEXT',
        content: 'Cross node',
        createdAt: ack.data?.createdAt
      });
      expect(await Message.count()).toBe(1);
    } finally {
      await closeSocketServer(peer);
    }
  });

  it('rechecks account state after the handshake and keeps the socket connected', async () => {
    if (!runtime) {
      return;
    }

    const suspendedThread = await activeThread();
    const suspendedSocket = await connectReady(suspendedThread.caller.id);
    await suspendedThread.caller.update({ status: 'SUSPENDED' });
    const suspendedAck = await sendEvent(suspendedSocket, textPayload(suspendedThread.conversation.id, 'Hello'));
    expect(suspendedAck.error).toEqual({
      code: 'ACCOUNT_SUSPENDED',
      message: 'Account is suspended.',
      details: null
    });
    expect(suspendedSocket.connected).toBe(true);

    const bannedThread = await activeThread();
    const bannedSocket = await connectReady(bannedThread.caller.id);
    await bannedThread.caller.update({ status: 'BANNED' });
    const bannedAck = await sendEvent(bannedSocket, textPayload(bannedThread.conversation.id, 'Hello'));
    expect(bannedAck.error?.code).toBe('ACCOUNT_BANNED');
    expect(bannedAck.error?.message).toBe('Account is banned.');
    expect(bannedSocket.connected).toBe(true);

    const deletedThread = await activeThread();
    const deletedSocket = await connectReady(deletedThread.caller.id);
    await deletedThread.caller.destroy();
    const deletedAck = await sendEvent(deletedSocket, textPayload(deletedThread.conversation.id, 'Hello'));
    expect(deletedAck.error).toEqual({
      code: 'INVALID_TOKEN',
      message: 'Invalid token.',
      details: null
    });
    expect(deletedSocket.connected).toBe(true);

    const adminThread = await activeThread();
    const adminSocket = await connectReady(adminThread.caller.id);
    await adminThread.caller.update({ role: 'ADMIN' });
    const adminAck = await sendEvent(adminSocket, textPayload(adminThread.conversation.id, 'Hello'));
    expect(adminAck.error).toEqual({
      code: 'FORBIDDEN',
      message: 'You do not have permission to perform this action.',
      details: null
    });
    expect(adminSocket.connected).toBe(true);
    expect(await Message.count()).toBe(0);
  });

  it('returns a generic acknowledgement when persistence throws unexpectedly', async () => {
    if (!runtime) {
      return;
    }

    const { caller, conversation } = await activeThread();
    const sender = await connectReady(caller.id);
    jest.spyOn(chatService, 'sendTextMessage').mockRejectedValueOnce(new Error('select password_hash from users'));

    const ack = await sendEvent(sender, textPayload(conversation.id, 'Boom'));
    expect(ack).toEqual({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred. Please try again later.',
        details: null
      }
    });
    expect(JSON.stringify(ack)).not.toContain('password_hash');
    expect(await Message.count()).toBe(0);
    expect(sender.connected).toBe(true);
  });

  it('persists a send that does not include an acknowledgement callback', async () => {
    if (!runtime) {
      return;
    }

    const { caller, target, conversation } = await activeThread();
    const sender = await connectReady(caller.id);
    const recipient = await connectReady(target.id);
    const incoming = waitForNewMessage(recipient);
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onRejection);

    try {
      sender.emit('chat:message:send', textPayload(conversation.id, 'No callback'));
      const event = await incoming;
      expect(event.content).toBe('No callback');
      expect(event.senderId).toBe(caller.id);
      expect(await Message.count()).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(rejections).toEqual([]);
      expect(sender.connected).toBe(true);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  it('does not emit a realtime event when message history is read', async () => {
    if (!runtime) {
      return;
    }

    const { caller, target, conversation } = await activeThread();
    const now = new Date();
    await Message.create({
      conversationId: conversation.id,
      senderId: caller.id,
      messageType: 'TEXT',
      content: 'Already stored',
      mediaStorageKey: null,
      mediaMimeType: null,
      mediaFileSize: null,
      readAt: null,
      createdAt: now,
      updatedAt: now
    });
    const callerSocket = await connectReady(caller.id);
    const targetSocket = await connectReady(target.id);
    const events: string[] = [];
    callerSocket.onAny((event) => events.push(`caller:${event}`));
    targetSocket.onAny((event) => events.push(`target:${event}`));

    const response = await request(app)
      .get(`/api/v1/conversations/${conversation.id}/messages`)
      .set(authHeader(caller.id));
    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(events).toEqual([]);
    expect(callerSocket.connected).toBe(true);
    expect(targetSocket.connected).toBe(true);
    expect(await Message.count()).toBe(1);
  });
});

describe('Socket.IO chat:message:read', () => {
  beforeAll(async () => {
    const reachable = await redisIsReachable();
    if (!reachable) {
      if (process.env.CI) {
        throw new Error('Socket.IO chat tests require Redis. CI did not provide a reachable Redis at REDIS_URL.');
      }
      console.warn('Redis is not reachable, so Socket.IO chat tests were not executed.');
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
  });

  it('emits chat:message:read only to the other participant after the read is committed', async () => {
    if (!runtime) {
      return;
    }

    const { caller, target, conversation } = await activeThread();
    const now = new Date();
    const message = await Message.create({
      conversationId: conversation.id,
      senderId: target.id,
      messageType: 'TEXT',
      content: 'Unread',
      mediaStorageKey: null,
      mediaMimeType: null,
      mediaFileSize: null,
      readAt: null,
      createdAt: now,
      updatedAt: now
    });
    const reader = await connectReady(caller.id);
    const recipient = await connectReady(target.id);
    let readerSawEvent = false;
    reader.on('chat:message:read', () => {
      readerSawEvent = true;
    });
    let readAtDuringEvent: string | null = null;
    const incoming = new Promise<ReadReceiptEvent>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('chat:message:read timed out.')), 5000);
      recipient.once('chat:message:read', (body: ReadReceiptEvent) => {
        clearTimeout(timer);
        void Message.findByPk(message.id).then((stored) => {
          readAtDuringEvent = stored?.readAt?.toISOString() ?? null;
          resolve(body);
        });
      });
    });

    const response = await markConversationRead(caller.id, conversation.id);
    const event = await incoming;
    expect(response.status).toBe(200);
    expect(event).toEqual({
      conversationId: conversation.id,
      readerId: caller.id,
      readAt: response.body.data.readAt
    });
    expect(readAtDuringEvent).toBe(event.readAt);
    expect(readerSawEvent).toBe(false);
    const stored = await Message.findByPk(message.id);
    expect(stored?.readAt?.toISOString()).toBe(event.readAt);
  });

  it('does not emit when nothing is newly marked, or when the request is rejected', async () => {
    if (!runtime) {
      return;
    }

    const empty = await activeThread();
    const emptyReader = await connectReady(empty.caller.id);
    const emptyRecipient = await connectReady(empty.target.id);
    const emptyEvents: string[] = [];
    emptyReader.onAny((event) => emptyEvents.push(`reader:${event}`));
    emptyRecipient.onAny((event) => emptyEvents.push(`recipient:${event}`));
    const emptyResponse = await markConversationRead(empty.caller.id, empty.conversation.id);
    expect(emptyResponse.status).toBe(200);
    expect(emptyResponse.body.data.readAt).toBeNull();
    await new Promise((resolve) => setImmediate(resolve));
    expect(emptyEvents).toEqual([]);

    const blocked = await activeThread();
    const now = new Date();
    await Message.create({
      conversationId: blocked.conversation.id,
      senderId: blocked.target.id,
      messageType: 'TEXT',
      content: 'Blocked',
      mediaStorageKey: null,
      mediaMimeType: null,
      mediaFileSize: null,
      readAt: null,
      createdAt: now,
      updatedAt: now
    });
    await Block.create({
      blockerId: blocked.caller.id,
      blockedId: blocked.target.id,
      reason: null,
      createdAt: new Date()
    });
    const blockedReader = await connectReady(blocked.caller.id);
    const blockedRecipient = await connectReady(blocked.target.id);
    const blockedEvents: string[] = [];
    blockedReader.onAny((event) => blockedEvents.push(event));
    blockedRecipient.onAny((event) => blockedEvents.push(event));
    const blockedResponse = await markConversationRead(blocked.caller.id, blocked.conversation.id);
    expect(blockedResponse.status).toBe(409);
    expect(blockedResponse.body.error.code).toBe('BLOCKED_USER');

    const invalid = await request(app)
      .patch(`/api/v1/conversations/${blocked.conversation.id}/read`)
      .set({ Authorization: 'Bearer not-a-token' });
    expect(invalid.status).toBe(401);

    const malformed = await markConversationRead(blocked.caller.id, 'not-a-uuid');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
    await new Promise((resolve) => setImmediate(resolve));
    expect(blockedEvents.filter((event) => event === 'chat:message:read')).toEqual([]);
    const stored = await Message.findOne({ where: { conversationId: blocked.conversation.id } });
    expect(stored?.readAt).toBeNull();
  });

  it('keeps the committed read when socket delivery throws', async () => {
    if (!runtime) {
      return;
    }

    const { caller, target, conversation } = await activeThread();
    const now = new Date();
    const message = await Message.create({
      conversationId: conversation.id,
      senderId: target.id,
      messageType: 'TEXT',
      content: 'Still read',
      mediaStorageKey: null,
      mediaMimeType: null,
      mediaFileSize: null,
      readAt: null,
      createdAt: now,
      updatedAt: now
    });
    jest.spyOn(runtime.io, 'to').mockImplementation(() => {
      throw new Error('socket delivery failed');
    });

    const response = await markConversationRead(caller.id, conversation.id);
    expect(response.status).toBe(200);
    expect(typeof response.body.data.readAt).toBe('string');
    const stored = await Message.findByPk(message.id);
    expect(stored?.readAt?.toISOString()).toBe(response.body.data.readAt);
  });
});
