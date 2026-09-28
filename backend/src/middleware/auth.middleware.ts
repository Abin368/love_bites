import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { ForbiddenError, UnauthorizedError } from '../utils/errors';
import { verifyAccessToken } from '../utils/jwt';
import { findProfileCompletion, findUserById } from '../modules/users/users.data-access';
import { AuthenticatedUser, computeIsVerified } from '../modules/auth/auth.types';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

function unauthorized(message: string, errorCode: 'AUTH_REQUIRED' | 'INVALID_TOKEN'): UnauthorizedError {
  return new UnauthorizedError(message, [], errorCode);
}

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header('authorization');
    if (!header) {
      next(unauthorized('Authentication required.', 'AUTH_REQUIRED'));
      return;
    }

    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      next(unauthorized('Authentication required.', 'AUTH_REQUIRED'));
      return;
    }

    let claims;
    try {
      claims = verifyAccessToken(token);
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError || error instanceof jwt.JsonWebTokenError) {
        next(unauthorized('Invalid token.', 'INVALID_TOKEN'));
        return;
      }
      throw error;
    }

    const user = await findUserById(claims.sub);
    if (!user || user.status === 'DELETED' || user.deletedAt) {
      next(unauthorized('Invalid token.', 'INVALID_TOKEN'));
      return;
    }

    if (user.status === 'SUSPENDED') {
      next(new ForbiddenError('Account is suspended.', [], 'ACCOUNT_SUSPENDED'));
      return;
    }

    if (user.status === 'BANNED') {
      next(new ForbiddenError('Account is banned.', [], 'ACCOUNT_BANNED'));
      return;
    }

    const isProfileComplete = await findProfileCompletion(user.id);
    req.user = {
      id: user.id,
      role: user.role,
      status: user.status,
      isVerified: computeIsVerified(user),
      isProfileComplete
    };
    next();
  } catch (error) {
    next(error);
  }
}

export async function requireVerified(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      next(unauthorized('Authentication required.', 'AUTH_REQUIRED'));
      return;
    }

    const user = await findUserById(req.user.id);
    if (!user || user.status === 'DELETED' || user.deletedAt) {
      next(unauthorized('Invalid token.', 'INVALID_TOKEN'));
      return;
    }

    if (computeIsVerified(user)) {
      next();
      return;
    }

    if (user.email && !user.emailVerified) {
      next(new ForbiddenError('Email verification is required.', [], 'EMAIL_NOT_VERIFIED'));
      return;
    }

    next(new ForbiddenError('Phone verification is required.', [], 'PHONE_NOT_VERIFIED'));
  } catch (error) {
    next(error);
  }
}
