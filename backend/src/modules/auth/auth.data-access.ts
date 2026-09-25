import { Op, Transaction } from 'sequelize';
import { AuthRefreshToken } from '../../database/models/auth-refresh-token.model';

export interface CreateRefreshTokenInput {
  userId: string;
  tokenHash: string;
  deviceInfo: string | null;
  ipAddress: string | null;
  expiresAt: Date;
}

export interface RevokeRefreshTokenInput {
  revokedAt: Date;
  replacedByHash?: string | null;
}

interface RefreshQueryOptions {
  transaction?: Transaction;
  lock?: boolean;
}

export async function createRefreshToken(
  input: CreateRefreshTokenInput,
  transaction?: Transaction
): Promise<AuthRefreshToken> {
  return AuthRefreshToken.create(
    {
      userId: input.userId,
      tokenHash: input.tokenHash,
      deviceInfo: input.deviceInfo,
      ipAddress: input.ipAddress,
      expiresAt: input.expiresAt
    },
    { transaction }
  );
}

export async function findRefreshTokenByHash(
  tokenHash: string,
  options: RefreshQueryOptions = {}
): Promise<AuthRefreshToken | null> {
  return AuthRefreshToken.findOne({
    where: { tokenHash },
    transaction: options.transaction,
    lock: options.lock && options.transaction ? Transaction.LOCK.UPDATE : undefined
  });
}

export async function revokeRefreshToken(
  id: string,
  values: RevokeRefreshTokenInput,
  transaction?: Transaction
): Promise<void> {
  await AuthRefreshToken.update(
    {
      revokedAt: values.revokedAt,
      ...(values.replacedByHash !== undefined ? { replacedByHash: values.replacedByHash } : {})
    },
    {
      where: { id },
      transaction
    }
  );
}

export async function revokeAllActiveRefreshTokens(
  userId: string,
  revokedAt: Date,
  transaction?: Transaction
): Promise<void> {
  await AuthRefreshToken.update(
    { revokedAt },
    {
      where: {
        userId,
        revokedAt: { [Op.is]: null }
      },
      transaction
    }
  );
}
