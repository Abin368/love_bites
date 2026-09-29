import { Router } from 'express';
import { rateLimitByIp } from '../../middleware/rate-limit.middleware';
import * as gendersController from './genders.controller';

const router = Router();

router.get('/', rateLimitByIp('ratelimit:public', 100), gendersController.listGenders);

export const genderRoutes = router;
