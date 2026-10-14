import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { ValidationError, type ErrorDetail } from '../../utils/errors';

const REPORT_REASONS = [
  'FAKE_PROFILE',
  'HARASSMENT',
  'SPAM',
  'INAPPROPRIATE_CONTENT',
  'SCAM',
  'OTHER'
] as const;

function reportReasonMessage(issue: z.ZodIssueOptionalMessage, ctx: z.ErrorMapCtx): { message: string } {
  if (issue.code === z.ZodIssueCode.invalid_type && ctx.data === undefined) {
    return { message: 'Reason is required.' };
  }
  return { message: 'Reason must be a valid report reason.' };
}

export const submitReportSchema = z
  .object({
    reportedUserId: z
      .string({
        required_error: 'Reported user id is required.',
        invalid_type_error: 'Reported user id must be a valid UUID.'
      })
      .uuid('Reported user id must be a valid UUID.'),
    reason: z.enum(REPORT_REASONS, { errorMap: reportReasonMessage }),
    description: z
      .string({
        invalid_type_error: 'Description must be a string.'
      })
      .optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.reason === 'OTHER' && (value.description ?? '').trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['description'],
        message: 'A description is required when the reason is OTHER.'
      });
    }
  })
  .transform((value) => {
    const description = (value.description ?? '').trim();
    return {
      reportedUserId: value.reportedUserId.toLowerCase(),
      reason: value.reason,
      description: description.length > 0 ? description : null
    };
  });

export type SubmitReportBody = z.infer<typeof submitReportSchema>;

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
