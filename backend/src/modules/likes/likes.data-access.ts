import { Op, QueryTypes, Transaction, UniqueConstraintError } from 'sequelize';
import { sequelize } from '../../config/database';
import '../../database/associations';
import { Conversation } from '../../database/models/conversation.model';
import { CreditTransaction } from '../../database/models/credit-transaction.model';
import { Like } from '../../database/models/like.model';
import { Match } from '../../database/models/match.model';
import { Plan } from '../../database/models/plan.model';
import { Subscription } from '../../database/models/subscription.model';
import type { PassTargetState, UtcDayWindow } from './likes.types';

export const DAILY_LIKE_PASS_METRIC = 'DAILY_LIKE_PASS';
export const FREE_DAILY_LIKE_PASS_LIMIT = 10;

const PREMIUM_PLAN_CODES = ['PREMIUM_MONTHLY', 'PREMIUM_YEARLY'] as const;
const PREMIUM_STATUSES = ['ACTIVE', 'PAST_DUE', 'GRACE_PERIOD'] as const;

interface PassTargetRow {
  status: string;
  deleted: boolean | string;
  profileComplete: boolean | string;
  hasPrimaryPhoto: boolean | string;
  blocked: boolean | string;
  alreadySwiped: boolean | string;
  activeMatch: boolean | string;
}

interface UsageCountRow {
  usageCount: number | string;
}

interface CreditBalanceRow {
  balance: number | string;
}

interface CanonicalPairRow {
  userOneId: string;
  userTwoId: string;
}

const INCREMENT_DAILY_LIKE_PASS_SQL = `
INSERT INTO usage_records (
  id,
  user_id,
  metric_key,
  period_start,
  period_end,
  usage_count
)
VALUES (
  gen_random_uuid(),
  CAST(:userId AS uuid),
  :metricKey,
  :periodStart,
  :periodEnd,
  1
)
ON CONFLICT (user_id, metric_key, period_start)
DO UPDATE SET
  usage_count = usage_records.usage_count + 1,
  updated_at = CURRENT_TIMESTAMP
WHERE usage_records.usage_count < :limit
RETURNING usage_count AS "usageCount"
`;

const CONSUME_SUPER_LIKE_CREDIT_SQL = `
UPDATE user_credit_balances
SET
  balance = balance - 1,
  updated_at = CURRENT_TIMESTAMP
WHERE user_id = CAST(:userId AS uuid)
  AND credit_type = 'SUPER_LIKE'
  AND balance >= 1
RETURNING balance
`;

const PASS_TARGET_SQL = `
SELECT
  u.status AS "status",
  (u.deleted_at IS NOT NULL OR u.status = 'DELETED') AS "deleted",
  COALESCE(p.is_profile_complete, FALSE) AS "profileComplete",
  EXISTS (
    SELECT 1
    FROM profile_photos ph
    WHERE ph.user_id = u.id
      AND ph.is_primary = TRUE
      AND ph.deleted_at IS NULL
  ) AS "hasPrimaryPhoto",
  EXISTS (
    SELECT 1
    FROM blocks b
    WHERE (b.blocker_id = CAST(:callerId AS uuid) AND b.blocked_id = u.id)
       OR (b.blocker_id = u.id AND b.blocked_id = CAST(:callerId AS uuid))
  ) AS "blocked",
  EXISTS (
    SELECT 1
    FROM likes l
    WHERE l.from_user_id = CAST(:callerId AS uuid)
      AND l.to_user_id = u.id
      AND l.is_undone = FALSE
  ) AS "alreadySwiped",
  EXISTS (
    SELECT 1
    FROM matches m
    WHERE m.status = 'ACTIVE'
      AND m.user_one_id = LEAST(CAST(:callerId AS uuid), u.id)
      AND m.user_two_id = GREATEST(CAST(:callerId AS uuid), u.id)
  ) AS "activeMatch"
FROM users u
LEFT JOIN profiles p ON p.user_id = u.id
WHERE u.id = CAST(:targetUserId AS uuid)
LIMIT 1
`;

function flag(value: boolean | string): boolean {
  return value === true || value === 't' || value === 'true';
}

export function currentUtcDayWindow(now = new Date()): UtcDayWindow {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const periodEnd = new Date(periodStart.getTime() + 24 * 60 * 60 * 1000);
  return { periodStart, periodEnd };
}

export function isActivePairConflict(error: unknown): boolean {
  if (!(error instanceof UniqueConstraintError)) {
    return false;
  }

  const parent = error.parent as { constraint?: string } | undefined;
  return parent?.constraint === undefined || parent.constraint === 'uq_likes_active_pair';
}

export function isActiveMatchConflict(error: unknown): boolean {
  if (!(error instanceof UniqueConstraintError)) {
    return false;
  }

  const parent = error.parent as { constraint?: string; detail?: string } | undefined;
  if (parent?.constraint === 'uq_matches_single_active_pair') {
    return true;
  }

  return `${parent?.detail ?? ''} ${error.message}`.includes('uq_matches_single_active_pair');
}

export async function findPassTarget(
  callerId: string,
  targetUserId: string,
  transaction: Transaction
): Promise<PassTargetState | null> {
  const rows = await sequelize.query<PassTargetRow>(PASS_TARGET_SQL, {
    replacements: { callerId, targetUserId },
    type: QueryTypes.SELECT,
    transaction
  });
  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    status: row.status,
    deleted: flag(row.deleted),
    profileComplete: flag(row.profileComplete),
    hasPrimaryPhoto: flag(row.hasPrimaryPhoto),
    blocked: flag(row.blocked),
    alreadySwiped: flag(row.alreadySwiped),
    activeMatch: flag(row.activeMatch)
  };
}

