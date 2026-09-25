import { Transaction } from 'sequelize';
import { User, UserStatus } from '../../database/models/user.model';
import { Profile } from '../../database/models/profile.model';

export interface CreateUserInput {
  email: string | null;
  phone: string | null;
  passwordHash: string;
  role: 'USER';
  status: 'UNVERIFIED';
  emailVerified: boolean;
  phoneVerified: boolean;
}

export interface UpdateUserPatch {
  passwordHash?: string;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  status?: UserStatus;
}

interface FindOptions {
  includePassword?: boolean;
  transaction?: Transaction;
}

export async function findUserByEmail(email: string, options: FindOptions = {}): Promise<User | null> {
  const scope = options.includePassword ? User.unscoped() : User;
  return scope.findOne({
    where: { email },
    transaction: options.transaction
  });
}

export async function findUserByPhone(phone: string, options: FindOptions = {}): Promise<User | null> {
  const scope = options.includePassword ? User.unscoped() : User;
  return scope.findOne({
    where: { phone },
    transaction: options.transaction
  });
}

export async function findUserById(id: string, options: FindOptions = {}): Promise<User | null> {
  const scope = options.includePassword ? User.unscoped() : User;
  return scope.findOne({
    where: { id },
    transaction: options.transaction
  });
}

export async function createUser(input: CreateUserInput, transaction?: Transaction): Promise<User> {
  return User.create(
    {
      email: input.email,
      phone: input.phone,
      passwordHash: input.passwordHash,
      role: input.role,
      status: input.status,
      emailVerified: input.emailVerified,
      phoneVerified: input.phoneVerified
    },
    { transaction }
  );
}

export async function updateUser(id: string, patch: UpdateUserPatch, transaction?: Transaction): Promise<void> {
  await User.update(patch, {
    where: { id },
    transaction
  });
}

export async function findProfileCompletion(userId: string): Promise<boolean> {
  const profile = await Profile.findOne({
    where: { userId },
    attributes: ['isProfileComplete']
  });
  return profile?.isProfileComplete === true;
}
