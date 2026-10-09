import type { Server, Socket } from 'socket.io';
import { ZodError, type ZodIssue } from 'zod';
import { loadAuthenticatedUser } from '../middleware/auth.middleware';
import * as chatService from '../modules/chat/chat.service';
import type { AuthorizeTypingResult, SendTextMessageResult } from '../modules/chat/chat.types';
import { sendTextMessageEventSchema, typingEventSchema } from '../modules/chat/chat.validator';
import { AppError, ErrorDetail, ForbiddenError, RateLimitError, ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';
import { evaluateSlidingWindow, type SlidingWindowEntry } from '../utils/rate-limit';
import { activeSocketServer } from './socket.server';

const USER_ROLE_MESSAGE = 'You do not have permission to perform this action.';
const UNEXPECTED_ERROR_MESSAGE = 'An unexpected error occurred. Please try again later.';
const RATE_LIMIT_MESSAGE = 'Too many requests. Please try again later.';
const SOCKET_PAYLOAD_LIMIT_BYTES = 100 * 1024;
const TYPING_TTL_MS = 5000;
const TYPING_START_LIMIT = 10;
const TYPING_START_WINDOW_MS = 10_000;

type TypingEventName = 'chat:typing:start' | 'chat:typing:stop';

interface TypingSession {
  conversationId: string;
  senderId: string;
  recipientId: string;
  generation: number;
  timer: NodeJS.Timeout;
}

const typingSessions = new Map<string, TypingSession>();
const typingWindows = new Map<string, SlidingWindowEntry[]>();

type Ack = (body: unknown) => void;

interface SocketFailure {
  success: false;
  error: {
    code: string;
    message: string;
    details: ErrorDetail[] | null;
  };
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

function readAck(ack: unknown): Ack | null {
  return typeof ack === 'function' ? (ack as Ack) : null;
}

function zodDetails(issues: ZodIssue[]): ErrorDetail[] {
  return issues.map((issue) => ({
    field: issue.path.map(String).join('.'),
    message: issue.message,
    code: issue.code
  }));
}

function payloadByteLength(payload: unknown): number {
  let serialized: string;
  try {
    const encoded = JSON.stringify(payload);
    if (typeof encoded !== 'string') {
      throw new ValidationError('Validation failed', [
        { field: 'payload', message: 'Payload must be a JSON object.' }
      ]);
    }
    serialized = encoded;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError('Validation failed', [
      { field: 'payload', message: 'Payload must be a JSON object.' }
    ]);
  }

  return Buffer.byteLength(serialized, 'utf8');
}

function assertPayloadSize(payload: unknown): void {
  if (payloadByteLength(payload) > SOCKET_PAYLOAD_LIMIT_BYTES) {
    throw new ValidationError('Validation failed', [
      { field: 'payload', message: 'Payload must not exceed 100 KB.' }
    ]);
  }
}

function parsePayload(payload: unknown): { conversationId: string; messageType: 'TEXT'; content: string } {
  const parsed = sendTextMessageEventSchema.safeParse(payload);
  if (!parsed.success) {
    const error = parsed.error as ZodError;
    throw new ValidationError('Validation failed', zodDetails(error.issues));
  }

  return parsed.data;
}

function httpMessageData(result: SendTextMessageResult) {
  return {
    id: result.id,
    conversationId: result.conversationId,
    senderId: result.senderId,
    messageType: result.messageType,
    content: result.content,
    mediaUrl: result.mediaUrl,
    readAt: result.readAt,
    createdAt: result.createdAt.toISOString(),
    remainingDailyMessages: result.remainingDailyMessages
  };
}

function failureAck(error: AppError): SocketFailure {
  return {
    success: false,
    error: {
      code: error.errorCode,
      message: error.message,
      details: error.details.length > 0 ? error.details : null
    }
  };
}

function unexpectedFailure(): SocketFailure {
  return {
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: UNEXPECTED_ERROR_MESSAGE,
      details: null
    }
  };
}

function deliverNewMessage(io: Server, result: SendTextMessageResult): void {
  if (result.recipientId.toLowerCase() === result.senderId.toLowerCase()) {
    logger.error('Refusing to deliver chat:message:new to the sender room', {
      conversationId: result.conversationId
    });
    return;
  }

  try {
    io.to(userRoom(result.recipientId)).emit('chat:message:new', {
      id: result.id,
      conversationId: result.conversationId,
      senderId: result.senderId,
      messageType: result.messageType,
      content: result.content,
      createdAt: result.createdAt.toISOString()
    });
  } catch (error) {
    logger.error('Failed to deliver chat:message:new', {
      error: error instanceof Error ? error.message : 'Unknown error',
      conversationId: result.conversationId,
      recipientId: result.recipientId
    });
  }
}

async function handleChatMessageSend(socket: Socket, io: Server, payload: unknown, ack: unknown): Promise<void> {
  const respond = readAck(ack);
  try {
    assertPayloadSize(payload);
    const parsed = parsePayload(payload);
    const current = await loadAuthenticatedUser(socket.data.user.id);
    if (current.role !== 'USER') {
      throw new ForbiddenError(USER_ROLE_MESSAGE, [], 'FORBIDDEN');
    }
    socket.data.user = current;

    const result = await chatService.sendTextMessage({
      callerId: current.id,
      isVerified: current.isVerified,
      conversationId: parsed.conversationId,
      messageType: parsed.messageType,
      content: parsed.content
    });

    deliverNewMessage(io, result);
    respond?.({
      success: true,
      data: httpMessageData(result)
    });
  } catch (error) {
    if (error instanceof AppError) {
      logger.warn('chat:message:send rejected', {
        errorCode: error.errorCode,
        userId: socket.data.user?.id
      });
      respond?.(failureAck(error));
      return;
    }

    logger.error('chat:message:send failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      userId: socket.data.user?.id
    });
    respond?.(unexpectedFailure());
  }
}

