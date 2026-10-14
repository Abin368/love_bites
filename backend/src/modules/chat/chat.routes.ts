import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validate.middleware';
import * as chatController from './chat.controller';
import {
  markReadBodySchema,
  mediaConfirmSchema,
  mediaDownloadBodySchema,
  mediaUploadUrlSchema,
  sendTextMessageSchema,
  validateConversationIdParam,
  validateListInboxQuery,
  validateListMessagesQuery,
  validateMarkReadRequest,
  validateMediaDownloadRequest,
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
  '/:conversationId/messages/:messageId/media-download-url',
  authenticate,
  requireRole('USER'),
  validateMediaDownloadRequest,
  validate(mediaDownloadBodySchema),
  chatController.createMediaDownloadUrl
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

router.post(
  '/:conversationId/media-upload-url',
  authenticate,
  requireRole('USER'),
  validateConversationIdParam,
  validate(mediaUploadUrlSchema),
  chatController.createMediaUploadUrl
);

router.post(
  '/:conversationId/media-confirm',
  authenticate,
  requireRole('USER'),
  validateConversationIdParam,
  validate(mediaConfirmSchema),
  chatController.confirmMediaUpload
);

router.patch(
  '/:conversationId/read',
  authenticate,
  requireRole('USER'),
  validateMarkReadRequest,
  validate(markReadBodySchema),
  chatController.markMessagesRead
);

router.get(
  '/:conversationId',
  authenticate,
  requireRole('USER'),
  validateConversationIdParam,
  validateUnreadCountQuery,
  chatController.getConversationDetails
);

export const chatRoutes = router;
