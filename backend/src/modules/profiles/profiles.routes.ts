import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { validate } from '../../middleware/validate.middleware';
import * as profilesController from './profiles.controller';
import { createProfileSchema, updateProfileSchema } from './profiles.validator';

const router = Router();

router.use(authenticate, requireRole('USER'));
router.get('/', profilesController.getProfile);
router.post('/', validate(createProfileSchema), profilesController.createProfile);
router.patch('/', validate(updateProfileSchema), profilesController.updateProfile);

export const profileRoutes = router;
