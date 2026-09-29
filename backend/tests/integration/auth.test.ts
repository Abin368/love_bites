import request from 'supertest';
import jwt from 'jsonwebtoken';
import { mockEmailService } from '../../src/integrations/email/mock-email.service';
import { mockSmsService } from '../../src/integrations/sms/mock-sms.service';
import { sha256 } from '../../src/utils/crypto';
import { markUserDeleted, memoryAuth, resetMemoryAuth, setUserStatus } from '../helpers/memory-auth-store';
import { resetMemoryRedis } from '../helpers/memory-redis';

jest.mock('../../src/config/database', () => ({
  sequelize: {
    transaction: async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (transaction: object) => Promise<unknown>)({});
      }
      return undefined;
    },
    authenticate: async () => undefined,
    close: async () => undefined
  }
}));

jest.mock('../../src/config/redis', () => jest.requireActual('../helpers/memory-redis'));
jest.mock('../../src/modules/users/users.data-access', () => jest.requireActual('../helpers/memory-auth-store'));
jest.mock('../../src/modules/auth/auth.data-access', () => jest.requireActual('../helpers/memory-auth-store'));
jest.mock('../../src/modules/genders/genders.data-access', () => ({
  findActiveGenders: async () => []
}));
jest.mock('../../src/modules/interests/interests.data-access', () => ({
  findActiveInterests: async () => []
}));
jest.mock('../../src/modules/relationship-intentions/relationship-intentions.data-access', () => ({
  findActiveRelationshipIntentions: async () => []
}));
jest.mock('../../src/modules/profiles/profiles.data-access', () => ({
  findGenderById: async () => null,
  findProfileByUserId: async () => null,
  createProfile: async () => {
    throw new Error('profile data access is not used by authentication tests');
  },
  updateProfile: async () => undefined
}));

import { app } from '../../src/app';

jest.setTimeout(180000);

const PASSWORD = 'SecurePassword123!';

function registration(overrides: Record<string, unknown> = {}) {
  return {
    email: 'alex.morgan@example.com',
    password: PASSWORD,
    dateOfBirth: '2000-01-15',
    termsAccepted: true,
    privacyAccepted: true,
    ...overrides
  };
}

function codeFrom(text: string): string {
  const match = text.match(/\b(\d{6})\b/);
  if (!match) {
    throw new Error('verification code missing');
  }
  return match[1];
}

function resetTokenFrom(text: string): string {
  const match = text.match(/\b([a-f0-9]{64})\b/i);
  if (!match) {
    throw new Error('reset token missing');
  }
  return match[1];
}

function setCookie(res: request.Response): string {
  const header = res.headers['set-cookie'];
  const cookies = Array.isArray(header) ? header : header ? [header] : [];
  const cookie = cookies.find((item) => item.startsWith('refreshToken='));
  if (!cookie) {
    throw new Error('refresh cookie missing');
  }
  return cookie;
}

async function registerUser(email = 'alex.morgan@example.com') {
  const response = await request(app).post('/api/v1/auth/register').send(registration({ email }));
  expect(response.status).toBe(201);
  return response;
}

async function verifyEmail(email: string) {
  const message = mockEmailService.outbox.find((item) => item.to === email);
  if (!message) {
    throw new Error('email missing');
  }
  return request(app).post('/api/v1/auth/verify-email').send({ email, token: codeFrom(message.text) });
}

