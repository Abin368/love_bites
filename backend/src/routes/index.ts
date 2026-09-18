import { Router } from 'express';
import { healthRoutes } from './health.routes';

const router = Router();

// Base health route under /api/v1
router.use('/health', healthRoutes);

export const apiRoutes = router;
