import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validate.middleware';
import * as onboardingController from './onboarding.controller';
import { replaceInterestsSchema, replaceRelationshipIntentionsSchema } from './onboarding.validator';

const router = Router();

router.put(
  '/interests',
  authenticate,
  requireRole('USER'),
  validate(replaceInterestsSchema),
  onboardingController.replaceInterests
);

router.put(
  '/relationship-intentions',
  authenticate,
  requireRole('USER'),
  validate(replaceRelationshipIntentionsSchema),
  onboardingController.replaceRelationshipIntentions
);

export const onboardingRoutes = router;
