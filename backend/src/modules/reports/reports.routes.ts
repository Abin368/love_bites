import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validate.middleware';
import * as reportsController from './reports.controller';
import { submitReportSchema, validateNoQuery } from './reports.validator';

const router = Router();

router.post(
  '/',
  authenticate,
  requireRole('USER'),
  validateNoQuery,
  validate(submitReportSchema),
  reportsController.submitReport
);

export const reportsRoutes = router;
