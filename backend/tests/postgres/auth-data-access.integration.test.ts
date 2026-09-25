import { randomUUID } from 'crypto';
import { ForeignKeyConstraintError, UniqueConstraintError, literal } from 'sequelize';
import { sequelize } from '../../src/config/database';
import { Gender } from '../../src/database/models/gender.model';
import { Profile } from '../../src/database/models/profile.model';
import { User } from '../../src/database/models/user.model';
import {
  createRefreshToken,
  findRefreshTokenByHash,
  revokeAllActiveRefreshTokens,
  revokeRefreshToken
} from '../../src/modules/auth/auth.data-access';
import {
  createUser,
  findProfileCompletion,
  findUserByEmail,
  findUserById,
  findUserByPhone,
  updateUser
} from '../../src/modules/users/users.data-access';
import { assertTestDatabase } from './database-guard';

const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';

function userInput(overrides: Partial<Parameters<typeof createUser>[0]> = {}) {
  return {
    email: `user-${randomUUID()}@example.com`,
    phone: null,
    passwordHash: PASSWORD_HASH,
    role: 'USER' as const,
    status: 'UNVERIFIED' as const,
    emailVerified: false,
    phoneVerified: false,
    ...overrides
  };
}

function refreshInput(userId: string, tokenHash = `hash-${randomUUID()}`) {
  return {
    userId,
    tokenHash,
    deviceInfo: 'jest-integration',
    ipAddress: '127.0.0.1',
    expiresAt: new Date(Date.now() + 60_000)
  };
}

