import { AppError, ErrorDetail } from './app.error';

export class RateLimitError extends AppError {
  public readonly statusCode = 429;
  public readonly errorCode: string;

  constructor(message = 'Too many requests', details: ErrorDetail[] = [], errorCode = 'RATE_LIMITED') {
    super(message, details);
    this.errorCode = errorCode;
  }
}
