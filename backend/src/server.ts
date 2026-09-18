import http from 'http';
import { app } from './app';
import { env } from './config/env';
import { sequelize } from './config/database';
import { redis } from './config/redis';
import { logger } from './utils/logger';

let server: http.Server;

async function bootstrap(): Promise<void> {
  try {
    logger.info('Initializing Love Bite Backend API...', {
      environment: env.NODE_ENV,
      port: env.PORT,
      prefix: env.API_PREFIX
    });

    // Test Database Connection
    try {
      await sequelize.authenticate();
      logger.info('Database connection pool established successfully');
    } catch (dbError: any) {
      logger.error('Failed to establish database connection on startup', {
        error: dbError.message
      });
      if (env.NODE_ENV === 'production') {
        process.exit(1);
      }
    }

    // Test Redis Connection
    try {
      if (redis.status === 'wait') {
        await redis.connect();
      }
      logger.info('Redis connection established successfully');
    } catch (redisError: any) {
      logger.error('Failed to establish Redis connection on startup', {
        error: redisError.message
      });
      if (env.NODE_ENV === 'production') {
        process.exit(1);
      }
    }

    // Start HTTP Server
    server = app.listen(env.PORT, () => {
      logger.info(`Server listening on port ${env.PORT} in ${env.NODE_ENV} mode`);
      logger.info(`Health check available at http://localhost:${env.PORT}/health`);
      logger.info(`API v1 mounted at http://localhost:${env.PORT}${env.API_PREFIX}`);
    });
  } catch (error: any) {
    logger.error('Fatal error during application startup', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  if (server) {
    server.close(async () => {
      logger.info('HTTP server closed');

      try {
        await sequelize.close();
        logger.info('Database connections closed');
      } catch (err: any) {
        logger.error('Error closing database connections', { error: err.message });
      }

      try {
        await redis.quit();
        logger.info('Redis connection closed');
      } catch (err: any) {
        logger.error('Error disconnecting Redis', { error: err.message });
      }

      logger.info('Graceful shutdown completed. Exiting process.');
      process.exit(0);
    });

    // Force shutdown if taking longer than 10 seconds
    setTimeout(() => {
      logger.error('Graceful shutdown timed out. Forcing process termination.');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason: any) => {
  logger.error('Unhandled Promise Rejection', {
    reason: reason?.message || reason,
    stack: reason?.stack
  });
});

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});

bootstrap();
