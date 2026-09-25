import { NextFunction, Request, Response } from 'express';
import type { UserRole } from '../database/models/user.model';
import { ForbiddenError, UnauthorizedError } from '../utils/errors';

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError('Authentication required.', [], 'AUTH_REQUIRED'));
      return;
    }

    if (!roles.includes(req.user.role)) {
      next(new ForbiddenError('You do not have permission to perform this action.', [], 'FORBIDDEN'));
      return;
    }

    next();
  };
}
