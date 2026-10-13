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
  countInboxUnreadMessages,
  countIncomingUnreadMessages,
  findConversationWithMatch,
  findProfileFirstName,
  hasBidirectionalBlock,
  insertTextMessage,
  listConversationMessages,
  listInboxConversations,
  listInboxLatestMessages,
  lockConversationById,
  lockMatchById,
  markIncomingMessagesRead,
  updateConversationLastMessageAt
} from './chat.data-access';
import type {
  AuthorizeTypingInput,
  AuthorizeTypingResult,
  ConversationDetails,
  GetConversationDetailsInput,
  GetUnreadCountInput,
  GetUnreadCountResult,
  HistoryMessage,
  InboxConversation,
  InboxLastMessage,
  ListConversationsInput,
  ListConversationsResult,
  ListMessagesInput,
  ListMessagesResult,
  MarkMessagesReadInput,
  MarkMessagesReadResult,
  SendTextMessageInput,
  SendTextMessageResult
} from './chat.types';
import { conversationIdSchema, encodeHistoryCursor, encodeInboxCursor } from './chat.validator';

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

function asDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Inbox query returned an invalid timestamp.');
  }
  return date;
}

function asNullableDate(value: Date | string | null): Date | null {
  if (value === null) {
    return null;
  }
  return asDate(value);
}

function asUnreadCount(value: number | string | undefined): number {
  if (value === undefined) {
    return 0;
  }
  const unreadCount = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(unreadCount) || unreadCount < 0) {
    throw new Error('Unread count query returned an invalid value.');
  }
  return unreadCount;
}

function toHistoryMessage(message: {
  id: string;
  conversationId: string;
  senderId: string;
  messageType: HistoryMessage['messageType'];
  content: string | null;
  readAt: Date | null;
  createdAt: Date;
}): HistoryMessage {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    messageType: message.messageType,
    content: message.content,
    mediaUrl: null,
    readAt: message.readAt,
    createdAt: message.createdAt
  };
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
      remainingDailyMessages,
      recipientId
    };
  });
}

function asConversationStatus(status: string): ConversationDetails['status'] {
  if (status === 'ACTIVE' || status === 'CLOSED') {
    return status;
  }
  throw resourceNotFound();
}

export async function getConversationDetails(input: GetConversationDetailsInput): Promise<ConversationDetails> {
  const conversationId = parseConversationId(input.conversationId);

  if (!input.isVerified) {
    await rejectUnverified(input.callerId);
  }

  const context = await findViewerDiscoveryContext(input.callerId);
  if (!context || !context.isProfileComplete || !context.hasLocation || !context.hasDatingPreferences) {
    throw incomplete();
  }

  const loaded = await findConversationWithMatch(conversationId);
  if (!loaded || !participates(loaded.userOneId, loaded.userTwoId, input.callerId)) {
    throw resourceNotFound();
  }

  if (loaded.conversationStatus === 'ACTIVE' && loaded.matchStatus !== 'ACTIVE') {
    throw resourceNotFound();
  }

  const participantId = otherParticipant(loaded.userOneId, loaded.userTwoId, input.callerId);
  if (await hasBidirectionalBlock(input.callerId, participantId)) {
    throw new ConflictError(BLOCKED_USER_MESSAGE, [], 'BLOCKED_USER');
  }

  const firstName = await findProfileFirstName(participantId);
  if (firstName === null) {
    throw resourceNotFound();
  }

  return {
    conversationId: loaded.conversationId,
    matchId: loaded.matchId,
    status: asConversationStatus(loaded.conversationStatus),
    participant: {
      userId: participantId,
      firstName
    },
    unreadCount: await countIncomingUnreadMessages(conversationId, participantId)
  };
}

export async function getUnreadCount(input: GetUnreadCountInput): Promise<GetUnreadCountResult> {
  const conversationId = parseConversationId(input.conversationId);

  if (!input.isVerified) {
    await rejectUnverified(input.callerId);
  }

  const context = await findViewerDiscoveryContext(input.callerId);
  if (!context || !context.isProfileComplete || !context.hasLocation || !context.hasDatingPreferences) {
    throw incomplete();
  }

  const loaded = await findConversationWithMatch(conversationId);
  if (!loaded || !participates(loaded.userOneId, loaded.userTwoId, input.callerId)) {
    throw resourceNotFound();
  }

  if (loaded.conversationStatus === 'ACTIVE' && loaded.matchStatus !== 'ACTIVE') {
    throw resourceNotFound();
  }

  const senderId = otherParticipant(loaded.userOneId, loaded.userTwoId, input.callerId);
  if (await hasBidirectionalBlock(input.callerId, senderId)) {
    throw new ConflictError(BLOCKED_USER_MESSAGE, [], 'BLOCKED_USER');
  }

  return {
    unreadCount: await countIncomingUnreadMessages(conversationId, senderId)
  };
}