export function deliverReadReceipt(input: {
  conversationId: string;
  readerId: string;
  recipientId: string;
  readAt: Date;
}): void {
  const io = activeSocketServer();
  if (!io) {
    return;
  }

  if (input.recipientId.toLowerCase() === input.readerId.toLowerCase()) {
    logger.error('Refusing to deliver chat:message:read to the reader room', {
      conversationId: input.conversationId
    });
    return;
  }

  try {
    io.to(userRoom(input.recipientId)).emit('chat:message:read', {
      conversationId: input.conversationId,
      readerId: input.readerId,
      readAt: input.readAt.toISOString()
    });
  } catch (error) {
    logger.error('Failed to deliver chat:message:read', {
      error: error instanceof Error ? error.message : 'Unknown error',
      conversationId: input.conversationId,
      recipientId: input.recipientId
    });
  }
}

function typingSuccess() {
  return { success: true, data: null };
}

function parseTypingPayload(payload: unknown): { conversationId: string } {
  const parsed = typingEventSchema.safeParse(payload);
  if (!parsed.success) {
    const error = parsed.error as ZodError;
    throw new ValidationError('Validation failed', zodDetails(error.issues));
  }

  return parsed.data;
}

function consumeTypingStartAttempt(socketId: string): boolean {
  const existing = typingWindows.get(socketId) ?? [];
  const now = Date.now();
  const decision = evaluateSlidingWindow(
    existing,
    now,
    TYPING_START_WINDOW_MS,
    TYPING_START_LIMIT,
    `${now}:${existing.length}`
  );
  typingWindows.set(socketId, decision.entries);
  return decision.allowed;
}

function deliverTyping(
  io: Server,
  event: TypingEventName,
  input: { conversationId: string; senderId: string; recipientId: string }
): void {
  if (input.recipientId.toLowerCase() === input.senderId.toLowerCase()) {
    logger.error('Refusing to deliver typing to the sender room', {
      event,
      conversationId: input.conversationId
    });
    return;
  }

  try {
    io.to(userRoom(input.recipientId)).emit(event, {
      conversationId: input.conversationId,
      senderId: input.senderId
    });
  } catch (error) {
    logger.error('Failed to deliver typing indicator', {
      error: error instanceof Error ? error.message : 'Unknown error',
      event,
      conversationId: input.conversationId,
      recipientId: input.recipientId
    });
  }
}

function scheduleTypingTimeout(socketId: string, io: Server, session: TypingSession): NodeJS.Timeout {
  const generation = session.generation;
  return setTimeout(() => {
    try {
      const current = typingSessions.get(socketId);
      if (!current || current.generation !== generation) {
        return;
      }
      clearTyping(socketId, io);
    } catch (error) {
      logger.error('Typing indicator timeout failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        conversationId: session.conversationId
      });
    }
  }, TYPING_TTL_MS);
}

function clearTyping(socketId: string, io: Server): void {
  const current = typingSessions.get(socketId);
  if (!current) {
    return;
  }

  clearTimeout(current.timer);
  typingSessions.delete(socketId);
  deliverTyping(io, 'chat:typing:stop', current);
}

