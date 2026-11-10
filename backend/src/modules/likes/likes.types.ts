export interface PassProfileInput {
  callerId: string;
  isVerified: boolean;
  targetUserId: string;
}

export interface PassProfileResult {
  action: 'PASS';
  targetUserId: string;
  remainingDailyActions: number | null;
}

export interface LikeProfileInput {
  callerId: string;
  isVerified: boolean;
  targetUserId: string;
  idempotencyKey?: string;
}

export interface LikeProfileData {
  action: 'LIKE';
  targetUserId: string;
  isMatch: boolean;
  matchId: string | null;
  remainingDailyActions: number | null;
}

export interface LikeProfileResponse {
  success: true;
  data: LikeProfileData;
  message: string;
}

export interface SuperLikeProfileInput {
  callerId: string;
  isVerified: boolean;
  targetUserId: string;
  idempotencyKey?: string;
}

export interface SuperLikeProfileData {
  action: 'SUPER_LIKE';
  targetUserId: string;
  isMatch: boolean;
  matchId: string | null;
  remainingSuperLikeCredits: number;
}

export interface SuperLikeProfileResponse {
  success: true;
  data: SuperLikeProfileData;
  message: string;
}

export interface UnmatchInput {
  callerId: string;
  isVerified: boolean;
  matchId: string;
}

export interface UnmatchResult {
  unmatched: true;
}

export interface UndoProfileInput {
  callerId: string;
  isVerified: boolean;
}

export interface UndoProfileResult {
  undoneAction: 'LIKE' | 'PASS';
  targetUserId: string;
  revertedMatch: boolean;
}

export interface PassTargetState {
  status: string;
  deleted: boolean;
  profileComplete: boolean;
  hasPrimaryPhoto: boolean;
  blocked: boolean;
  alreadySwiped: boolean;
  activeMatch: boolean;
}

export interface UtcDayWindow {
  periodStart: Date;
  periodEnd: Date;
}

export interface WhoLikedMeInput {
  callerId: string;
  isVerified: boolean;
}

export interface WhoLikedMeAdmirer {
  userId: string;
  firstName: string;
  age: number;
  city: string | null;
  distanceKm: number;
  likedAt: string;
  primaryPhotoUrl: string;
}

export interface WhoLikedMeData {
  count: number;
  isUnlocked: boolean;
  admirers: WhoLikedMeAdmirer[];
}

export interface WhoLikedMeResult {
  data: WhoLikedMeData;
  message: string;
}

export interface MatchListCursor {
  matchedAt: string;
  matchId: string;
}

export interface ListMatchesInput {
  callerId: string;
  isVerified: boolean;
  limit: number;
  cursor: MatchListCursor | null;
}

export interface MatchListLastMessage {
  id: string;
  senderId: string;
  messageType: 'TEXT' | 'IMAGE' | 'GIF' | 'VIDEO' | 'VOICE';
  content: string | null;
  createdAt: string;
  mediaUrl: null;
}

export interface MatchListItem {
  matchId: string;
  matchedAt: string;
  conversationId: string;
  user: {
    id: string;
    firstName: string;
    age: number;
    city: string | null;
    primaryPhotoUrl: string | null;
  };
  lastMessage: MatchListLastMessage | null;
  unreadCount: number;
}

export interface ListMatchesResult {
  items: MatchListItem[];
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
}
