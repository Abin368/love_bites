import { randomUUID } from 'crypto';
import request from 'supertest';
import { Gender } from '../../src/database/models/gender.model';
import { Profile } from '../../src/database/models/profile.model';
import { ProfilePhoto } from '../../src/database/models/profile-photo.model';
import { User } from '../../src/database/models/user.model';
import { createUser } from '../../src/modules/users/users.data-access';
import { signAccessToken } from '../../src/utils/jwt';
import { redis, resetMemoryRedis } from '../helpers/memory-redis';

const mockPhotoStorage = {
  createUploadUrl: jest.fn(async (input: { storageKey: string; mimeType: string; expiresInSeconds: number }) => ({
    url: `https://upload.test/${input.storageKey}`,
    expiresInSeconds: input.expiresInSeconds
  })),
  createDownloadUrl: jest.fn(async (input: { storageKey: string; expiresInSeconds: number }) => ({
    url: `https://download.test/${input.storageKey}`,
    expiresInSeconds: input.expiresInSeconds
  })),
  deleteObject: jest.fn()
};

jest.mock('../../src/config/redis', () => jest.requireActual('../helpers/memory-redis'));
jest.mock('../../src/integrations/storage/s3.provider', () => ({
  photoStorage: mockPhotoStorage
}));

import { app } from '../../src/app';

const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';

function userInput() {
  return {
    email: `photo-${randomUUID()}@example.com`,
    phone: null,
    passwordHash: PASSWORD_HASH,
    role: 'USER' as const,
    status: 'UNVERIFIED' as const,
    emailVerified: true,
    phoneVerified: false
  };
}

