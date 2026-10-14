import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import * as blocksController from './blocks.controller';
import { validateEmptyBody, validateNoQuery, validateTargetUserIdParam } from './blocks.validator';

const router = Router();

router.get('/', authenticate, requireRole('USER'), validateNoQuery, validateEmptyBody, blocksController.listBlocks);

router.post(
  '/:userId',
  authenticate,
  requireRole('USER'),
  validateTargetUserIdParam,
  validateNoQuery,
  validateEmptyBody,
  blocksController.blockUser
);

router.delete(
  '/:userId',
  authenticate,
  requireRole('USER'),
  validateTargetUserIdParam,
  validateNoQuery,
  validateEmptyBody,
  blocksController.unblockUser
);

export const blocksRoutes = router;
