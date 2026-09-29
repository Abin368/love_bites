import { ForeignKeyConstraintError, UniqueConstraintError } from 'sequelize';
import type { Gender } from '../../database/models/gender.model';
import type { Profile } from '../../database/models/profile.model';
import {
  ConflictError,
  NotFoundError,
  UnprocessableEntityError,
  ValidationError
} from '../../utils/errors';
import { isAtLeast18, isRealCalendarDate } from '../auth/auth.validator';
import * as profilesDataAccess from './profiles.data-access';
import type { ProfileCompletionInput, ProfileResponse } from './profiles.types';
import type { CreateProfileBody, UpdateProfileBody } from './profiles.validator';

const genderUnavailable = new ValidationError(
  'Gender is not available.',
  [{ field: 'genderId', message: 'Select an active gender.' }],
  'INVALID_GENDER'
);

function underageError(): UnprocessableEntityError {
  return new UnprocessableEntityError(
    'You must be at least 18 years old.',
    [{ field: 'dateOfBirth', message: 'You must be at least 18 years old.' }],
    'UNDERAGE_NOT_PERMITTED'
  );
}

function profileNotFound(): NotFoundError {
  return new NotFoundError('Profile not found.', [], 'PROFILE_NOT_FOUND');
}

function profileAlreadyExists(): ConflictError {
  return new ConflictError('A profile already exists for this account.', [], 'PROFILE_ALREADY_EXISTS');
}

function isUnderageConstraint(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('parent' in error)) {
    return false;
  }
  const parent = (error as { parent?: { code?: string; constraint?: string } }).parent;
  return parent?.code === '23514' && parent.constraint === 'chk_profiles_age_18_plus';
}

function rethrowProfileWriteError(error: unknown): never {
  if (error instanceof UniqueConstraintError) {
    throw profileAlreadyExists();
  }
  if (error instanceof ForeignKeyConstraintError) {
    throw genderUnavailable;
  }
  if (isUnderageConstraint(error)) {
    throw underageError();
  }
  throw error;
}

function assertAdult(dateOfBirth: string): void {
  if (!isRealCalendarDate(dateOfBirth) || !isAtLeast18(dateOfBirth)) {
    throw underageError();
  }
}

async function requireActiveGender(genderId: string): Promise<void> {
  const gender = await profilesDataAccess.findGenderById(genderId);
  if (!gender || !gender.isActive) {
    throw genderUnavailable;
  }
}

function formatDateOnly(value: string): string {
  return value.slice(0, 10);
}

function toProfileResponse(profile: Profile): ProfileResponse {
  const gender = profile.get('gender') as Pick<Gender, 'id' | 'code' | 'name'> | null | undefined;
  if (!gender) {
    throw profileNotFound();
  }

  return {
    id: profile.id,
    userId: profile.userId,
    firstName: profile.firstName,
    dateOfBirth: formatDateOnly(profile.dateOfBirth),
    gender: {
      id: gender.id,
      code: gender.code,
      name: gender.name
    },
    bio: profile.bio,
    occupation: profile.occupation,
    education: profile.education,
    city: profile.city,
    isProfileComplete: profile.isProfileComplete
  };
}

/**
 * Discovery eligibility from the product onboarding sequence.
 * A profile is complete only when city, location, one primary photo (1–5),
 * 3–10 interests, at least one relationship intention, and dating preferences
 * are all present. Basic profile fields alone are not enough. Bio, occupation,
 * and education are optional and do not change the flag.
 */
export function evaluateIsProfileComplete(input: ProfileCompletionInput): boolean {
  const hasCity = typeof input.city === 'string' && input.city.trim().length > 0;
  const hasLocation = input.location != null;
  const hasPhotos =
    input.hasPrimaryPhoto && input.activePhotoCount >= 1 && input.activePhotoCount <= 5;
  const hasInterests = input.interestCount >= 3 && input.interestCount <= 10;
  const hasIntentions = input.intentionCount >= 1;

  return (
    hasCity &&
    hasLocation &&
    hasPhotos &&
    hasInterests &&
    hasIntentions &&
    input.hasDatingPreferences
  );
}

export async function getOwnProfile(userId: string): Promise<ProfileResponse> {
  const profile = await profilesDataAccess.findProfileByUserId(userId);
  if (!profile) {
    throw profileNotFound();
  }
  return toProfileResponse(profile);
}

export async function createOwnProfile(userId: string, input: CreateProfileBody): Promise<ProfileResponse> {
  assertAdult(input.dateOfBirth);
  await requireActiveGender(input.genderId);

  const existing = await profilesDataAccess.findProfileByUserId(userId);
  if (existing) {
    throw profileAlreadyExists();
  }

  try {
    // Completion is not accepted from the client. This write leaves city and
    // location null and does not record photos, interests, intentions, or
    // dating preferences, so is_profile_complete stays at its default of false.
    await profilesDataAccess.createProfile({
      userId,
      firstName: input.firstName,
      dateOfBirth: input.dateOfBirth,
      genderId: input.genderId,
      bio: input.bio ?? null,
      occupation: input.occupation ?? null,
      education: input.education ?? null
    });
  } catch (error) {
    rethrowProfileWriteError(error);
  }

  const created = await profilesDataAccess.findProfileByUserId(userId);
  if (!created) {
    throw profileNotFound();
  }
  return toProfileResponse(created);
}

export async function updateOwnProfile(userId: string, patch: UpdateProfileBody): Promise<ProfileResponse> {
  if (Object.keys(patch).length === 0) {
    throw new ValidationError('At least one profile field is required.', [], 'VALIDATION_ERROR');
  }
  if (patch.dateOfBirth !== undefined) {
    assertAdult(patch.dateOfBirth);
  }
  if (patch.genderId !== undefined) {
    await requireActiveGender(patch.genderId);
  }

  const existing = await profilesDataAccess.findProfileByUserId(userId);
  if (!existing) {
    throw profileNotFound();
  }

  try {
    await profilesDataAccess.updateProfile(userId, patch);
  } catch (error) {
    rethrowProfileWriteError(error);
  }

  const updated = await profilesDataAccess.findProfileByUserId(userId);
  if (!updated) {
    throw profileNotFound();
  }
  return toProfileResponse(updated);
}
