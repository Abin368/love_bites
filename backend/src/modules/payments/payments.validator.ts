import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { ValidationError, type ErrorDetail } from '../../utils/errors';

const planIdSchema = z.string().uuid('Plan id must be a valid UUID.');

export const checkoutSchema = z
  .object({
    planId: planIdSchema.transform((planId) => planId.toLowerCase())
  })
  .strict();

export type CheckoutBody = z.infer<typeof checkoutSchema>;

function requiredText(label: string) {
  return z
    .string({
      required_error: `${label} is required.`,
      invalid_type_error: `${label} must be a string.`
    })
    .trim()
    .min(1, `${label} is required.`);
}

export const verifySchema = z
  .object({
    razorpayPaymentId: requiredText('Razorpay payment id'),
    razorpayOrderId: requiredText('Razorpay order id'),
    razorpaySignature: requiredText('Razorpay signature')
  })
  .strict();

export type VerifyBody = z.infer<typeof verifySchema>;

export function validateNoQuery(req: Request, _res: Response, next: NextFunction): void {
  try {
    if (!req.query || typeof req.query !== 'object' || Array.isArray(req.query)) {
      throw new ValidationError('Validation failed', [{ field: 'query', message: 'Query parameters are invalid.' }]);
    }

    const details: ErrorDetail[] = [];
    for (const key of Object.keys(req.query)) {
      details.push({ field: key, message: 'Unsupported query parameter.' });
    }
    if (details.length > 0) {
      throw new ValidationError('Validation failed', details);
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function parseIdempotencyKey(value: string | undefined): string {
  if (value === undefined || value === '') {
    throw new ValidationError('Validation failed', [
      { field: 'Idempotency-Key', message: 'Idempotency-Key is required.' }
    ]);
  }

  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', [
      { field: 'Idempotency-Key', message: 'Idempotency-Key must be a valid UUID.' }
    ]);
  }

  return parsed.data.toLowerCase();
}

export function validateIdempotencyKey(req: Request, _res: Response, next: NextFunction): void {
  try {
    parseIdempotencyKey(req.get('Idempotency-Key'));
    next();
  } catch (error) {
    next(error);
  }
}
