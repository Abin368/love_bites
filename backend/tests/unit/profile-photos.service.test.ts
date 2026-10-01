import { UniqueConstraintError } from 'sequelize';
import { ConflictError, NotFoundError, ValidationError } from '../../src/utils/errors';
import { resetMemoryRedis, redis } from '../helpers/memory-redis';

jest.mock('../../src/config/database', () => ({
  sequelize: {
    transaction: async (callback: (transaction: object) => Promise<unknown>) =>
      callback({ LOCK: { UPDATE: 'UPDATE' } })
  }
}));

jest.mock('../../src/config/redis', () => jest.requireActual('../helpers/memory-redis'));

jest.mock('../../src/integrations/storage/s3.provider', () => ({
  photoStorage: {
    createUploadUrl: jest.fn(),
    createDownloadUrl: jest.fn()
  }
}));

jest.mock('../../src/modules/profile-photos/profile-photos.data-access', () => ({
  lockUser: jest.fn(),
  listActivePhotos: jest.fn(),
  isProfileMarkedComplete: jest.fn(),
  updateDisplayOrder: jest.fn(),
  clearActivePrimary: jest.fn(),
  setActivePrimary: jest.fn(),
  insertPhoto: jest.fn(),
  softDeletePhoto: jest.fn(),
  swapDisplayOrders: jest.fn()
}));

import { photoStorage } from '../../src/integrations/storage/s3.provider';
import * as profilePhotosDataAccess from '../../src/modules/profile-photos/profile-photos.data-access';
import {
  buildPhotoStorageKey,
  confirmPhoto,
  createUploadUrl,
  deletePhoto,
  updatePhoto,
  uploadReservationKey
} from '../../src/modules/profile-photos/profile-photos.service';

const dataAccess = profilePhotosDataAccess as jest.Mocked<typeof profilePhotosDataAccess>;
const userId = '4f6a1c0e-6a7b-4c1d-9e22-0d5a6b7c8d90';
const otherUserId = '8c1d2e3f-4a5b-4c6d-8e7f-1029384756ab';

function photo(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId,
    storageKey: `photos/${userId}/11111111-1111-4111-8111-111111111111.webp`,
    displayOrder: 1,
    isPrimary: true,
    ...overrides
  };
}

