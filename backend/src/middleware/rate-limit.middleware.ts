import { RequestHandler } from 'express';
import { RateLimitError } from '../utils/errors';
import { asyncHandler } from '../utils/async-handler';
import { consumeRateLimit } from '../utils/rate-limit';

const WINDOW_MS = 60_000;

function clientIp(req: Parameters<RequestHandler>[0]): string {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return ip.slice(0, 64);
}

export function rateLimitByIp(bucket: string, limit: number): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const allowed = await consumeRateLimit(`${bucket}:${clientIp(req)}`, limit, WINDOW_MS);
    if (!allowed) {
      throw new RateLimitError('Too many requests. Please try again later.', [], 'RATE_LIMITED');
    }
    next();
  });
}
