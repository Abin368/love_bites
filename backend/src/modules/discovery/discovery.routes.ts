import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import * as discoveryController from './discovery.controller';
import * as likesController from '../likes/likes.controller';

const router = Router();

router.get('/', authenticate, requireRole('USER'), discoveryController.getNextCandidate);
router.post('/:userId/pass', authenticate, requireRole('USER'), likesController.passProfile);

export const discoveryRoutes = router;
