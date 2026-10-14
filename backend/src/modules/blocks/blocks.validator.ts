import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.middleware';
import { ValidationError, type ErrorDetail } from '../../utils/errors';

const targetUserIdSchema = z.string().uuid('User id must be a valid UUID.');
const emptyBodySchema = z.object({}).strict();

export function validateTargetUserIdParam(req: Request, _res: Response, next: NextFunction): void {
  try {
    const raw = req.params.userId;
    const userId = Array.isArray(raw) ? raw[0] : raw;
    const parsed = targetUserIdSchema.safeParse(userId);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', [
        { field: 'userId', message: 'User id must be a valid UUID.' }
      ]);
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function validateNoQuery(req: Request, _res: Response, next: NextFunction): void {
  try {
    if (!req.query || typeof req.query !== 'object' || Array.isArray(req.query)) {
      throw new ValidationError('Validation failed', [{ field: 'query', message: 'Query parameters are invalid.' }]);
    }

    const details: ErrorDetail[] = [];
    for (const key of Object.keys(req.query)) {
      details.push({ field: key, message: 'Unsupported query parameter.' });
    }
    if (details.length > 0) {
      throw new ValidationError('Validation failed', details);
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function validateEmptyBody(req: Request, res: Response, next: NextFunction): void {
  if (req.body === undefined || req.body === null) {
    req.body = {};
  }
  validate(emptyBodySchema)(req, res, next);
}

export function parseTargetUserId(userId: string): string {
  const parsed = targetUserIdSchema.safeParse(userId);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', [
      { field: 'userId', message: 'User id must be a valid UUID.' }
    ]);
  }
  return parsed.data.toLowerCase();
}
