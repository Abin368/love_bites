import { QueryTypes, Transaction } from 'sequelize';
import { sequelize } from '../../config/database';
import { Conversation } from '../../database/models/conversation.model';
import { Message } from '../../database/models/message.model';
import type { ConversationMatchLookup } from './chat.types';

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
  transaction: Transaction
): Promise<ConversationMatchLookup | null> {
  const rows = await sequelize.query<ConversationMatchLookup>(CONVERSATION_MATCH_SQL, {
    replacements: { conversationId },
    type: QueryTypes.SELECT,
    transaction
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
  transaction: Transaction
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
      transaction
    }
  );
  return rows.length > 0;
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
