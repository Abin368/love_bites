import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import * as likesController from './likes.controller';
import { validateEmptyBody, validateNoQuery } from './likes.validator';

const router = Router();

router.get(
  '/who-liked-me',
  authenticate,
  requireRole('USER'),
  validateNoQuery,
  validateEmptyBody,
  likesController.getWhoLikedMe
);

export const likesRoutes = router;
