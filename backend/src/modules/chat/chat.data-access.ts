import { literal, Op, QueryTypes, Transaction, WhereOptions } from 'sequelize';
import { sequelize } from '../../config/database';
import { Conversation } from '../../database/models/conversation.model';
import { Message, MessageAttributes } from '../../database/models/message.model';
import type { MessageType } from '../../database/models/message.model';
import type { ConversationMatchLookup } from './chat.types';
import type { HistoryCursor, InboxCursor } from './chat.validator';

const CONVERSATION_MATCH_SQL = `
SELECT
  c.id AS "conversationId",
  c.status AS "conversationStatus",
  m.id AS "matchId",
  m.status AS "matchStatus",
  m.user_one_id AS "userOneId",
  m.user_two_id AS "userTwoId"
FROM conversations c
INNER JOIN matches m ON m.id = c.match_id
WHERE c.id = CAST(:conversationId AS uuid)
`;

export async function findConversationWithMatch(
  conversationId: string,
  transaction?: Transaction
): Promise<ConversationMatchLookup | null> {
  const rows = await sequelize.query<ConversationMatchLookup>(CONVERSATION_MATCH_SQL, {
    replacements: { conversationId },
    type: QueryTypes.SELECT,
    ...(transaction ? { transaction } : {})
  });
  return rows[0] ?? null;
}

export async function lockMatchById(matchId: string, transaction: Transaction): Promise<void> {
  await sequelize.query(
    `SELECT id
     FROM matches
     WHERE id = CAST(:matchId AS uuid)
     FOR UPDATE`,
    {
      replacements: { matchId },
      type: QueryTypes.SELECT,
      transaction
    }
  );
}

export async function lockConversationById(conversationId: string, transaction: Transaction): Promise<void> {
  await sequelize.query(
    `SELECT id
     FROM conversations
     WHERE id = CAST(:conversationId AS uuid)
     FOR UPDATE`,
    {
      replacements: { conversationId },
      type: QueryTypes.SELECT,
      transaction
    }
  );
}

export async function hasBidirectionalBlock(
  callerId: string,
  otherUserId: string,
  transaction?: Transaction
): Promise<boolean> {
  const rows = await sequelize.query<{ found: number }>(
    `SELECT 1 AS "found"
     FROM blocks b
     WHERE (b.blocker_id = CAST(:callerId AS uuid) AND b.blocked_id = CAST(:otherUserId AS uuid))
        OR (b.blocker_id = CAST(:otherUserId AS uuid) AND b.blocked_id = CAST(:callerId AS uuid))
     LIMIT 1`,
    {
      replacements: { callerId, otherUserId },
      type: QueryTypes.SELECT,
      ...(transaction ? { transaction } : {})
    }
  );
  return rows.length > 0;
}

const HISTORY_CURSOR_PREDICATE = `(
  "Message"."created_at" < CAST(:cursorCreatedAt AS timestamptz)
  OR (
    "Message"."created_at" = CAST(:cursorCreatedAt AS timestamptz)
    AND "Message"."id" < CAST(:cursorId AS uuid)
  )
)`;

export async function listConversationMessages(
  conversationId: string,
  limit: number,
  cursor: HistoryCursor | null
): Promise<Message[]> {
  const where: WhereOptions<MessageAttributes> = cursor
    ? {
        conversationId,
        [Op.and]: [literal(HISTORY_CURSOR_PREDICATE)]
      }
    : { conversationId };

  return Message.findAll({
    where,
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC']
    ],
    limit,
    ...(cursor ? { replacements: { cursorCreatedAt: cursor.createdAt, cursorId: cursor.id } } : {})
  });
}

export async function insertTextMessage(
  conversationId: string,
  senderId: string,
  content: string,
  transaction: Transaction
): Promise<Message> {
  const now = new Date();
  return Message.create(
    {
      conversationId,
      senderId,
      messageType: 'TEXT',
      content,
      mediaStorageKey: null,
      mediaMimeType: null,
      mediaFileSize: null,
      readAt: null,
      createdAt: now,
      updatedAt: now
    },
    { transaction }
  );
}

const MARK_INCOMING_READ_SQL = `
UPDATE messages
SET read_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE conversation_id = CAST(:conversationId AS uuid)
  AND sender_id = CAST(:senderId AS uuid)
  AND read_at IS NULL
  AND deleted_at IS NULL
RETURNING read_at AS "readAt"
`;

const COUNT_INCOMING_UNREAD_SQL = `
SELECT COUNT(*)::integer AS "unreadCount"
FROM messages
WHERE conversation_id = CAST(:conversationId AS uuid)
  AND sender_id = CAST(:senderId AS uuid)
  AND read_at IS NULL
  AND deleted_at IS NULL
`;

export async function countIncomingUnreadMessages(conversationId: string, senderId: string): Promise<number> {
  const rows = await sequelize.query<{ unreadCount: number | string }>(COUNT_INCOMING_UNREAD_SQL, {
    replacements: { conversationId, senderId },
    type: QueryTypes.SELECT
  });
  const value = rows[0]?.unreadCount;
  const unreadCount = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(unreadCount) || unreadCount < 0) {
    throw new Error('Unread count query returned an invalid value.');
  }
  return unreadCount;
}

export async function markIncomingMessagesRead(
  conversationId: string,
  senderId: string,
  transaction: Transaction
): Promise<Date | null> {
  const rows = await sequelize.query<{ readAt: Date | string }>(MARK_INCOMING_READ_SQL, {
    replacements: { conversationId, senderId },
    type: QueryTypes.SELECT,
    transaction
  });
  const value = rows[0]?.readAt;
  if (!value) {
    return null;
  }
  const readAt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(readAt.getTime())) {
    return null;
  }
  return readAt;
}

