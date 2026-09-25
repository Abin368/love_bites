import { v4 as uuidv4 } from 'uuid';
import type { UserStatus } from '../../src/database/models/user.model';

export interface MemoryUser {
  id: string;
  email: string | null;
  phone: string | null;
  passwordHash: string;
  role: 'USER' | 'ADMIN';
  status: UserStatus;
  emailVerified: boolean;
  phoneVerified: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryRefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  deviceInfo: string | null;
  ipAddress: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByHash: string | null;
}

export const memoryAuth = {
  users: [] as MemoryUser[],
  tokens: [] as MemoryRefreshToken[]
};

export function resetMemoryAuth(): void {
  memoryAuth.users = [];
  memoryAuth.tokens = [];
}

export function setUserStatus(identifier: string, status: UserStatus): void {
  const user = memoryAuth.users.find((item) => item.email === identifier || item.phone === identifier);
  if (!user) {
    throw new Error(`User not found for ${identifier}`);
  }
  user.status = status;
}

export function markUserDeleted(identifier: string): void {
  const user = memoryAuth.users.find((item) => item.email === identifier || item.phone === identifier);
  if (!user) {
    throw new Error(`User not found for ${identifier}`);
  }
  user.status = 'DELETED';
  user.deletedAt = new Date();
}

function visible(user: MemoryUser): boolean {
  return user.deletedAt === null && user.status !== 'DELETED';
}

function present(user: MemoryUser, includePassword: boolean) {
  if (includePassword) {
    return { ...user };
  }
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

export async function findUserByEmail(email: string, options: { includePassword?: boolean } = {}) {
  const user = memoryAuth.users.find((item) => item.email === email && visible(item));
  return user ? present(user, options.includePassword === true) : null;
}

export async function findUserByPhone(phone: string, options: { includePassword?: boolean } = {}) {
  const user = memoryAuth.users.find((item) => item.phone === phone && visible(item));
  return user ? present(user, options.includePassword === true) : null;
}

export async function findUserById(id: string, options: { includePassword?: boolean } = {}) {
  const user = memoryAuth.users.find((item) => item.id === id && visible(item));
  return user ? present(user, options.includePassword === true) : null;
}

export async function createUser(input: {
  email: string | null;
  phone: string | null;
  passwordHash: string;
  role: 'USER';
  status: 'UNVERIFIED';
  emailVerified: boolean;
  phoneVerified: boolean;
}) {
  const duplicate = memoryAuth.users.find(
    (item) =>
      visible(item) &&
      ((input.email && item.email === input.email) || (input.phone && item.phone === input.phone))
  );
  if (duplicate) {
    const error = new Error('duplicate') as Error & { name: string };
    error.name = 'SequelizeUniqueConstraintError';
    throw error;
  }

  const now = new Date();
  const user: MemoryUser = {
    id: uuidv4(),
    email: input.email,
    phone: input.phone,
    passwordHash: input.passwordHash,
    role: input.role,
    status: input.status,
    emailVerified: input.emailVerified,
    phoneVerified: input.phoneVerified,
    deletedAt: null,
    createdAt: now,
    updatedAt: now
  };
  memoryAuth.users.push(user);
  return { ...user };
}

export async function updateUser(
  id: string,
  patch: Partial<Pick<MemoryUser, 'passwordHash' | 'emailVerified' | 'phoneVerified' | 'status'>>
) {
  const user = memoryAuth.users.find((item) => item.id === id);
  if (!user) {
    return;
  }
  Object.assign(user, patch, { updatedAt: new Date() });
}

export async function findProfileCompletion(_userId: string): Promise<boolean> {
  return false;
}

export async function createRefreshToken(input: {
  userId: string;
  tokenHash: string;
  deviceInfo: string | null;
  ipAddress: string | null;
  expiresAt: Date;
}) {
  const token: MemoryRefreshToken = {
    id: uuidv4(),
    userId: input.userId,
    tokenHash: input.tokenHash,
    deviceInfo: input.deviceInfo,
    ipAddress: input.ipAddress,
    expiresAt: input.expiresAt,
    revokedAt: null,
    replacedByHash: null
  };
  memoryAuth.tokens.push(token);
  return { ...token };
}

export async function findRefreshTokenByHash(tokenHash: string) {
  const token = memoryAuth.tokens.find((item) => item.tokenHash === tokenHash);
  return token ? { ...token } : null;
}

export async function revokeRefreshToken(
  id: string,
  values: { revokedAt: Date; replacedByHash?: string | null }
) {
  const token = memoryAuth.tokens.find((item) => item.id === id);
  if (!token) {
    return;
  }
  token.revokedAt = values.revokedAt;
  if (values.replacedByHash !== undefined) {
    token.replacedByHash = values.replacedByHash;
  }
}

export async function revokeAllActiveRefreshTokens(userId: string, revokedAt: Date) {
  for (const token of memoryAuth.tokens) {
    if (token.userId === userId && token.revokedAt === null) {
      token.revokedAt = revokedAt;
    }
  }
}