export async function hasActivePremium(userId: string, transaction: Transaction): Promise<boolean> {
  const now = new Date();
  const subscription = await Subscription.findOne({
    attributes: ['id'],
    where: {
      userId,
      status: { [Op.in]: [...PREMIUM_STATUSES] },
      [Op.or]: [{ currentPeriodEnd: { [Op.gt]: now } }, { gracePeriodEnd: { [Op.gt]: now } }]
    },
    include: [
      {
        model: Plan,
        as: 'plan',
        attributes: ['id'],
        required: true,
        where: { code: { [Op.in]: [...PREMIUM_PLAN_CODES] } }
      }
    ],
    transaction
  });

  return subscription !== null;
}

export async function incrementDailyLikePass(userId: string, transaction: Transaction): Promise<number | null> {
  const { periodStart, periodEnd } = currentUtcDayWindow();
  const rows = await sequelize.query<UsageCountRow>(INCREMENT_DAILY_LIKE_PASS_SQL, {
    replacements: {
      userId,
      metricKey: DAILY_LIKE_PASS_METRIC,
      periodStart,
      periodEnd,
      limit: FREE_DAILY_LIKE_PASS_LIMIT
    },
    type: QueryTypes.SELECT,
    transaction
  });
  const usageCount = rows[0]?.usageCount;
  if (usageCount === undefined) {
    return null;
  }

  return Number(usageCount);
}

export async function insertPass(fromUserId: string, toUserId: string, transaction: Transaction): Promise<void> {
  const now = new Date();
  await Like.create(
    {
      fromUserId,
      toUserId,
      action: 'PASS',
      isUndone: false,
      createdAt: now,
      updatedAt: now
    },
    { transaction }
  );
}

export async function lockLikeUsers(callerId: string, targetUserId: string, transaction: Transaction): Promise<void> {
  await sequelize.query(
    `SELECT id
     FROM users
     WHERE id IN (CAST(:callerId AS uuid), CAST(:targetUserId AS uuid))
     ORDER BY id
     FOR UPDATE`,
    {
      replacements: { callerId, targetUserId },
      type: QueryTypes.SELECT,
      transaction
    }
  );
}

export async function hasReciprocalLike(
  callerId: string,
  targetUserId: string,
  transaction: Transaction
): Promise<boolean> {
  const rows = await sequelize.query(
    `SELECT 1 AS "found"
     FROM likes
     WHERE from_user_id = CAST(:targetUserId AS uuid)
       AND to_user_id = CAST(:callerId AS uuid)
       AND is_undone = FALSE
       AND action IN ('LIKE', 'SUPER_LIKE')
     LIMIT 1`,
    {
      replacements: { callerId, targetUserId },
      type: QueryTypes.SELECT,
      transaction
    }
  );

  return rows.length > 0;
}

export async function consumeSuperLikeCredit(userId: string, transaction: Transaction): Promise<number | null> {
  const rows = await sequelize.query<CreditBalanceRow>(CONSUME_SUPER_LIKE_CREDIT_SQL, {
    replacements: { userId },
    type: QueryTypes.SELECT,
    transaction
  });
  const balance = rows[0]?.balance;
  if (balance === undefined) {
    return null;
  }

  return Number(balance);
}

export async function insertSuperLike(
  fromUserId: string,
  toUserId: string,
  transaction: Transaction
): Promise<string> {
  const now = new Date();
  const like = await Like.create(
    {
      fromUserId,
      toUserId,
      action: 'SUPER_LIKE',
      isUndone: false,
      createdAt: now,
      updatedAt: now
    },
    { transaction }
  );

  return like.id;
}

export async function insertSuperLikeCreditTransaction(
  userId: string,
  likeId: string,
  transaction: Transaction
): Promise<void> {
  await CreditTransaction.create(
    {
      userId,
      creditType: 'SUPER_LIKE',
      delta: -1,
      reason: 'CONSUMPTION',
      referenceId: likeId,
      createdAt: new Date()
    },
    { transaction }
  );
}

export async function insertLike(fromUserId: string, toUserId: string, transaction: Transaction): Promise<void> {
  const now = new Date();
  await Like.create(
    {
      fromUserId,
      toUserId,
      action: 'LIKE',
      isUndone: false,
      createdAt: now,
      updatedAt: now
    },
    { transaction }
  );
}

export async function insertActiveMatch(
  callerId: string,
  targetUserId: string,
  transaction: Transaction
): Promise<string> {
  const rows = await sequelize.query<CanonicalPairRow>(
    `SELECT
       LEAST(CAST(:callerId AS uuid), CAST(:targetUserId AS uuid)) AS "userOneId",
       GREATEST(CAST(:callerId AS uuid), CAST(:targetUserId AS uuid)) AS "userTwoId"`,
    {
      replacements: { callerId, targetUserId },
      type: QueryTypes.SELECT,
      transaction
    }
  );
  const pair = rows[0];
  if (!pair) {
    throw new Error('Canonical match pair could not be resolved.');
  }
  const now = new Date();
  const match = await Match.create(
    {
      userOneId: pair.userOneId,
      userTwoId: pair.userTwoId,
      status: 'ACTIVE',
      matchedAt: now,
      unmatchedAt: null,
      unmatchedByUserId: null,
      createdAt: now,
      updatedAt: now
    },
    { transaction }
  );

  return match.id;
}

export async function insertActiveConversation(matchId: string, transaction: Transaction): Promise<void> {
  const now = new Date();
  await Conversation.create(
    {
      matchId,
      status: 'ACTIVE',
      lastMessageAt: null,
      closedAt: null,
      createdAt: now,
      updatedAt: now
    },
    { transaction }
  );
}
