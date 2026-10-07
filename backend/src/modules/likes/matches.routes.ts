import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import * as likesController from './likes.controller';

const router = Router();

router.delete('/:matchId', authenticate, requireRole('USER'), likesController.unmatch);

export const matchesRoutes = router;
