import type { Server, Socket } from 'socket.io';
import { ZodError, type ZodIssue } from 'zod';
import { loadAuthenticatedUser } from '../middleware/auth.middleware';
import * as chatService from '../modules/chat/chat.service';
import type { SendTextMessageResult } from '../modules/chat/chat.types';
import { sendTextMessageEventSchema } from '../modules/chat/chat.validator';
import { AppError, ErrorDetail, ForbiddenError, ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';
import { activeSocketServer } from './socket.server';

const USER_ROLE_MESSAGE = 'You do not have permission to perform this action.';
const UNEXPECTED_ERROR_MESSAGE = 'An unexpected error occurred. Please try again later.';
const SOCKET_PAYLOAD_LIMIT_BYTES = 100 * 1024;

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

export function registerChatSocketHandlers(socket: Socket, io: Server): void {
  socket.on('chat:message:send', (payload: unknown, ack?: unknown) => {
    void handleChatMessageSend(socket, io, payload, ack);
  });
}
