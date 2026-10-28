import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { requireRole } from '../../middleware/role.middleware';
import * as paymentsController from './payments.controller';
import { checkoutSchema, validateIdempotencyKey, validateNoQuery } from './payments.validator';

const router = Router();

router.post(
  '/checkout',
  authenticate,
  requireRole('USER'),
  validateNoQuery,
  validateIdempotencyKey,
  validate(checkoutSchema),
  paymentsController.createCheckout
);

export const paymentsRoutes = router;
