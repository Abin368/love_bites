import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import * as entitlementsController from './entitlements.controller';
import { validateEmptyBody, validateNoQuery } from './entitlements.validator';

const router = Router();

router.get(
  '/entitlements',
  authenticate,
  requireRole('USER'),
  validateNoQuery,
  validateEmptyBody,
  entitlementsController.getEntitlements
);

router.get(
  '/usage',
  authenticate,
  requireRole('USER'),
  validateNoQuery,
  validateEmptyBody,
  entitlementsController.getUsage
);

export const entitlementsRoutes = router;
