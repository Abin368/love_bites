import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { ValidationError, type ErrorDetail } from '../../utils/errors';

export const conversationIdSchema = z.string().uuid('Conversation id must be a valid UUID.');

export function validateConversationIdParam(req: Request, _res: Response, next: NextFunction): void {
  try {
    const parsed = conversationIdSchema.safeParse(req.params.conversationId);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', [
        { field: 'conversationId', message: 'Conversation id must be a valid UUID.' }
      ]);
    }
    next();
  } catch (error) {
    next(error);
  }
}

const HISTORY_LIMIT_MESSAGE = 'Limit must be an integer from 1 to 50.';
const CURSOR_MALFORMED_MESSAGE = 'Cursor must be a base64-encoded JSON object with createdAt and id.';
const CURSOR_TIME_MESSAGE = 'Cursor createdAt must be a valid date-time.';
const CURSOR_ID_MESSAGE = 'Cursor id must be a valid UUID.';
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/;
const cursorIdSchema = z.string().uuid();
const cursorDateTimeSchema = z.string().datetime({ offset: true });

export interface HistoryCursor {
  createdAt: string;
  id: string;
}

export interface ListMessagesQuery {
  limit: number;
  cursor: HistoryCursor | null;
}

export function encodeHistoryCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id: id.toLowerCase() }), 'utf8').toString(
    'base64'
  );
}

function isCanonicalBase64(value: string): boolean {
  if (!CANONICAL_BASE64.test(value)) {
    return false;
  }
  return Buffer.from(value, 'base64').toString('base64') === value;
}

function parseLimit(value: unknown): { limit?: number; detail?: ErrorDetail } {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    return { detail: { field: 'limit', message: HISTORY_LIMIT_MESSAGE } };
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    return { detail: { field: 'limit', message: HISTORY_LIMIT_MESSAGE } };
  }
  return { limit };
}

