import { QueryTypes, Transaction, UniqueConstraintError } from 'sequelize';
import { sequelize } from '../../config/database';
import '../../database/associations';
import { Conversation } from '../../database/models/conversation.model';
import { CreditTransaction } from '../../database/models/credit-transaction.model';
import { Like } from '../../database/models/like.model';
import { Match } from '../../database/models/match.model';
import { findQualifyingPremiumSubscription } from '../subscriptions/subscriptions.data-access';
import type { PassTargetState, UtcDayWindow } from './likes.types';

export const DAILY_LIKE_PASS_METRIC = 'DAILY_LIKE_PASS';
export const FREE_DAILY_LIKE_PASS_LIMIT = 10;
export const DAILY_TEXT_MESSAGES_METRIC = 'DAILY_TEXT_MESSAGES';
export const FREE_DAILY_TEXT_MESSAGES_LIMIT = 20;

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

const INCREMENT_DAILY_USAGE_SQL = `
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

export interface QualifyingPremiumPlan {
  id: string;
  code: string;
}

export async function findQualifyingPremiumPlan(
  userId: string,
  transaction: Transaction
): Promise<QualifyingPremiumPlan | null> {
  const row = await findQualifyingPremiumSubscription(userId, transaction);
  if (!row?.plan) {
    return null;
  }

  return { id: row.plan.id, code: row.plan.code };
}

export async function hasActivePremium(userId: string, transaction: Transaction): Promise<boolean> {
  const plan = await findQualifyingPremiumPlan(userId, transaction);
  return plan !== null;
}

async function incrementDailyUsage(
  userId: string,
  metricKey: string,
  limit: number,
  transaction: Transaction
): Promise<number | null> {
  const { periodStart, periodEnd } = currentUtcDayWindow();
  const rows = await sequelize.query<UsageCountRow>(INCREMENT_DAILY_USAGE_SQL, {
    replacements: {
      userId,
      metricKey,
      periodStart,
      periodEnd,
      limit
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

export async function incrementDailyLikePass(
  userId: string,
  transaction: Transaction,
  limit: number
): Promise<number | null> {
  return incrementDailyUsage(userId, DAILY_LIKE_PASS_METRIC, limit, transaction);
}

export async function incrementDailyTextMessages(
  userId: string,
  transaction: Transaction,
  limit: number
): Promise<number | null> {
  return incrementDailyUsage(userId, DAILY_TEXT_MESSAGES_METRIC, limit, transaction);
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

interface UndoableActionRow {
  id: string;
  toUserId: string;
  action: string;
  withinWindow: boolean | string;
}

export interface UndoableAction {
  id: string;
  toUserId: string;
  action: 'LIKE' | 'PASS';
  withinWindow: boolean;
}

interface UndoMatchRow {
  id: string;
}

const LATEST_UNDOABLE_ACTION_SQL = `
SELECT
  id,
  to_user_id AS "toUserId",
  action,
  (created_at >= CURRENT_TIMESTAMP - INTERVAL '5 minutes') AS "withinWindow"
FROM likes
WHERE from_user_id = CAST(:callerId AS uuid)
  AND is_undone = FALSE
  AND action IN ('LIKE', 'PASS')
ORDER BY created_at DESC
LIMIT 1
`;

const UNDO_ACTIVE_MATCH_SQL = `
UPDATE matches
SET
  status = 'UNDONE',
  updated_at = CURRENT_TIMESTAMP
WHERE status = 'ACTIVE'
  AND user_one_id = LEAST(CAST(:callerId AS uuid), CAST(:targetUserId AS uuid))
  AND user_two_id = GREATEST(CAST(:callerId AS uuid), CAST(:targetUserId AS uuid))
RETURNING id
`;

export async function findLatestUndoableAction(
  callerId: string,
  transaction: Transaction,
  lock = false
): Promise<UndoableAction | null> {
  const rows = await sequelize.query<UndoableActionRow>(
    lock ? `${LATEST_UNDOABLE_ACTION_SQL} FOR UPDATE` : LATEST_UNDOABLE_ACTION_SQL,
    {
      replacements: { callerId },
      type: QueryTypes.SELECT,
      transaction
    }
  );
  const row = rows[0];
  if (!row || (row.action !== 'LIKE' && row.action !== 'PASS')) {
    return null;
  }

  return {
    id: row.id,
    toUserId: row.toUserId,
    action: row.action,
    withinWindow: flag(row.withinWindow)
  };
}

export async function markUndoableAction(likeId: string, transaction: Transaction): Promise<boolean> {
  const [count] = await Like.update(
    { isUndone: true },
    {
      where: { id: likeId, isUndone: false },
      transaction
    }
  );
  return count === 1;
}

export async function undoActiveMatch(
  callerId: string,
  targetUserId: string,
  transaction: Transaction
): Promise<string | null> {
  const rows = await sequelize.query<UndoMatchRow>(UNDO_ACTIVE_MATCH_SQL, {
    replacements: { callerId, targetUserId },
    type: QueryTypes.SELECT,
    transaction
  });
  return rows[0]?.id ?? null;
}

export interface MatchLookup {
  id: string;
  userOneId: string;
  userTwoId: string;
  status: string;
}

const FIND_MATCH_SQL = `
SELECT
  id,
  user_one_id AS "userOneId",
  user_two_id AS "userTwoId",
  status
