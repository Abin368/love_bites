import { UniqueConstraintError } from 'sequelize';
import { sequelize } from '../../config/database';
import { redis } from '../../config/redis';
import { mockEmailService } from '../../integrations/email/mock-email.service';
import { mockSmsService } from '../../integrations/sms/mock-sms.service';
import {
  generateOtpCode,
  generateRefreshToken,
  generateResetToken,
  hashPassword,
  safeEqualHex,
  sha256,
  verifyPassword,
  verifyPasswordDummy
} from '../../utils/crypto';
import { ConflictError, NotFoundError, RateLimitError, UnauthorizedError, UnprocessableEntityError, ValidationError, ForbiddenError } from '../../utils/errors';
import { accessTokenTtlSeconds, signAccessToken } from '../../utils/jwt';
import { consumeRateLimit } from '../../utils/rate-limit';
import {
  createRefreshToken,
  findRefreshTokenByHash,
  revokeAllActiveRefreshTokens,
  revokeRefreshToken
} from './auth.data-access';
import { assessRefreshToken, computeIsVerified } from './auth.types';
import { isAtLeast18 } from './auth.validator';
import type {
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResendVerificationInput,
  ResetPasswordInput,
  VerifyEmailInput,
  VerifyPhoneInput
} from './auth.validator';
import {
  createUser,
  findProfileCompletion,
  findUserByEmail,
  findUserById,
  findUserByPhone,
  updateUser
} from '../users/users.data-access';
import type { User, UserStatus } from '../../database/models/user.model';

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const OTP_TTL_SECONDS = 300;
const OTP_MAX_ATTEMPTS = 3;
const PASSWORD_RESET_TTL_SECONDS = 15 * 60;
const OTP_WINDOW_MS = 60_000;

type VerificationChannel = 'EMAIL' | 'PHONE';

interface OtpRecord {
  codeHash: string;
  attempts: number;
  userId: string;
}

interface PasswordResetRecord {
  userId: string;
  identifier: string;
}

interface PublicUser {
  id: string;
  email: string | null;
  phone: string | null;
  role: User['role'];
  status: UserStatus;
  isVerified: boolean;
  isProfileComplete: boolean;
}

function duplicateIdentifier(): ConflictError {
  return new ConflictError('An account with this email or phone already exists.', [], 'DUPLICATE_IDENTIFIER');
}

function invalidCredentials(): UnauthorizedError {
  return new UnauthorizedError('Invalid credentials provided.', [], 'INVALID_CREDENTIALS');
}

function invalidToken(message = 'Invalid token.'): UnauthorizedError {
  return new UnauthorizedError(message, [], 'INVALID_TOKEN');
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof UniqueConstraintError || (error as { name?: string }).name === 'SequelizeUniqueConstraintError';
}

function otpKey(channel: VerificationChannel, identifier: string): string {
  return channel === 'EMAIL' ? `auth:otp:email:${identifier}` : `auth:otp:phone:${identifier}`;
}

function resetKey(tokenHash: string): string {
  return `auth:password-reset:${tokenHash}`;
}

function nextStatus(user: User, emailVerified: boolean, phoneVerified: boolean): UserStatus {
  if (user.status === 'SUSPENDED' || user.status === 'BANNED' || user.status === 'DELETED') {
    return user.status;
  }
  return computeIsVerified({
    email: user.email,
    phone: user.phone,
    emailVerified,
    phoneVerified
  })
    ? 'ACTIVE'
    : 'UNVERIFIED';
}

async function enforceOtpRateLimit(identifier: string): Promise<void> {
  const allowed = await consumeRateLimit(`ratelimit:auth:otp:${identifier}`, 1, OTP_WINDOW_MS);
  if (!allowed) {
    throw new RateLimitError('Please wait before requesting another verification code.', [], 'RATE_LIMITED');
  }
}

async function readOtp(channel: VerificationChannel, identifier: string): Promise<OtpRecord | null> {
  const raw = await redis.get(otpKey(channel, identifier));
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as OtpRecord;
    if (!parsed.codeHash || typeof parsed.attempts !== 'number' || !parsed.userId) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function registerFailedOtpAttempt(channel: VerificationChannel, identifier: string, record: OtpRecord): Promise<void> {
  const key = otpKey(channel, identifier);
  const attempts = record.attempts + 1;
  if (attempts >= OTP_MAX_ATTEMPTS) {
    await redis.del(key);
    return;
  }
  const ttl = await redis.ttl(key);
  const remaining = ttl > 0 ? ttl : OTP_TTL_SECONDS;
  await redis.set(key, JSON.stringify({ ...record, attempts }), 'EX', remaining);
}

async function storeAndSendOtp(user: User, channel: VerificationChannel, identifier: string): Promise<void> {
  const code = generateOtpCode();
  const record: OtpRecord = {
    codeHash: sha256(code),
    attempts: 0,
    userId: user.id
  };
  await redis.set(otpKey(channel, identifier), JSON.stringify(record), 'EX', OTP_TTL_SECONDS);

  if (channel === 'EMAIL') {
    await mockEmailService.send({
      to: identifier,
      subject: 'Verify your Love Bite email',
      text: `Your Love Bite verification code is ${code}. It expires in 5 minutes.`
    });
    return;
  }

  await mockSmsService.send({
    to: identifier,
    text: `Your Love Bite verification code is ${code}. It expires in 5 minutes.`
  });
}

async function issueSession(user: User, deviceInfo: string | null, ipAddress: string | null) {
  const isProfileComplete = await findProfileCompletion(user.id);
  const isVerified = computeIsVerified(user);
  const accessToken = signAccessToken({
    sub: user.id,
    role: user.role,
    isVerified,
    isProfileComplete
  });
  const refreshToken = generateRefreshToken();
  await createRefreshToken({
    userId: user.id,
    tokenHash: sha256(refreshToken),
    deviceInfo,
    ipAddress,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS)
  });

  const publicUser: PublicUser = {
    id: user.id,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    isVerified,
    isProfileComplete
  };

  return {
    accessToken,
    refreshToken,
    expiresIn: accessTokenTtlSeconds(),
    user: publicUser
  };
}