function parseCursor(value: unknown): { cursor?: HistoryCursor; details: ErrorDetail[] } {
  if (typeof value !== 'string' || !isCanonicalBase64(value)) {
    return { details: [{ field: 'cursor', message: CURSOR_MALFORMED_MESSAGE }] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
  } catch {
    return { details: [{ field: 'cursor', message: CURSOR_MALFORMED_MESSAGE }] };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { details: [{ field: 'cursor', message: CURSOR_MALFORMED_MESSAGE }] };
  }

  const record = parsed as Record<string, unknown>;
  const details: ErrorDetail[] = [];
  for (const key of Object.keys(record)) {
    if (key !== 'createdAt' && key !== 'id') {
      details.push({ field: `cursor.${key}`, message: 'Unsupported cursor field.' });
    }
  }

  let createdAt: string | undefined;
  if (!Object.prototype.hasOwnProperty.call(record, 'createdAt')) {
    details.push({ field: 'cursor.createdAt', message: 'Cursor createdAt is required.' });
  } else if (typeof record.createdAt !== 'string' || !cursorDateTimeSchema.safeParse(record.createdAt).success) {
    details.push({ field: 'cursor.createdAt', message: CURSOR_TIME_MESSAGE });
  } else {
    const instant = new Date(record.createdAt);
    if (Number.isNaN(instant.getTime())) {
      details.push({ field: 'cursor.createdAt', message: CURSOR_TIME_MESSAGE });
    } else {
      createdAt = record.createdAt;
    }
  }

  let id: string | undefined;
  if (!Object.prototype.hasOwnProperty.call(record, 'id')) {
    details.push({ field: 'cursor.id', message: 'Cursor id is required.' });
  } else if (typeof record.id !== 'string' || !cursorIdSchema.safeParse(record.id).success) {
    details.push({ field: 'cursor.id', message: CURSOR_ID_MESSAGE });
  } else {
    id = record.id.toLowerCase();
  }

  if (details.length > 0 || !createdAt || !id) {
    return { details };
  }

  return { cursor: { createdAt, id }, details: [] };
}

export function parseListMessagesQuery(input: unknown): ListMessagesQuery {
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
    const parsedLimit = parseLimit(query.limit);
    if (parsedLimit.detail) {
      details.push(parsedLimit.detail);
    } else if (parsedLimit.limit !== undefined) {
      limit = parsedLimit.limit;
    }
  }

  let cursor: HistoryCursor | null = null;
  if (Object.prototype.hasOwnProperty.call(query, 'cursor')) {
    const parsedCursor = parseCursor(query.cursor);
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

export function validateUnreadCountQuery(req: Request, _res: Response, next: NextFunction): void {
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

export function validateListMessagesQuery(req: Request, res: Response, next: NextFunction): void {
  try {
    res.locals.listMessagesQuery = parseListMessagesQuery(req.query);
    next();
  } catch (error) {
    next(error);
  }
}

const INBOX_CURSOR_MALFORMED_MESSAGE =
  'Cursor must be a base64-encoded JSON object with lastMessageAt and conversationId.';
const INBOX_CURSOR_TIME_MESSAGE = 'Cursor lastMessageAt must be a valid date-time or null.';
const INBOX_CURSOR_ID_MESSAGE = 'Cursor conversationId must be a valid UUID.';

export interface InboxCursor {
  lastMessageAt: string | null;
  conversationId: string;
}

export interface ListInboxQuery {
  limit: number;
  cursor: InboxCursor | null;
}

export function encodeInboxCursor(lastMessageAt: Date | null, conversationId: string): string {
  return Buffer.from(
    JSON.stringify({
      lastMessageAt: lastMessageAt === null ? null : lastMessageAt.toISOString(),
      conversationId: conversationId.toLowerCase()
    }),
    'utf8'
  ).toString('base64');
}

function parseInboxCursor(value: unknown): { cursor?: InboxCursor; details: ErrorDetail[] } {
  if (typeof value !== 'string' || !isCanonicalBase64(value)) {
    return { details: [{ field: 'cursor', message: INBOX_CURSOR_MALFORMED_MESSAGE }] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
  } catch {
    return { details: [{ field: 'cursor', message: INBOX_CURSOR_MALFORMED_MESSAGE }] };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { details: [{ field: 'cursor', message: INBOX_CURSOR_MALFORMED_MESSAGE }] };
  }

  const record = parsed as Record<string, unknown>;
  const details: ErrorDetail[] = [];
  for (const key of Object.keys(record)) {
    if (key !== 'lastMessageAt' && key !== 'conversationId') {
      details.push({ field: `cursor.${key}`, message: 'Unsupported cursor field.' });
    }
  }

  let lastMessageAt: string | null | undefined;
  if (!Object.prototype.hasOwnProperty.call(record, 'lastMessageAt')) {
    details.push({ field: 'cursor.lastMessageAt', message: 'Cursor lastMessageAt is required.' });
  } else if (record.lastMessageAt === null) {
    lastMessageAt = null;
  } else if (typeof record.lastMessageAt !== 'string' || !cursorDateTimeSchema.safeParse(record.lastMessageAt).success) {
    details.push({ field: 'cursor.lastMessageAt', message: INBOX_CURSOR_TIME_MESSAGE });
  } else {
    const instant = new Date(record.lastMessageAt);
    if (Number.isNaN(instant.getTime())) {
      details.push({ field: 'cursor.lastMessageAt', message: INBOX_CURSOR_TIME_MESSAGE });
    } else {
      lastMessageAt = record.lastMessageAt;
    }
  }

  let conversationId: string | undefined;
  if (!Object.prototype.hasOwnProperty.call(record, 'conversationId')) {
    details.push({ field: 'cursor.conversationId', message: 'Cursor conversationId is required.' });
  } else if (typeof record.conversationId !== 'string' || !cursorIdSchema.safeParse(record.conversationId).success) {
    details.push({ field: 'cursor.conversationId', message: INBOX_CURSOR_ID_MESSAGE });
  } else {
    conversationId = record.conversationId.toLowerCase();
  }

  if (details.length > 0 || lastMessageAt === undefined || !conversationId) {
    return { details };
  }

  return { cursor: { lastMessageAt, conversationId }, details: [] };
}

export function parseListInboxQuery(input: unknown): ListInboxQuery {
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
    const parsedLimit = parseLimit(query.limit);
    if (parsedLimit.detail) {
      details.push(parsedLimit.detail);
    } else if (parsedLimit.limit !== undefined) {
      limit = parsedLimit.limit;
    }
  }

  let cursor: InboxCursor | null = null;
  if (Object.prototype.hasOwnProperty.call(query, 'cursor')) {
    const parsedCursor = parseInboxCursor(query.cursor);
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

export function validateListInboxQuery(req: Request, res: Response, next: NextFunction): void {
  try {
    res.locals.listInboxQuery = parseListInboxQuery(req.query);
    next();
  } catch (error) {
    next(error);
  }
}

export const markReadBodySchema = z.object({}).strict();

export const mediaDownloadBodySchema = z.object({}).strict();

export function validateMediaDownloadRequest(req: Request, _res: Response, next: NextFunction): void {
  try {
    const conversationId = conversationIdSchema.safeParse(req.params.conversationId);
    if (!conversationId.success) {
      throw new ValidationError('Validation failed', [
        { field: 'conversationId', message: 'Conversation id must be a valid UUID.' }
      ]);
    }

    const messageId = conversationIdSchema.safeParse(req.params.messageId);
    if (!messageId.success) {
      throw new ValidationError('Validation failed', [
        { field: 'messageId', message: 'Message id must be a valid UUID.' }
      ]);
    }

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

    if (req.body === undefined) {
      req.body = {};
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function validateMarkReadRequest(req: Request, _res: Response, next: NextFunction): void {
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

    if (req.body === undefined) {
      req.body = {};
    }
    next();
  } catch (error) {
    next(error);
  }
}

export const sendTextMessageSchema = z
  .object({
    messageType: z.enum(['TEXT']),
    content: z.string()
  })
  .strict();

export const sendTextMessageEventSchema = sendTextMessageSchema
  .extend({
    conversationId: conversationIdSchema
  })
  .strict();

export const typingEventSchema = z
  .object({
    conversationId: conversationIdSchema
  })
  .strict();

export type SendTextMessageBody = z.infer<typeof sendTextMessageSchema>;
export type SendTextMessageEvent = z.infer<typeof sendTextMessageEventSchema>;
export type TypingEvent = z.infer<typeof typingEventSchema>;

const CHAT_MEDIA_TYPES = ['IMAGE', 'GIF', 'VIDEO', 'VOICE'] as const;

const MEDIA_MIME_TYPES = {
  IMAGE: ['image/jpeg', 'image/png', 'image/webp'],
  GIF: ['image/gif'],
  VIDEO: ['video/mp4', 'video/webm'],
  VOICE: ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/wav']
} as const;

const MEDIA_MAX_BYTES = {
  IMAGE: 10_485_760,
  GIF: 15_728_640,
  VIDEO: 52_428_800,
  VOICE: 10_485_760
} as const;

export function isAllowedChatMedia(mediaType: string, mimeType: string, fileSizeBytes: number): boolean {
  if (!CHAT_MEDIA_TYPES.includes(mediaType as (typeof CHAT_MEDIA_TYPES)[number])) {
    return false;
  }
  const type = mediaType as (typeof CHAT_MEDIA_TYPES)[number];
  const allowed = MEDIA_MIME_TYPES[type] as readonly string[];
  if (!allowed.includes(mimeType)) {
    return false;
  }
  return Number.isInteger(fileSizeBytes) && fileSizeBytes >= 1 && fileSizeBytes <= MEDIA_MAX_BYTES[type];
}

const MEDIA_MIME_MESSAGES = {
  IMAGE: 'Mime type must be image/jpeg, image/png, or image/webp.',
  GIF: 'Mime type must be image/gif.',
  VIDEO: 'Mime type must be video/mp4 or video/webm.',
  VOICE: 'Mime type must be audio/mpeg, audio/mp4, audio/ogg, audio/webm, or audio/wav.'
} as const;

export const mediaUploadUrlSchema = z
  .object({
    mediaType: z.enum(['IMAGE', 'GIF', 'VIDEO', 'VOICE'], {
      errorMap: () => ({ message: 'Media type must be IMAGE, GIF, VIDEO, or VOICE.' })
    }),
    mimeType: z.string({
      required_error: 'Mime type is required.',
      invalid_type_error: 'Mime type must be a string.'
    }),
    fileSizeBytes: z
      .number({
        required_error: 'File size is required.',
        invalid_type_error: 'File size must be a number of bytes.'
      })
      .int('File size must be a whole number of bytes.')
  })
  .strict()
  .superRefine((value, ctx) => {
    const allowed = MEDIA_MIME_TYPES[value.mediaType] as readonly string[];
    if (!allowed.includes(value.mimeType)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mimeType'],
        message: MEDIA_MIME_MESSAGES[value.mediaType]
      });
    }

    const maxBytes = MEDIA_MAX_BYTES[value.mediaType];
    if (value.fileSizeBytes < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fileSizeBytes'],
        message: 'File size must be at least 1 byte.'
      });
    } else if (value.fileSizeBytes > maxBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fileSizeBytes'],
        message: `File size must be at most ${maxBytes} bytes.`
      });
    }
  });

export type MediaUploadUrlBody = z.infer<typeof mediaUploadUrlSchema>;

export const mediaConfirmSchema = z
  .object({
    uploadId: z
      .string({
        required_error: 'Upload id is required.',
        invalid_type_error: 'Upload id must be a valid UUID.'
      })
      .uuid('Upload id must be a valid UUID.')
  })
  .strict();

export type MediaConfirmBody = z.infer<typeof mediaConfirmSchema>;
