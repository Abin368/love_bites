import { randomUUID } from 'crypto';
import { UniqueConstraintError } from 'sequelize';
import { sequelize } from '../../config/database';
import { redis } from '../../config/redis';
import { photoStorage } from '../../integrations/storage/s3.provider';
import { StorageObjectMissingError } from '../../integrations/storage/storage.interface';
import {
  ConflictError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
  ValidationError
} from '../../utils/errors';
import { findViewerDiscoveryContext } from '../discovery/discovery.data-access';
import { consumeDailyQuota } from '../entitlements/usage.service';
import {
  DAILY_TEXT_MESSAGES_METRIC,
  hasActivePremium,
  lockLikeUsers
} from '../likes/likes.data-access';
import { findUserById } from '../users/users.data-access';
import {
  countInboxUnreadMessages,
  countIncomingUnreadMessages,
  findConversationWithMatch,
  findMessageById,
  findProfileFirstName,
  hasBidirectionalBlock,
  insertMediaMessage,
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
  ChatMediaType,
  ChatMediaUploadReservation,
  ConfirmMediaUploadInput,
  ConfirmMediaUploadResult,
  ConversationDetails,
  CreateMediaDownloadUrlInput,
  CreateMediaUploadUrlInput,
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
  MediaDownloadUrlResult,
  MediaUploadUrlResult,
  SendTextMessageInput,
  SendTextMessageResult
} from './chat.types';
import { conversationIdSchema, encodeHistoryCursor, encodeInboxCursor, isAllowedChatMedia } from './chat.validator';

const RESOURCE_NOT_FOUND_MESSAGE = 'Resource not found';
const CONVERSATION_CLOSED_MESSAGE = 'Conversation is closed due to unmatch or safety block.';
const BLOCKED_USER_MESSAGE = 'Interaction prohibited due to an active safety block.';
const PREMIUM_REQUIRED_MESSAGE = 'Feature requires an active Premium subscription.';
const MEDIA_UPLOAD_TTL_SECONDS = 300;
const MEDIA_DOWNLOAD_TTL_SECONDS = 3600;
const MEDIA_STORAGE_UNAVAILABLE_MESSAGE = 'Media storage is temporarily unavailable.';
const DOWNLOADABLE_MEDIA_TYPES = new Set(['IMAGE', 'GIF', 'VIDEO', 'VOICE']);
const MEDIA_NOT_UPLOADED_MESSAGE = 'Uploaded media was not found.';
const MEDIA_SIZE_MISMATCH_MESSAGE = 'Uploaded media size does not match the reservation.';
const MEDIA_MIME_MISMATCH_MESSAGE = 'Uploaded media type does not match the reservation.';
const MEDIA_CONFIRM_IN_PROGRESS_MESSAGE = 'Media confirmation is already in progress.';

function buildChatMediaStorageKey(conversationId: string, uploadId: string): string {
  return `chat-media/${conversationId}/${uploadId}`;
}

function chatMediaReservationKey(uploadId: string): string {
  return `chat-media:upload:${uploadId}`;
}

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

    const remainingDailyMessages = await consumeDailyQuota(
      input.callerId,
      DAILY_TEXT_MESSAGES_METRIC,
      transaction
    );

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

async function authorizeMediaUpload(callerId: string, conversationId: string): Promise<void> {
  await sequelize.transaction(async (transaction) => {
    const loaded = await findConversationWithMatch(conversationId, transaction);
    if (!loaded || !participates(loaded.userOneId, loaded.userTwoId, callerId)) {
      throw resourceNotFound();
    }

    await lockLikeUsers(loaded.userOneId, loaded.userTwoId, transaction);
    await lockMatchById(loaded.matchId, transaction);
    await lockConversationById(conversationId, transaction);

    const locked = await findConversationWithMatch(conversationId, transaction);
    if (!locked || !participates(locked.userOneId, locked.userTwoId, callerId)) {
      throw resourceNotFound();
    }

    if (locked.conversationStatus === 'CLOSED') {
      throw conversationClosed();
    }

    if (locked.matchStatus !== 'ACTIVE') {
      throw resourceNotFound();
    }

    const recipientId = otherParticipant(locked.userOneId, locked.userTwoId, callerId);
    if (await hasBidirectionalBlock(callerId, recipientId, transaction)) {
      throw new ConflictError(BLOCKED_USER_MESSAGE, [], 'BLOCKED_USER');
    }

    const premium = await hasActivePremium(callerId, transaction);
    if (!premium) {
      throw new ForbiddenError(PREMIUM_REQUIRED_MESSAGE, [], 'PREMIUM_REQUIRED');
    }
  });
}

