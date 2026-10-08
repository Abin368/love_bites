import type { ExtendedError, Socket } from 'socket.io';
import { authenticateAccessToken } from '../middleware/auth.middleware';
import type { AuthenticatedUser } from '../modules/auth/auth.types';
import { AppError, ForbiddenError, UnauthorizedError } from '../utils/errors';
import { logger } from '../utils/logger';

declare module 'socket.io' {
  interface SocketData {
    user: AuthenticatedUser;
  }
}

const USER_ROLE_MESSAGE = 'You do not have permission to perform this action.';

function handshakeError(error: AppError): ExtendedError {
  const handshake = new Error(error.message) as ExtendedError;
  handshake.data = { code: error.errorCode };
  return handshake;
}

function readAccessToken(socket: Socket): string | undefined {
  const token = socket.handshake.auth?.token;
  if (typeof token !== 'string' || token.length === 0) {
    return undefined;
  }
  return token;
}

export function authenticateSocket(socket: Socket, next: (err?: ExtendedError) => void): void {
  const token = readAccessToken(socket);
  if (!token) {
    next(handshakeError(new UnauthorizedError('Authentication required.', [], 'AUTH_REQUIRED')));
    return;
  }

  authenticateAccessToken(token)
    .then((user) => {
      if (user.role !== 'USER') {
        next(handshakeError(new ForbiddenError(USER_ROLE_MESSAGE, [], 'FORBIDDEN')));
        return;
      }
      socket.data.user = user;
      next();
    })
    .catch((error: unknown) => {
      if (error instanceof AppError) {
        next(handshakeError(error));
        return;
      }
      logger.error('Socket.IO handshake failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      next(new Error('An unexpected error occurred. Please try again later.'));
    });
}
