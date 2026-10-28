import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { requireRole } from '../../middleware/role.middleware';
import * as paymentsController from './payments.controller';
import { checkoutSchema, validateIdempotencyKey, validateNoQuery, verifySchema } from './payments.validator';

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

router.post(
  '/verify',
  authenticate,
  requireRole('USER'),
  validateNoQuery,
  validate(verifySchema),
  paymentsController.verifyPayment
);

export const paymentsRoutes = router;
