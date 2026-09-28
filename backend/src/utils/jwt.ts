import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import type { UserRole } from '../database/models/user.model';

export interface AccessTokenClaims {
  sub: string;
  role: UserRole;
  isVerified: boolean;
  isProfileComplete: boolean;
}

const DURATION_MULTIPLIERS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400
};

export function parseDurationSeconds(value: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(value.trim());
  if (!match) {
    return 900;
  }
  return Number(match[1]) * DURATION_MULTIPLIERS[match[2]];
}

export function accessTokenTtlSeconds(): number {
  return parseDurationSeconds(env.JWT_ACCESS_EXPIRATION);
}

export function signAccessToken(claims: AccessTokenClaims): string {
  const options: SignOptions = {
    algorithm: 'HS256',
    expiresIn: accessTokenTtlSeconds()
  };

  return jwt.sign(
    {
      sub: claims.sub,
      role: claims.role,
      isVerified: claims.isVerified,
      isProfileComplete: claims.isProfileComplete
    },
    env.JWT_ACCESS_SECRET,
    options
  );
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ['HS256']
  });

  if (typeof decoded === 'string' || !isAccessPayload(decoded)) {
    throw new jwt.JsonWebTokenError('Invalid access token payload');
  }

  return {
    sub: decoded.sub,
    role: decoded.role,
    isVerified: decoded.isVerified,
    isProfileComplete: decoded.isProfileComplete
  };
}

function isAccessPayload(payload: JwtPayload): payload is JwtPayload & AccessTokenClaims {
  return (
    typeof payload.sub === 'string' &&
    (payload.role === 'USER' || payload.role === 'ADMIN') &&
    typeof payload.isVerified === 'boolean' &&
    typeof payload.isProfileComplete === 'boolean'
  );
}
