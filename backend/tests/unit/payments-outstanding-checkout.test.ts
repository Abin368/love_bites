import { UniqueConstraintError } from 'sequelize';
import {
  isIdempotencyUniqueViolation,
  isOutstandingCheckoutUniqueViolation
} from '../../src/modules/payments/payments.data-access';

function uniqueError(constraint: string, extras: string[] = []): UniqueConstraintError {
  return new UniqueConstraintError({
    message: `duplicate key value violates unique constraint "${constraint}"`,
    errors: [],
    fields: {},
    parent: {
      constraint,
      detail: extras.join(' ')
    } as Error & { constraint: string; detail: string }
  });
}

describe('outstanding checkout unique-violation mapping', () => {
  it('recognizes only the one-unresolved-subscription-checkout index', () => {
    expect(
      isOutstandingCheckoutUniqueViolation(
        uniqueError('uq_payments_one_unresolved_subscription_checkout_per_user')
      )
    ).toBe(true);
  });

  it('does not treat the idempotency unique index as an outstanding-checkout conflict', () => {
    const error = uniqueError('uq_payments_user_idempotency_key', ['idempotency_key']);
    expect(isOutstandingCheckoutUniqueViolation(error)).toBe(false);
    expect(isIdempotencyUniqueViolation(error)).toBe(true);
  });

  it('does not treat an unrelated unique violation as an outstanding-checkout conflict', () => {
    const error = uniqueError('uq_payments_provider_order_id', ['provider_order_id']);
    expect(isOutstandingCheckoutUniqueViolation(error)).toBe(false);
    expect(isIdempotencyUniqueViolation(error)).toBe(false);
  });

  it('ignores non-unique errors', () => {
    expect(isOutstandingCheckoutUniqueViolation(new Error('boom'))).toBe(false);
    expect(isOutstandingCheckoutUniqueViolation(null)).toBe(false);
  });
});
