import { Router } from 'express';
import { rateLimitByIp } from '../../middleware/rate-limit.middleware';
import * as interestsController from './interests.controller';

const router = Router();

router.get('/', rateLimitByIp('ratelimit:public', 100), interestsController.listInterests);

export const interestRoutes = router;