describe('authentication API', () => {
  beforeEach(() => {
    resetMemoryAuth();
    resetMemoryRedis();
    mockEmailService.clear();
    mockSmsService.clear();
  });

  it('registers an email account without persisting date of birth', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send(registration({ email: 'Alex.Morgan@Example.com', extra: 'ignored' }));

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      email: 'alex.morgan@example.com',
      phone: null,
      status: 'UNVERIFIED',
      emailVerified: false,
      phoneVerified: false,
      nextStep: 'VERIFY_EMAIL'
    });
    expect(response.body.data).not.toHaveProperty('password');
    expect(response.body.data).not.toHaveProperty('dateOfBirth');
    expect(memoryAuth.users[0]).not.toHaveProperty('dateOfBirth');
    expect(mockEmailService.outbox).toHaveLength(1);
    expect(mockSmsService.outbox).toHaveLength(0);
  });

  it('registers phone-only and dual identifiers with email verification first', async () => {
    const phoneOnly = await request(app)
      .post('/api/v1/auth/register')
      .send(registration({ email: undefined, phone: '+919876543210' }));
    expect(phoneOnly.status).toBe(201);
    expect(phoneOnly.body.data.nextStep).toBe('VERIFY_PHONE');
    expect(mockSmsService.outbox).toHaveLength(1);

    const both = await request(app)
      .post('/api/v1/auth/register')
      .send(registration({ email: 'both@example.com', phone: '+14155552671' }));
    expect(both.body.data.nextStep).toBe('VERIFY_EMAIL');
    expect(both.body.data.phone).toBe('+14155552671');
    expect(mockEmailService.outbox.map((item) => item.to)).toContain('both@example.com');
  });

  it('rejects a duplicate identifier', async () => {
    await registerUser();
    const response = await request(app).post('/api/v1/auth/register').send(registration());
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('DUPLICATE_IDENTIFIER');
  });

  it('rejects underage registration', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send(registration({ dateOfBirth: '2015-01-01' }));
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('UNDERAGE_NOT_PERMITTED');
    expect(memoryAuth.users).toHaveLength(0);
  });

  it('verifies email and phone codes and locks an OTP after three failures', async () => {
    await registerUser('verify@example.com');
    const verified = await verifyEmail('verify@example.com');
    expect(verified.status).toBe(200);
    expect(verified.body.data).toEqual({ verified: true, status: 'ACTIVE' });

    await request(app).post('/api/v1/auth/register').send(registration({ email: undefined, phone: '+447911123456' }));
    const sms = mockSmsService.outbox[0];
    const phoneVerified = await request(app)
      .post('/api/v1/auth/verify-phone')
      .send({ phone: '+447911123456', otp: codeFrom(sms.text) });
    expect(phoneVerified.body.data.status).toBe('ACTIVE');

    await registerUser('attempts@example.com');
    const wrong = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: 'attempts@example.com', token: '000000' });
    expect(wrong.status).toBe(401);
    await request(app).post('/api/v1/auth/verify-email').send({ email: 'attempts@example.com', token: '000000' });
    await request(app).post('/api/v1/auth/verify-email').send({ email: 'attempts@example.com', token: '000000' });
    const message = mockEmailService.outbox.find((item) => item.to === 'attempts@example.com');
    const afterLock = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ email: 'attempts@example.com', token: codeFrom(message!.text) });
    expect(afterLock.status).toBe(401);
    expect(afterLock.body.error.code).toBe('INVALID_TOKEN');
  });

  it('logs in a verified user and rejects a wrong password', async () => {
    await registerUser();
    await verifyEmail('alex.morgan@example.com');
    const wrong = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'alex.morgan@example.com', password: 'WrongPassword123!' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'Alex.Morgan@Example.com', password: PASSWORD });
    expect(response.status).toBe(200);
    expect(response.body.data.expiresIn).toBe(900);
    expect(response.body.data.user.isVerified).toBe(true);
    expect(response.body.data.user.isProfileComplete).toBe(false);
    expect(response.body.data.refreshToken).toBeUndefined();
    const cookie = setCookie(response);
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(cookie.toLowerCase()).toContain('samesite=strict');
    expect(cookie).toContain('Path=/api/v1/auth/refresh');
    const decoded = jwt.decode(response.body.data.accessToken) as jwt.JwtPayload;
    expect(decoded.email).toBeUndefined();
    expect(decoded.sub).toBe(response.body.data.user.id);
  });

  it('returns invalid credentials for a deleted user', async () => {
    await registerUser('gone@example.com');
    markUserDeleted('gone@example.com');
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'gone@example.com', password: PASSWORD });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('blocks a suspended user', async () => {
    await registerUser('suspended@example.com');
    setUserStatus('suspended@example.com', 'SUSPENDED');
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'suspended@example.com', password: PASSWORD });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('blocks a banned user', async () => {
    await registerUser('banned@example.com');
    setUserStatus('banned@example.com', 'BANNED');
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'banned@example.com', password: PASSWORD });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ACCOUNT_BANNED');
  });

  it('lets an unverified user log in and log out', async () => {
    await registerUser('pending@example.com');
    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'pending@example.com', password: PASSWORD });
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.data.user.status).toBe('UNVERIFIED');
    expect(loginResponse.body.data.user.isVerified).toBe(false);

    const logoutResponse = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${loginResponse.body.data.accessToken}`)
      .set('Cookie', setCookie(loginResponse).split(';')[0]);
    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.body.data).toBeNull();
  });

  it('rotates a refresh token and stores only the SHA-256 hash', async () => {
    await registerUser();
    await verifyEmail('alex.morgan@example.com');
    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'alex.morgan@example.com', password: PASSWORD });
    const firstCookie = setCookie(loginResponse);
    const raw = firstCookie.split(';')[0].split('=')[1];
    expect(memoryAuth.tokens.some((token) => token.tokenHash === sha256(raw))).toBe(true);
    expect(memoryAuth.tokens.some((token) => token.tokenHash === raw)).toBe(false);

    const refreshed = await request(app).post('/api/v1/auth/refresh').set('Cookie', firstCookie.split(';')[0]);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).toEqual(expect.any(String));
    const previous = memoryAuth.tokens.find((token) => token.tokenHash === sha256(raw));
    const nextRaw = setCookie(refreshed).split(';')[0].split('=')[1];
    expect(nextRaw).not.toBe(raw);
    expect(previous?.revokedAt).toBeTruthy();
    expect(previous?.replacedByHash).toBe(sha256(nextRaw));
  });

  it('revokes every active session when a rotated refresh token is reused', async () => {
    await registerUser('reuse@example.com');
    await verifyEmail('reuse@example.com');
    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'reuse@example.com', password: PASSWORD });
    const first = setCookie(loginResponse).split(';')[0];
    const rotated = await request(app).post('/api/v1/auth/refresh').set('Cookie', first);
    const second = setCookie(rotated).split(';')[0];

    const reuse = await request(app).post('/api/v1/auth/refresh').set('Cookie', first);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('INVALID_TOKEN');
    expect(memoryAuth.tokens.every((token) => token.revokedAt)).toBe(true);

    const followUp = await request(app).post('/api/v1/auth/refresh').set('Cookie', second);
    expect(followUp.status).toBe(401);
  });

  it('logs out an authenticated user and clears the refresh cookie', async () => {
    await registerUser('logout@example.com');
    await verifyEmail('logout@example.com');
    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'logout@example.com', password: PASSWORD });
    const cookie = setCookie(loginResponse).split(';')[0];
    const response = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${loginResponse.body.data.accessToken}`)
      .set('Cookie', cookie);
    expect(response.status).toBe(200);
    expect(String(response.headers['set-cookie'])).toContain('refreshToken=');
    const refresh = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(refresh.status).toBe(401);
  });

  it('returns a generic forgot-password response and resets the password', async () => {
    const missing = await request(app).post('/api/v1/auth/forgot-password').send({ identifier: 'missing@example.com' });
    expect(missing.status).toBe(200);
    expect(missing.body.message).toContain('If an account exists');

    await registerUser('reset@example.com');
    const sent = await request(app).post('/api/v1/auth/forgot-password').send({ identifier: 'reset@example.com' });
    expect(sent.status).toBe(200);
    const token = resetTokenFrom(
      mockEmailService.outbox.find((item) => item.to === 'reset@example.com' && item.subject.includes('Reset'))!.text
    );
    const reset = await request(app).post('/api/v1/auth/reset-password').send({
      identifier: 'reset@example.com',
      token,
      newPassword: 'ChangedPassword123!'
    });
    expect(reset.status).toBe(200);

    const oldPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'reset@example.com', password: PASSWORD });
    expect(oldPassword.status).toBe(401);
    const nextLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'reset@example.com', password: 'ChangedPassword123!' });
    expect(nextLogin.status).toBe(200);
  });

  it('revokes refresh sessions when the password is reset', async () => {
    await registerUser('session@example.com');
    await verifyEmail('session@example.com');
    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'session@example.com', password: PASSWORD });
    const cookie = setCookie(loginResponse).split(';')[0];
    const forgot = await request(app).post('/api/v1/auth/forgot-password').send({ identifier: 'session@example.com' });
    expect(forgot.status).toBe(200);
    const token = resetTokenFrom(mockEmailService.outbox.find((item) => item.subject.includes('Reset'))!.text);
    const reset = await request(app).post('/api/v1/auth/reset-password').send({
      identifier: 'session@example.com',
      token,
      newPassword: 'ChangedPassword123!'
    });
    expect(reset.status).toBe(200);
    expect(memoryAuth.tokens.every((item) => item.revokedAt)).toBe(true);
    const refresh = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(refresh.status).toBe(401);
  });

  it('enforces the verification resend cooldown', async () => {
    await registerUser('cooldown@example.com');
    const first = await request(app)
      .post('/api/v1/auth/resend-verification')
      .send({ identifier: 'cooldown@example.com', type: 'EMAIL' });
    expect(first.status).toBe(429);
    expect(first.body.error.code).toBe('RATE_LIMITED');
  });

  it('rate limits registration by IP', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(app).post('/api/v1/auth/register').send({});
      expect(response.status).toBe(400);
    }
    const limited = await request(app).post('/api/v1/auth/register').send({});
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });
});
