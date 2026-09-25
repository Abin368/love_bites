import { AppError, ErrorDetail } from './app.error';

export class UnprocessableEntityError extends AppError {
  public readonly statusCode = 422;
  public readonly errorCode: string;

  constructor(
    message = 'Unprocessable entity',
    details: ErrorDetail[] = [],
    errorCode = 'UNDERAGE_NOT_PERMITTED'
  ) {
    super(message, details);
    this.errorCode = errorCode;
  }
}
