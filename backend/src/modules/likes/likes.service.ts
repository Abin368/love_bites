import { z } from 'zod';
import { sequelize } from '../../config/database';
import { redis } from '../../config/redis';
import { findViewerDiscoveryContext } from '../discovery/discovery.data-access';
import { findUserById } from '../users/users.data-access';
import { ConflictError, ForbiddenError, NotFoundError, RateLimitError, UnauthorizedError, ValidationError } from '../../utils/errors';
import {
  consumeSuperLikeCredit,
  findPassTarget,
  FREE_DAILY_LIKE_PASS_LIMIT,
  hasActivePremium,
  hasReciprocalLike,
  incrementDailyLikePass,
  insertActiveConversation,
  insertActiveMatch,
  insertLike,
  insertPass,
  insertSuperLike,
  insertSuperLikeCreditTransaction,
  isActiveMatchConflict,
  isActivePairConflict,
  lockLikeUsers,
  closeActiveConversation,
  findLatestUndoableAction,
  findMatchById,
  markUndoableAction,
  undoActiveMatch,
  unmatchActiveMatch
} from './likes.data-access';
import type {
  LikeProfileInput,
  LikeProfileResponse,
  PassProfileInput,
  PassProfileResult,
  PassTargetState,
  SuperLikeProfileInput,
  SuperLikeProfileResponse,
  UndoProfileInput,
  UndoProfileResult,
  UnmatchInput,
  UnmatchResult
} from './likes.types';
import { matchIdSchema, targetUserIdSchema } from './likes.validator';

const DAILY_LIMIT_MESSAGE = 'You have reached your daily limit of 10 likes/passes.';
const LIKE_MESSAGE = 'Profile liked.';
const SUPER_LIKE_MESSAGE = 'Profile super liked.';
const MATCH_MESSAGE = "It's a Match!";
const PREMIUM_REQUIRED_MESSAGE = 'Feature requires an active Premium subscription.';
const NO_UNDOABLE_ACTION_MESSAGE = 'There is no action to undo.';
const UNDO_WINDOW_EXPIRED_MESSAGE = 'The undo window for your last action has expired.';
const INSUFFICIENT_SUPER_LIKE_CREDITS_MESSAGE = 'You do not have any Super Like credits.';
const MATCH_NOT_FOUND_MESSAGE = 'Active match record does not exist.';
const IDEMPOTENCY_TTL_SECONDS = 120;
const IDEMPOTENCY_PENDING = 'pending';

function parseMatchId(matchId: string): string {
  const parsed = matchIdSchema.safeParse(matchId);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', [
      { field: 'matchId', message: 'Match id must be a valid UUID.' }
    ]);
  }

  return parsed.data.toLowerCase();
}

function participates(userOneId: string, userTwoId: string, callerId: string): boolean {
  const caller = callerId.toLowerCase();
  return userOneId.toLowerCase() === caller || userTwoId.toLowerCase() === caller;
}

function matchNotFound(): NotFoundError {
  return new NotFoundError(MATCH_NOT_FOUND_MESSAGE, [], 'MATCH_NOT_FOUND');
}

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

function assertTarget(target: PassTargetState | null, invalidTargetMessage = 'This profile cannot be passed.'): void {
  if (!target || target.deleted) {
    throw new NotFoundError('Target user profile not found.', [], 'USER_NOT_FOUND');
  }

  if (target.status !== 'ACTIVE' || !target.profileComplete || !target.hasPrimaryPhoto) {
    throw new NotFoundError(invalidTargetMessage, [], 'INVALID_TARGET');
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

function activeMatchExists(): ConflictError {
  return new ConflictError('Users are already in an active mutual match.', [], 'ACTIVE_MATCH_EXISTS');
}

function idempotencyConflict(): ConflictError {
  return new ConflictError('A request with this Idempotency-Key is already in progress.', [], 'IDEMPOTENCY_CONFLICT');
}

function idempotencyRedisKey(callerId: string, idempotencyKey: string): string {
  return `idempotency:${callerId}:${idempotencyKey}`;
}

function superLikeIdempotencyRedisKey(callerId: string, idempotencyKey: string): string {
  return `idempotency:${callerId}:super-like:${idempotencyKey}`;
}

function parseIdempotencyKey(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', [
      { field: 'Idempotency-Key', message: 'Idempotency-Key must be a valid UUID.' }
    ]);
  }

  return parsed.data.toLowerCase();
}