export async function register(input: RegisterInput) {
  if (!isAtLeast18(input.dateOfBirth)) {
    throw new UnprocessableEntityError('You must be at least 18 years old.');
  }

  if (input.email) {
    const existingEmail = await findUserByEmail(input.email);
    if (existingEmail) {
      throw duplicateIdentifier();
    }
  }

  if (input.phone) {
    const existingPhone = await findUserByPhone(input.phone);
    if (existingPhone) {
      throw duplicateIdentifier();
    }
  }

  const passwordHash = await hashPassword(input.password);
  let user: User;
  try {
    user = await createUser({
      email: input.email ?? null,
      phone: input.phone ?? null,
      passwordHash,
      role: 'USER',
      status: 'UNVERIFIED',
      emailVerified: false,
      phoneVerified: false
    });
  } catch (error) {
    if (isUniqueConstraint(error)) {
      throw duplicateIdentifier();
    }
    throw error;
  }

  const channel: VerificationChannel = user.email ? 'EMAIL' : 'PHONE';
  const identifier = channel === 'EMAIL' ? user.email : user.phone;
  if (!identifier) {
    throw new ValidationError('Email or phone is required.');
  }

  await storeAndSendOtp(user, channel, identifier);
  await consumeRateLimit(`ratelimit:auth:otp:${identifier}`, 1, OTP_WINDOW_MS);

  return {
    userId: user.id,
    email: user.email,
    phone: user.phone,
    status: user.status,
    emailVerified: user.emailVerified,
    phoneVerified: user.phoneVerified,
    nextStep: channel === 'EMAIL' ? 'VERIFY_EMAIL' : 'VERIFY_PHONE'
  };
}

async function completeVerification(user: User, channel: VerificationChannel, identifier: string, submittedCode: string) {
  const record = await readOtp(channel, identifier);
  if (!record || record.userId !== user.id) {
    throw invalidToken('Invalid or expired verification code.');
  }

  if (!safeEqualHex(record.codeHash, sha256(submittedCode))) {
    await registerFailedOtpAttempt(channel, identifier, record);
    throw invalidToken('Invalid or expired verification code.');
  }

  await redis.del(otpKey(channel, identifier));
  const emailVerified = channel === 'EMAIL' ? true : user.emailVerified;
  const phoneVerified = channel === 'PHONE' ? true : user.phoneVerified;
  const status = nextStatus(user, emailVerified, phoneVerified);
  await updateUser(user.id, { emailVerified, phoneVerified, status });
  return { verified: true, status };
}

export async function verifyEmail(input: VerifyEmailInput) {
  const user = await findUserByEmail(input.email);
  if (!user) {
    throw invalidToken('Invalid or expired verification code.');
  }
  return completeVerification(user, 'EMAIL', input.email, input.token);
}

export async function verifyPhone(input: VerifyPhoneInput) {
  const user = await findUserByPhone(input.phone);
  if (!user) {
    throw invalidToken('Invalid or expired verification code.');
  }
  return completeVerification(user, 'PHONE', input.phone, input.otp);
}

export async function resendVerification(input: ResendVerificationInput) {
  await enforceOtpRateLimit(input.identifier);
  const user =
    input.type === 'EMAIL' ? await findUserByEmail(input.identifier) : await findUserByPhone(input.identifier);

  if (!user || user.status === 'DELETED' || user.deletedAt) {
    throw new NotFoundError('User not found.', [], 'USER_NOT_FOUND');
  }

  if (input.type === 'EMAIL' && user.emailVerified) {
    throw new ValidationError('Email is already verified.');
  }
  if (input.type === 'PHONE' && user.phoneVerified) {
    throw new ValidationError('Phone number is already verified.');
  }

  await storeAndSendOtp(user, input.type, input.identifier);
  return { sent: true };
}

