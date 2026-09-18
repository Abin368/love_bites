import { AppError, ErrorDetail } from './app.error';

export class ForbiddenError extends AppError {
  public readonly statusCode = 403;
  public readonly errorCode: string;

  constructor(message = 'Access forbidden', details: ErrorDetail[] = [], errorCode = 'FORBIDDEN') {
    super(message, details);
    this.errorCode = errorCode;
  }
}