function sameTypingTarget(current: TypingSession, result: AuthorizeTypingResult): boolean {
  return (
    current.conversationId === result.conversationId &&
    current.senderId.toLowerCase() === result.senderId.toLowerCase()
  );
}

function beginOrRefreshTyping(socketId: string, io: Server, result: AuthorizeTypingResult): void {
  if (result.recipientId.toLowerCase() === result.senderId.toLowerCase()) {
    clearTyping(socketId, io);
    logger.error('Refusing to deliver typing to the sender room', {
      conversationId: result.conversationId
    });
    return;
  }

  const current = typingSessions.get(socketId);
  if (current && sameTypingTarget(current, result)) {
    current.recipientId = result.recipientId;
    current.generation += 1;
    clearTimeout(current.timer);
    current.timer = scheduleTypingTimeout(socketId, io, current);
    return;
  }

  if (current) {
    clearTyping(socketId, io);
  }

  const session: TypingSession = {
    conversationId: result.conversationId,
    senderId: result.senderId,
    recipientId: result.recipientId,
    generation: 1,
    timer: setTimeout(() => undefined, 0)
  };
  clearTimeout(session.timer);
  session.timer = scheduleTypingTimeout(socketId, io, session);
  typingSessions.set(socketId, session);
  deliverTyping(io, 'chat:typing:start', session);
}

function cleanupTypingSocket(socketId: string, io: Server): void {
  try {
    clearTyping(socketId, io);
  } catch (error) {
    logger.error('Typing indicator disconnect cleanup failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    typingWindows.delete(socketId);
  }
}

function acknowledgeTypingFailure(event: TypingEventName, socket: Socket, error: unknown, respond: Ack | null): void {
  if (error instanceof AppError) {
    logger.warn(`${event} rejected`, {
      errorCode: error.errorCode,
      userId: socket.data.user?.id
    });
    respond?.(failureAck(error));
    return;
  }

  logger.error(`${event} failed`, {
    error: error instanceof Error ? error.message : 'Unknown error',
    userId: socket.data.user?.id
  });
  respond?.(unexpectedFailure());
}

async function handleTypingStart(socket: Socket, io: Server, payload: unknown, ack: unknown): Promise<void> {
  const respond = readAck(ack);
  try {
    assertPayloadSize(payload);
    const parsed = parseTypingPayload(payload);
    if (!consumeTypingStartAttempt(socket.id)) {
      acknowledgeTypingFailure(
        'chat:typing:start',
        socket,
        new RateLimitError(RATE_LIMIT_MESSAGE, [], 'RATE_LIMITED'),
        respond
      );
      return;
    }

    try {
      const current = await loadAuthenticatedUser(socket.data.user.id);
      if (current.role !== 'USER') {
        throw new ForbiddenError(USER_ROLE_MESSAGE, [], 'FORBIDDEN');
      }
      socket.data.user = current;
      const result = await chatService.authorizeTyping({
        callerId: current.id,
        isVerified: current.isVerified,
        conversationId: parsed.conversationId
      });
      beginOrRefreshTyping(socket.id, io, result);
      respond?.(typingSuccess());
    } catch (error) {
      clearTyping(socket.id, io);
      throw error;
    }
  } catch (error) {
    acknowledgeTypingFailure('chat:typing:start', socket, error, respond);
  }
}

function handleTypingStop(socket: Socket, io: Server, payload: unknown, ack: unknown): void {
  const respond = readAck(ack);
  try {
    assertPayloadSize(payload);
    const parsed = parseTypingPayload(payload);
    const current = typingSessions.get(socket.id);
    if (current && current.conversationId === parsed.conversationId.toLowerCase()) {
      clearTyping(socket.id, io);
    }
    respond?.(typingSuccess());
  } catch (error) {
    acknowledgeTypingFailure('chat:typing:stop', socket, error, respond);
  }
}

export function registerChatSocketHandlers(socket: Socket, io: Server): void {
  socket.on('chat:message:send', (payload: unknown, ack?: unknown) => {
    void handleChatMessageSend(socket, io, payload, ack);
  });
  socket.on('chat:typing:start', (payload: unknown, ack?: unknown) => {
    void handleTypingStart(socket, io, payload, ack);
  });
  socket.on('chat:typing:stop', (payload: unknown, ack?: unknown) => {
    void handleTypingStop(socket, io, payload, ack);
  });
  socket.on('disconnect', () => {
    cleanupTypingSocket(socket.id, io);
  });
}
