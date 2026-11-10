import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.middleware';
import { ValidationError, type ErrorDetail } from '../../utils/errors';

export const targetUserIdSchema = z.string().uuid('User id must be a valid UUID.');

export const matchIdSchema = z.string().uuid('Match id must be a valid UUID.');

const emptyBodySchema = z.object({}).strict();

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
