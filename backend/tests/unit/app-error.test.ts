import {
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  InternalServerError
} from '../../src/utils/errors';

describe('AppError Hierarchy', () => {
  it('should instantiate ValidationError with 400 status code', () => {
    const error = new ValidationError('Invalid input', [{ field: 'email', message: 'Invalid email' }]);
    expect(error.statusCode).toBe(400);
    expect(error.errorCode).toBe('VALIDATION_ERROR');
    expect(error.message).toBe('Invalid input');
    expect(error.details).toHaveLength(1);
    expect(error.isOperational).toBe(true);
  });

  it('should instantiate UnauthorizedError with 401 status code', () => {
    const error = new UnauthorizedError('Token expired', [], 'INVALID_TOKEN');
    expect(error.statusCode).toBe(401);
    expect(error.errorCode).toBe('INVALID_TOKEN');
    expect(error.message).toBe('Token expired');
  });

  it('should instantiate ForbiddenError with 403 status code', () => {
    const error = new ForbiddenError('Upgrade to Premium required', [], 'PREMIUM_REQUIRED');
    expect(error.statusCode).toBe(403);
    expect(error.errorCode).toBe('PREMIUM_REQUIRED');
  });

  it('should instantiate NotFoundError with 404 status code', () => {
    const error = new NotFoundError('User not found', [], 'USER_NOT_FOUND');
    expect(error.statusCode).toBe(404);
    expect(error.errorCode).toBe('USER_NOT_FOUND');
  });

  it('should instantiate ConflictError with 409 status code', () => {
    const error = new ConflictError('Email already registered', [], 'DUPLICATE_IDENTIFIER');
    expect(error.statusCode).toBe(409);
    expect(error.errorCode).toBe('DUPLICATE_IDENTIFIER');
  });

  it('should instantiate RateLimitError with 429 status code', () => {
    const error = new RateLimitError('Daily swipe limit reached', [], 'DAILY_LIMIT_REACHED');
    expect(error.statusCode).toBe(429);
    expect(error.errorCode).toBe('DAILY_LIMIT_REACHED');
  });

  it('should instantiate InternalServerError with 500 status code', () => {
    const error = new InternalServerError('Database unavailable');
    expect(error.statusCode).toBe(500);
    expect(error.errorCode).toBe('INTERNAL_SERVER_ERROR');
    expect(error.isOperational).toBe(false);
  });
});
