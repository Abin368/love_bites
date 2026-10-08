import { sequelize } from '../../config/database';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  ValidationError
} from '../../utils/errors';
import { findViewerDiscoveryContext } from '../discovery/discovery.data-access';
import {
  FREE_DAILY_TEXT_MESSAGES_LIMIT,
  hasActivePremium,
  incrementDailyTextMessages,
  lockLikeUsers
} from '../likes/likes.data-access';
import { findUserById } from '../users/users.data-access';
import {
  findConversationWithMatch,
  hasBidirectionalBlock,
  insertTextMessage,
  lockConversationById,
  lockMatchById,
  updateConversationLastMessageAt
} from './chat.data-access';
import type { SendTextMessageInput, SendTextMessageResult } from './chat.types';
import { conversationIdSchema } from './chat.validator';

const RESOURCE_NOT_FOUND_MESSAGE = 'Resource not found';
const CONVERSATION_CLOSED_MESSAGE = 'Conversation is closed due to unmatch or safety block.';
const BLOCKED_USER_MESSAGE = 'Interaction prohibited due to an active safety block.';
const DAILY_TEXT_LIMIT_MESSAGE = 'You have reached your daily limit of 20 text messages.';

function parseConversationId(conversationId: string): string {
  const parsed = conversationIdSchema.safeParse(conversationId);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', [
      { field: 'conversationId', message: 'Conversation id must be a valid UUID.' }
    ]);
  }

  return parsed.data.toLowerCase();
}

function participates(userOneId: string, userTwoId: string, callerId: string): boolean {
  const caller = callerId.toLowerCase();
  return userOneId.toLowerCase() === caller || userTwoId.toLowerCase() === caller;
}

function otherParticipant(userOneId: string, userTwoId: string, callerId: string): string {
  return userOneId.toLowerCase() === callerId.toLowerCase() ? userTwoId : userOneId;
}

function resourceNotFound(): NotFoundError {
  return new NotFoundError(RESOURCE_NOT_FOUND_MESSAGE, [], 'RESOURCE_NOT_FOUND');
}

function conversationClosed(): NotFoundError {
  return new NotFoundError(CONVERSATION_CLOSED_MESSAGE, [], 'CONVERSATION_CLOSED');
}

async function rejectUnverified(userId: string): Promise<never> {
  const user = await findUserById(userId);
  if (!user || user.status === 'DELETED' || user.deletedAt) {
    throw new UnauthorizedError('Invalid token.', [], 'INVALID_TOKEN');
  }

  if (user.email && !user.emailVerified) {
    throw new ForbiddenError('Email verification is required.', [], 'EMAIL_NOT_VERIFIED');
  }

  throw new ForbiddenError('Phone verification is required.', [], 'PHONE_NOT_VERIFIED');
}

function incomplete(): ValidationError {
  return new ValidationError('Onboarding is incomplete.', [], 'PROFILE_INCOMPLETE');
}

export async function sendTextMessage(input: SendTextMessageInput): Promise<SendTextMessageResult> {
  const conversationId = parseConversationId(input.conversationId);

  if (!input.isVerified) {
    await rejectUnverified(input.callerId);
  }

  const context = await findViewerDiscoveryContext(input.callerId);
  if (!context || !context.isProfileComplete || !context.hasLocation || !context.hasDatingPreferences) {
    throw incomplete();
  }

  return sequelize.transaction(async (transaction) => {
    const loaded = await findConversationWithMatch(conversationId, transaction);
    if (!loaded || !participates(loaded.userOneId, loaded.userTwoId, input.callerId)) {
      throw resourceNotFound();
    }

    await lockLikeUsers(loaded.userOneId, loaded.userTwoId, transaction);
    await lockMatchById(loaded.matchId, transaction);
    await lockConversationById(conversationId, transaction);

    const locked = await findConversationWithMatch(conversationId, transaction);
    if (!locked || !participates(locked.userOneId, locked.userTwoId, input.callerId)) {
      throw resourceNotFound();
    }

    if (locked.conversationStatus === 'CLOSED') {
      throw conversationClosed();
    }

    if (locked.matchStatus !== 'ACTIVE') {
      throw resourceNotFound();
    }

    const recipientId = otherParticipant(locked.userOneId, locked.userTwoId, input.callerId);
    if (await hasBidirectionalBlock(input.callerId, recipientId, transaction)) {
      throw new ConflictError(BLOCKED_USER_MESSAGE, [], 'BLOCKED_USER');
    }

    const premium = await hasActivePremium(input.callerId, transaction);
    let remainingDailyMessages: number | null = null;
    if (!premium) {
      const usageCount = await incrementDailyTextMessages(input.callerId, transaction);
      if (usageCount === null) {
        throw new RateLimitError(DAILY_TEXT_LIMIT_MESSAGE, [], 'DAILY_LIMIT_REACHED');
      }
      remainingDailyMessages = FREE_DAILY_TEXT_MESSAGES_LIMIT - usageCount;
    }

    const message = await insertTextMessage(conversationId, input.callerId, input.content, transaction);
    const updated = await updateConversationLastMessageAt(conversationId, message.createdAt, transaction);
    if (!updated) {
      throw conversationClosed();
    }

    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      messageType: 'TEXT',
      content: message.content ?? input.content,
      mediaUrl: null,
      readAt: null,
      createdAt: message.createdAt,
      remainingDailyMessages
    };
  });
}
