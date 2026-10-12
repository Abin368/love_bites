import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validate.middleware';
import * as chatController from './chat.controller';
import {
  markReadBodySchema,
  sendTextMessageSchema,
  validateListInboxQuery,
  validateListMessagesQuery,
  validateMarkReadRequest,
  validateUnreadCountQuery
} from './chat.validator';

const router = Router();

router.get('/', authenticate, requireRole('USER'), validateListInboxQuery, chatController.listConversations);

router.get(
  '/:conversationId/unread-count',
  authenticate,
  requireRole('USER'),
  validateUnreadCountQuery,
  chatController.getUnreadCount
);

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

router.patch(
  '/:conversationId/read',
  authenticate,
  requireRole('USER'),
  validateMarkReadRequest,
  validate(markReadBodySchema),
  chatController.markMessagesRead
);

export const chatRoutes = router;
