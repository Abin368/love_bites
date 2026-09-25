import { assessRefreshToken } from '../../src/modules/auth/auth.types';

describe('refresh token assessment', () => {
  const now = new Date('2026-09-24T10:00:00.000Z');

  it('rotates a live token', () => {
    expect(
      assessRefreshToken(
        {
          userId: 'user-1',
          revokedAt: null,
          expiresAt: new Date('2026-09-30T10:00:00.000Z')
        },
        now
      )
    ).toEqual({ action: 'rotate', userId: 'user-1' });
  });

  it('treats a revoked token as reuse', () => {
    expect(
      assessRefreshToken(
        {
          userId: 'user-1',
          revokedAt: new Date('2026-09-24T09:00:00.000Z'),
          expiresAt: new Date('2026-09-30T10:00:00.000Z')
        },
        now
      )
    ).toEqual({ action: 'reuse', userId: 'user-1' });
  });

  it('rejects a missing or expired token without reuse', () => {
    expect(assessRefreshToken(null, now)).toEqual({ action: 'invalid' });
    expect(
      assessRefreshToken(
        {
          userId: 'user-1',
          revokedAt: null,
          expiresAt: new Date('2026-09-24T09:59:00.000Z')
        },
        now
      )
    ).toEqual({ action: 'invalid' });
  });
});
