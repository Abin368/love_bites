import { AppError, ErrorDetail } from './app.error';

export class InternalServerError extends AppError {
  public readonly statusCode = 500;
  public readonly errorCode: string;

  constructor(message = 'Internal server error', details: ErrorDetail[] = [], errorCode = 'INTERNAL_SERVER_ERROR', isOperational = false) {
    super(message, details, isOperational);
    this.errorCode = errorCode;
  }
}
