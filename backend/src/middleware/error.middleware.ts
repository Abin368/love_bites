import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { env } from '../config/env';

export const errorMiddleware: ErrorRequestHandler = (
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const requestId = req.id || 'unknown';
  const timestamp = new Date().toISOString();

  let statusCode = 500;
  let errorCode = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected error occurred. Please try again later.';
  let details: any[] = [];

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    errorCode = err.errorCode;
    message = err.message;
    details = err.details || [];
  } else if (err.name === 'SyntaxError' && 'body' in err) {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    message = 'Invalid JSON payload structure';
  } else if (err.name === 'SequelizeValidationError') {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    message = 'Database validation failed';
    details = err.errors?.map((e: any) => ({
      field: e.path,
      message: e.message,
      code: e.validatorKey
    })) || [];
  } else if (err.name === 'SequelizeUniqueConstraintError') {
    statusCode = 409;
    errorCode = 'CONFLICT';
    message = 'Unique constraint violation';
    details = err.errors?.map((e: any) => ({
      field: e.path,
      message: e.message
    })) || [];
  } else {
    // Log unexpected errors with full stack trace
    logger.error('Unhandled server exception', {
      error: err.message,
      stack: err.stack,
      requestId,
      method: req.method,
      url: req.originalUrl
    });
  }

  // If operational error, log at warn level
  if (err instanceof AppError && err.isOperational) {
    logger.warn('Operational application error', {
      statusCode,
      errorCode,
      message,
      details,
      requestId,
      method: req.method,
      url: req.originalUrl
    });
  }

  res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message,
      details,
      timestamp,
      requestId,
      ...(env.NODE_ENV === 'development' && !(err instanceof AppError) ? { stack: err.stack } : {})
    }
  });
};