export async function login(input: LoginInput, deviceInfo: string | null, ipAddress: string | null) {
  const user =
    input.identifier.type === 'email'
      ? await findUserByEmail(input.identifier.value, { includePassword: true })
      : await findUserByPhone(input.identifier.value, { includePassword: true });

  if (!user || !user.passwordHash || user.status === 'DELETED' || user.deletedAt) {
    await verifyPasswordDummy(input.password);
    throw invalidCredentials();
  }

  const passwordMatches = await verifyPassword(user.passwordHash, input.password);
  if (!passwordMatches) {
    throw invalidCredentials();
  }

  if (user.status === 'SUSPENDED') {
    throw new ForbiddenError('Account is suspended.', [], 'ACCOUNT_SUSPENDED');
  }
  if (user.status === 'BANNED') {
    throw new ForbiddenError('Account is banned.', [], 'ACCOUNT_BANNED');
  }

  return issueSession(user, deviceInfo, ipAddress);
}

export async function refresh(rawToken: string | undefined, deviceInfo: string | null, ipAddress: string | null) {
  if (!rawToken) {
    throw invalidToken();
  }

  const presentedHash = sha256(rawToken);
  const outcome = await sequelize.transaction(async (transaction) => {
    const row = await findRefreshTokenByHash(presentedHash, { transaction, lock: true });
    const decision = assessRefreshToken(row, new Date());

    if (decision.action === 'invalid') {
      return { kind: 'invalid' as const };
    }

    if (decision.action === 'reuse') {
      await revokeAllActiveRefreshTokens(decision.userId, new Date(), transaction);
      return { kind: 'invalid' as const };
    }

    const user = await findUserById(decision.userId, { transaction });
    if (!user || user.status === 'DELETED' || user.deletedAt) {
      return { kind: 'invalid' as const };
    }
    if (user.status === 'SUSPENDED') {
      throw new ForbiddenError('Account is suspended.', [], 'ACCOUNT_SUSPENDED');
    }
    if (user.status === 'BANNED') {
      throw new ForbiddenError('Account is banned.', [], 'ACCOUNT_BANNED');
    }

    const refreshToken = generateRefreshToken();
    const nextHash = sha256(refreshToken);
    await revokeRefreshToken(row!.id, { revokedAt: new Date(), replacedByHash: nextHash }, transaction);
    await createRefreshToken(
      {
        userId: user.id,
        tokenHash: nextHash,
        deviceInfo,
        ipAddress,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS)
      },
      transaction
    );

    const isProfileComplete = await findProfileCompletion(user.id);
    const accessToken = signAccessToken({
      sub: user.id,
      role: user.role,
      isVerified: computeIsVerified(user),
      isProfileComplete
    });

    return {
      kind: 'ok' as const,
      accessToken,
      refreshToken,
      expiresIn: accessTokenTtlSeconds()
    };
  });

  if (outcome.kind === 'invalid') {
    throw invalidToken();
  }

  return outcome;
}

export async function logout(userId: string, rawToken: string | undefined): Promise<void> {
  if (!rawToken) {
    return;
  }

  const row = await findRefreshTokenByHash(sha256(rawToken));
  if (!row || row.userId !== userId || row.revokedAt) {
    return;
  }

  await revokeRefreshToken(row.id, { revokedAt: new Date() });
}

export async function forgotPassword(input: ForgotPasswordInput): Promise<void> {
  const user =
    input.identifier.type === 'email'
      ? await findUserByEmail(input.identifier.value)
      : await findUserByPhone(input.identifier.value);

  if (!user || user.status === 'DELETED' || user.deletedAt) {
    return;
  }

  const token = generateResetToken();
  const record: PasswordResetRecord = {
    userId: user.id,
    identifier: input.identifier.value
  };
  await redis.set(resetKey(sha256(token)), JSON.stringify(record), 'EX', PASSWORD_RESET_TTL_SECONDS);

  if (input.identifier.type === 'email') {
    await mockEmailService.send({
      to: input.identifier.value,
      subject: 'Reset your Love Bite password',
      text: `Your password reset token is ${token}. It expires in 15 minutes.`
    });
    return;
  }

  await mockSmsService.send({
    to: input.identifier.value,
    text: `Your Love Bite password reset token is ${token}. It expires in 15 minutes.`
  });
}

export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const key = resetKey(sha256(input.token));
  const raw = await redis.get(key);
  if (!raw) {
    throw invalidToken('Invalid or expired reset token.');
  }

  let record: PasswordResetRecord;
  try {
    record = JSON.parse(raw) as PasswordResetRecord;
  } catch {
    await redis.del(key);
    throw invalidToken('Invalid or expired reset token.');
  }

  if (!record.userId || record.identifier !== input.identifier.value) {
    await redis.del(key);
    throw invalidToken('Invalid or expired reset token.');
  }

  const user = await findUserById(record.userId);
  if (!user || user.status === 'DELETED' || user.deletedAt) {
    await redis.del(key);
    throw invalidToken('Invalid or expired reset token.');
  }

  const passwordHash = await hashPassword(input.newPassword);
  await sequelize.transaction(async (transaction) => {
    await updateUser(user.id, { passwordHash }, transaction);
    await revokeAllActiveRefreshTokens(user.id, new Date(), transaction);
  });
  await redis.del(key);
}