FROM matches
WHERE id = CAST(:matchId AS uuid)
`;

const UNMATCH_ACTIVE_MATCH_SQL = `
UPDATE matches
SET
  status = 'UNMATCHED',
  unmatched_at = CURRENT_TIMESTAMP,
  unmatched_by_user_id = CAST(:callerId AS uuid),
  updated_at = CURRENT_TIMESTAMP
WHERE id = CAST(:matchId AS uuid)
  AND status = 'ACTIVE'
  AND (
    user_one_id = CAST(:callerId AS uuid)
    OR user_two_id = CAST(:callerId AS uuid)
  )
RETURNING id
`;

export async function findMatchById(
  matchId: string,
  transaction: Transaction,
  lock = false
): Promise<MatchLookup | null> {
  const rows = await sequelize.query<MatchLookup>(lock ? `${FIND_MATCH_SQL} FOR UPDATE` : FIND_MATCH_SQL, {
    replacements: { matchId },
    type: QueryTypes.SELECT,
    transaction
  });
  return rows[0] ?? null;
}

export async function unmatchActiveMatch(
  matchId: string,
  callerId: string,
  transaction: Transaction
): Promise<string | null> {
  const rows = await sequelize.query<{ id: string }>(UNMATCH_ACTIVE_MATCH_SQL, {
    replacements: { matchId, callerId },
    type: QueryTypes.SELECT,
    transaction
  });
  return rows[0]?.id ?? null;
}

export async function closeActiveConversation(matchId: string, transaction: Transaction): Promise<void> {
  await Conversation.update(
    { status: 'CLOSED', closedAt: new Date() },
    {
      where: { matchId, status: 'ACTIVE' },
      transaction
    }
  );
}

export const WHO_LIKED_ME_CARD_LIMIT = 50;

/**
 * Shared eligibility for the Free count and the Premium list.
 * The Free statement selects only COUNT(*). Photo keys stay out of that projection;
 * the EXISTS below does not return storage_key.
 */
const ELIGIBLE_ADMIRERS_FROM_WHERE = `
FROM likes l
INNER JOIN users admirer ON admirer.id = l.from_user_id
INNER JOIN profiles admirer_profile ON admirer_profile.user_id = admirer.id
INNER JOIN profiles caller_profile ON caller_profile.user_id = CAST(:callerId AS uuid)
WHERE l.to_user_id = CAST(:callerId AS uuid)
  AND l.is_undone = FALSE
  AND l.action IN ('LIKE', 'SUPER_LIKE')
  AND admirer.deleted_at IS NULL
  AND admirer.status = 'ACTIVE'
  AND admirer_profile.location IS NOT NULL
  AND caller_profile.location IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM profile_photos ph
    WHERE ph.user_id = admirer.id
      AND ph.is_primary = TRUE
      AND ph.deleted_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM blocks b
    WHERE (b.blocker_id = CAST(:callerId AS uuid) AND b.blocked_id = admirer.id)
       OR (b.blocker_id = admirer.id AND b.blocked_id = CAST(:callerId AS uuid))
  )
  AND NOT EXISTS (
    SELECT 1
    FROM matches m
    WHERE m.status = 'ACTIVE'
      AND m.user_one_id = LEAST(CAST(:callerId AS uuid), admirer.id)
      AND m.user_two_id = GREATEST(CAST(:callerId AS uuid), admirer.id)
  )
`;

const COUNT_ELIGIBLE_ADMIRERS_SQL = `
SELECT COUNT(*)::int AS "count"
${ELIGIBLE_ADMIRERS_FROM_WHERE}
`;

const LIST_ELIGIBLE_ADMIRERS_SQL = `
SELECT
  admirer.id AS "userId",
  admirer_profile.first_name AS "firstName",
  CAST(EXTRACT(YEAR FROM AGE(admirer_profile.date_of_birth)) AS int) AS "age",
  admirer_profile.city AS "city",
  ROUND(CAST(ST_Distance(admirer_profile.location, caller_profile.location) / 1000.0 AS numeric), 1) AS "distanceKm",
  l.created_at AS "likedAt",
  (
    SELECT ph.storage_key
    FROM profile_photos ph
    WHERE ph.user_id = admirer.id
      AND ph.is_primary = TRUE
      AND ph.deleted_at IS NULL
  ) AS "storageKey"
