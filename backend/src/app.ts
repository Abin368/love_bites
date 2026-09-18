import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';
import { env } from './config/env';
import { requestIdMiddleware } from './middleware/request-id.middleware';
import { httpLoggerMiddleware } from './middleware/http-logger.middleware';
import { notFoundMiddleware } from './middleware/not-found.middleware';
import { errorMiddleware } from './middleware/error.middleware';
import { apiRoutes } from './routes';
import { healthRoutes } from './routes/health.routes';

export function createApp(): Express {
  const app = express();

  // Trust proxy in production behind load balancer
  if (env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  // Security HTTP Headers
  app.use(helmet());

  // CORS Configuration
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'Idempotency-Key']
    })
  );

  // Correlation ID tracking
  app.use(requestIdMiddleware);

  // Request logging
  app.use(httpLoggerMiddleware);

  // Request Parsers
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));
  app.use(cookieParser());

  // Parameter pollution protection
  app.use(hpp());

  // Root Health Check Endpoint
  app.use('/health', healthRoutes);

  // API v1 Routes
  app.use(env.API_PREFIX, apiRoutes);

  // 404 Not Found Middleware
  app.use(notFoundMiddleware);

  // Centralized Error Handling Middleware
  app.use(errorMiddleware);

  return app;
}

export const app = createApp();
