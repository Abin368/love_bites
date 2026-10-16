import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { rateLimitByIp } from '../../middleware/rate-limit.middleware';
import { requireRole } from '../../middleware/role.middleware';
import * as subscriptionsController from './subscriptions.controller';
import { validateEmptyBody, validateNoQuery } from './subscriptions.validator';

const router = Router();

router.get('/plans', rateLimitByIp('ratelimit:public', 100), subscriptionsController.listPlans);
router.get(
  '/me',
  authenticate,
  requireRole('USER'),
  validateNoQuery,
  validateEmptyBody,
  subscriptionsController.getCurrentSubscription
);
router.post(
  '/cancel',
  authenticate,
  requireRole('USER'),
  validateNoQuery,
  validateEmptyBody,
  subscriptionsController.cancelSubscription
);

export const subscriptionsRoutes = router;
