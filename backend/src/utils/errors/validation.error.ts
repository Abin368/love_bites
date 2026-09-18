import { AppError, ErrorDetail } from './app.error';

export class ValidationError extends AppError {
  public readonly statusCode = 400;
  public readonly errorCode: string;

  constructor(message = 'Validation failed', details: ErrorDetail[] = [], errorCode = 'VALIDATION_ERROR') {
    super(message, details);
    this.errorCode = errorCode;
  }
}
