import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validate.middleware';
import * as chatController from './chat.controller';
import { sendTextMessageSchema, validateListMessagesQuery } from './chat.validator';

const router = Router();

router.get(
  '/:conversationId/messages',
  authenticate,
  requireRole('USER'),
  validateListMessagesQuery,
  chatController.listMessages
);

router.post(
  '/:conversationId/messages',
  authenticate,
  requireRole('USER'),
  validate(sendTextMessageSchema),
  chatController.sendTextMessage
);

export const chatRoutes = router;
