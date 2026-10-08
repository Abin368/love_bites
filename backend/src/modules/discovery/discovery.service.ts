import type { ProfilePhoto } from '../../database/models/profile-photo.model';
import { photoStorage } from '../../integrations/storage/s3.provider';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../../utils/errors';
import { findUserInterests } from '../interests/interests.data-access';
import { listActivePhotos } from '../profile-photos/profile-photos.data-access';
import { findUserRelationshipIntentions } from '../relationship-intentions/relationship-intentions.data-access';
import { findUserById } from '../users/users.data-access';
import { findNextDiscoveryCandidate, findViewerDiscoveryContext } from './discovery.data-access';
import type { DiscoveryCandidate, DiscoveryCard, DiscoveryPhoto } from './discovery.types';

const DOWNLOAD_TTL_SECONDS = 3600;

export interface DiscoveryViewer {
  id: string;
  isVerified: boolean;
}

function oneDecimal(value: number | string): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Math.round(numeric * 10) / 10;
}

async function rejectUnverified(userId: string): Promise<never> {
  const user = await findUserById(userId);
  if (!user || user.status === 'DELETED' || user.deletedAt) {
    throw new UnauthorizedError('Invalid token.', [], 'INVALID_TOKEN');
  }

  if (user.email && !user.emailVerified) {
    throw new ForbiddenError('Email verification is required.', [], 'EMAIL_NOT_VERIFIED');
  }

  throw new ForbiddenError('Phone verification is required.', [], 'PHONE_NOT_VERIFIED');
}

function incomplete(): ValidationError {
  return new ValidationError('Onboarding is incomplete.', [], 'PROFILE_INCOMPLETE');
}

async function presentPhoto(photo: ProfilePhoto): Promise<DiscoveryPhoto> {
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

export async function getNextCandidate(viewer: DiscoveryViewer): Promise<DiscoveryCard> {
  if (!viewer.isVerified) {
    await rejectUnverified(viewer.id);
  }

  const context = await findViewerDiscoveryContext(viewer.id);
  if (!context || !context.isProfileComplete || !context.hasLocation || !context.hasDatingPreferences) {
    throw incomplete();
  }

  const row = await findNextDiscoveryCandidate(viewer.id);
  if (!row) {
    return { candidate: null };
  }

  const [photos, interests, intentions] = await Promise.all([
    listActivePhotos(row.userId),
    findUserInterests(row.userId),
    findUserRelationshipIntentions(row.userId)
  ]);
  const presentedPhotos = await Promise.all(photos.map((photo) => presentPhoto(photo)));

  const candidate: DiscoveryCandidate = {
    id: row.userId,
    firstName: row.firstName,
    age: Number(row.age),
    gender: {
      id: row.genderId,
      code: row.genderCode,
      name: row.genderName
    },
    bio: row.bio,
    occupation: row.occupation,
    education: row.education,
    city: row.city,
    distanceKm: oneDecimal(row.distanceKm),
    photos: presentedPhotos,
    interests: interests.map((interest) => ({
      id: interest.id,
      code: interest.code,
      name: interest.name,
      category: interest.category ?? null
    })),
    relationshipIntentions: intentions.map((intention) => ({
      id: intention.id,
      code: intention.code,
      name: intention.name
    }))
  };

  return { candidate };
}
