import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export const httpLoggerMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const start = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    logger.http('HTTP Request', {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs,
      requestId: req.id,
      userAgent: req.get('user-agent'),
      ip: req.ip
    });
  });

  next();
};
