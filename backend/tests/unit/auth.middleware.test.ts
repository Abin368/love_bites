import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { authenticate, requireVerified } from '../../src/middleware/auth.middleware';
import { requireRole } from '../../src/middleware/role.middleware';
import { signAccessToken } from '../../src/utils/jwt';
import * as usersDataAccess from '../../src/modules/users/users.data-access';

jest.mock('../../src/modules/users/users.data-access', () => ({
  findUserById: jest.fn(),
  findProfileCompletion: jest.fn()
}));

const findUserById = usersDataAccess.findUserById as jest.Mock;
const findProfileCompletion = usersDataAccess.findProfileCompletion as jest.Mock;

function run(
  middleware: (req: Request, res: Response, next: (error?: unknown) => void) => unknown,
  req: Request
) {
  return new Promise<{ req: Request; error?: { statusCode?: number; errorCode?: string } }>((resolve) => {
    const request = req as Request;
    middleware(request, {} as Response, (error?: unknown) => {
      resolve({ req: request, error: error as { statusCode?: number; errorCode?: string } | undefined });
    });
  });
}

describe('auth middleware', () => {
  const user = {
    id: 'user-1',
    role: 'USER',
    status: 'UNVERIFIED',
    email: 'alex@example.com',
    phone: null,
    emailVerified: false,
    phoneVerified: false,
    deletedAt: null
  };

  beforeEach(() => {
    findUserById.mockResolvedValue(user);
    findProfileCompletion.mockResolvedValue(false);
  });

  it('rejects a missing bearer token', async () => {
    const result = await run(authenticate, { header: () => undefined } as unknown as Request);
    expect(result.error?.statusCode).toBe(401);
    expect(result.error?.errorCode).toBe('AUTH_REQUIRED');
  });

  it('rejects an expired token', async () => {
    const token = jwt.sign(
      { sub: user.id, role: 'USER', isVerified: false, isProfileComplete: false, exp: Math.floor(Date.now() / 1000) - 5 },
      process.env.JWT_ACCESS_SECRET || 'development-jwt-access-secret-minimum-16-chars',
      { algorithm: 'HS256' }
    );
    const result = await run(authenticate, { header: () => `Bearer ${token}` } as unknown as Request);
    expect(result.error?.errorCode).toBe('INVALID_TOKEN');
  });

  it('authenticates an unverified user without exposing the password hash', async () => {
    const token = signAccessToken({
      sub: user.id,
      role: 'USER',
      isVerified: false,
      isProfileComplete: false
    });
    const result = await run(authenticate, { header: () => `Bearer ${token}` } as unknown as Request);
    expect(result.error).toBeUndefined();
    expect(result.req.user).toEqual({
      id: 'user-1',
      role: 'USER',
      status: 'UNVERIFIED',
      isVerified: false,
      isProfileComplete: false
    });
    expect(result.req.user).not.toHaveProperty('passwordHash');
  });

  it('rejects suspended, banned, and deleted users', async () => {
    const token = signAccessToken({
      sub: user.id,
      role: 'USER',
      isVerified: true,
      isProfileComplete: false
    });
    const header = (() => `Bearer ${token}`) as unknown as Request['header'];
    const request = { header } as Request;

    findUserById.mockResolvedValue({ ...user, status: 'SUSPENDED', emailVerified: true });
    expect((await run(authenticate, request)).error?.errorCode).toBe('ACCOUNT_SUSPENDED');

    findUserById.mockResolvedValue({ ...user, status: 'BANNED', emailVerified: true });
    expect((await run(authenticate, request)).error?.errorCode).toBe('ACCOUNT_BANNED');

    findUserById.mockResolvedValue(null);
    expect((await run(authenticate, request)).error?.errorCode).toBe('INVALID_TOKEN');
  });

  it('lets verified routes reject an unverified email user', async () => {
    const result = await run(requireVerified, {
      user: { id: user.id, role: 'USER', status: 'UNVERIFIED', isVerified: false, isProfileComplete: false }
    } as Request);
    expect(result.error?.errorCode).toBe('EMAIL_NOT_VERIFIED');
  });
});

describe('role middleware', () => {
  it('allows a matching role and rejects everyone else', () => {
    const next = jest.fn();
    requireRole('ADMIN')({ user: { id: '1', role: 'ADMIN', status: 'ACTIVE', isVerified: true, isProfileComplete: false } } as Request, {} as Response, next);
    expect(next).toHaveBeenCalledWith();

    const denied = jest.fn();
    requireRole('ADMIN')({ user: { id: '1', role: 'USER', status: 'ACTIVE', isVerified: true, isProfileComplete: false } } as Request, {} as Response, denied);
    expect(denied.mock.calls[0][0].errorCode).toBe('FORBIDDEN');
  });
});
