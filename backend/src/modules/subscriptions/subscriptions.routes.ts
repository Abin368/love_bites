import { Router } from 'express';
import { rateLimitByIp } from '../../middleware/rate-limit.middleware';
import * as subscriptionsController from './subscriptions.controller';

const router = Router();

router.get('/plans', rateLimitByIp('ratelimit:public', 100), subscriptionsController.listPlans);

export const subscriptionsRoutes = router;
