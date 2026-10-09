import { Response } from 'express';
import { deliverReadReceipt } from '../../socket/chat.socket';
import { asyncHandler } from '../../utils/async-handler';
import * as chatService from './chat.service';
import type { HistoryMessage } from './chat.types';
import type { ListMessagesQuery, SendTextMessageBody } from './chat.validator';

function send(res: Response, status: number, data: unknown, message: string): void {
  res.status(status).json({ success: true, data, message });
}

export const sendTextMessage = asyncHandler(async (req, res) => {
  const body = req.body as SendTextMessageBody;
  const result = await chatService.sendTextMessage({
    callerId: req.user!.id,
    isVerified: req.user!.isVerified,
    conversationId: req.params.conversationId,
    messageType: body.messageType,
    content: body.content
  });

  send(
    res,
    201,
    {
      id: result.id,
      conversationId: result.conversationId,
      senderId: result.senderId,
      messageType: result.messageType,
      content: result.content,
      mediaUrl: result.mediaUrl,
      readAt: result.readAt,
      createdAt: result.createdAt,
      remainingDailyMessages: result.remainingDailyMessages
    },
    'Message sent.'
  );
});

function historyItem(message: HistoryMessage) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    messageType: message.messageType,
    content: message.content,
    mediaUrl: message.mediaUrl,
    readAt: message.readAt,
    createdAt: message.createdAt
  };
}

export const markMessagesRead = asyncHandler(async (req, res) => {
  const result = await chatService.markMessagesRead({
    callerId: req.user!.id,
    isVerified: req.user!.isVerified,
    conversationId: req.params.conversationId
  });

  if (result.readAt) {
    deliverReadReceipt({
      conversationId: result.conversationId,
      readerId: result.readerId,
      recipientId: result.recipientId,
      readAt: result.readAt
    });
  }

  send(res, 200, { readAt: result.readAt }, 'Messages marked as read.');
});

export const listMessages = asyncHandler(async (req, res) => {
  const query = res.locals.listMessagesQuery as ListMessagesQuery;
  const result = await chatService.listMessages({
    callerId: req.user!.id,
    isVerified: req.user!.isVerified,
    conversationId: req.params.conversationId,
    limit: query.limit,
    cursor: query.cursor
  });

  send(
    res,
    200,
    {
      items: result.items.map(historyItem),
      pagination: {
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        limit: result.limit
      }
    },
    'Messages retrieved.'
  );
});
