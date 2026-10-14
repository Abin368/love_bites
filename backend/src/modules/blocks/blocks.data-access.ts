import { QueryTypes, Transaction, UniqueConstraintError } from 'sequelize';
import { sequelize } from '../../config/database';
import '../../database/associations';
import { Block } from '../../database/models/block.model';

export interface PairMatchRow {
  id: string;
  status: string;
}

export interface PairConversationRow {
  id: string;
  status: string;
}

const ACTIVE_PAIR_MATCH_SQL = `
SELECT id, status
FROM matches
WHERE status = 'ACTIVE'
  AND user_one_id = LEAST(CAST(:callerId AS uuid), CAST(:targetUserId AS uuid))
  AND user_two_id = GREATEST(CAST(:callerId AS uuid), CAST(:targetUserId AS uuid))
LIMIT 1
`;

const MATCH_BY_ID_SQL = `
SELECT id, status
FROM matches
WHERE id = CAST(:matchId AS uuid)
LIMIT 1
`;

const CONVERSATION_BY_MATCH_SQL = `
SELECT id, status
FROM conversations
WHERE match_id = CAST(:matchId AS uuid)
LIMIT 1
`;

const UNMATCH_ACTIVE_PAIR_SQL = `
UPDATE matches
SET
  status = 'UNMATCHED',
  unmatched_at = CURRENT_TIMESTAMP,
  unmatched_by_user_id = CAST(:callerId AS uuid),
  updated_at = CURRENT_TIMESTAMP
WHERE id = CAST(:matchId AS uuid)
  AND status = 'ACTIVE'
RETURNING id
`;

export function isBlockPairConflict(error: unknown): boolean {
  if (!(error instanceof UniqueConstraintError)) {
    return false;
  }

  const parent = error.parent as { constraint?: string; detail?: string } | undefined;
  if (parent?.constraint === 'uq_blocks_pair') {
    return true;
  }

  return `${parent?.detail ?? ''} ${error.message}`.includes('uq_blocks_pair');
}

export async function findOutgoingBlock(
  callerId: string,
  targetUserId: string,
  transaction: Transaction
): Promise<boolean> {
  const row = await Block.findOne({
    where: { blockerId: callerId, blockedId: targetUserId },
    attributes: ['id'],
    transaction
  });
  return row !== null;
}

export async function insertBlock(
  callerId: string,
  targetUserId: string,
  transaction: Transaction
): Promise<void> {
  await Block.create(
    {
      blockerId: callerId,
      blockedId: targetUserId,
      reason: null,
      createdAt: new Date()
    },
    { transaction }
  );
}

export async function listOutgoingBlocks(callerId: string): Promise<Block[]> {
  return Block.findAll({
    where: { blockerId: callerId },
    attributes: ['id', 'blockedId', 'createdAt'],
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC']
    ]
  });
}

export async function deleteOutgoingBlock(
  callerId: string,
  targetUserId: string,
  transaction: Transaction
): Promise<boolean> {
  const deleted = await Block.destroy({
    where: { blockerId: callerId, blockedId: targetUserId },
    transaction
  });
  return deleted === 1;
}

export async function findActiveMatchForPair(
  callerId: string,
  targetUserId: string,
  transaction: Transaction
): Promise<PairMatchRow | null> {
  const rows = await sequelize.query<PairMatchRow>(ACTIVE_PAIR_MATCH_SQL, {
    replacements: { callerId, targetUserId },
    type: QueryTypes.SELECT,
    transaction
  });
  return rows[0] ?? null;
}

export async function findMatchStatusById(
  matchId: string,
  transaction: Transaction
): Promise<PairMatchRow | null> {
  const rows = await sequelize.query<PairMatchRow>(MATCH_BY_ID_SQL, {
    replacements: { matchId },
    type: QueryTypes.SELECT,
    transaction
  });
  return rows[0] ?? null;
}

export async function findConversationForMatch(
  matchId: string,
  transaction: Transaction
): Promise<PairConversationRow | null> {
  const rows = await sequelize.query<PairConversationRow>(CONVERSATION_BY_MATCH_SQL, {
    replacements: { matchId },
    type: QueryTypes.SELECT,
    transaction
  });
  return rows[0] ?? null;
}

export async function unmatchActivePairMatch(
  matchId: string,
  callerId: string,
  transaction: Transaction
): Promise<string | null> {
  const rows = await sequelize.query<{ id: string }>(UNMATCH_ACTIVE_PAIR_SQL, {
    replacements: { matchId, callerId },
    type: QueryTypes.SELECT,
    transaction
  });
  return rows[0]?.id ?? null;
}
