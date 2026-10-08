import { randomUUID } from 'crypto';
import http from 'http';
import jwt from 'jsonwebtoken';
import Redis from 'ioredis';
import request from 'supertest';
import { Server } from 'socket.io';
import { io as createClient, Socket as ClientSocket } from 'socket.io-client';
import { RedisAdapter } from '@socket.io/redis-adapter';
import { env } from '../../src/config/env';
import { Conversation } from '../../src/database/models/conversation.model';
import { Message } from '../../src/database/models/message.model';
import { User, UserStatus } from '../../src/database/models/user.model';
import { app } from '../../src/app';
import { attachSocketServer, closeSocketServer, SocketRuntime } from '../../src/socket/socket.server';
import { signAccessToken } from '../../src/utils/jwt';

const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';

interface HandshakeError extends Error {
  data?: { code?: string };
}

let httpServer: http.Server | undefined;
let runtime: SocketRuntime | null = null;
let port = 0;
const openClients: ClientSocket[] = [];

function accessToken(userId: string, role: 'USER' | 'ADMIN' = 'USER'): string {
  return signAccessToken({
    sub: userId,
    role,
    isVerified: true,
    isProfileComplete: true
  });
}

async function createAccount(input: {
  role?: 'USER' | 'ADMIN';
  status?: UserStatus;
  emailVerified?: boolean;
} = {}): Promise<User> {
  return User.create({
    email: `socket-${randomUUID()}@example.com`,
    phone: null,
    passwordHash: PASSWORD_HASH,
    role: input.role ?? 'USER',
    status: input.status ?? 'UNVERIFIED',
    emailVerified: input.emailVerified ?? false,
    phoneVerified: false
  });
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
  auth?: Record<string, unknown>,
  origin?: string,
  transports: Array<'websocket' | 'polling'> = ['websocket']
): Promise<{ client: ClientSocket; error?: HandshakeError }> {
  return new Promise((resolve) => {
    const client = createClient(`http://127.0.0.1:${port}`, {
      auth,
      reconnection: false,
      timeout: 5000,
      forceNew: true,
      transports,
      extraHeaders: origin ? { Origin: origin } : undefined
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

async function waitForUserRoom(io: Server, userId: string) {
  const room = `user:${userId}`;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const members = await io.in(room).fetchSockets();
    if (members.length > 0) {
      return members;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${room}`);
}

function expectRejected(error: HandshakeError | undefined, code: string, message: string): void {
  expect(error).toBeDefined();
  expect(error?.data?.code).toBe(code);
  expect(error?.message).toBe(message);
}

describe('Socket.IO foundation', () => {
  beforeAll(async () => {
    const reachable = await redisIsReachable();
    if (!reachable) {
      if (process.env.CI) {
        throw new Error('Socket.IO foundation tests require Redis. CI did not provide a reachable Redis at REDIS_URL.');
      }
      console.warn('Redis is not reachable, so Socket.IO foundation tests were not executed.');
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
  });

  it('rejects a missing token', async () => {
    if (!runtime) {
      return;
    }

    const missing = await connectSocket();
    expectRejected(missing.error, 'AUTH_REQUIRED', 'Authentication required.');

    const empty = await connectSocket({ token: '' });
    expectRejected(empty.error, 'AUTH_REQUIRED', 'Authentication required.');

    const numeric = await connectSocket({ token: 12345 });
    expectRejected(numeric.error, 'AUTH_REQUIRED', 'Authentication required.');
  });

  it('rejects an invalid token', async () => {
    if (!runtime) {
      return;
    }

    const result = await connectSocket({ token: 'not-a-jwt' });
    expectRejected(result.error, 'INVALID_TOKEN', 'Invalid token.');
  });

  it('rejects an expired token', async () => {
    if (!runtime) {
      return;
    }

    const token = jwt.sign(
      {
        sub: randomUUID(),
        role: 'USER',
        isVerified: true,
        isProfileComplete: false,
        exp: Math.floor(Date.now() / 1000) - 10
      },
      env.JWT_ACCESS_SECRET,
      { algorithm: 'HS256' }
    );
    const result = await connectSocket({ token });
    expectRejected(result.error, 'INVALID_TOKEN', 'Invalid token.');
  });

  it('rejects an unknown user without revealing whether the id exists', async () => {
    if (!runtime) {
      return;
    }

    const result = await connectSocket({ token: accessToken(randomUUID()) });
    expectRejected(result.error, 'INVALID_TOKEN', 'Invalid token.');
  });

  it('rejects a deleted user with the same invalid-token error', async () => {
    if (!runtime) {
      return;
    }

    const user = await createAccount({ status: 'ACTIVE', emailVerified: true });
    const token = accessToken(user.id);
    await user.destroy();

    const result = await connectSocket({ token });
    expectRejected(result.error, 'INVALID_TOKEN', 'Invalid token.');
  });

  it('rejects a suspended user even when the access token is still cryptographically valid', async () => {
    if (!runtime) {
      return;
    }

    const user = await createAccount({ status: 'ACTIVE', emailVerified: true });
    const token = accessToken(user.id);
    await user.update({ status: 'SUSPENDED' });

    const result = await connectSocket({ token });
    expectRejected(result.error, 'ACCOUNT_SUSPENDED', 'Account is suspended.');
  });

  it('rejects a banned user even when the access token is still cryptographically valid', async () => {
    if (!runtime) {
      return;
    }

    const user = await createAccount({ status: 'ACTIVE', emailVerified: true });
    const token = accessToken(user.id);
    await user.update({ status: 'BANNED' });

    const result = await connectSocket({ token });
    expectRejected(result.error, 'ACCOUNT_BANNED', 'Account is banned.');
  });

  it('rejects an admin account', async () => {
    if (!runtime) {
      return;
    }

    const admin = await createAccount({ role: 'ADMIN', status: 'ACTIVE', emailVerified: true });
    const result = await connectSocket({ token: accessToken(admin.id, 'ADMIN') });
    expectRejected(result.error, 'FORBIDDEN', 'You do not have permission to perform this action.');
  });

  it('connects a user and stores the current database account on socket.data.user', async () => {
    if (!runtime) {
      return;
    }

    const user = await createAccount({ status: 'UNVERIFIED', emailVerified: false });
    const other = await createAccount({ status: 'ACTIVE', emailVerified: true });
    const allowedOrigin = env.CORS_ORIGIN.split(',')[0]?.trim();
    const result = await connectSocket(
      {
        token: accessToken(user.id),
        room: `user:${other.id}`,
        userId: other.id,
        conversationId: randomUUID()
      },
      allowedOrigin
    );

    expect(result.error).toBeUndefined();
    const members = await waitForUserRoom(runtime.io, user.id);
    expect(members).toHaveLength(1);
    expect(members[0].data.user).toEqual({
      id: user.id,
      role: 'USER',
      status: 'UNVERIFIED',
      isVerified: false,
      isProfileComplete: false
    });
    expect(members[0].data.user).not.toHaveProperty('passwordHash');

    const rooms = [...members[0].rooms];
    expect(rooms).toContain(`user:${user.id}`);
    expect(rooms.filter((room) => room.startsWith('user:'))).toEqual([`user:${user.id}`]);
    expect(rooms.some((room) => room.startsWith('conversation:'))).toBe(false);
    expect(await Message.count()).toBe(0);
    expect(await Conversation.count()).toBe(0);
  });

  it('uses the Redis adapter to deliver a server event to the user room on another node', async () => {
    if (!runtime || !httpServer) {
      return;
    }

    expect(runtime.io.of('/').adapter).toBeInstanceOf(RedisAdapter);

    const peerHttp = http.createServer(app);
    const peer = await attachSocketServer(peerHttp);
    const peerPort = await listen(peerHttp);
    expect(peerPort).toBeGreaterThan(0);

    try {
      const user = await createAccount({ status: 'ACTIVE', emailVerified: true });
      const result = await connectSocket({ token: accessToken(user.id) });
      expect(result.error).toBeUndefined();
      await waitForUserRoom(peer.io, user.id);

      const received = new Promise<{ ok: boolean }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Cross-node Socket.IO delivery timed out.')), 5000);
        result.client.on('socket-foundation:probe', (body: { ok: boolean }) => {
          clearTimeout(timer);
          resolve(body);
        });
      });
      peer.io.to(`user:${user.id}`).emit('socket-foundation:probe', { ok: true });
      await expect(received).resolves.toEqual({ ok: true });
      expect(await Message.count()).toBe(0);
    } finally {
      await closeSocketServer(peer);
    }
  });

  it('keeps HTTP authentication and the health endpoint working', async () => {
    if (!runtime) {
      return;
    }

    const anonymous = await request(app).get('/api/v1/discovery');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('AUTH_REQUIRED');

    const user = await createAccount({ status: 'ACTIVE', emailVerified: false });
    const authed = await request(app).get('/api/v1/discovery').set('Authorization', `Bearer ${accessToken(user.id)}`);
    expect(authed.status).toBe(403);
    expect(authed.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.body.success).toBe(true);
    expect(health.body.data.services.redis).toBe('CONNECTED');
    expect(health.body.data.services.database).toBe('CONNECTED');
  });
});