function readStoredLike(raw: string): LikeProfileResponse | null {
  try {
    const parsed = JSON.parse(raw) as LikeProfileResponse;
    if (parsed?.success === true && parsed.data?.action === 'LIKE' && typeof parsed.message === 'string') {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

async function readIdempotentLike(callerId: string, idempotencyKey: string): Promise<LikeProfileResponse | 'conflict' | null> {
  const raw = await redis.get(idempotencyRedisKey(callerId, idempotencyKey));
  if (raw === null) {
    return null;
  }

  return readStoredLike(raw) ?? 'conflict';
}

function readStoredSuperLike(raw: string): SuperLikeProfileResponse | null {
  try {
    const parsed = JSON.parse(raw) as SuperLikeProfileResponse;
    if (
      parsed?.success === true &&
      parsed.data?.action === 'SUPER_LIKE' &&
      typeof parsed.data.remainingSuperLikeCredits === 'number' &&
      typeof parsed.message === 'string'
    ) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

async function readIdempotentSuperLike(
  callerId: string,
  idempotencyKey: string
): Promise<SuperLikeProfileResponse | 'conflict' | null> {
  const raw = await redis.get(superLikeIdempotencyRedisKey(callerId, idempotencyKey));
  if (raw === null) {
    return null;
  }

  return readStoredSuperLike(raw) ?? 'conflict';
}

function rethrowLikeConstraint(error: unknown): never {
  if (isActiveMatchConflict(error)) {
    throw activeMatchExists();
  }
  if (isActivePairConflict(error)) {
    throw alreadySwiped();
  }
  throw error;
}

async function runLikeTransaction(callerId: string, targetUserId: string): Promise<LikeProfileResponse> {
  try {
    return await sequelize.transaction(async (transaction) => {
      await lockLikeUsers(callerId, targetUserId, transaction);
      const target = await findPassTarget(callerId, targetUserId, transaction);
      assertTarget(target, 'This profile cannot be liked.');

      const reciprocal = await hasReciprocalLike(callerId, targetUserId, transaction);
      try {
        await insertLike(callerId, targetUserId, transaction);
      } catch (error) {
        rethrowLikeConstraint(error);
      }

      let matchId: string | null = null;
      if (reciprocal) {
        try {
          matchId = await insertActiveMatch(callerId, targetUserId, transaction);
          await insertActiveConversation(matchId, transaction);
        } catch (error) {
          rethrowLikeConstraint(error);
        }
      }

      const premium = await hasActivePremium(callerId, transaction);
      let remainingDailyActions: number | null = null;
      if (!premium) {
        const usageCount = await incrementDailyLikePass(callerId, transaction);
        if (usageCount === null) {
          throw new RateLimitError(DAILY_LIMIT_MESSAGE, [], 'DAILY_LIMIT_REACHED');
        }
        remainingDailyActions = FREE_DAILY_LIKE_PASS_LIMIT - usageCount;
      }

      return {
        success: true,
        data: {
          action: 'LIKE',
          targetUserId,
          isMatch: matchId !== null,
          matchId,
          remainingDailyActions
        },
        message: matchId !== null ? MATCH_MESSAGE : LIKE_MESSAGE
      };
    });
  } catch (error) {
    rethrowLikeConstraint(error);
  }
}

export async function likeProfile(input: LikeProfileInput): Promise<LikeProfileResponse> {
  const idempotencyKey = parseIdempotencyKey(input.idempotencyKey);
  if (idempotencyKey) {
    const existing = await readIdempotentLike(input.callerId, idempotencyKey);
    if (existing === 'conflict') {
      throw idempotencyConflict();
    }
    if (existing) {
      return existing;
    }
  }

  const targetUserId = parseTargetUserId(input.targetUserId);
  if (targetUserId === input.callerId.toLowerCase()) {
    throw new ValidationError('You cannot like your own profile.', [], 'SELF_INTERACTION');
  }

  if (!input.isVerified) {
    await rejectUnverified(input.callerId);
  }

  const context = await findViewerDiscoveryContext(input.callerId);
  if (!context || !context.isProfileComplete || !context.hasLocation || !context.hasDatingPreferences) {
    throw incomplete();
  }

  if (idempotencyKey) {
    const locked = await redis.set(
      idempotencyRedisKey(input.callerId, idempotencyKey),
      IDEMPOTENCY_PENDING,
      'EX',
      IDEMPOTENCY_TTL_SECONDS,
      'NX'
    );
    if (locked !== 'OK') {
      const existing = await readIdempotentLike(input.callerId, idempotencyKey);
      if (existing && existing !== 'conflict') {
        return existing;
      }
      throw idempotencyConflict();
    }
  }

  let response: LikeProfileResponse;
  try {
    response = await runLikeTransaction(input.callerId, targetUserId);
  } catch (error) {
    if (idempotencyKey) {
      try {
        await redis.del(idempotencyRedisKey(input.callerId, idempotencyKey));
      } catch {
        // The original transaction error is the client response.
      }
    }
    throw error;
  }

  if (idempotencyKey) {
    await redis.set(
      idempotencyRedisKey(input.callerId, idempotencyKey),
      JSON.stringify(response),
      'EX',
      IDEMPOTENCY_TTL_SECONDS
    );
  }

  return response;
}

async function runSuperLikeTransaction(callerId: string, targetUserId: string): Promise<SuperLikeProfileResponse> {
  try {
    return await sequelize.transaction(async (transaction) => {
      await lockLikeUsers(callerId, targetUserId, transaction);
      const target = await findPassTarget(callerId, targetUserId, transaction);
      assertTarget(target, 'This profile cannot be super liked.');

      const premium = await hasActivePremium(callerId, transaction);
      if (!premium) {
        throw new ForbiddenError(PREMIUM_REQUIRED_MESSAGE, [], 'PREMIUM_REQUIRED');
      }

      const remainingSuperLikeCredits = await consumeSuperLikeCredit(callerId, transaction);
      if (remainingSuperLikeCredits === null) {
        throw new ConflictError(INSUFFICIENT_SUPER_LIKE_CREDITS_MESSAGE, [], 'INSUFFICIENT_SUPER_LIKE_CREDITS');
      }

      let likeId: string;
      try {
        likeId = await insertSuperLike(callerId, targetUserId, transaction);
      } catch (error) {
        rethrowLikeConstraint(error);
      }

      const reciprocal = await hasReciprocalLike(callerId, targetUserId, transaction);
      let matchId: string | null = null;
      if (reciprocal) {
        try {
          matchId = await insertActiveMatch(callerId, targetUserId, transaction);
          await insertActiveConversation(matchId, transaction);
        } catch (error) {
          rethrowLikeConstraint(error);
        }
      }

      await insertSuperLikeCreditTransaction(callerId, likeId, transaction);

      return {
        success: true,
        data: {
          action: 'SUPER_LIKE',
          targetUserId,
          isMatch: matchId !== null,
          matchId,
          remainingSuperLikeCredits
        },
        message: matchId !== null ? MATCH_MESSAGE : SUPER_LIKE_MESSAGE
      };
    });
  } catch (error) {
    rethrowLikeConstraint(error);
  }
}

export async function superLikeProfile(input: SuperLikeProfileInput): Promise<SuperLikeProfileResponse> {
  const idempotencyKey = parseIdempotencyKey(input.idempotencyKey);
  if (idempotencyKey) {
    const existing = await readIdempotentSuperLike(input.callerId, idempotencyKey);
    if (existing === 'conflict') {
      throw idempotencyConflict();
    }
    if (existing) {
      return existing;
    }
  }

  const targetUserId = parseTargetUserId(input.targetUserId);
  if (targetUserId === input.callerId.toLowerCase()) {
    throw new ValidationError('You cannot super like your own profile.', [], 'SELF_INTERACTION');
  }

  if (!input.isVerified) {
    await rejectUnverified(input.callerId);
  }

  const context = await findViewerDiscoveryContext(input.callerId);
  if (!context || !context.isProfileComplete || !context.hasLocation || !context.hasDatingPreferences) {
    throw incomplete();
  }

  if (idempotencyKey) {
    const locked = await redis.set(
      superLikeIdempotencyRedisKey(input.callerId, idempotencyKey),
      IDEMPOTENCY_PENDING,
      'EX',
      IDEMPOTENCY_TTL_SECONDS,
      'NX'
    );
    if (locked !== 'OK') {
      const existing = await readIdempotentSuperLike(input.callerId, idempotencyKey);
      if (existing && existing !== 'conflict') {
        return existing;
      }
      throw idempotencyConflict();
    }
  }

  let response: SuperLikeProfileResponse;
  try {
    response = await runSuperLikeTransaction(input.callerId, targetUserId);
  } catch (error) {
    if (idempotencyKey) {
      try {
        await redis.del(superLikeIdempotencyRedisKey(input.callerId, idempotencyKey));
      } catch {
        // The original transaction error is the client response.
      }
    }
    throw error;
  }

  if (idempotencyKey) {
    await redis.set(
      superLikeIdempotencyRedisKey(input.callerId, idempotencyKey),
      JSON.stringify(response),
      'EX',
      IDEMPOTENCY_TTL_SECONDS
    );
  }

  return response;
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

function noUndoableAction(): ValidationError {
  return new ValidationError(NO_UNDOABLE_ACTION_MESSAGE, [], 'NO_UNDOABLE_ACTION');
}

function undoWindowExpired(): ValidationError {
  return new ValidationError(UNDO_WINDOW_EXPIRED_MESSAGE, [], 'UNDO_WINDOW_EXPIRED');
}

export async function undoLastAction(input: UndoProfileInput): Promise<UndoProfileResult> {
  if (!input.isVerified) {
    await rejectUnverified(input.callerId);
  }

  const context = await findViewerDiscoveryContext(input.callerId);
  if (!context || !context.isProfileComplete || !context.hasLocation || !context.hasDatingPreferences) {
    throw incomplete();
  }

  return sequelize.transaction(async (transaction) => {
    const premium = await hasActivePremium(input.callerId, transaction);
    if (!premium) {
      throw new ForbiddenError(PREMIUM_REQUIRED_MESSAGE, [], 'PREMIUM_REQUIRED');
    }

    const selected = await findLatestUndoableAction(input.callerId, transaction);
    if (!selected) {
      throw noUndoableAction();
    }
    if (!selected.withinWindow) {
      throw undoWindowExpired();
    }

    await lockLikeUsers(input.callerId, selected.toUserId, transaction);
    const current = await findLatestUndoableAction(input.callerId, transaction, true);
    if (!current || current.id !== selected.id) {
      throw noUndoableAction();
    }
    if (!current.withinWindow) {
      throw undoWindowExpired();
    }

    const marked = await markUndoableAction(current.id, transaction);
    if (!marked) {
      throw noUndoableAction();
    }

    let revertedMatch = false;
    if (current.action === 'LIKE') {
      const matchId = await undoActiveMatch(input.callerId, current.toUserId, transaction);
      if (matchId) {
        await closeActiveConversation(matchId, transaction);
        revertedMatch = true;
      }
    }

    return {
      undoneAction: current.action,
      targetUserId: current.toUserId,
      revertedMatch
    };
  });
}

export async function 
unmatch(input: UnmatchInput): Promise<UnmatchResult> {
  const matchId = parseMatchId(input.matchId);

  if (!input.isVerified) {
    await rejectUnverified(input.callerId);
  }

  const context = await findViewerDiscoveryContext(input.callerId);
  if (!context || !context.isProfileComplete || !context.hasLocation || !context.hasDatingPreferences) {
    throw incomplete();
  }

  return sequelize.transaction(async (transaction) => {
    const loaded = await findMatchById(matchId, transaction);
    if (!loaded || !participates(loaded.userOneId, loaded.userTwoId, input.callerId) || loaded.status !== 'ACTIVE') {
      throw matchNotFound();
    }

    await lockLikeUsers(loaded.userOneId, loaded.userTwoId, transaction);
    const locked = await findMatchById(matchId, transaction, true);
    if (!locked || !participates(locked.userOneId, locked.userTwoId, input.callerId) || locked.status !== 'ACTIVE') {
      throw matchNotFound();
    }

    const updatedId = await unmatchActiveMatch(matchId, input.callerId, transaction);
    if (!updatedId) {
      throw matchNotFound();
    }

    await closeActiveConversation(matchId, transaction);
    return { unmatched: true };
  });
}
