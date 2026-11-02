import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { ValidationError, type ErrorDetail } from '../../utils/errors';

const PRICE_MAX = 2_147_483_647;

const planIdSchema = z.string().uuid('Plan id must be a valid UUID.');

export const updatePlanPriceSchema = z
  .object({
    priceInCents: z
      .number({ invalid_type_error: 'Price must be an integer number of cents.' })
      .int('Price must be an integer number of cents.')
      .min(0, 'Price must be zero or greater.')
      .max(PRICE_MAX, 'Price exceeds the maximum allowed value.')
      .optional(),
    currency: z
      .literal('INR', {
        errorMap: () => ({ message: 'Currency must be INR.' })
      })
      .optional(),
    reason: z
      .string({
        required_error: 'Reason is required.',
        invalid_type_error: 'Reason must be a string.'
      })
      .trim()
      .min(1, 'Reason is required.')
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.priceInCents === undefined && value.currency === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priceInCents'],
        message: 'At least one of priceInCents or currency is required.'
      });
    }
  });

export type UpdatePlanPriceBody = z.infer<typeof updatePlanPriceSchema>;

export function validatePlanIdParam(req: Request, _res: Response, next: NextFunction): void {
  try {
    const raw = req.params.planId;
    const planId = Array.isArray(raw) ? raw[0] : raw;
    const parsed = planIdSchema.safeParse(planId);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', [{ field: 'planId', message: 'Plan id must be a valid UUID.' }]);
    }
    next();
  } catch (error) {
    next(error);
  }
}

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

export function parsePlanId(planId: string): string {
  const parsed = planIdSchema.safeParse(planId);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', [{ field: 'planId', message: 'Plan id must be a valid UUID.' }]);
  }
  return parsed.data.toLowerCase();
}
