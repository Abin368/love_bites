import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import * as discoveryController from './discovery.controller';

const router = Router();

router.get('/', authenticate, requireRole('USER'), discoveryController.getNextCandidate);

export const discoveryRoutes = router;
