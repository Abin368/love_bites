import { AppError, ErrorDetail } from './app.error';

export class NotFoundError extends AppError {
  public readonly statusCode = 404;
  public readonly errorCode: string;

  constructor(message = 'Resource not found', details: ErrorDetail[] = [], errorCode = 'RESOURCE_NOT_FOUND') {
    super(message, details);
    this.errorCode = errorCode;
  }
}
