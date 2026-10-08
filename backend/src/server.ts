import http from 'http';
import { app } from './app';
import { env } from './config/env';
import { sequelize } from './config/database';
import { redis } from './config/redis';
import { attachSocketServer, closeSocketServer, SocketRuntime } from './socket/socket.server';
import { logger } from './utils/logger';
import './database/associations';

let server: http.Server | undefined;
let sockets: SocketRuntime | null = null;

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
    let redisReady = false;
    try {
      if (redis.status === 'wait') {
        await redis.connect();
      }
      redisReady = true;
      logger.info('Redis connection established successfully');
    } catch (redisError: any) {
      logger.error('Failed to establish Redis connection on startup', {
        error: redisError.message
      });
      if (env.NODE_ENV === 'production') {
        process.exit(1);
      }
    }

    const httpServer = http.createServer(app);
    server = httpServer;

    if (redisReady) {
      try {
        sockets = await attachSocketServer(httpServer);
        logger.info('Socket.IO server attached with Redis adapter');
      } catch (socketError: any) {
        logger.error('Failed to start Socket.IO because the Redis adapter is unavailable', {
          error: socketError.message
        });
        if (env.NODE_ENV === 'production') {
          process.exit(1);
        }
        logger.warn('HTTP will continue without Socket.IO because Redis adapter initialization failed.');
      }
    } else {
      logger.warn('HTTP will continue without Socket.IO because Redis is unavailable.');
    }

    httpServer.listen(env.PORT, () => {
      logger.info(`Server listening on port ${env.PORT} in ${env.NODE_ENV} mode`);
      logger.info(`Health check available at http://localhost:${env.PORT}/health`);
      logger.info(`API v1 mounted at http://localhost:${env.PORT}${env.API_PREFIX}`);
    });
  } catch (error: any) {
    logger.error('Fatal error during application startup', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

async function releaseProcessResources(): Promise<void> {
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
}

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  if (!server) {
    process.exit(0);
    return;
  }

  // Force shutdown if taking longer than 10 seconds
  setTimeout(() => {
    logger.error('Graceful shutdown timed out. Forcing process termination.');
    process.exit(1);
  }, 10000);

  if (sockets) {
    const runtime = sockets;
    sockets = null;
    try {
      await closeSocketServer(runtime);
      logger.info('Socket.IO server closed');
      logger.info('HTTP server closed');
    } catch (err: any) {
      logger.error('Error closing Socket.IO', { error: err.message });
    }
    await releaseProcessResources();
    return;
  }

  server.close(() => {
    logger.info('HTTP server closed');
    void releaseProcessResources();
  });
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
