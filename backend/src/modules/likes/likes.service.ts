import { sequelize } from '../../config/database';
import { findViewerDiscoveryContext } from '../discovery/discovery.data-access';
import { findUserById } from '../users/users.data-access';
import { ConflictError, ForbiddenError, NotFoundError, RateLimitError, UnauthorizedError, ValidationError } from '../../utils/errors';
import {
  findPassTarget,
  FREE_DAILY_LIKE_PASS_LIMIT,
  hasActivePremium,
  incrementDailyLikePass,
  insertPass,
  isActivePairConflict
} from './likes.data-access';
import type { PassProfileInput, PassProfileResult, PassTargetState } from './likes.types';
import { targetUserIdSchema } from './likes.validator';

const DAILY_LIMIT_MESSAGE = 'You have reached your daily limit of 10 likes/passes.';

function parseTargetUserId(userId: string): string {
  const parsed = targetUserIdSchema.safeParse(userId);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', [
      { field: 'userId', message: 'User id must be a valid UUID.' }
    ]);
  }

  return parsed.data.toLowerCase();
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

function assertTarget(target: PassTargetState | null): void {
  if (!target || target.deleted) {
    throw new NotFoundError('Target user profile not found.', [], 'USER_NOT_FOUND');
  }

  if (target.status !== 'ACTIVE' || !target.profileComplete || !target.hasPrimaryPhoto) {
    throw new NotFoundError('This profile cannot be passed.', [], 'INVALID_TARGET');
  }

  if (target.blocked) {
    throw new ConflictError('Interaction prohibited due to an active safety block.', [], 'BLOCKED_USER');
  }

  if (target.alreadySwiped) {
    throw new ConflictError('Target user has already been liked or permanently passed.', [], 'ALREADY_SWIPED');
  }

  if (target.activeMatch) {
    throw new ConflictError('Users are already in an active mutual match.', [], 'ACTIVE_MATCH_EXISTS');
  }
}

function alreadySwiped(): ConflictError {
  return new ConflictError('Target user has already been liked or permanently passed.', [], 'ALREADY_SWIPED');
}

export async function passProfile(input: PassProfileInput): Promise<PassProfileResult> {
  const targetUserId = parseTargetUserId(input.targetUserId);
  if (targetUserId === input.callerId.toLowerCase()) {
    throw new ValidationError('You cannot pass your own profile.', [], 'SELF_INTERACTION');
  }

  if (!input.isVerified) {
    await rejectUnverified(input.callerId);
  }

  const context = await findViewerDiscoveryContext(input.callerId);
  if (!context || !context.isProfileComplete || !context.hasLocation || !context.hasDatingPreferences) {
    throw incomplete();
  }

  try {
    return await sequelize.transaction(async (transaction) => {
      const target = await findPassTarget(input.callerId, targetUserId, transaction);
      assertTarget(target);

      const premium = await hasActivePremium(input.callerId, transaction);
      let remainingDailyActions: number | null = null;
      if (!premium) {
        const usageCount = await incrementDailyLikePass(input.callerId, transaction);
        if (usageCount === null) {
          throw new RateLimitError(DAILY_LIMIT_MESSAGE, [], 'DAILY_LIMIT_REACHED');
        }
        remainingDailyActions = FREE_DAILY_LIKE_PASS_LIMIT - usageCount;
      }

      try {
        await insertPass(input.callerId, targetUserId, transaction);
      } catch (error) {
        if (isActivePairConflict(error)) {
          throw alreadySwiped();
        }
        throw error;
      }

      return {
        action: 'PASS',
        targetUserId,
        remainingDailyActions
      };
    });
  } catch (error) {
    if (isActivePairConflict(error)) {
      throw alreadySwiped();
    }
    throw error;
  }
}
