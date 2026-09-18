import { Router, Request, Response } from 'express';
import { sequelize } from '../config/database';
import { checkRedisHealth } from '../config/redis';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  let dbStatus = 'DISCONNECTED';
  let redisStatus = 'DISCONNECTED';

  try {
    await sequelize.authenticate();
    dbStatus = 'CONNECTED';
  } catch {
    dbStatus = 'DISCONNECTED';
  }

  try {
    const isRedisOk = await checkRedisHealth();
    redisStatus = isRedisOk ? 'CONNECTED' : 'DISCONNECTED';
  } catch {
    redisStatus = 'DISCONNECTED';
  }

  const isHealthy = dbStatus === 'CONNECTED' && redisStatus === 'CONNECTED';
  const statusCode = isHealthy ? 200 : 503;

  res.status(statusCode).json({
    success: isHealthy,
    data: {
      status: isHealthy ? 'UP' : 'DOWN',
      timestamp: new Date().toISOString(),
      services: {
        database: dbStatus,
        redis: redisStatus
      },
      uptime: process.uptime()
    }
  });
});

export const healthRoutes = router;