describe('PostgreSQL authentication data access', () => {
  it('finds, creates, and updates users without exposing the password hash by default', async () => {
    const input = userInput({ phone: `+9198${randomUUID().replace(/-/g, '').slice(0, 8)}` });
    const created = await createUser(input);

    const byEmail = await findUserByEmail(input.email as string);
    const byPhone = await findUserByPhone(input.phone as string);
    const byId = await findUserById(created.id);

    expect(byEmail?.id).toBe(created.id);
    expect(byPhone?.id).toBe(created.id);
    expect(byId?.id).toBe(created.id);
    expect(byEmail?.passwordHash).toBeUndefined();
    expect(byEmail?.getDataValue('passwordHash')).toBeUndefined();

    const withPassword = await findUserByEmail(input.email as string, { includePassword: true });
    const unscoped = await User.unscoped().findOne({ where: { email: input.email } });
    expect(withPassword?.passwordHash).toBe(PASSWORD_HASH);
    expect(unscoped?.passwordHash).toBe(PASSWORD_HASH);

    await updateUser(created.id, { emailVerified: true, status: 'ACTIVE' });
    const updated = await findUserById(created.id);
    expect(updated?.emailVerified).toBe(true);
    expect(updated?.status).toBe('ACTIVE');
    expect(updated?.updatedAt).toBeInstanceOf(Date);
    expect(updated?.createdAt).toBeInstanceOf(Date);
  });

  it('reports profile completion from the profiles row', async () => {
    const user = await createUser(userInput());
    expect(await findProfileCompletion(user.id)).toBe(false);

    const gender = await Gender.create({ code: `g-${randomUUID()}`, name: 'Integration' });
    await Profile.create({
      userId: user.id,
      firstName: 'Ada',
      dateOfBirth: '2000-01-15',
      genderId: gender.id,
      city: 'Kochi',
      location: literal("ST_GeogFromText('SRID=4326;POINT(76.2673 9.9312)')"),
      isProfileComplete: false
    });
    expect(await findProfileCompletion(user.id)).toBe(false);

    await Profile.update({ isProfileComplete: true }, { where: { userId: user.id } });
    expect(await findProfileCompletion(user.id)).toBe(true);
  });

  it('rejects a second active user with the same email as a Sequelize unique constraint error', async () => {
    const email = `dup-${randomUUID()}@example.com`;
    await createUser(userInput({ email }));

    await expect(createUser(userInput({ email }))).rejects.toBeInstanceOf(UniqueConstraintError);
    try {
      await createUser(userInput({ email }));
    } catch (error) {
      expect(error).toBeInstanceOf(UniqueConstraintError);
      expect((error as { name?: string }).name).toBe('SequelizeUniqueConstraintError');
    }
  });

  it('rejects a second active user with the same phone', async () => {
    const phone = `+9188${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    await createUser(userInput({ email: null, phone }));

    await expect(createUser(userInput({ email: null, phone }))).rejects.toBeInstanceOf(UniqueConstraintError);
  });

  it('allows an active user to reuse a soft-deleted email and phone', async () => {
    const email = `reuse-${randomUUID()}@example.com`;
    const phone = `+9177${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const original = await createUser(userInput({ email, phone }));
    await original.destroy();

    expect(await findUserByEmail(email)).toBeNull();
    expect(await findUserByPhone(phone)).toBeNull();
    expect(await findUserById(original.id)).toBeNull();

    const replacement = await createUser(userInput({ email, phone }));
    expect(replacement.id).not.toBe(original.id);
    expect((await findUserByEmail(email))?.id).toBe(replacement.id);
    expect((await findUserByPhone(phone))?.id).toBe(replacement.id);

    const deleted = await User.findOne({ where: { id: original.id }, paranoid: false });
    expect(deleted?.deletedAt).toBeInstanceOf(Date);
  });

  it('persists refresh tokens and revokes them individually or in bulk', async () => {
    const user = await createUser(userInput());
    const created = await createRefreshToken(refreshInput(user.id, 'persisted-hash'));

    const [rows] = await sequelize.query(
      `SELECT user_id, token_hash, created_at, updated_at
       FROM auth_refresh_tokens
       WHERE id = :id`,
      { replacements: { id: created.id } }
    );
    const row = (rows as Array<Record<string, unknown>>)[0];
    expect(row.user_id).toBe(user.id);
    expect(row.token_hash).toBe('persisted-hash');
    expect(row.created_at).toBeTruthy();
    expect(row.updated_at).toBeTruthy();
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);

    const found = await findRefreshTokenByHash('persisted-hash');
    expect(found?.id).toBe(created.id);
    expect(found?.userId).toBe(user.id);

    const revokedAt = new Date('2026-01-02T00:00:00.000Z');
    await revokeRefreshToken(created.id, { revokedAt, replacedByHash: 'next-hash' });
    const revoked = await findRefreshTokenByHash('persisted-hash');
    expect(revoked?.revokedAt?.toISOString()).toBe(revokedAt.toISOString());
    expect(revoked?.replacedByHash).toBe('next-hash');

    const activeOne = await createRefreshToken(refreshInput(user.id));
    const activeTwo = await createRefreshToken(refreshInput(user.id));
    const alreadyRevokedAt = new Date('2026-01-01T00:00:00.000Z');
    const alreadyRevoked = await createRefreshToken(refreshInput(user.id));
    await revokeRefreshToken(alreadyRevoked.id, { revokedAt: alreadyRevokedAt });

    const bulkRevokedAt = new Date('2026-01-03T00:00:00.000Z');
    await revokeAllActiveRefreshTokens(user.id, bulkRevokedAt);

    const first = await findRefreshTokenByHash(activeOne.tokenHash);
    const second = await findRefreshTokenByHash(activeTwo.tokenHash);
    const previous = await findRefreshTokenByHash(alreadyRevoked.tokenHash);
    expect(first?.revokedAt?.toISOString()).toBe(bulkRevokedAt.toISOString());
    expect(second?.revokedAt?.toISOString()).toBe(bulkRevokedAt.toISOString());
    expect(previous?.revokedAt?.toISOString()).toBe(alreadyRevokedAt.toISOString());
  });

  it('rolls back a user insert when the transaction fails', async () => {
    await assertTestDatabase(sequelize, 'exercise a rollback');
    const email = `rollback-${randomUUID()}@example.com`;

    await expect(
      sequelize.transaction(async (transaction) => {
        await createUser(userInput({ email }), transaction);
        throw new Error('force rollback');
      })
    ).rejects.toThrow('force rollback');

    expect(await findUserByEmail(email)).toBeNull();
    const [rows] = await sequelize.query('SELECT id FROM users WHERE email = :email', {
      replacements: { email }
    });
    expect(rows).toHaveLength(0);
  });

  it('enforces the refresh-token user foreign key', async () => {
    await expect(createRefreshToken(refreshInput(randomUUID()))).rejects.toBeInstanceOf(ForeignKeyConstraintError);
  });

  it('applies FOR UPDATE when findRefreshTokenByHash is called with a transaction and lock', async () => {
    const user = await createUser(userInput());
    const token = await createRefreshToken(refreshInput(user.id));
    const queries: string[] = [];
    const previous = sequelize.options.logging;
    sequelize.options.logging = (sql: string) => {
      queries.push(sql);
    };

    try {
      await sequelize.transaction(async (transaction) => {
        const locked = await findRefreshTokenByHash(token.tokenHash, { transaction, lock: true });
        expect(locked?.id).toBe(token.id);
      });
    } finally {
      sequelize.options.logging = previous;
    }

    expect(queries.some((sql) => sql.includes('FOR UPDATE'))).toBe(true);
  });
});
