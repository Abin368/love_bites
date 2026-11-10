import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import * as likesController from './likes.controller';
import { validateListMatchesQuery } from './likes.validator';

const router = Router();

router.get('/', authenticate, requireRole('USER'), validateListMatchesQuery, likesController.listMatches);

router.delete('/:matchId', authenticate, requireRole('USER'), likesController.unmatch);

export const matchesRoutes = router;
