import { randomUUID } from 'crypto';
import { UniqueConstraintError } from 'sequelize';
import { sequelize } from '../../config/database';
import { redis } from '../../config/redis';
import type { ProfilePhoto } from '../../database/models/profile-photo.model';
import { photoStorage } from '../../integrations/storage/s3.provider';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
import * as profilePhotosDataAccess from './profile-photos.data-access';
import type { ProfilePhotoResponse, UploadReservation, UploadUrlResponse } from './profile-photos.types';
import { PHOTO_MIME_TYPES, type PhotoMimeType } from './profile-photos.types';
import type { ConfirmPhotoBody, UpdatePhotoBody, UploadUrlBody } from './profile-photos.validator';
import { photoIdSchema } from './profile-photos.validator';

const MAX_ACTIVE_PHOTOS = 5;
const UPLOAD_TTL_SECONDS = 300;
const DOWNLOAD_TTL_SECONDS = 3600;

export function buildPhotoStorageKey(userId: string, photoId: string): string {
  return `photos/${userId}/${photoId}.webp`;
}

export function uploadReservationKey(photoId: string): string {
  return `profile-photo:upload:${photoId}`;
}

function photoNotFound(): NotFoundError {
  return new NotFoundError('Photo not found.', [], 'RESOURCE_NOT_FOUND');
}

function uploadNotFound(): NotFoundError {
  return new NotFoundError('Upload not found.', [], 'RESOURCE_NOT_FOUND');
}

function photoLimitReached(): ConflictError {
  return new ConflictError('You can have at most 5 photos.', [], 'PHOTO_LIMIT_REACHED');
}

function parsePhotoId(photoId: string): string {
  const parsed = photoIdSchema.safeParse(photoId);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', [
      { field: 'photoId', message: 'Photo id must be a valid UUID.' }
    ]);
  }
  return parsed.data;
}

function isMimeType(value: unknown): value is PhotoMimeType {
  return typeof value === 'string' && (PHOTO_MIME_TYPES as readonly string[]).includes(value);
}

function readReservation(value: string): UploadReservation | null {
  try {
    const parsed = JSON.parse(value) as Partial<UploadReservation>;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    if (
      typeof parsed.userId !== 'string' ||
      typeof parsed.photoId !== 'string' ||
      typeof parsed.storageKey !== 'string' ||
      !isMimeType(parsed.mimeType) ||
      typeof parsed.fileSizeBytes !== 'number' ||
      !Number.isInteger(parsed.fileSizeBytes)
    ) {
      return null;
    }
    return {
      userId: parsed.userId,
      photoId: parsed.photoId,
      storageKey: parsed.storageKey,
      mimeType: parsed.mimeType,
      fileSizeBytes: parsed.fileSizeBytes,
      originalFilename: typeof parsed.originalFilename === 'string' ? parsed.originalFilename : null
    };
  } catch {
    return null;
  }
}

async function loadReservation(photoId: string): Promise<UploadReservation | null> {
  const raw = await redis.get(uploadReservationKey(photoId));
  if (!raw) {
    return null;
  }
  return readReservation(raw);
}

function lowestFreeOrder(photos: ProfilePhoto[]): number {
  const used = new Set(photos.map((photo) => photo.displayOrder));
  for (let order = 1; order <= MAX_ACTIVE_PHOTOS; order += 1) {
    if (!used.has(order)) {
      return order;
    }
  }
  throw photoLimitReached();
}

function byDisplayOrder(left: ProfilePhoto, right: ProfilePhoto): number {
  return left.displayOrder - right.displayOrder || left.id.localeCompare(right.id);
}

async function present(photo: ProfilePhoto): Promise<ProfilePhotoResponse> {
  const signed = await photoStorage.createDownloadUrl({
    storageKey: photo.storageKey,
    expiresInSeconds: DOWNLOAD_TTL_SECONDS
  });
  return {
    id: photo.id,
    url: signed.url,
    displayOrder: photo.displayOrder,
    isPrimary: photo.isPrimary
  };
}

async function presentAll(photos: ProfilePhoto[]): Promise<ProfilePhotoResponse[]> {
  const ordered = [...photos].sort(byDisplayOrder);
  return Promise.all(ordered.map((photo) => present(photo)));
}

export async function createUploadUrl(userId: string, body: UploadUrlBody): Promise<UploadUrlResponse> {
  const active = await profilePhotosDataAccess.listActivePhotos(userId);
  if (active.length >= MAX_ACTIVE_PHOTOS) {
    throw photoLimitReached();
  }

  const photoId = randomUUID();
  const storageKey = buildPhotoStorageKey(userId, photoId);
  const signed = await photoStorage.createUploadUrl({
    storageKey,
    mimeType: body.mimeType,
    expiresInSeconds: UPLOAD_TTL_SECONDS
  });

  const reservation: UploadReservation = {
    userId,
    photoId,
    storageKey,
    mimeType: body.mimeType,
    fileSizeBytes: body.fileSizeBytes,
    originalFilename: body.originalFilename ?? null
  };
  await redis.set(uploadReservationKey(photoId), JSON.stringify(reservation), 'EX', UPLOAD_TTL_SECONDS);

  return {
    photoId,
    uploadUrl: signed.url,
    storageKey,
    expiresInSeconds: UPLOAD_TTL_SECONDS
  };
}

