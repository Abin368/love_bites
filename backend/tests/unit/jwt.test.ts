import jwt from 'jsonwebtoken';
import { env } from '../../src/config/env';
import { signAccessToken, verifyAccessToken } from '../../src/utils/jwt';

const claims = {
  sub: 'b2f6c91a-8821-4122-901b-5e4d29381029',
  role: 'USER' as const,
  isVerified: true,
  isProfileComplete: false
};

describe('access tokens', () => {
  it('signs and verifies an HS256 access token with the required claims', () => {
    const token = signAccessToken(claims);
    const header = jwt.decode(token, { complete: true })?.header;
    expect(header?.alg).toBe('HS256');

    const verified = verifyAccessToken(token);
    expect(verified).toMatchObject(claims);

    const decoded = jwt.decode(token) as jwt.JwtPayload;
    expect(decoded.email).toBeUndefined();
    expect(decoded.phone).toBeUndefined();
    expect(decoded.password).toBeUndefined();
    expect(decoded.passwordHash).toBeUndefined();
    expect(typeof decoded.iat).toBe('number');
    expect(typeof decoded.exp).toBe('number');
    expect((decoded.exp ?? 0) - (decoded.iat ?? 0)).toBe(900);
  });

  it('rejects an expired access token', () => {
    const expired = jwt.sign(
      { ...claims, exp: Math.floor(Date.now() / 1000) - 10 },
      env.JWT_ACCESS_SECRET,
      { algorithm: 'HS256' }
    );
    expect(() => verifyAccessToken(expired)).toThrow();
  });
});