${ELIGIBLE_ADMIRERS_FROM_WHERE}
ORDER BY l.created_at DESC, l.id DESC
LIMIT :limit
`;

interface AdmirerCountRow {
  count: number | string;
}

export interface EligibleAdmirerRow {
  userId: string;
  firstName: string;
  age: number | string;
  city: string | null;
  distanceKm: number | string;
  likedAt: Date | string;
  storageKey: string | null;
}

export async function countEligibleAdmirers(callerId: string, transaction: Transaction): Promise<number> {
  const rows = await sequelize.query<AdmirerCountRow>(COUNT_ELIGIBLE_ADMIRERS_SQL, {
    replacements: { callerId },
    type: QueryTypes.SELECT,
    transaction
  });
  const count = rows[0]?.count;
  if (count === undefined) {
    throw new Error('Eligible admirer count was not returned.');
  }
  return Number(count);
}

export async function listEligibleAdmirers(
  callerId: string,
  transaction: Transaction
): Promise<EligibleAdmirerRow[]> {
  return sequelize.query<EligibleAdmirerRow>(LIST_ELIGIBLE_ADMIRERS_SQL, {
    replacements: { callerId, limit: WHO_LIKED_ME_CARD_LIMIT },
    type: QueryTypes.SELECT,
    transaction
  });
}

export interface ActiveMatchCardRow {
  matchId: string;
  matchedAt: Date | string;
  conversationId: string;
  userId: string;
  firstName: string;
  age: number | string;
  city: string | null;
  storageKey: string | null;
}

const ACTIVE_MATCH_CARDS_SQL = `
SELECT
  m.id AS "matchId",
  m.matched_at AS "matchedAt",
  c.id AS "conversationId",
  partner.id AS "userId",
  partner_profile.first_name AS "firstName",
  CAST(EXTRACT(YEAR FROM AGE(partner_profile.date_of_birth)) AS int) AS "age",
  partner_profile.city AS "city",
  (
    SELECT ph.storage_key
    FROM profile_photos ph
    WHERE ph.user_id = partner.id
      AND ph.is_primary = TRUE
      AND ph.deleted_at IS NULL
    LIMIT 1
  ) AS "storageKey"
FROM matches m
INNER JOIN conversations c ON c.match_id = m.id
INNER JOIN users partner ON partner.id = CASE
  WHEN m.user_one_id = CAST(:callerId AS uuid) THEN m.user_two_id
  ELSE m.user_one_id
END
INNER JOIN profiles partner_profile ON partner_profile.user_id = partner.id
WHERE m.status = 'ACTIVE'
  AND (
    m.user_one_id = CAST(:callerId AS uuid)
    OR m.user_two_id = CAST(:callerId AS uuid)
  )
  AND partner.deleted_at IS NULL
  AND partner.status = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1
    FROM blocks b
    WHERE (b.blocker_id = m.user_one_id AND b.blocked_id = m.user_two_id)
       OR (b.blocker_id = m.user_two_id AND b.blocked_id = m.user_one_id)
  )
`;

const ACTIVE_MATCH_CURSOR_SQL = `
  AND (
    m.matched_at < CAST(:cursorMatchedAt AS timestamptz)
    OR (
      m.matched_at = CAST(:cursorMatchedAt AS timestamptz)
      AND m.id < CAST(:cursorMatchId AS uuid)
    )
  )
`;

const ACTIVE_MATCH_ORDER_SQL = `
ORDER BY m.matched_at DESC, m.id DESC
LIMIT :pageSize
`;

export async function listActiveMatchCards(
  callerId: string,
  pageSize: number,
  cursor: { matchedAt: string; matchId: string } | null
): Promise<ActiveMatchCardRow[]> {
  const replacements: Record<string, unknown> = { callerId, pageSize };
  const cursorSql = cursor ? ACTIVE_MATCH_CURSOR_SQL : '';
  if (cursor) {
    replacements.cursorMatchedAt = cursor.matchedAt;
    replacements.cursorMatchId = cursor.matchId;
  }

  return sequelize.query<ActiveMatchCardRow>(`${ACTIVE_MATCH_CARDS_SQL}${cursorSql}${ACTIVE_MATCH_ORDER_SQL}`, {
    replacements,
    type: QueryTypes.SELECT
  });
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
