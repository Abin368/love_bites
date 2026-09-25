import { NextFunction, Request, Response } from 'express';
import { ZodError, ZodIssue, ZodTypeAny } from 'zod';
import { ErrorDetail, UnprocessableEntityError, ValidationError } from '../utils/errors';

function isUnderageIssue(issue: ZodIssue): boolean {
  return issue.code === 'custom' && 'params' in issue && issue.params?.errorCode === 'UNDERAGE_NOT_PERMITTED';
}

function toDetails(issues: ZodIssue[]): ErrorDetail[] {
  return issues.map((issue) => ({
    field: issue.path.map(String).join('.'),
    message: issue.message,
    code: issue.code
  }));
}

export function validate(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.body);

    if (!parsed.success) {
      const error = parsed.error as ZodError;
      const underage = error.issues.filter(isUnderageIssue);
      const other = error.issues.filter((issue) => !isUnderageIssue(issue));

      if (underage.length > 0 && other.length === 0) {
        next(
          new UnprocessableEntityError(
            'You must be at least 18 years old.',
            toDetails(underage),
            'UNDERAGE_NOT_PERMITTED'
          )
        );
        return;
      }

      next(new ValidationError('Validation failed', toDetails(error.issues)));
      return;
    }

    req.body = parsed.data;
    next();
  };
}
