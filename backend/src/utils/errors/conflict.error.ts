import { AppError, ErrorDetail } from './app.error';

export class ConflictError extends AppError {
  public readonly statusCode = 409;
  public readonly errorCode: string;

  constructor(message = 'Resource conflict', details: ErrorDetail[] = [], errorCode = 'CONFLICT') {
    super(message, details);
    this.errorCode = errorCode;
  }
}
