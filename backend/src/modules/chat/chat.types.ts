import type { MessageType } from '../../database/models/message.model';
import type { HistoryCursor, InboxCursor } from './chat.validator';

export type ChatMediaType = 'IMAGE' | 'GIF' | 'VIDEO' | 'VOICE';

export interface CreateMediaUploadUrlInput {
  callerId: string;
  isVerified: boolean;
  conversationId: string;
  mediaType: ChatMediaType;
  mimeType: string;
  fileSizeBytes: number;
}

export interface MediaUploadUrlResult {
  uploadId: string;
  uploadUrl: string;
  storageKey: string;
  expiresInSeconds: number;
}

export interface ChatMediaUploadReservation {
  uploadId: string;
  userId: string;
  conversationId: string;
  storageKey: string;
  mediaType: ChatMediaType;
  mimeType: string;
  fileSizeBytes: number;
}

export interface SendTextMessageInput {
  callerId: string;
  isVerified: boolean;
  conversationId: string;
  messageType: 'TEXT';
  content: string;
}

export interface SendTextMessageResult {
  id: string;
  conversationId: string;
  senderId: string;
  messageType: 'TEXT';
  content: string;
  mediaUrl: null;
  readAt: null;
  createdAt: Date;
  remainingDailyMessages: number | null;
  recipientId: string;
}

export interface ListMessagesInput {
  callerId: string;
  isVerified: boolean;
  conversationId: string;
  limit: number;
  cursor: HistoryCursor | null;
}

export interface HistoryMessage {
  id: string;
  conversationId: string;
  senderId: string;
  messageType: MessageType;
  content: string | null;
  mediaUrl: null;
  readAt: Date | null;
  createdAt: Date;
}

export interface ListMessagesResult {
  items: HistoryMessage[];
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
}

export interface GetUnreadCountInput {
  callerId: string;
  isVerified: boolean;
  conversationId: string;
}

export interface GetConversationDetailsInput {
  callerId: string;
  isVerified: boolean;
  conversationId: string;
}

export interface ConversationDetails {
  conversationId: string;
  matchId: string;
  status: 'ACTIVE' | 'CLOSED';
  participant: {
    userId: string;
    firstName: string;
  };
  unreadCount: number;
}

export interface GetUnreadCountResult {
  unreadCount: number;
}

export interface MarkMessagesReadInput {
  callerId: string;
  isVerified: boolean;
  conversationId: string;
}

export interface MarkMessagesReadResult {
  conversationId: string;
  readerId: string;
  recipientId: string;
  readAt: Date | null;
}

export interface AuthorizeTypingInput {
  callerId: string;
  isVerified: boolean;
  conversationId: string;
}

export interface AuthorizeTypingResult {
  conversationId: string;
  senderId: string;
  recipientId: string;
}

export interface ConversationMatchLookup {
  conversationId: string;
  conversationStatus: string;
  matchId: string;
  matchStatus: string;
  userOneId: string;
  userTwoId: string;
}

export interface ListConversationsInput {
  callerId: string;
  isVerified: boolean;
  limit: number;
  cursor: InboxCursor | null;
}

export interface InboxLastMessage {
  id: string;
  senderId: string;
  messageType: MessageType;
  content: string | null;
  createdAt: Date;
  mediaUrl: null;
}

export interface InboxConversation {
  conversationId: string;
  matchId: string;
  status: 'ACTIVE';
  participant: {
    userId: string;
    firstName: string;
  };
  lastMessage: InboxLastMessage | null;
  unreadCount: number;
}

export interface ListConversationsResult {
  conversations: InboxConversation[];
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
}
