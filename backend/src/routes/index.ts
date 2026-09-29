import { Router } from 'express';
import { healthRoutes } from './health.routes';
import { authRoutes } from '../modules/auth/auth.routes';
import { genderRoutes } from '../modules/genders/genders.routes';
import { interestRoutes } from '../modules/interests/interests.routes';
import { onboardingRoutes } from '../modules/onboarding/onboarding.routes.js';
import { profileRoutes } from '../modules/profiles/profiles.routes.js';
import { relationshipIntentionRoutes } from '../modules/relationship-intentions/relationship-intentions.routes';

const router = Router();

// Base health route under /api/v1
router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/onboarding', onboardingRoutes);
router.use('/profile', profileRoutes);
router.use('/genders', genderRoutes);
router.use('/interests', interestRoutes);
router.use('/relationship-intentions', relationshipIntentionRoutes);

export const apiRoutes = router;