export async function createMediaUploadUrl(input: CreateMediaUploadUrlInput): Promise<MediaUploadUrlResult> {
  const conversationId = parseConversationId(input.conversationId);

  if (!input.isVerified) {
    await rejectUnverified(input.callerId);
  }

  const context = await findViewerDiscoveryContext(input.callerId);
  if (!context || !context.isProfileComplete || !context.hasLocation || !context.hasDatingPreferences) {
    throw incomplete();
  }

  await authorizeMediaUpload(input.callerId, conversationId);

  // Row locks end with the authorization transaction, before signing or Redis.
  const uploadId = randomUUID();
  const storageKey = buildChatMediaStorageKey(conversationId, uploadId);
  const signed = await photoStorage.createUploadUrl({
    storageKey,
    mimeType: input.mimeType,
    expiresInSeconds: MEDIA_UPLOAD_TTL_SECONDS
  });

  const reservation: ChatMediaUploadReservation = {
    uploadId,
    userId: input.callerId,
    conversationId,
    storageKey,
    mediaType: input.mediaType,
    mimeType: input.mimeType,
    fileSizeBytes: input.fileSizeBytes
  };
  const reservationKey = chatMediaReservationKey(uploadId);
  try {
    await redis.set(reservationKey, JSON.stringify(reservation), 'EX', MEDIA_UPLOAD_TTL_SECONDS);
  } catch (error) {
    try {
      await redis.del(reservationKey);
    } catch {
      // The reservation error is the client response.
    }
    throw error;
  }

  return {
    uploadId,
    uploadUrl: signed.url,
    storageKey,
    expiresInSeconds: MEDIA_UPLOAD_TTL_SECONDS
  };
}

function parseUploadId(uploadId: string): string {
  const parsed = conversationIdSchema.safeParse(uploadId);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', [
      { field: 'uploadId', message: 'Upload id must be a valid UUID.' }
    ]);
  }
  return parsed.data.toLowerCase();
}

function parseMessageId(messageId: string): string {
  const parsed = conversationIdSchema.safeParse(messageId);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', [
      { field: 'messageId', message: 'Message id must be a valid UUID.' }
    ]);
  }
  return parsed.data.toLowerCase();
}

function isDownloadableMediaMessage(
  message: { conversationId: string; messageType: string; mediaStorageKey: string | null },
  conversationId: string,
  messageId: string
): boolean {
  if (message.conversationId.toLowerCase() !== conversationId) {
    return false;
  }
  if (!DOWNLOADABLE_MEDIA_TYPES.has(message.messageType)) {
    return false;
  }
  return message.mediaStorageKey === buildChatMediaStorageKey(conversationId, messageId);
}

async function signChatMediaDownload(storageKey: string): Promise<{ url: string }> {
  try {
    return await photoStorage.createDownloadUrl({
      storageKey,
      expiresInSeconds: MEDIA_DOWNLOAD_TTL_SECONDS
    });
  } catch (error) {
    if (error instanceof InternalServerError && error.errorCode === 'STORAGE_NOT_CONFIGURED') {
      throw error;
    }
    throw new InternalServerError(MEDIA_STORAGE_UNAVAILABLE_MESSAGE, [], 'STORAGE_UNAVAILABLE', true);
  }
}

function isUuid(value: string): boolean {
  return conversationIdSchema.safeParse(value).success;
}

