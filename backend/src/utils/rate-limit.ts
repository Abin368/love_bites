import { randomBytes } from 'crypto';
import { redis } from '../config/redis';
import { logger } from './logger';

const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - windowMs)
local count = redis.call('ZCARD', key)
if count >= limit then
  redis.call('PEXPIRE', key, windowMs)
  return 0
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, windowMs)
return 1
`;

export interface SlidingWindowEntry {
  member: string;
  score: number;
}

export function evaluateSlidingWindow(
  entries: SlidingWindowEntry[],
  now: number,
  windowMs: number,
  limit: number,
  member: string
): { allowed: boolean; entries: SlidingWindowEntry[] } {
  const minimumScore = now - windowMs;
  const active = entries.filter((entry) => entry.score > minimumScore);
  if (active.length >= limit) {
    return { allowed: false, entries: active };
  }
  active.push({ member, score: now });
  return { allowed: true, entries: active };
}

export async function consumeRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  const member = `${now}:${randomBytes(4).toString('hex')}`;
  const result = await redis.eval(SLIDING_WINDOW_SCRIPT, 1, key, now, windowMs, limit, member);
  const allowed = Number(result) === 1;

  if (!allowed) {
    logger.warn('Authentication rate limit exceeded', { bucket: key.split(':').slice(0, 3).join(':') });
  }

  return allowed;
}
