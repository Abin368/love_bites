import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validate.middleware';
import * as chatController from './chat.controller';
import { sendTextMessageSchema } from './chat.validator';

const router = Router();

router.post(
  '/:conversationId/messages',
  authenticate,
  requireRole('USER'),
  validate(sendTextMessageSchema),
  chatController.sendTextMessage
);

export const chatRoutes = router;