describe('profile photo service', () => {
  beforeEach(() => {
    resetMemoryRedis();
    jest.mocked(photoStorage.createUploadUrl).mockImplementation(async (input) => ({
      url: `https://upload.test/${input.storageKey}`,
      expiresInSeconds: input.expiresInSeconds
    }));
    jest.mocked(photoStorage.createDownloadUrl).mockImplementation(async (input) => ({
      url: `https://download.test/${input.storageKey}`,
      expiresInSeconds: input.expiresInSeconds
    }));
    dataAccess.listActivePhotos.mockResolvedValue([]);
    dataAccess.lockUser.mockResolvedValue(true);
    dataAccess.clearActivePrimary.mockResolvedValue(undefined);
    dataAccess.setActivePrimary.mockResolvedValue(undefined);
    dataAccess.updateDisplayOrder.mockResolvedValue(undefined);
    dataAccess.swapDisplayOrders.mockResolvedValue(undefined);
    dataAccess.softDeletePhoto.mockResolvedValue(undefined);
    dataAccess.isProfileMarkedComplete.mockResolvedValue(false);
    dataAccess.insertPhoto.mockImplementation(async (input) => photo({
      id: input.photoId,
      storageKey: input.storageKey,
      displayOrder: input.displayOrder,
      isPrimary: input.isPrimary
    }) as never);
  });

  it('builds a server-owned webp key and does not use the original filename', () => {
    const key = buildPhotoStorageKey(userId, '22222222-2222-4222-8222-222222222222');
    expect(key).toBe(`photos/${userId}/22222222-2222-4222-8222-222222222222.webp`);
    expect(key).not.toContain('photo.jpg');
  });

  it('stores a reservation and rejects an upload when five active photos exist', async () => {
    const created = await createUploadUrl(userId, {
      mimeType: 'image/jpeg',
      fileSizeBytes: 2048,
      originalFilename: 'photo.jpg'
    });

    expect(created.storageKey).toBe(buildPhotoStorageKey(userId, created.photoId));
    expect(created.expiresInSeconds).toBe(300);
    expect(created.uploadUrl).toContain(created.storageKey);
    expect(jest.mocked(photoStorage.createUploadUrl)).toHaveBeenCalledWith({
      storageKey: created.storageKey,
      mimeType: 'image/jpeg',
      expiresInSeconds: 300
    });
    const stored = JSON.parse((await redis.get(uploadReservationKey(created.photoId))) ?? '{}') as {
      userId: string;
      storageKey: string;
      originalFilename: string;
    };
    expect(stored).toMatchObject({
      userId,
      storageKey: created.storageKey,
      mimeType: 'image/jpeg',
      fileSizeBytes: 2048,
      originalFilename: 'photo.jpg'
    });
    expect(dataAccess.insertPhoto).not.toHaveBeenCalled();

    dataAccess.listActivePhotos.mockResolvedValue([photo(), photo(), photo(), photo(), photo()] as never);
    await expect(
      createUploadUrl(userId, { mimeType: 'image/png', fileSizeBytes: 10 })
    ).rejects.toMatchObject({ errorCode: 'PHOTO_LIMIT_REACHED' });
  });

  it('rejects a missing reservation and a mismatched storage key without inserting', async () => {
    await expect(
      confirmPhoto(userId, {
        photoId: '33333333-3333-4333-8333-333333333333',
        storageKey: 'photos/other/nope.webp',
        displayOrder: 1,
        isPrimary: true
      })
    ).rejects.toBeInstanceOf(NotFoundError);

    const created = await createUploadUrl(userId, { mimeType: 'image/webp', fileSizeBytes: 30 });
    await expect(
      confirmPhoto(userId, {
        photoId: created.photoId,
        storageKey: 'photos/attacker/chosen.webp',
        displayOrder: 1,
        isPrimary: false
      })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await redis.get(uploadReservationKey(created.photoId))).not.toBeNull();
    expect(dataAccess.insertPhoto).not.toHaveBeenCalled();
  });

  it('confirms from the reservation, moves a colliding order, and keeps the reservation when the write fails', async () => {
    const created = await createUploadUrl(userId, {
      mimeType: 'image/png',
      fileSizeBytes: 99,
      originalFilename: 'ignore-me.png'
    });
    const existing = photo({ displayOrder: 1, isPrimary: true });
    dataAccess.listActivePhotos.mockResolvedValue([existing] as never);

    const confirmed = await confirmPhoto(userId, {
      photoId: created.photoId,
      storageKey: created.storageKey,
      displayOrder: 1,
      isPrimary: true
    });

    expect(dataAccess.updateDisplayOrder).toHaveBeenCalledWith(userId, existing.id, 2, expect.any(Object));
    expect(dataAccess.clearActivePrimary.mock.invocationCallOrder[0]).toBeLessThan(
      dataAccess.insertPhoto.mock.invocationCallOrder[0]
    );
    expect(dataAccess.insertPhoto).toHaveBeenCalledWith(
      expect.objectContaining({
        photoId: created.photoId,
        userId,
        storageKey: created.storageKey,
        mimeType: 'image/png',
        fileSizeBytes: 99,
        originalFilename: 'ignore-me.png',
        displayOrder: 1,
        isPrimary: true
      }),
      expect.any(Object)
    );
    expect(confirmed.url).toBe(`https://download.test/${created.storageKey}`);
    expect(confirmed).not.toHaveProperty('storageKey');
    expect(await redis.get(uploadReservationKey(created.photoId))).toBeNull();

    const retry = await createUploadUrl(userId, { mimeType: 'image/jpeg', fileSizeBytes: 40 });
    dataAccess.insertPhoto.mockRejectedValue(new UniqueConstraintError({}));
    await expect(
      confirmPhoto(userId, {
        photoId: retry.photoId,
        storageKey: retry.storageKey,
        displayOrder: 2,
        isPrimary: false
      })
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await redis.get(uploadReservationKey(retry.photoId))).not.toBeNull();
  });

  it('does not confirm another user reservation', async () => {
    const created = await createUploadUrl(userId, { mimeType: 'image/jpeg', fileSizeBytes: 40 });
    await expect(
      confirmPhoto(otherUserId, {
        photoId: created.photoId,
        storageKey: created.storageKey,
        displayOrder: 1,
        isPrimary: true
      })
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(dataAccess.insertPhoto).not.toHaveBeenCalled();
    expect(await redis.get(uploadReservationKey(created.photoId))).not.toBeNull();
  });

  it('forces the first confirmed photo to be primary for either client flag', async () => {
    dataAccess.listActivePhotos.mockResolvedValue([]);

    const rejected = await createUploadUrl(userId, { mimeType: 'image/jpeg', fileSizeBytes: 20 });
    const forced = await confirmPhoto(userId, {
      photoId: rejected.photoId,
      storageKey: rejected.storageKey,
      displayOrder: 2,
      isPrimary: false
    });
    expect(forced.isPrimary).toBe(true);
    expect(dataAccess.clearActivePrimary).not.toHaveBeenCalled();
    expect(dataAccess.insertPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ photoId: rejected.photoId, isPrimary: true }),
      expect.any(Object)
    );

    dataAccess.insertPhoto.mockClear();
    const accepted = await createUploadUrl(userId, { mimeType: 'image/png', fileSizeBytes: 21 });
    const explicit = await confirmPhoto(userId, {
      photoId: accepted.photoId,
      storageKey: accepted.storageKey,
      displayOrder: 1,
      isPrimary: true
    });
    expect(explicit.isPrimary).toBe(true);
    expect(dataAccess.clearActivePrimary).not.toHaveBeenCalled();
    expect(dataAccess.insertPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ photoId: accepted.photoId, isPrimary: true }),
      expect.any(Object)
    );
  });

  it('keeps or replaces the existing primary when another photo is confirmed', async () => {
    const existing = photo({ displayOrder: 1, isPrimary: true });
    dataAccess.listActivePhotos.mockResolvedValue([existing] as never);

    const kept = await createUploadUrl(userId, { mimeType: 'image/webp', fileSizeBytes: 22 });
    await confirmPhoto(userId, {
      photoId: kept.photoId,
      storageKey: kept.storageKey,
      displayOrder: 2,
      isPrimary: false
    });
    expect(dataAccess.clearActivePrimary).not.toHaveBeenCalled();
    expect(dataAccess.insertPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ photoId: kept.photoId, isPrimary: false }),
      expect.any(Object)
    );

    dataAccess.insertPhoto.mockClear();
    const replacement = await createUploadUrl(userId, { mimeType: 'image/jpeg', fileSizeBytes: 23 });
    await confirmPhoto(userId, {
      photoId: replacement.photoId,
      storageKey: replacement.storageKey,
      displayOrder: 3,
      isPrimary: true
    });
    expect(dataAccess.clearActivePrimary.mock.invocationCallOrder[0]).toBeLessThan(
      dataAccess.insertPhoto.mock.invocationCallOrder[0]
    );
    expect(dataAccess.insertPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ photoId: replacement.photoId, isPrimary: true }),
      expect.any(Object)
    );
  });

  it('promotes the lowest remaining photo when primary is cleared or deleted', async () => {
    const primary = photo({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', displayOrder: 2, isPrimary: true });
    const lower = photo({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', displayOrder: 1, isPrimary: false });
    dataAccess.listActivePhotos.mockResolvedValue([lower, primary] as never);

    await updatePhoto(userId, primary.id, { isPrimary: false });
    expect(dataAccess.setActivePrimary).toHaveBeenCalledWith(userId, lower.id, expect.any(Object));

    dataAccess.setActivePrimary.mockClear();
    await deletePhoto(userId, primary.id);
    expect(dataAccess.softDeletePhoto).toHaveBeenCalledWith(userId, primary.id, expect.any(Object));
    expect(dataAccess.setActivePrimary).toHaveBeenCalledWith(userId, lower.id, expect.any(Object));
  });

  it('rejects deleting the only photo of a completed profile', async () => {
    dataAccess.listActivePhotos.mockResolvedValue([photo()] as never);
    dataAccess.isProfileMarkedComplete.mockResolvedValue(true);

    await expect(deletePhoto(userId, '11111111-1111-4111-8111-111111111111')).rejects.toMatchObject({
      errorCode: 'PHOTO_REQUIRED'
    });
    expect(dataAccess.softDeletePhoto).not.toHaveBeenCalled();
    expect(dataAccess.isProfileMarkedComplete).toHaveBeenCalled();
  });
});
