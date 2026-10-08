import type { Server as HttpServer } from 'http';
import type { Redis } from 'ioredis';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { env } from '../config/env';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';
import { authenticateSocket } from './socket.auth';

export interface SocketRuntime {
  io: Server;
  pubClient: Redis;
  subClient: Redis;
}

function allowedOrigins(): string[] {
  return env.CORS_ORIGIN.split(',').map((origin) => origin.trim());
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

function observeRedisClient(client: Redis, role: 'pub' | 'sub'): void {
  client.on('error', (error: Error) => {
    logger.error(`Socket.IO Redis ${role} client error`, { error: error.message });
  });
}

async function quitRedisClient(client: Redis): Promise<void> {
  client.removeAllListeners('error');
  client.on('error', () => undefined);
  if (client.status === 'wait' || client.status === 'end') {
    client.disconnect();
    return;
  }
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}

export async function attachSocketServer(httpServer: HttpServer): Promise<SocketRuntime> {
  const pubClient = redis.duplicate();
  const subClient = redis.duplicate();
  observeRedisClient(pubClient, 'pub');
  observeRedisClient(subClient, 'sub');

  try {
    await Promise.all([pubClient.connect(), subClient.connect()]);
  } catch (error) {
    pubClient.disconnect();
    subClient.disconnect();
    throw error;
  }

  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins(),
      credentials: true
    }
  });

  io.adapter(createAdapter(pubClient, subClient));
  io.use(authenticateSocket);
  io.on('connection', (socket) => {
    const room = userRoom(socket.data.user.id);
    void Promise.resolve(socket.join(room)).catch((error: unknown) => {
      logger.error('Failed to join user room', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: socket.data.user.id
      });
      socket.disconnect(true);
    });
  });

  return { io, pubClient, subClient };
}

export async function closeSocketServer(runtime: SocketRuntime): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      void runtime.io.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  } finally {
    await quitRedisClient(runtime.pubClient);
    await quitRedisClient(runtime.subClient);
  }
}
