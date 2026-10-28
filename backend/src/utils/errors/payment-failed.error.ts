import { AppError, ErrorDetail } from './app.error';

export class PaymentFailedError extends AppError {
  public readonly statusCode = 402;
  public readonly errorCode = 'PAYMENT_FAILED';

  constructor(message = 'Payment could not be initiated.', details: ErrorDetail[] = []) {
    super(message, details);
  }
}
