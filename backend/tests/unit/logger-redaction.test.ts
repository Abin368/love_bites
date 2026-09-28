import { redactSensitiveData } from '../../src/utils/logger';

describe('logger redaction', () => {
  it('redacts password hashes, access tokens, and new passwords', () => {
    const redacted = redactSensitiveData({
      password: 'plain',
      passwordHash: 'hash',
      password_hash: 'hash2',
      accessToken: 'jwt',
      access_token: 'jwt2',
      newPassword: 'next',
      new_password: 'next2',
      refreshToken: 'opaque',
      otp: '123456',
      token: 'reset',
      nested: { accessToken: 'inner' },
      status: 'ACTIVE'
    });

    expect(redacted.password).toBe('[REDACTED]');
    expect(redacted.passwordHash).toBe('[REDACTED]');
    expect(redacted.password_hash).toBe('[REDACTED]');
    expect(redacted.accessToken).toBe('[REDACTED]');
    expect(redacted.access_token).toBe('[REDACTED]');
    expect(redacted.newPassword).toBe('[REDACTED]');
    expect(redacted.new_password).toBe('[REDACTED]');
    expect(redacted.refreshToken).toBe('[REDACTED]');
    expect(redacted.otp).toBe('[REDACTED]');
    expect(redacted.token).toBe('[REDACTED]');
    expect(redacted.nested.accessToken).toBe('[REDACTED]');
    expect(redacted.status).toBe('ACTIVE');
  });
});
