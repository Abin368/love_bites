import { sequelize } from '../../config/database';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
import { lockConversationById, lockMatchById } from '../chat/chat.data-access';
import { closeActiveConversation, lockLikeUsers } from '../likes/likes.data-access';
import { findUserById } from '../users/users.data-access';
import {
  deleteOutgoingBlock,
  findActiveMatchForPair,
  findConversationForMatch,
  findMatchStatusById,
  findOutgoingBlock,
  insertBlock,
  isBlockPairConflict,
  listOutgoingBlocks,
  unmatchActivePairMatch
} from './blocks.data-access';
import type {
  BlockListItem,
  BlockUserInput,
  BlockUserResult,
  UnblockUserInput,
  UnblockUserResult
} from './blocks.types';
import { parseTargetUserId } from './blocks.validator';

const SELF_BLOCK_MESSAGE = 'You cannot block your own profile.';
const TARGET_NOT_FOUND_MESSAGE = 'Target user profile not found.';
const ALREADY_BLOCKED_MESSAGE = 'User is already blocked.';
const BLOCK_NOT_FOUND_MESSAGE = 'Resource not found.';

function alreadyBlocked(): ConflictError {
  return new ConflictError(ALREADY_BLOCKED_MESSAGE, [], 'CONFLICT');
}

function blockNotFound(): NotFoundError {
  return new NotFoundError(BLOCK_NOT_FOUND_MESSAGE, [], 'RESOURCE_NOT_FOUND');
}

async function assertBlockTarget(targetUserId: string): Promise<void> {
  const target = await findUserById(targetUserId);
  if (!target || target.status === 'DELETED' || target.deletedAt) {
    throw new NotFoundError(TARGET_NOT_FOUND_MESSAGE, [], 'USER_NOT_FOUND');
  }
}

export async function blockUser(input: BlockUserInput): Promise<BlockUserResult> {
  const targetUserId = parseTargetUserId(input.targetUserId);
  const callerId = input.callerId.toLowerCase();

  if (callerId === targetUserId) {
    throw new ValidationError(SELF_BLOCK_MESSAGE, [], 'SELF_INTERACTION');
  }

  await assertBlockTarget(targetUserId);

  try {
    return await sequelize.transaction(async (transaction) => {
      await lockLikeUsers(callerId, targetUserId, transaction);

      const activeMatch = await findActiveMatchForPair(callerId, targetUserId, transaction);
      if (activeMatch) {
        await lockMatchById(activeMatch.id, transaction);
        const conversation = await findConversationForMatch(activeMatch.id, transaction);
        if (conversation) {
          await lockConversationById(conversation.id, transaction);
        }
      }

      const match = activeMatch ? await findMatchStatusById(activeMatch.id, transaction) : null;
      const conversation = match ? await findConversationForMatch(match.id, transaction) : null;

      if (await findOutgoingBlock(callerId, targetUserId, transaction)) {
        throw alreadyBlocked();
      }

      try {
        await insertBlock(callerId, targetUserId, transaction);
      } catch (error) {
        if (isBlockPairConflict(error)) {
          throw alreadyBlocked();
        }
        throw error;
      }

      let unmatchedMatchId: string | null = null;
      if (match?.status === 'ACTIVE') {
        unmatchedMatchId = await unmatchActivePairMatch(match.id, callerId, transaction);
      }

      if (unmatchedMatchId && conversation?.status === 'ACTIVE') {
        await closeActiveConversation(unmatchedMatchId, transaction);
      }

      return {
        targetUserId,
        unmatchEvent:
          unmatchedMatchId && conversation
            ? {
                matchId: unmatchedMatchId,
                conversationId: conversation.id,
                recipientId: targetUserId
              }
            : null
      };
    });
  } catch (error) {
    if (isBlockPairConflict(error)) {
      throw alreadyBlocked();
    }
    throw error;
  }
}

export async function listBlocks(callerId: string): Promise<BlockListItem[]> {
  const rows = await listOutgoingBlocks(callerId.toLowerCase());
  return rows.map((row) => ({
    userId: row.blockedId,
    createdAt: row.createdAt
  }));
}

export async function unblockUser(input: UnblockUserInput): Promise<UnblockUserResult> {
  const targetUserId = parseTargetUserId(input.targetUserId);
  const callerId = input.callerId.toLowerCase();

  const removed = await sequelize.transaction(async (transaction) => {
    return deleteOutgoingBlock(callerId, targetUserId, transaction);
  });
  if (!removed) {
    throw blockNotFound();
  }

  return { blocked: false, targetUserId };
}
