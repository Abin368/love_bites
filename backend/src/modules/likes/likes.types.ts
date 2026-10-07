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
