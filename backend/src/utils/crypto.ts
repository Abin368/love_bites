import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import argon2 from 'argon2';

const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  timeCost: 3,
  memoryCost: 65536,
  parallelism: 4
};

let dummyHashPromise: Promise<string> | undefined;

function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = argon2.hash('love-bites-dummy-password-timing-mitigation', ARGON2_OPTIONS);
  }
  return dummyHashPromise;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}

export async function verifyPasswordDummy(password: string): Promise<void> {
  const dummyHash = await getDummyHash();
  await verifyPassword(dummyHash, password);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const COMPLETE_HEX = /^[0-9a-fA-F]+$/;

export function safeEqualHex(left: string, right: string): boolean {
  // Buffer.from(value, 'hex') drops a trailing nibble and stops at the first invalid pair.
  // Both strings must be complete even-length hex before that decode.
  if (left.length === 0 || left.length % 2 !== 0 || left.length !== right.length) {
    return false;
  }
  if (!COMPLETE_HEX.test(left) || !COMPLETE_HEX.test(right)) {
    return false;
  }

  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function generateResetToken(): string {
  return randomBytes(32).toString('hex');
}

export function generateOtpCode(): string {
  return randomInt(100000, 1000000).toString();
}
