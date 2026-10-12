import type { MessageType } from '../../database/models/message.model';
import type { HistoryCursor } from './chat.validator';

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