export async function listConversations(input: ListConversationsInput): Promise<ListConversationsResult> {
  if (!input.isVerified) {
    await rejectUnverified(input.callerId);
  }

  const context = await findViewerDiscoveryContext(input.callerId);
  if (!context || !context.isProfileComplete || !context.hasLocation || !context.hasDatingPreferences) {
    throw incomplete();
  }

  const rows = await listInboxConversations(input.callerId, input.limit + 1, input.cursor);
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const conversationIds = page.map((row) => row.conversationId);
  const previews =
    conversationIds.length === 0 ? [] : await listInboxLatestMessages(conversationIds);
  const unreadRows =
    conversationIds.length === 0 ? [] : await countInboxUnreadMessages(input.callerId, conversationIds);

  const previewByConversation = new Map(previews.map((row) => [row.conversationId.toLowerCase(), row]));
  const unreadByConversation = new Map(unreadRows.map((row) => [row.conversationId.toLowerCase(), row.unreadCount]));
  const conversations: InboxConversation[] = page.map((row) => {
    const preview = previewByConversation.get(row.conversationId.toLowerCase());
    const lastMessage: InboxLastMessage | null = preview
      ? {
          id: preview.id,
          senderId: preview.senderId,
          messageType: preview.messageType,
          content: preview.content,
          createdAt: asDate(preview.createdAt),
          mediaUrl: null
        }
      : null;

    return {
      conversationId: row.conversationId,
      matchId: row.matchId,
      status: 'ACTIVE',
      participant: {
        userId: row.participantId,
        firstName: row.firstName
      },
      lastMessage,
      unreadCount: asUnreadCount(unreadByConversation.get(row.conversationId.toLowerCase()))
    };
  });
  const last = page[page.length - 1];

  return {
    conversations,
    nextCursor: hasMore && last ? encodeInboxCursor(asNullableDate(last.lastMessageAt), last.conversationId) : null,
    hasMore,
    limit: input.limit
  };
}

export async function listMessages(input: ListMessagesInput): Promise<ListMessagesResult> {
  const conversationId = parseConversationId(input.conversationId);

  if (!input.isVerified) {
    await rejectUnverified(input.callerId);
  }

  const context = await findViewerDiscoveryContext(input.callerId);
  if (!context || !context.isProfileComplete || !context.hasLocation || !context.hasDatingPreferences) {
    throw incomplete();
  }

  const loaded = await findConversationWithMatch(conversationId);
  if (!loaded || !participates(loaded.userOneId, loaded.userTwoId, input.callerId)) {
    throw resourceNotFound();
  }

  if (loaded.conversationStatus === 'ACTIVE' && loaded.matchStatus !== 'ACTIVE') {
    throw resourceNotFound();
  }

  const recipientId = otherParticipant(loaded.userOneId, loaded.userTwoId, input.callerId);
  if (await hasBidirectionalBlock(input.callerId, recipientId)) {
    throw new ConflictError(BLOCKED_USER_MESSAGE, [], 'BLOCKED_USER');
  }

  const rows = await listConversationMessages(conversationId, input.limit + 1, input.cursor);
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map(toHistoryMessage),
    nextCursor: hasMore && last ? encodeHistoryCursor(last.createdAt, last.id) : null,
    hasMore,
    limit: input.limit
  };
}

export async function markMessagesRead(input: MarkMessagesReadInput): Promise<MarkMessagesReadResult> {
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

    if (loaded.conversationStatus === 'ACTIVE' && loaded.matchStatus !== 'ACTIVE') {
      throw resourceNotFound();
    }

    const recipientId = otherParticipant(loaded.userOneId, loaded.userTwoId, input.callerId);
    if (await hasBidirectionalBlock(input.callerId, recipientId, transaction)) {
      throw new ConflictError(BLOCKED_USER_MESSAGE, [], 'BLOCKED_USER');
    }

    const readAt = await markIncomingMessagesRead(conversationId, recipientId, transaction);
    return {
      conversationId,
      readerId: input.callerId,
      recipientId,
      readAt
    };
  });
}

export async function authorizeTyping(input: AuthorizeTypingInput): Promise<AuthorizeTypingResult> {
  const conversationId = parseConversationId(input.conversationId);

  if (!input.isVerified) {
    await rejectUnverified(input.callerId);
  }

  const context = await findViewerDiscoveryContext(input.callerId);
  if (!context || !context.isProfileComplete || !context.hasLocation || !context.hasDatingPreferences) {
    throw incomplete();
  }

  const loaded = await findConversationWithMatch(conversationId);
  if (!loaded || !participates(loaded.userOneId, loaded.userTwoId, input.callerId)) {
    throw resourceNotFound();
  }

  if (loaded.conversationStatus === 'CLOSED') {
    throw conversationClosed();
  }

  if (loaded.matchStatus !== 'ACTIVE') {
    throw resourceNotFound();
  }

  const recipientId = otherParticipant(loaded.userOneId, loaded.userTwoId, input.callerId);
  if (await hasBidirectionalBlock(input.callerId, recipientId)) {
    throw new ConflictError(BLOCKED_USER_MESSAGE, [], 'BLOCKED_USER');
  }

  return {
    conversationId,
    senderId: input.callerId,
    recipientId
  };
}
