import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.middleware';
import { ValidationError, type ErrorDetail } from '../../utils/errors';
import type { MatchListCursor } from './likes.types';

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

const MATCH_LIST_LIMIT_MESSAGE = 'Limit must be an integer from 1 to 50.';
const MATCH_LIST_CURSOR_MALFORMED_MESSAGE =
  'Cursor must be a base64-encoded JSON object with matchedAt and matchId.';
const MATCH_LIST_CURSOR_TIME_MESSAGE = 'Cursor matchedAt must be a valid date-time.';
const MATCH_LIST_CURSOR_ID_MESSAGE = 'Cursor matchId must be a valid UUID.';
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/;
const cursorDateTimeSchema = z.string().datetime({ offset: true });

export interface ListMatchesQuery {
  limit: number;
  cursor: MatchListCursor | null;
}

function isCanonicalBase64(value: string): boolean {
  if (!CANONICAL_BASE64.test(value)) {
    return false;
  }
  return Buffer.from(value, 'base64').toString('base64') === value;
}

function parseMatchListLimit(value: unknown): { limit?: number; detail?: ErrorDetail } {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    return { detail: { field: 'limit', message: MATCH_LIST_LIMIT_MESSAGE } };
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    return { detail: { field: 'limit', message: MATCH_LIST_LIMIT_MESSAGE } };
  }
  return { limit };
}

export function encodeMatchListCursor(matchedAt: Date, matchId: string): string {
  return Buffer.from(
    JSON.stringify({
      matchedAt: matchedAt.toISOString(),
      matchId: matchId.toLowerCase()
    }),
    'utf8'
  ).toString('base64');
}

function parseMatchListCursor(value: unknown): { cursor?: MatchListCursor; details: ErrorDetail[] } {
  if (typeof value !== 'string' || !isCanonicalBase64(value)) {
    return { details: [{ field: 'cursor', message: MATCH_LIST_CURSOR_MALFORMED_MESSAGE }] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
  } catch {
    return { details: [{ field: 'cursor', message: MATCH_LIST_CURSOR_MALFORMED_MESSAGE }] };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { details: [{ field: 'cursor', message: MATCH_LIST_CURSOR_MALFORMED_MESSAGE }] };
  }

  const record = parsed as Record<string, unknown>;
  const details: ErrorDetail[] = [];
  for (const key of Object.keys(record)) {
    if (key !== 'matchedAt' && key !== 'matchId') {
      details.push({ field: `cursor.${key}`, message: 'Unsupported cursor field.' });
    }
  }

  let matchedAt: string | undefined;
  if (!Object.prototype.hasOwnProperty.call(record, 'matchedAt')) {
    details.push({ field: 'cursor.matchedAt', message: 'Cursor matchedAt is required.' });
  } else if (typeof record.matchedAt !== 'string' || !cursorDateTimeSchema.safeParse(record.matchedAt).success) {
    details.push({ field: 'cursor.matchedAt', message: MATCH_LIST_CURSOR_TIME_MESSAGE });
  } else {
    const instant = new Date(record.matchedAt);
    if (Number.isNaN(instant.getTime())) {
      details.push({ field: 'cursor.matchedAt', message: MATCH_LIST_CURSOR_TIME_MESSAGE });
    } else {
      matchedAt = record.matchedAt;
    }
  }

  let matchId: string | undefined;
  if (!Object.prototype.hasOwnProperty.call(record, 'matchId')) {
    details.push({ field: 'cursor.matchId', message: 'Cursor matchId is required.' });
  } else if (typeof record.matchId !== 'string' || !matchIdSchema.safeParse(record.matchId).success) {
    details.push({ field: 'cursor.matchId', message: MATCH_LIST_CURSOR_ID_MESSAGE });
  } else {
    matchId = record.matchId.toLowerCase();
  }

  if (details.length > 0 || !matchedAt || !matchId) {
    return { details };
  }

  return { cursor: { matchedAt, matchId }, details: [] };
}

export function parseListMatchesQuery(input: unknown): ListMatchesQuery {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('Validation failed', [{ field: 'query', message: 'Query parameters are invalid.' }]);
  }

  const query = input as Record<string, unknown>;
  const details: ErrorDetail[] = [];
  for (const key of Object.keys(query)) {
    if (key !== 'limit' && key !== 'cursor') {
      details.push({ field: key, message: 'Unsupported query parameter.' });
    }
  }

  let limit = 20;
  if (Object.prototype.hasOwnProperty.call(query, 'limit')) {
    const parsedLimit = parseMatchListLimit(query.limit);
    if (parsedLimit.detail) {
      details.push(parsedLimit.detail);
    } else if (parsedLimit.limit !== undefined) {
      limit = parsedLimit.limit;
    }
  }

  let cursor: MatchListCursor | null = null;
  if (Object.prototype.hasOwnProperty.call(query, 'cursor')) {
    const parsedCursor = parseMatchListCursor(query.cursor);
    details.push(...parsedCursor.details);
    if (parsedCursor.cursor) {
      cursor = parsedCursor.cursor;
    }
  }

  if (details.length > 0) {
    throw new ValidationError('Validation failed', details);
  }

  return { limit, cursor };
}

export function validateListMatchesQuery(req: Request, res: Response, next: NextFunction): void {
  try {
    res.locals.listMatchesQuery = parseListMatchesQuery(req.query);
    next();
  } catch (error) {
    next(error);
  }
}
