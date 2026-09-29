import { Router } from 'express';
import { rateLimitByIp } from '../../middleware/rate-limit.middleware';
import * as relationshipIntentionsController from './relationship-intentions.controller';

const router = Router();

router.get(
  '/',
  rateLimitByIp('ratelimit:public', 100),
  relationshipIntentionsController.listRelationshipIntentions
);

export const relationshipIntentionRoutes = router;
