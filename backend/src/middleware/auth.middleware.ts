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

export async function authenticateAccessToken(token: string): Promise<AuthenticatedUser> {
  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError || error instanceof jwt.JsonWebTokenError) {
      throw unauthorized('Invalid token.', 'INVALID_TOKEN');
    }
    throw error;
  }

  const user = await findUserById(claims.sub);
  if (!user || user.status === 'DELETED' || user.deletedAt) {
    throw unauthorized('Invalid token.', 'INVALID_TOKEN');
  }

  if (user.status === 'SUSPENDED') {
    throw new ForbiddenError('Account is suspended.', [], 'ACCOUNT_SUSPENDED');
  }

  if (user.status === 'BANNED') {
    throw new ForbiddenError('Account is banned.', [], 'ACCOUNT_BANNED');
  }

  const isProfileComplete = await findProfileCompletion(user.id);
  return {
    id: user.id,
    role: user.role,
    status: user.status,
    isVerified: computeIsVerified(user),
    isProfileComplete
  };
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

    req.user = await authenticateAccessToken(token);
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