function integerFileSize(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function readReservation(
  raw: string,
  uploadId: string,
  callerId: string,
  conversationId: string
): ChatMediaUploadReservation | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  if (typeof record.uploadId !== 'string' || !isUuid(record.uploadId)) {
    return null;
  }
  if (typeof record.userId !== 'string' || !isUuid(record.userId)) {
    return null;
  }
  if (typeof record.conversationId !== 'string' || !isUuid(record.conversationId)) {
    return null;
  }

  const reservedUploadId = record.uploadId.toLowerCase();
  const reservedUserId = record.userId.toLowerCase();
  const reservedConversationId = record.conversationId.toLowerCase();
  if (
    reservedUploadId !== uploadId ||
    reservedUserId !== callerId.toLowerCase() ||
    reservedConversationId !== conversationId
  ) {
    return null;
  }

  const storageKey = buildChatMediaStorageKey(conversationId, uploadId);
  if (record.storageKey !== storageKey) {
    return null;
  }
  if (typeof record.mediaType !== 'string' || typeof record.mimeType !== 'string') {
    return null;
  }
  const fileSizeBytes = integerFileSize(record.fileSizeBytes);
  if (fileSizeBytes === null || !isAllowedChatMedia(record.mediaType, record.mimeType, fileSizeBytes)) {
    return null;
  }

  return {
    uploadId: reservedUploadId,
    userId: reservedUserId,
    conversationId: reservedConversationId,
    storageKey,
    mediaType: record.mediaType as ChatMediaType,
    mimeType: record.mimeType,
    fileSizeBytes
  };
}

function isReplayableMediaMessage(
  message: {
    senderId: string;
    conversationId: string;
    messageType: string;
    content: string | null;
    mediaStorageKey: string | null;
    mediaMimeType: string | null;
    mediaFileSize: number | string | null;
  },
  callerId: string,
  conversationId: string,
  uploadId: string
): boolean {
  const fileSizeBytes = integerFileSize(message.mediaFileSize);
  if (message.senderId.toLowerCase() !== callerId.toLowerCase()) {
    return false;
  }
  if (message.conversationId.toLowerCase() !== conversationId) {
    return false;
  }
  if (message.mediaStorageKey !== buildChatMediaStorageKey(conversationId, uploadId)) {
    return false;
  }
  if (message.content !== null || message.mediaMimeType === null || fileSizeBytes === null) {
    return false;
  }
  return isAllowedChatMedia(message.messageType, message.mediaMimeType, fileSizeBytes);
}

function presentConfirmedMessage(
  message: {
    id: string;
    conversationId: string;
    senderId: string;
    messageType: string;
    readAt: Date | string | null;
    createdAt: Date | string;
  },
  created: boolean,
  recipientId: string | null
): ConfirmMediaUploadResult {
  return {
    created,
    recipientId,
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    messageType: message.messageType as ChatMediaType,
    content: null,
    mediaUrl: null,
    readAt: message.readAt === null ? null : asDate(message.readAt),
    createdAt: asDate(message.createdAt)
  };
}

function isMessagesPrimaryKeyConflict(error: unknown): boolean {
  if (!(error instanceof UniqueConstraintError)) {
    return false;
  }
  const parent = error.parent as { constraint?: string; code?: string; detail?: string } | undefined;
  if (parent?.constraint === 'messages_pkey') {
    return true;
  }
  return parent?.code === '23505' && typeof parent.detail === 'string' && /\(id\)/.test(parent.detail);
}

async function findReplay(
  uploadId: string,
  callerId: string,
  conversationId: string
): Promise<ConfirmMediaUploadResult | null> {
  const existing = await findMessageById(uploadId);
  if (!existing || !isReplayableMediaMessage(existing, callerId, conversationId, uploadId)) {
    return null;
  }
  return presentConfirmedMessage(existing, false, null);
}

async function deleteChatMediaReservation(uploadId: string): Promise<void> {
  try {
    await redis.del(chatMediaReservationKey(uploadId));
  } catch {
    // The message is already committed. A later replay reads PostgreSQL.
  }
}

