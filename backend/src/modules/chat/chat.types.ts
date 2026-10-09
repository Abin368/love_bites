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

export interface ConversationMatchLookup {
  conversationId: string;
  conversationStatus: string;
  matchId: string;
  matchStatus: string;
  userOneId: string;
  userTwoId: string;
}
