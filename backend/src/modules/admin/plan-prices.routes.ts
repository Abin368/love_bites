import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { requireRole } from '../../middleware/role.middleware';
import * as planPricesController from './plan-prices.controller';
import { updatePlanPriceSchema, validateNoQuery, validatePlanIdParam } from './plan-prices.validator';

const router = Router();

router.patch(
  '/:planId',
  authenticate,
  requireRole('ADMIN'),
  validatePlanIdParam,
  validateNoQuery,
  validate(updatePlanPriceSchema),
  planPricesController.updatePlanPrice
);

export const planPriceRoutes = router;