function verifiedMediaMetadata(
  head: { contentLength?: number; contentType?: string },
  reservation: ChatMediaUploadReservation
): { contentLength: number; contentType: string } {
  const contentLength = head.contentLength;
  const contentType = head.contentType;
  if (typeof contentLength !== 'number' || !Number.isInteger(contentLength) || contentLength !== reservation.fileSizeBytes) {
    throw new ConflictError(MEDIA_SIZE_MISMATCH_MESSAGE, [], 'MEDIA_SIZE_MISMATCH');
  }
  if (contentType !== reservation.mimeType) {
    throw new ConflictError(MEDIA_MIME_MISMATCH_MESSAGE, [], 'MEDIA_MIME_MISMATCH');
  }
  return { contentLength, contentType };
}

export async function confirmMediaUpload(input: ConfirmMediaUploadInput): Promise<ConfirmMediaUploadResult> {
  const conversationId = parseConversationId(input.conversationId);
  const uploadId = parseUploadId(input.uploadId);

  if (!input.isVerified) {
    await rejectUnverified(input.callerId);
  }

  const context = await findViewerDiscoveryContext(input.callerId);
  if (!context || !context.isProfileComplete || !context.hasLocation || !context.hasDatingPreferences) {
    throw incomplete();
  }

  const rawReservation = await redis.get(chatMediaReservationKey(uploadId));
  const reservation = rawReservation
    ? readReservation(rawReservation, uploadId, input.callerId, conversationId)
    : null;
  if (!reservation) {
    const replay = await findReplay(uploadId, input.callerId, conversationId);
    if (replay) {
      return replay;
    }
    throw resourceNotFound();
  }

  let head: { contentLength?: number; contentType?: string };
  try {
    head = await photoStorage.headObject({ storageKey: reservation.storageKey });
  } catch (error) {
    if (error instanceof StorageObjectMissingError) {
      throw new NotFoundError(MEDIA_NOT_UPLOADED_MESSAGE, [], 'MEDIA_NOT_UPLOADED');
    }
    throw error;
  }
  const verified = verifiedMediaMetadata(head, reservation);

  try {
    const inserted = await sequelize.transaction(async (transaction) => {
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
      if (!premium) {
        throw new ForbiddenError(PREMIUM_REQUIRED_MESSAGE, [], 'PREMIUM_REQUIRED');
      }

      const message = await insertMediaMessage(
        {
          id: uploadId,
          conversationId,
          senderId: input.callerId,
          messageType: reservation.mediaType,
          mediaStorageKey: reservation.storageKey,
          mediaMimeType: verified.contentType,
          mediaFileSize: verified.contentLength
        },
        transaction
      );
      const updated = await updateConversationLastMessageAt(conversationId, message.createdAt, transaction);
      if (!updated) {
        throw conversationClosed();
      }

      return { message, recipientId };
    });

    await deleteChatMediaReservation(uploadId);
    return presentConfirmedMessage(inserted.message, true, inserted.recipientId);
  } catch (error) {
    if (!isMessagesPrimaryKeyConflict(error)) {
      throw error;
    }

    const replay = await findReplay(uploadId, input.callerId, conversationId);
    if (replay) {
      return replay;
    }
    const existing = await findMessageById(uploadId);
    if (!existing) {
      throw new ConflictError(MEDIA_CONFIRM_IN_PROGRESS_MESSAGE, [], 'CONFLICT');
    }
    throw resourceNotFound();
  }
}

export async function createMediaDownloadUrl(input: CreateMediaDownloadUrlInput): Promise<MediaDownloadUrlResult> {
  const conversationId = parseConversationId(input.conversationId);
  const messageId = parseMessageId(input.messageId);

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

  const message = await findMessageById(messageId);
  if (!message || !isDownloadableMediaMessage(message, conversationId, messageId)) {
    throw resourceNotFound();
  }

  const signed = await signChatMediaDownload(buildChatMediaStorageKey(conversationId, messageId));
  return {
    downloadUrl: signed.url,
    expiresInSeconds: MEDIA_DOWNLOAD_TTL_SECONDS
  };
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
