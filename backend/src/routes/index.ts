import { Router } from 'express';
import { healthRoutes } from './health.routes';
import { authRoutes } from '../modules/auth/auth.routes';

const router = Router();

// Base health route under /api/v1
router.use('/health', healthRoutes);
router.use('/auth', authRoutes);

export const apiRoutes = router;
