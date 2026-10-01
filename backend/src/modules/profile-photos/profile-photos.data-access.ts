import { Transaction } from 'sequelize';
import { sequelize } from '../../config/database';
import '../../database/associations';
import { Profile } from '../../database/models/profile.model';
import { ProfilePhoto } from '../../database/models/profile-photo.model';
import { User } from '../../database/models/user.model';
import { NotFoundError } from '../../utils/errors';
import type { InsertProfilePhotoInput } from './profile-photos.types';

function rowLock(transaction?: Transaction): true | undefined {
  return transaction ? true : undefined;
}

export async function lockUser(userId: string, transaction: Transaction): Promise<boolean> {
  const user = await User.findByPk(userId, {
    attributes: ['id'],
    transaction,
    lock: true,
  });
  return user !== null;
}

export async function listActivePhotos(userId: string, transaction?: Transaction): Promise<ProfilePhoto[]> {
  return ProfilePhoto.findAll({
    where: { userId },
    order: [
      ['displayOrder', 'ASC'],
      ['id', 'ASC']
    ],
    transaction,
    lock: rowLock(transaction)
  });
}

export async function isProfileMarkedComplete(userId: string, transaction?: Transaction): Promise<boolean> {
  const profile = await Profile.findOne({
    where: { userId },
    attributes: ['isProfileComplete'],
    transaction
  });
  return profile?.isProfileComplete === true;
}

export async function updateDisplayOrder(
  userId: string,
  photoId: string,
  displayOrder: number,
  transaction: Transaction
): Promise<void> {
  await ProfilePhoto.update({ displayOrder }, { where: { id: photoId, userId }, transaction });
}

export async function clearActivePrimary(userId: string, transaction: Transaction): Promise<void> {
  await ProfilePhoto.update({ isPrimary: false }, { where: { userId, isPrimary: true }, transaction });
}

export async function setActivePrimary(userId: string, photoId: string, transaction: Transaction): Promise<void> {
  await ProfilePhoto.update({ isPrimary: true }, { where: { id: photoId, userId }, transaction });
}

export async function insertPhoto(input: InsertProfilePhotoInput, transaction: Transaction): Promise<ProfilePhoto> {
  return ProfilePhoto.create(
    {
      id: input.photoId,
      userId: input.userId,
      storageKey: input.storageKey,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      fileSizeBytes: input.fileSizeBytes,
      displayOrder: input.displayOrder,
      isPrimary: input.isPrimary,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    { transaction }
  );
}

export async function softDeletePhoto(userId: string, photoId: string, transaction: Transaction): Promise<void> {
  await ProfilePhoto.destroy({ where: { id: photoId, userId }, transaction });
}

function affectedRows(result: unknown): number {
  const metadata = Array.isArray(result) ? result[1] : undefined;
  if (metadata && typeof metadata === 'object' && metadata !== null && 'rowCount' in metadata) {
    return Number((metadata as { rowCount: number }).rowCount);
  }
  return 0;
}

async function updatePhotoRow(
  sql: string,
  replacements: Record<string, string | number>,
  transaction: Transaction
): Promise<void> {
  const result = await sequelize.query(sql, { replacements, transaction });
  if (affectedRows(result) !== 1) {
    throw new NotFoundError('Photo not found.', [], 'RESOURCE_NOT_FOUND');
  }
}

/**
 * Moves moverId onto an order held by occupantId.
 * The occupant is parked with deleted_at so the active 1–5 unique index can be rewritten,
 * then restored on the mover's previous order. No order outside 1–5 is written.
 */
export async function swapDisplayOrders(
  userId: string,
  moverId: string,
  occupantId: string,
  targetOrder: number,
  sourceOrder: number,
  transaction: Transaction
): Promise<void> {
  await updatePhotoRow(
    `UPDATE profile_photos
     SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = :occupantId AND user_id = :userId AND deleted_at IS NULL`,
    { occupantId, userId },
    transaction
  );
  await updatePhotoRow(
    `UPDATE profile_photos
     SET display_order = :targetOrder, updated_at = CURRENT_TIMESTAMP
     WHERE id = :moverId AND user_id = :userId AND deleted_at IS NULL`,
    { targetOrder, moverId, userId },
    transaction
  );
  await updatePhotoRow(
    `UPDATE profile_photos
     SET display_order = :sourceOrder, deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = :occupantId AND user_id = :userId AND deleted_at IS NOT NULL`,
    { sourceOrder, occupantId, userId },
    transaction
  );
}