export async function confirmPhoto(userId: string, body: ConfirmPhotoBody): Promise<ProfilePhotoResponse> {
  const reservation = await loadReservation(body.photoId);
  if (!reservation || reservation.photoId !== body.photoId || reservation.userId !== userId) {
    throw uploadNotFound();
  }
  if (body.storageKey !== reservation.storageKey) {
    throw new ValidationError(
      'Storage key does not match the upload reservation.',
      [{ field: 'storageKey', message: 'Storage key does not match the upload reservation.' }],
      'INVALID_STORAGE_KEY'
    );
  }

  let created: ProfilePhoto;
  try {
    created = await sequelize.transaction(async (transaction) => {
      const locked = await profilePhotosDataAccess.lockUser(userId, transaction);
      if (!locked) {
        throw uploadNotFound();
      }

      const active = await profilePhotosDataAccess.listActivePhotos(userId, transaction);
      if (active.length >= MAX_ACTIVE_PHOTOS) {
        throw photoLimitReached();
      }

      const occupant = active.find((photo) => photo.displayOrder === body.displayOrder);
      if (occupant) {
        await profilePhotosDataAccess.updateDisplayOrder(
          userId,
          occupant.id,
          lowestFreeOrder(active),
          transaction
        );
      }

      const isPrimary = active.length === 0 ? true : body.isPrimary;
      if (isPrimary && active.length > 0) {
        await profilePhotosDataAccess.clearActivePrimary(userId, transaction);
      }

      return profilePhotosDataAccess.insertPhoto(
        {
          photoId: reservation.photoId,
          userId,
          storageKey: reservation.storageKey,
          originalFilename: reservation.originalFilename,
          mimeType: reservation.mimeType,
          fileSizeBytes: reservation.fileSizeBytes,
          displayOrder: body.displayOrder,
          isPrimary
        },
        transaction
      );
    });
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      throw new ConflictError(
        'Photo order or primary photo conflicts with an existing photo.',
        [],
        'PHOTO_CONFLICT'
      );
    }
    throw error;
  }

  await redis.del(uploadReservationKey(reservation.photoId));
  return present(created);
}

export async function listPhotos(userId: string): Promise<ProfilePhotoResponse[]> {
  const photos = await profilePhotosDataAccess.listActivePhotos(userId);
  return presentAll(photos);
}

export async function updatePhoto(
  userId: string,
  photoId: string,
  patch: UpdatePhotoBody
): Promise<ProfilePhotoResponse[]> {
  const id = parsePhotoId(photoId);

  try {
    await sequelize.transaction(async (transaction) => {
      const locked = await profilePhotosDataAccess.lockUser(userId, transaction);
      if (!locked) {
        throw photoNotFound();
      }

      const active = await profilePhotosDataAccess.listActivePhotos(userId, transaction);
      const photo = active.find((item) => item.id === id);
      if (!photo) {
        throw photoNotFound();
      }

      if (patch.displayOrder !== undefined && patch.displayOrder !== photo.displayOrder) {
        const occupant = active.find((item) => item.id !== photo.id && item.displayOrder === patch.displayOrder);
        if (occupant) {
          const sourceOrder = photo.displayOrder;
          await profilePhotosDataAccess.swapDisplayOrders(
            userId,
            photo.id,
            occupant.id,
            patch.displayOrder,
            sourceOrder,
            transaction
          );
          occupant.displayOrder = sourceOrder;
          photo.displayOrder = patch.displayOrder;
        } else {
          await profilePhotosDataAccess.updateDisplayOrder(userId, photo.id, patch.displayOrder, transaction);
          photo.displayOrder = patch.displayOrder;
        }
      }

      if (patch.isPrimary === true) {
        await profilePhotosDataAccess.clearActivePrimary(userId, transaction);
        await profilePhotosDataAccess.setActivePrimary(userId, photo.id, transaction);
      } else if (patch.isPrimary === false && photo.isPrimary) {
        const successor = active.filter((item) => item.id !== photo.id).sort(byDisplayOrder)[0];
        if (successor) {
          await profilePhotosDataAccess.clearActivePrimary(userId, transaction);
          await profilePhotosDataAccess.setActivePrimary(userId, successor.id, transaction);
        }
      }
    });
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      throw new ConflictError(
        'Photo order or primary photo conflicts with an existing photo.',
        [],
        'PHOTO_CONFLICT'
      );
    }
    throw error;
  }

  return presentAll(await profilePhotosDataAccess.listActivePhotos(userId));
}

export async function deletePhoto(userId: string, photoId: string): Promise<{ deleted: true }> {
  const id = parsePhotoId(photoId);

  await sequelize.transaction(async (transaction) => {
    const locked = await profilePhotosDataAccess.lockUser(userId, transaction);
    if (!locked) {
      throw photoNotFound();
    }

    const active = await profilePhotosDataAccess.listActivePhotos(userId, transaction);
    const photo = active.find((item) => item.id === id);
    if (!photo) {
      throw photoNotFound();
    }

    const complete = await profilePhotosDataAccess.isProfileMarkedComplete(userId, transaction);
    if (complete && active.length <= 1) {
      throw new ConflictError(
        'A completed profile must keep at least one photo.',
        [],
        'PHOTO_REQUIRED'
      );
    }

    await profilePhotosDataAccess.softDeletePhoto(userId, photo.id, transaction);
    if (photo.isPrimary) {
      const successor = active.filter((item) => item.id !== photo.id).sort(byDisplayOrder)[0];
      if (successor) {
        await profilePhotosDataAccess.setActivePrimary(userId, successor.id, transaction);
      }
    }
  });

  return { deleted: true };
}