function tokenFor(userId: string, role: 'USER' | 'ADMIN' = 'USER'): string {
  return signAccessToken({
    sub: userId,
    role,
    isVerified: true,
    isProfileComplete: false
  });
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function upload(token: string, overrides: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/v1/profile-photos/upload-url')
    .set(auth(token))
    .send({
      mimeType: 'image/jpeg',
      fileSizeBytes: 2048,
      originalFilename: 'camera.jpg',
      ...overrides
    });
}

async function confirm(
  token: string,
  slot: { photoId: string; storageKey: string },
  overrides: Record<string, unknown> = {}
) {
  return request(app)
    .post('/api/v1/profile-photos/confirm')
    .set(auth(token))
    .send({
      photoId: slot.photoId,
      storageKey: slot.storageKey,
      displayOrder: 1,
      isPrimary: true,
      ...overrides
    });
}

async function addPhoto(
  token: string,
  displayOrder: number,
  isPrimary: boolean
): Promise<{ id: string; storageKey: string }> {
  const slot = await upload(token);
  expect(slot.status).toBe(200);
  const saved = await confirm(token, slot.body.data, { displayOrder, isPrimary });
  expect(saved.status).toBe(201);
  return { id: saved.body.data.id as string, storageKey: slot.body.data.storageKey as string };
}

describe('PostgreSQL profile photos API', () => {
  beforeEach(() => {
    resetMemoryRedis();
    mockPhotoStorage.createUploadUrl.mockClear();
    mockPhotoStorage.createDownloadUrl.mockClear();
    mockPhotoStorage.deleteObject.mockClear();
  });

  it('rejects unauthenticated and non-USER photo requests', async () => {
    const missing = await request(app).post('/api/v1/profile-photos/upload-url').send({
      mimeType: 'image/jpeg',
      fileSizeBytes: 10
    });
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('AUTH_REQUIRED');

    const admin = await User.create({
      email: `admin-${randomUUID()}@example.com`,
      passwordHash: PASSWORD_HASH,
      role: 'ADMIN',
      status: 'ACTIVE',
      emailVerified: true,
      phoneVerified: false
    });
    const forbidden = await request(app)
      .get('/api/v1/profile-photos')
      .set(auth(tokenFor(admin.id, 'ADMIN')));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
  });

  it('creates a redis reservation without inserting a photo row', async () => {
    const user = await createUser(userInput());
    const response = await upload(tokenFor(user.id));

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Upload URL created successfully');
    expect(response.body.data.expiresInSeconds).toBe(300);
    expect(response.body.data.storageKey).toBe(`photos/${user.id}/${response.body.data.photoId}.webp`);
    expect(response.body.data.storageKey).not.toContain('camera.jpg');
    expect(response.body.data.uploadUrl).toBe(`https://upload.test/${response.body.data.storageKey}`);
    expect(mockPhotoStorage.createUploadUrl).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'image/jpeg', expiresInSeconds: 300 })
    );
    expect(await ProfilePhoto.count({ where: { userId: user.id }, paranoid: false })).toBe(0);

    const reservation = JSON.parse(
      (await redis.get(`profile-photo:upload:${response.body.data.photoId}`)) ?? 'null'
    ) as { userId: string; storageKey: string; mimeType: string; fileSizeBytes: number; originalFilename: string };
    expect(reservation).toMatchObject({
      userId: user.id,
      storageKey: response.body.data.storageKey,
      mimeType: 'image/jpeg',
      fileSizeBytes: 2048,
      originalFilename: 'camera.jpg'
    });
  });

  it('rejects invalid mime types, sizes, and unexpected fields', async () => {
    const user = await createUser(userInput());
    const token = tokenFor(user.id);

    expect((await upload(token, { mimeType: 'image/gif' })).status).toBe(400);
    expect((await upload(token, { fileSizeBytes: 0 })).status).toBe(400);
    expect((await upload(token, { fileSizeBytes: 10_485_761 })).status).toBe(400);
    expect((await upload(token, { userId: user.id })).status).toBe(400);
    expect((await upload(token, { mimeType: 'image/webp', fileSizeBytes: 1, originalFilename: undefined })).status).toBe(
      200
    );
  });

  it('rejects an upload when five active photos already exist', async () => {
    const user = await createUser(userInput());
    const token = tokenFor(user.id);
    for (let order = 1; order <= 5; order += 1) {
      await addPhoto(token, order, order === 1);
    }

    const blocked = await upload(token);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('PHOTO_LIMIT_REACHED');
    expect(await ProfilePhoto.count({ where: { userId: user.id } })).toBe(5);
  });

  it('confirms the reserved key, consumes redis, and rejects a bad or foreign reservation', async () => {
    const user = await createUser(userInput());
    const other = await createUser(userInput());
    const token = tokenFor(user.id);
    const slot = await upload(token);
    const storageKey = slot.body.data.storageKey as string;

    const mismatch = await confirm(token, slot.body.data, { storageKey: 'photos/attacker/chosen.webp' });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.code).toBe('INVALID_STORAGE_KEY');
    expect(await redis.get(`profile-photo:upload:${slot.body.data.photoId}`)).not.toBeNull();
    expect(await ProfilePhoto.count({ where: { userId: user.id }, paranoid: false })).toBe(0);

    const foreign = await confirm(tokenFor(other.id), slot.body.data);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(await ProfilePhoto.count({ where: { userId: other.id }, paranoid: false })).toBe(0);

    const missing = await confirm(token, {
      photoId: '44444444-4444-4444-8444-444444444444',
      storageKey
    });
    expect(missing.status).toBe(404);

    const saved = await confirm(token, slot.body.data, { displayOrder: 3, isPrimary: true });
    expect(saved.status).toBe(201);
    expect(saved.body.data).toEqual({
      id: slot.body.data.photoId,
      url: `https://download.test/${storageKey}`,
      displayOrder: 3,
      isPrimary: true
    });
    expect(saved.body.data).not.toHaveProperty('storageKey');
    expect(await redis.get(`profile-photo:upload:${slot.body.data.photoId}`)).toBeNull();
    expect(mockPhotoStorage.createDownloadUrl).toHaveBeenCalledWith({
      storageKey,
      expiresInSeconds: 3600
    });

    const row = await ProfilePhoto.findByPk(slot.body.data.photoId);
    expect(row?.storageKey).toBe(storageKey);
    expect(row?.mimeType).toBe('image/jpeg');
    expect(row?.fileSizeBytes).toBe(2048);
    expect(row?.originalFilename).toBe('camera.jpg');
    expect(row?.userId).toBe(user.id);
  });

  it('moves an occupied display order and promotes a new primary inside one commit', async () => {
    const user = await createUser(userInput());
    const token = tokenFor(user.id);
    const first = await addPhoto(token, 1, true);
    const slot = await upload(token, { mimeType: 'image/png', fileSizeBytes: 50, originalFilename: 'second.png' });

    const saved = await confirm(token, slot.body.data, { displayOrder: 1, isPrimary: true });
    expect(saved.status).toBe(201);
    expect(saved.body.data).toMatchObject({ displayOrder: 1, isPrimary: true });

    const rows = await ProfilePhoto.findAll({ where: { userId: user.id }, order: [['displayOrder', 'ASC']] });
    expect(rows.map((row) => ({ id: row.id, displayOrder: row.displayOrder, isPrimary: row.isPrimary }))).toEqual([
      { id: slot.body.data.photoId, displayOrder: 1, isPrimary: true },
      { id: first.id, displayOrder: 2, isPrimary: false }
    ]);
  });

  it('rolls back a failed confirm and leaves the reservation in place', async () => {
    const user = await createUser(userInput());
    const token = tokenFor(user.id);
    const existing = await addPhoto(token, 1, true);
    const reservation = {
      userId: user.id,
      photoId: existing.id,
      storageKey: `photos/${user.id}/${existing.id}.webp`,
      mimeType: 'image/webp',
      fileSizeBytes: 80,
      originalFilename: null
    };
    await redis.set(`profile-photo:upload:${existing.id}`, JSON.stringify(reservation), 'EX', 300);

    const failed = await confirm(token, { photoId: existing.id, storageKey: reservation.storageKey }, {
      displayOrder: 2,
      isPrimary: true
    });
    expect(failed.status).toBe(409);
    expect(failed.body.error.code).toBe('PHOTO_CONFLICT');

    const row = await ProfilePhoto.findByPk(existing.id);
    expect(row?.displayOrder).toBe(1);
    expect(row?.isPrimary).toBe(true);
    expect(row?.mimeType).toBe('image/jpeg');
    expect(await ProfilePhoto.count({ where: { userId: user.id }, paranoid: false })).toBe(1);
    expect(await redis.get(`profile-photo:upload:${existing.id}`)).not.toBeNull();
  });

  it('rejects confirm once five active photos exist even if a reservation remains', async () => {
    const user = await createUser(userInput());
    const token = tokenFor(user.id);
    for (let order = 1; order <= 5; order += 1) {
      await addPhoto(token, order, order === 1);
    }
    const photoId = randomUUID();
    const storageKey = `photos/${user.id}/${photoId}.webp`;
    await redis.set(
      `profile-photo:upload:${photoId}`,
      JSON.stringify({
        userId: user.id,
        photoId,
        storageKey,
        mimeType: 'image/jpeg',
        fileSizeBytes: 10,
        originalFilename: null
      }),
      'EX',
      300
    );

    const failed = await confirm(token, { photoId, storageKey }, { displayOrder: 1, isPrimary: false });
    expect(failed.status).toBe(409);
    expect(failed.body.error.code).toBe('PHOTO_LIMIT_REACHED');
    expect(await ProfilePhoto.count({ where: { userId: user.id } })).toBe(5);
    expect(await redis.get(`profile-photo:upload:${photoId}`)).not.toBeNull();
  });

  it('lists only the caller active photos in display order with signed urls', async () => {
    const user = await createUser(userInput());
    const other = await createUser(userInput());
    const token = tokenFor(user.id);
    const second = await addPhoto(token, 2, false);
    const first = await addPhoto(token, 1, true);
    await addPhoto(tokenFor(other.id), 1, true);
    await request(app).delete(`/api/v1/profile-photos/${second.id}`).set(auth(token));

    const listed = await request(app).get('/api/v1/profile-photos').set(auth(token));
    expect(listed.status).toBe(200);
    expect(listed.body.data).toEqual([
      {
        id: first.id,
        url: `https://download.test/${first.storageKey}`,
        displayOrder: 1,
        isPrimary: true
      }
    ]);
    expect(JSON.stringify(listed.body)).not.toContain('storageKey');
    expect(JSON.stringify(listed.body)).not.toContain(other.id);
  });

  it('updates order and primary for the owner and hides another user photo', async () => {
    const user = await createUser(userInput());
    const other = await createUser(userInput());
    const token = tokenFor(user.id);
    const low = await addPhoto(token, 1, false);
    const high = await addPhoto(token, 3, true);
    const foreign = await addPhoto(tokenFor(other.id), 1, true);

    const missing = await request(app)
      .patch(`/api/v1/profile-photos/${foreign.id}`)
      .set(auth(token))
      .send({ displayOrder: 2 });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('RESOURCE_NOT_FOUND');

    const moved = await request(app)
      .patch(`/api/v1/profile-photos/${high.id}`)
      .set(auth(token))
      .send({ displayOrder: 1 });
    expect(moved.status).toBe(200);
    expect(moved.body.data).toEqual([
      expect.objectContaining({ id: high.id, displayOrder: 1, isPrimary: true }),
      expect.objectContaining({ id: low.id, displayOrder: 3, isPrimary: false })
    ]);

    const cleared = await request(app)
      .patch(`/api/v1/profile-photos/${high.id}`)
      .set(auth(token))
      .send({ isPrimary: false });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toEqual([
      expect.objectContaining({ id: high.id, displayOrder: 1, isPrimary: false }),
      expect.objectContaining({ id: low.id, displayOrder: 3, isPrimary: true })
    ]);
  });

  it('keeps a valid photo set when a patch transaction cannot apply', async () => {
    const user = await createUser(userInput());
    const token = tokenFor(user.id);
    const only = await addPhoto(token, 1, true);

    const rejected = await request(app)
      .patch(`/api/v1/profile-photos/${only.id}`)
      .set(auth(token))
      .send({});
    expect(rejected.status).toBe(400);

    const row = await ProfilePhoto.findByPk(only.id);
    expect(row?.displayOrder).toBe(1);
    expect(row?.isPrimary).toBe(true);
    expect(row?.deletedAt).toBeNull();
  });

  it('soft-deletes a photo, promotes the lowest remaining primary, and does not delete the object', async () => {
    const user = await createUser(userInput());
    const token = tokenFor(user.id);
    const primary = await addPhoto(token, 1, true);
    const next = await addPhoto(token, 4, false);
    await addPhoto(token, 5, false);

    const removed = await request(app).delete(`/api/v1/profile-photos/${primary.id}`).set(auth(token));
    expect(removed.status).toBe(200);
    expect(removed.body.data).toEqual({ deleted: true });
    expect(mockPhotoStorage.deleteObject).not.toHaveBeenCalled();

    const stored = await ProfilePhoto.findByPk(primary.id, { paranoid: false });
    expect(stored?.deletedAt).not.toBeNull();
    const remaining = await ProfilePhoto.findAll({ where: { userId: user.id }, order: [['displayOrder', 'ASC']] });
    expect(remaining.map((row) => ({ id: row.id, isPrimary: row.isPrimary }))).toEqual([
      { id: next.id, isPrimary: true },
      { id: remaining[1].id, isPrimary: false }
    ]);
  });

  it('does not let a completed profile delete its only photo or change completion', async () => {
    const user = await createUser(userInput());
    const gender = await Gender.create({
      code: `g-${randomUUID()}`,
      name: 'Woman',
      isActive: true
    });
    await Profile.create({
      userId: user.id,
      firstName: 'Ada',
      dateOfBirth: '1992-04-04',
      genderId: gender.id,
      isProfileComplete: true
    });
    const token = tokenFor(user.id);
    const only = await addPhoto(token, 1, true);

    const blocked = await request(app).delete(`/api/v1/profile-photos/${only.id}`).set(auth(token));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('PHOTO_REQUIRED');
    expect(await ProfilePhoto.count({ where: { userId: user.id } })).toBe(1);
    const profile = await Profile.findOne({ where: { userId: user.id } });
    expect(profile?.isProfileComplete).toBe(true);

    const other = await createUser(userInput());
    const hidden = await request(app)
      .delete(`/api/v1/profile-photos/${only.id}`)
      .set(auth(tokenFor(other.id)));
    expect(hidden.status).toBe(404);
    expect(await ProfilePhoto.count({ where: { userId: user.id } })).toBe(1);
  });

  it('keeps exactly one primary whenever active photos remain', async () => {
    const user = await createUser(userInput());
    const token = tokenFor(user.id);

    const assertOnePrimary = async () => {
      const rows = await ProfilePhoto.findAll({ where: { userId: user.id } });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.filter((row) => row.isPrimary)).toHaveLength(1);
    };

    const firstSlot = await upload(token);
    const forced = await confirm(token, firstSlot.body.data, { displayOrder: 2, isPrimary: false });
    expect(forced.status).toBe(201);
    expect(forced.body.data.isPrimary).toBe(true);
    await assertOnePrimary();

    const explicitUser = await createUser(userInput());
    const explicitToken = tokenFor(explicitUser.id);
    const explicitSlot = await upload(explicitToken);
    const explicit = await confirm(explicitToken, explicitSlot.body.data, { displayOrder: 1, isPrimary: true });
    expect(explicit.status).toBe(201);
    expect(explicit.body.data.isPrimary).toBe(true);
    const explicitRows = await ProfilePhoto.findAll({ where: { userId: explicitUser.id } });
    expect(explicitRows.filter((row) => row.isPrimary)).toHaveLength(1);

    const secondSlot = await upload(token);
    const kept = await confirm(token, secondSlot.body.data, { displayOrder: 4, isPrimary: false });
    expect(kept.status).toBe(201);
    expect(kept.body.data.isPrimary).toBe(false);
    const afterKept = await ProfilePhoto.findAll({ where: { userId: user.id } });
    expect(afterKept.find((row) => row.id === firstSlot.body.data.photoId)?.isPrimary).toBe(true);
    await assertOnePrimary();

    const thirdSlot = await upload(token);
    const replaced = await confirm(token, thirdSlot.body.data, { displayOrder: 3, isPrimary: true });
    expect(replaced.status).toBe(201);
    expect(replaced.body.data.isPrimary).toBe(true);
    expect(
      (await ProfilePhoto.findByPk(firstSlot.body.data.photoId))?.isPrimary
    ).toBe(false);
    await assertOnePrimary();

    const cleared = await request(app)
      .patch(`/api/v1/profile-photos/${thirdSlot.body.data.photoId}`)
      .set(auth(token))
      .send({ isPrimary: false });
    expect(cleared.status).toBe(200);
    const promoted = await ProfilePhoto.findAll({
      where: { userId: user.id, isPrimary: true }
    });
    expect(promoted).toHaveLength(1);
    expect(promoted[0].id).toBe(firstSlot.body.data.photoId);
    expect(promoted[0].displayOrder).toBe(2);
    await assertOnePrimary();

    const removed = await request(app)
      .delete(`/api/v1/profile-photos/${firstSlot.body.data.photoId}`)
      .set(auth(token));
    expect(removed.status).toBe(200);
    const afterDelete = await ProfilePhoto.findAll({
      where: { userId: user.id },
      order: [['displayOrder', 'ASC']]
    });
    expect(afterDelete.map((row) => ({ id: row.id, isPrimary: row.isPrimary }))).toEqual([
      { id: thirdSlot.body.data.photoId, isPrimary: true },
      { id: secondSlot.body.data.photoId, isPrimary: false }
    ]);
    await assertOnePrimary();
  });

  it('leaves profile completion false after photo writes', async () => {
    const user = await createUser(userInput());
    const gender = await Gender.create({
      code: `g-${randomUUID()}`,
      name: 'Man',
      isActive: true
    });
    await Profile.create({
      userId: user.id,
      firstName: 'John',
      dateOfBirth: '1998-05-10',
      genderId: gender.id,
      isProfileComplete: false
    });
    const token = tokenFor(user.id);
    await addPhoto(token, 1, true);
    await request(app)
      .patch(`/api/v1/profile-photos/${(await ProfilePhoto.findOne({ where: { userId: user.id } }))?.id}`)
      .set(auth(token))
      .send({ isPrimary: true });

    const profile = await Profile.findOne({ where: { userId: user.id } });
    expect(profile?.isProfileComplete).toBe(false);
  });
});
