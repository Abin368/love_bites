import { AppError, ErrorDetail } from './app.error';

export class UnauthorizedError extends AppError {
  public readonly statusCode = 401;
  public readonly errorCode: string;

  constructor(message = 'Authentication required', details: ErrorDetail[] = [], errorCode = 'AUTH_REQUIRED') {
    super(message, details);
    this.errorCode = errorCode;
  }
}
