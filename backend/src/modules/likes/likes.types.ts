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
