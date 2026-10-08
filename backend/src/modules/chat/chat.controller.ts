import { Response } from 'express';
import { asyncHandler } from '../../utils/async-handler';
import * as chatService from './chat.service';
import type { SendTextMessageBody } from './chat.validator';

function send(res: Response, status: number, data: unknown, message: string): void {
  res.status(status).json({ success: true, data, message });
}

export const sendTextMessage = asyncHandler(async (req, res) => {
  const body = req.body as SendTextMessageBody;
  const data = await chatService.sendTextMessage({
    callerId: req.user!.id,
    isVerified: req.user!.isVerified,
    conversationId: req.params.conversationId,
    messageType: body.messageType,
    content: body.content
  });

  send(res, 201, data, 'Message sent.');
});
