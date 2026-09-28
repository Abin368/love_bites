import type { UserRole, UserStatus } from '../../database/models/user.model';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  status: UserStatus;
  isVerified: boolean;
  isProfileComplete: boolean;
}

export interface VerificationState {
  email: string | null;
  phone: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
}

export function computeIsVerified(user: VerificationState): boolean {
  if (user.email && user.emailVerified) {
    return true;
  }
  if (user.phone && user.phoneVerified) {
    return true;
  }
  return false;
}

export interface RefreshTokenSnapshot {
  userId: string;
  revokedAt: Date | null;
  expiresAt: Date;
}

export type RefreshAssessment =
  | { action: 'invalid' }
  | { action: 'reuse'; userId: string }
  | { action: 'rotate'; userId: string };

export function assessRefreshToken(row: RefreshTokenSnapshot | null, now: Date): RefreshAssessment {
  if (!row) {
    return { action: 'invalid' };
  }
  if (row.revokedAt) {
    return { action: 'reuse', userId: row.userId };
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { action: 'invalid' };
  }
  return { action: 'rotate', userId: row.userId };
}
