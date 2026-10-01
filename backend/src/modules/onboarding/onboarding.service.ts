import { sequelize } from '../../config/database';
import { NotFoundError, ValidationError } from '../../utils/errors';
import * as gendersDataAccess from '../genders/genders.data-access';
import type { GenderCatalogItem } from '../genders/genders.types';
import * as interestsDataAccess from '../interests/interests.data-access';
import type { InterestCatalogItem } from '../interests/interests.types';
import * as profilesDataAccess from '../profiles/profiles.data-access';
import * as relationshipIntentionsDataAccess from '../relationship-intentions/relationship-intentions.data-access';
import type { RelationshipIntentionCatalogItem } from '../relationship-intentions/relationship-intentions.types';
import * as onboardingDataAccess from './onboarding.data-access';
import type { ReplaceDatingPreferencesBody, SaveLocationBody } from './onboarding.validator';

function unavailableIds(requestedIds: string[], activeIds: string[]): string[] {
  const active = new Set(activeIds.map((id) => id.toLowerCase()));
  return requestedIds.filter((id) => !active.has(id.toLowerCase()));
}

function canonicalIds(requestedIds: string[], activeIds: string[]): string[] {
  const active = new Map(activeIds.map((id) => [id.toLowerCase(), id]));
  return requestedIds.map((id) => active.get(id.toLowerCase()) as string);
}

function rejectUnavailable(field: string, ids: string[], errorCode: string, message: string): void {
  if (ids.length === 0) {
    return;
  }

  throw new ValidationError(
    message,
    ids.map((id) => ({ field, message: `${id} is unknown or inactive.` })),
    errorCode
  );
}

export async function replaceOwnInterests(userId: string, interestIds: string[]): Promise<InterestCatalogItem[]> {
  const active = await interestsDataAccess.findActiveInterestsByIds(interestIds);
  const missing = unavailableIds(
    interestIds,
    active.map((row) => row.id)
  );
  rejectUnavailable(
    'interestIds',
    missing,
    'INVALID_INTEREST',
    'One or more interests are not available.'
  );

  const selected = await sequelize.transaction(async (transaction) => {
    await interestsDataAccess.replaceUserInterests(userId, canonicalIds(interestIds, active.map((row) => row.id)), transaction);
    return interestsDataAccess.findUserInterests(userId, transaction);
  });

  return selected.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category ?? null
  }));
}

export async function replaceOwnRelationshipIntentions(
  userId: string,
  relationshipIntentionIds: string[]
): Promise<RelationshipIntentionCatalogItem[]> {
  const active = await relationshipIntentionsDataAccess.findActiveRelationshipIntentionsByIds(relationshipIntentionIds);
  const missing = unavailableIds(
    relationshipIntentionIds,
    active.map((row) => row.id)
  );
  rejectUnavailable(
    'relationshipIntentionIds',
    missing,
    'INVALID_RELATIONSHIP_INTENTION',
    'One or more relationship intentions are not available.'
  );

  const selected = await sequelize.transaction(async (transaction) => {
    await relationshipIntentionsDataAccess.replaceUserRelationshipIntentions(
      userId,
      canonicalIds(relationshipIntentionIds, active.map((row) => row.id)),
      transaction
    );
    return relationshipIntentionsDataAccess.findUserRelationshipIntentions(userId, transaction);
  });

  return selected.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name
  }));
}

export interface StoredDatingPreferences {
  minAge: number;
  maxAge: number;
  maxDistanceKm: number;
  interestedInGenders: GenderCatalogItem[];
  preferredIntentions: RelationshipIntentionCatalogItem[];
}

export async function replaceOwnDatingPreferences(
  userId: string,
  body: ReplaceDatingPreferencesBody
): Promise<StoredDatingPreferences> {
  const activeGenders = await gendersDataAccess.findActiveGendersByIds(body.interestedInGenderIds);
  const missingGenders = unavailableIds(
    body.interestedInGenderIds,
    activeGenders.map((row) => row.id)
  );
  rejectUnavailable(
    'interestedInGenderIds',
    missingGenders,
    'INVALID_GENDER',
    'One or more genders are not available.'
  );

  const activeIntentions = await relationshipIntentionsDataAccess.findActiveRelationshipIntentionsByIds(
    body.preferredIntentionIds
  );
  const missingIntentions = unavailableIds(
    body.preferredIntentionIds,
    activeIntentions.map((row) => row.id)
  );
  rejectUnavailable(
    'preferredIntentionIds',
    missingIntentions,
    'INVALID_RELATIONSHIP_INTENTION',
    'One or more relationship intentions are not available.'
  );

  const genderIds = canonicalIds(
    body.interestedInGenderIds,
    activeGenders.map((row) => row.id)
  );
  const intentionIds = canonicalIds(
    body.preferredIntentionIds,
    activeIntentions.map((row) => row.id)
  );
  const values = {
    minAge: body.minAge,
    maxAge: body.maxAge,
    maxDistanceKm: body.maxDistanceKm
  };

  return sequelize.transaction(async (transaction) => {
    const existing = await onboardingDataAccess.findDatingPreference(userId, transaction);
    if (existing) {
      await onboardingDataAccess.updateDatingPreference(userId, values, transaction);
    } else {
      await onboardingDataAccess.createDatingPreference(userId, values, transaction);
    }

    await onboardingDataAccess.replaceDatingPreferenceGenders(userId, genderIds, transaction);
    await onboardingDataAccess.replaceDatingPreferenceIntentions(userId, intentionIds, transaction);

    const stored = await onboardingDataAccess.findDatingPreference(userId, transaction);
    if (!stored) {
      throw new Error('Dating preferences were not stored.');
    }

    const interestedInGenders = await onboardingDataAccess.findDatingPreferenceGenders(userId, transaction);
    const preferredIntentions = await onboardingDataAccess.findDatingPreferenceIntentions(userId, transaction);

    return {
      minAge: stored.minAge,
      maxAge: stored.maxAge,
      maxDistanceKm: stored.maxDistanceKm,
      interestedInGenders,
      preferredIntentions
    };
  });
}

export interface SavedLocation {
  city: string;
  updated: true;
}

export async function updateOwnLocation(userId: string, input: SaveLocationBody): Promise<SavedLocation> {
  const profile = await profilesDataAccess.findProfileByUserId(userId);
  if (!profile) {
    throw new NotFoundError('Profile not found.', [], 'PROFILE_NOT_FOUND');
  }

  await profilesDataAccess.updateProfileLocation(userId, {
    city: input.city,
    latitude: input.latitude,
    longitude: input.longitude
  });

  return {
    city: input.city,
    updated: true
  };
}
