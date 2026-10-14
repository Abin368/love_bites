export interface BlockUserInput {
  callerId: string;
  targetUserId: string;
}

export interface UnblockUserInput {
  callerId: string;
  targetUserId: string;
}

export interface BlockListItem {
  userId: string;
  createdAt: Date;
}

export interface MatchUnmatchEvent {
  matchId: string;
  conversationId: string;
  recipientId: string;
}

export interface BlockUserResult {
  targetUserId: string;
  unmatchEvent: MatchUnmatchEvent | null;
}

export interface UnblockUserResult {
  blocked: false;
  targetUserId: string;
}
