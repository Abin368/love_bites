import Redis from 'ioredis';
import { env } from './env';
import { logger } from '../utils/logger';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: true,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 2000);
    logger.warn(`Redis reconnecting, attempt ${times} (delay: ${delay}ms)`);
    return delay;
  }
});

redis.on('connect', () => {
  logger.info('Redis client connected');
});

redis.on('error', (err) => {
  logger.error('Redis client error', { error: err.message });
});

export async function checkRedisHealth(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch (err: any) {
    logger.error('Redis health check failed', { error: err.message });
    return false;
  }
}