export interface InboxConversationRow {
  conversationId: string;
  matchId: string;
  status: string;
  lastMessageAt: Date | string | null;
  participantId: string;
  firstName: string;
}

export interface InboxPreviewRow {
  id: string;
  conversationId: string;
  senderId: string;
  messageType: MessageType;
  content: string | null;
  createdAt: Date | string;
}

export interface InboxUnreadRow {
  conversationId: string;
  unreadCount: number | string;
}

const INBOX_PAGE_SQL = `
SELECT
  c.id AS "conversationId",
  c.match_id AS "matchId",
  c.status AS "status",
  c.last_message_at AS "lastMessageAt",
  CASE
    WHEN m.user_one_id = CAST(:callerId AS uuid) THEN m.user_two_id
    ELSE m.user_one_id
  END AS "participantId",
  p.first_name AS "firstName"
FROM conversations c
INNER JOIN matches m ON m.id = c.match_id
INNER JOIN profiles p ON p.user_id = (
  CASE
    WHEN m.user_one_id = CAST(:callerId AS uuid) THEN m.user_two_id
    ELSE m.user_one_id
  END
)
WHERE c.status = 'ACTIVE'
  AND m.status = 'ACTIVE'
  AND (
    m.user_one_id = CAST(:callerId AS uuid)
    OR m.user_two_id = CAST(:callerId AS uuid)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM blocks b
    WHERE (b.blocker_id = m.user_one_id AND b.blocked_id = m.user_two_id)
       OR (b.blocker_id = m.user_two_id AND b.blocked_id = m.user_one_id)
  )
`;

const INBOX_CURSOR_NON_NULL_SQL = `
  AND (
    c.last_message_at < CAST(:cursorLastMessageAt AS timestamptz)
    OR (
      c.last_message_at = CAST(:cursorLastMessageAt AS timestamptz)
      AND c.id < CAST(:cursorConversationId AS uuid)
    )
    OR c.last_message_at IS NULL
  )
`;

const INBOX_CURSOR_NULL_SQL = `
  AND c.last_message_at IS NULL
  AND c.id < CAST(:cursorConversationId AS uuid)
`;

const INBOX_PAGE_ORDER_SQL = `
ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC
LIMIT :pageSize
`;

function bindUuidList(ids: string[], prefix: string, replacements: Record<string, unknown>): string {
  return ids
    .map((id, index) => {
      const key = `${prefix}${index}`;
      replacements[key] = id;
      return `CAST(:${key} AS uuid)`;
    })
    .join(', ');
}

export async function listInboxConversations(
  callerId: string,
  pageSize: number,
  cursor: InboxCursor | null
): Promise<InboxConversationRow[]> {
  const cursorSql = !cursor
    ? ''
    : cursor.lastMessageAt === null
      ? INBOX_CURSOR_NULL_SQL
      : INBOX_CURSOR_NON_NULL_SQL;
  const replacements: Record<string, unknown> = { callerId, pageSize };
  if (cursor) {
    replacements.cursorConversationId = cursor.conversationId;
    if (cursor.lastMessageAt !== null) {
      replacements.cursorLastMessageAt = cursor.lastMessageAt;
    }
  }

  return sequelize.query<InboxConversationRow>(`${INBOX_PAGE_SQL}${cursorSql}${INBOX_PAGE_ORDER_SQL}`, {
    replacements,
    type: QueryTypes.SELECT
  });
}

export async function listInboxLatestMessages(conversationIds: string[]): Promise<InboxPreviewRow[]> {
  if (conversationIds.length === 0) {
    return [];
  }

  const replacements: Record<string, unknown> = {};
  const idList = bindUuidList(conversationIds, 'conversationId', replacements);
  return sequelize.query<InboxPreviewRow>(
    `SELECT DISTINCT ON (msg.conversation_id)
       msg.id AS "id",
       msg.conversation_id AS "conversationId",
       msg.sender_id AS "senderId",
       msg.message_type AS "messageType",
       msg.content AS "content",
       msg.created_at AS "createdAt"
     FROM messages msg
     WHERE msg.deleted_at IS NULL
       AND msg.conversation_id IN (${idList})
     ORDER BY msg.conversation_id, msg.created_at DESC, msg.id DESC`,
    {
      replacements,
      type: QueryTypes.SELECT
    }
  );
}

export async function countInboxUnreadMessages(callerId: string, conversationIds: string[]): Promise<InboxUnreadRow[]> {
  if (conversationIds.length === 0) {
    return [];
  }

  const replacements: Record<string, unknown> = { callerId };
  const idList = bindUuidList(conversationIds, 'conversationId', replacements);
  return sequelize.query<InboxUnreadRow>(
    `SELECT
       msg.conversation_id AS "conversationId",
       COUNT(*)::integer AS "unreadCount"
     FROM messages msg
     INNER JOIN conversations c ON c.id = msg.conversation_id
     INNER JOIN matches m ON m.id = c.match_id
     WHERE msg.conversation_id IN (${idList})
       AND msg.read_at IS NULL
       AND msg.deleted_at IS NULL
       AND msg.sender_id = CASE
         WHEN m.user_one_id = CAST(:callerId AS uuid) THEN m.user_two_id
         ELSE m.user_one_id
       END
     GROUP BY msg.conversation_id`,
    {
      replacements,
      type: QueryTypes.SELECT
    }
  );
}

export async function updateConversationLastMessageAt(
  conversationId: string,
  lastMessageAt: Date,
  transaction: Transaction
): Promise<boolean> {
  const [count] = await Conversation.update(
    { lastMessageAt },
    {
      where: { id: conversationId, status: 'ACTIVE' },
      transaction
    }
  );
  return count === 1;
}
