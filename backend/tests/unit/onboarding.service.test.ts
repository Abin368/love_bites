jest.mock('../../src/config/database', () => ({
  sequelize: {
    transaction: jest.fn()
  }
}));

jest.mock('../../src/modules/interests/interests.data-access', () => ({
  findActiveInterests: jest.fn(),
  findActiveInterestsByIds: jest.fn(),
  replaceUserInterests: jest.fn(),
  findUserInterests: jest.fn()
}));

jest.mock('../../src/modules/relationship-intentions/relationship-intentions.data-access', () => ({
  findActiveRelationshipIntentions: jest.fn(),
  findActiveRelationshipIntentionsByIds: jest.fn(),
  replaceUserRelationshipIntentions: jest.fn(),
  findUserRelationshipIntentions: jest.fn()
}));

jest.mock('../../src/modules/genders/genders.data-access', () => ({
  findActiveGenders: jest.fn(),
  findActiveGendersByIds: jest.fn()
}));

jest.mock('../../src/modules/onboarding/onboarding.data-access', () => ({
  findDatingPreference: jest.fn(),
  createDatingPreference: jest.fn(),
  updateDatingPreference: jest.fn(),
  replaceDatingPreferenceGenders: jest.fn(),
  replaceDatingPreferenceIntentions: jest.fn(),
  findDatingPreferenceGenders: jest.fn(),
  findDatingPreferenceIntentions: jest.fn()
}));

jest.mock('../../src/modules/profiles/profiles.data-access', () => ({
  findProfileByUserId: jest.fn(),
  updateProfileLocation: jest.fn()
}));

import { sequelize } from '../../src/config/database';
import * as gendersDataAccess from '../../src/modules/genders/genders.data-access';
import * as interestsDataAccess from '../../src/modules/interests/interests.data-access';
import * as onboardingDataAccess from '../../src/modules/onboarding/onboarding.data-access';
import {
  replaceOwnDatingPreferences,
  replaceOwnInterests,
  replaceOwnRelationshipIntentions,
  updateOwnLocation
} from '../../src/modules/onboarding/onboarding.service';
import * as profilesDataAccess from '../../src/modules/profiles/profiles.data-access';
import * as profilesService from '../../src/modules/profiles/profiles.service';
import * as relationshipIntentionsDataAccess from '../../src/modules/relationship-intentions/relationship-intentions.data-access';
import { ValidationError } from '../../src/utils/errors';

const interests = interestsDataAccess as jest.Mocked<typeof interestsDataAccess>;
const intentions = relationshipIntentionsDataAccess as jest.Mocked<typeof relationshipIntentionsDataAccess>;
const genders = gendersDataAccess as jest.Mocked<typeof gendersDataAccess>;
const preferences = onboardingDataAccess as jest.Mocked<typeof onboardingDataAccess>;
const profiles = profilesDataAccess as jest.Mocked<typeof profilesDataAccess>;
const transaction = sequelize.transaction as jest.Mock;
const userId = 'user-1';
const interestIds = [
  '1a2b3c4d-0001-4000-8000-000000000001',
  '1a2b3c4d-0002-4000-8000-000000000002',
  '1a2b3c4d-0003-4000-8000-000000000003'
];
const intentionIds = ['2a3b4c5d-0001-4000-8000-000000000001', '2a3b4c5d-0002-4000-8000-000000000002'];

describe('onboarding selection service', () => {
  beforeEach(() => {
    transaction.mockImplementation(async (work: (trx: { id: string }) => Promise<unknown>) => work({ id: 'tx' }));
  });

  it('replaces interests inside a transaction and returns catalog fields only', async () => {
    interests.findActiveInterestsByIds.mockResolvedValue(interestIds.map((id) => ({ id })) as never);
    interests.findUserInterests.mockResolvedValue([
      { id: interestIds[2], code: 'C', name: 'Third', category: null, displayOrder: 1 },
      { id: interestIds[0], code: 'A', name: 'First', category: 'Food', displayOrder: 2 },
      { id: interestIds[1], code: 'B', name: 'Second', category: 'Sport', displayOrder: 3 }
    ] as never);

    const result = await replaceOwnInterests(userId, [interestIds[0].toUpperCase(), interestIds[1], interestIds[2]]);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(interests.replaceUserInterests).toHaveBeenCalledWith(userId, interestIds, { id: 'tx' });
    expect(result).toEqual([
      { id: interestIds[2], code: 'C', name: 'Third', category: null },
      { id: interestIds[0], code: 'A', name: 'First', category: 'Food' },
      { id: interestIds[1], code: 'B', name: 'Second', category: 'Sport' }
    ]);
    expect(result[0]).not.toHaveProperty('displayOrder');
  });

  it('does not change interests when an id is unknown or inactive', async () => {
    interests.findActiveInterestsByIds.mockResolvedValue([{ id: interestIds[0] }, { id: interestIds[1] }] as never);

    await expect(replaceOwnInterests(userId, interestIds)).rejects.toMatchObject({
      name: 'ValidationError',
      statusCode: 400,
      errorCode: 'INVALID_INTEREST'
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(interests.replaceUserInterests).not.toHaveBeenCalled();
  });

  it('propagates an interest insert failure from the transaction', async () => {
    interests.findActiveInterestsByIds.mockResolvedValue(interestIds.map((id) => ({ id })) as never);
    interests.replaceUserInterests.mockRejectedValue(new Error('insert failed'));

    await expect(replaceOwnInterests(userId, interestIds)).rejects.toThrow('insert failed');
    expect(interests.findUserInterests).not.toHaveBeenCalled();
  });

  it('replaces relationship intentions inside a transaction and omits extra fields', async () => {
    intentions.findActiveRelationshipIntentionsByIds.mockResolvedValue(intentionIds.map((id) => ({ id })) as never);
    intentions.findUserRelationshipIntentions.mockResolvedValue([
      { id: intentionIds[1], code: 'FRIENDSHIP', name: 'Friendship', description: 'hidden', displayOrder: 1 },
      { id: intentionIds[0], code: 'LONG_TERM_RELATIONSHIP', name: 'Long-term relationship', displayOrder: 2 }
    ] as never);

    const result = await replaceOwnRelationshipIntentions(userId, intentionIds);

    expect(intentions.replaceUserRelationshipIntentions).toHaveBeenCalledWith(userId, intentionIds, { id: 'tx' });
    expect(result).toEqual([
      { id: intentionIds[1], code: 'FRIENDSHIP', name: 'Friendship' },
      { id: intentionIds[0], code: 'LONG_TERM_RELATIONSHIP', name: 'Long-term relationship' }
    ]);
    expect(result[0]).not.toHaveProperty('description');
  });

  it('does not change intentions when an id is unknown or inactive', async () => {
    intentions.findActiveRelationshipIntentionsByIds.mockResolvedValue([{ id: intentionIds[0] }] as never);

    const error = await replaceOwnRelationshipIntentions(userId, intentionIds).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ errorCode: 'INVALID_RELATIONSHIP_INTENTION' });
    expect(transaction).not.toHaveBeenCalled();
    expect(intentions.replaceUserRelationshipIntentions).not.toHaveBeenCalled();
  });

  it('propagates an intention insert failure from the transaction', async () => {
    intentions.findActiveRelationshipIntentionsByIds.mockResolvedValue(intentionIds.map((id) => ({ id })) as never);
    intentions.replaceUserRelationshipIntentions.mockRejectedValue(new Error('insert failed'));

    await expect(replaceOwnRelationshipIntentions(userId, intentionIds)).rejects.toThrow('insert failed');
    expect(intentions.findUserRelationshipIntentions).not.toHaveBeenCalled();
  });
});

const otherUserId = 'user-2';
const genderId = '9a12c4b5-8821-4122-901b-5e4d29381002';
const otherGenderId = '9a12c4b5-8821-4122-901b-5e4d29381003';
const preferredIntentionId = '2a3b4c5d-0001-4000-8000-000000000001';
const otherPreferredIntentionId = '2a3b4c5d-0002-4000-8000-000000000002';
const preferenceInput = {
  minAge: 22,
  maxAge: 32,
  maxDistanceKm: 40,
  interestedInGenderIds: [genderId.toUpperCase()],
  preferredIntentionIds: [preferredIntentionId]
};

describe('onboarding dating preference service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    transaction.mockImplementation(async (work: (trx: { id: string }) => Promise<unknown>) => work({ id: 'tx' }));
    genders.findActiveGendersByIds.mockResolvedValue([{ id: genderId }] as never);
    intentions.findActiveRelationshipIntentionsByIds.mockResolvedValue([{ id: preferredIntentionId }] as never);
    preferences.createDatingPreference.mockResolvedValue(undefined);
    preferences.updateDatingPreference.mockResolvedValue(undefined);
    preferences.replaceDatingPreferenceGenders.mockResolvedValue(undefined);
    preferences.replaceDatingPreferenceIntentions.mockResolvedValue(undefined);
    preferences.findDatingPreferenceGenders.mockResolvedValue([{ id: genderId, code: 'WOMAN', name: 'Woman' }]);
    preferences.findDatingPreferenceIntentions.mockResolvedValue([
      { id: preferredIntentionId, code: 'LONG_TERM_RELATIONSHIP', name: 'Long-term relationship' }
    ]);
  });

  it('creates a preference row on the first save and returns the stored catalog records', async () => {
    preferences.findDatingPreference
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ minAge: 22, maxAge: 32, maxDistanceKm: 40 });

    const result = await replaceOwnDatingPreferences(userId, preferenceInput);

    expect(preferences.createDatingPreference).toHaveBeenCalledWith(
      userId,
      { minAge: 22, maxAge: 32, maxDistanceKm: 40 },
      { id: 'tx' }
    );
    expect(preferences.updateDatingPreference).not.toHaveBeenCalled();
    expect(preferences.replaceDatingPreferenceGenders).toHaveBeenCalledWith(userId, [genderId], { id: 'tx' });
    expect(preferences.replaceDatingPreferenceIntentions).toHaveBeenCalledWith(userId, [preferredIntentionId], { id: 'tx' });
    expect(result).toEqual({
      minAge: 22,
      maxAge: 32,
      maxDistanceKm: 40,
      interestedInGenders: [{ id: genderId, code: 'WOMAN', name: 'Woman' }],
      preferredIntentions: [{ id: preferredIntentionId, code: 'LONG_TERM_RELATIONSHIP', name: 'Long-term relationship' }]
    });
    expect(JSON.stringify(result)).not.toContain(otherUserId);
  });

  it('updates the existing preference row on a later save', async () => {
    preferences.findDatingPreference
      .mockResolvedValueOnce({ minAge: 18, maxAge: 100, maxDistanceKm: 50 })
      .mockResolvedValueOnce({ minAge: 22, maxAge: 32, maxDistanceKm: 40 });

    await replaceOwnDatingPreferences(userId, preferenceInput);

    expect(preferences.updateDatingPreference).toHaveBeenCalledWith(
      userId,
      { minAge: 22, maxAge: 32, maxDistanceKm: 40 },
      { id: 'tx' }
    );
    expect(preferences.createDatingPreference).not.toHaveBeenCalled();
  });

  it('replaces gender and intention junctions, including when the new lists are empty', async () => {
    preferences.findDatingPreference.mockResolvedValue({ minAge: 22, maxAge: 32, maxDistanceKm: 40 });
    genders.findActiveGendersByIds.mockResolvedValue([{ id: otherGenderId }, { id: genderId }] as never);
    intentions.findActiveRelationshipIntentionsByIds.mockResolvedValue([
      { id: otherPreferredIntentionId },
      { id: preferredIntentionId }
    ] as never);

    await replaceOwnDatingPreferences(userId, {
      ...preferenceInput,
      interestedInGenderIds: [otherGenderId, genderId],
      preferredIntentionIds: [otherPreferredIntentionId]
    });

    expect(preferences.replaceDatingPreferenceGenders).toHaveBeenCalledWith(userId, [otherGenderId, genderId], { id: 'tx' });
    expect(preferences.replaceDatingPreferenceIntentions).toHaveBeenCalledWith(userId, [otherPreferredIntentionId], {
      id: 'tx'
    });

    preferences.replaceDatingPreferenceGenders.mockClear();
    preferences.replaceDatingPreferenceIntentions.mockClear();
    genders.findActiveGendersByIds.mockResolvedValue([]);
    intentions.findActiveRelationshipIntentionsByIds.mockResolvedValue([]);

    await replaceOwnDatingPreferences(userId, {
      ...preferenceInput,
      interestedInGenderIds: [],
      preferredIntentionIds: []
    });

    expect(preferences.replaceDatingPreferenceGenders).toHaveBeenCalledWith(userId, [], { id: 'tx' });
    expect(preferences.replaceDatingPreferenceIntentions).toHaveBeenCalledWith(userId, [], { id: 'tx' });
    expect(preferences.replaceDatingPreferenceGenders).not.toHaveBeenCalledWith(otherUserId, expect.anything(), expect.anything());
  });

  it('does not write when a gender or intention id is unknown or inactive', async () => {
    genders.findActiveGendersByIds.mockResolvedValue([]);

    await expect(replaceOwnDatingPreferences(userId, preferenceInput)).rejects.toMatchObject({
      errorCode: 'INVALID_GENDER'
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(preferences.createDatingPreference).not.toHaveBeenCalled();
    expect(preferences.updateDatingPreference).not.toHaveBeenCalled();
    expect(preferences.replaceDatingPreferenceGenders).not.toHaveBeenCalled();

    genders.findActiveGendersByIds.mockResolvedValue([{ id: genderId }] as never);
    intentions.findActiveRelationshipIntentionsByIds.mockResolvedValue([]);

    await expect(replaceOwnDatingPreferences(userId, preferenceInput)).rejects.toMatchObject({
      errorCode: 'INVALID_RELATIONSHIP_INTENTION'
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(preferences.replaceDatingPreferenceIntentions).not.toHaveBeenCalled();
  });

  it('rejects the whole transaction when a later write fails', async () => {
    preferences.findDatingPreference.mockResolvedValueOnce(null);
    preferences.replaceDatingPreferenceIntentions.mockRejectedValue(new Error('insert failed'));

    await expect(replaceOwnDatingPreferences(userId, preferenceInput)).rejects.toThrow('insert failed');
    expect(preferences.createDatingPreference).toHaveBeenCalledWith(userId, expect.any(Object), { id: 'tx' });
    expect(preferences.findDatingPreferenceGenders).not.toHaveBeenCalled();
    expect(preferences.updateDatingPreference).not.toHaveBeenCalledWith(otherUserId, expect.anything(), expect.anything());
  });
});

describe('onboarding location service', () => {
  let completion: jest.SpyInstance;

  beforeEach(() => {
    profiles.findProfileByUserId.mockReset();
    profiles.updateProfileLocation.mockReset();
    profiles.findProfileByUserId.mockResolvedValue({ id: 'profile-1', isProfileComplete: false } as never);
    profiles.updateProfileLocation.mockResolvedValue(undefined);
    completion = jest.spyOn(profilesService, 'evaluateIsProfileComplete');
  });

  afterEach(() => {
    completion.mockRestore();
  });

  it('stores the city and coordinates for the supplied user and returns no coordinates', async () => {
    const result = await updateOwnLocation(userId, {
      city: 'Bengaluru',
      latitude: 12.9716,
      longitude: 77.5946
    });

    expect(profiles.findProfileByUserId).toHaveBeenCalledWith(userId);
    expect(profiles.updateProfileLocation).toHaveBeenCalledWith(userId, {
      city: 'Bengaluru',
      latitude: 12.9716,
      longitude: 77.5946
    });
    expect(result).toEqual({ city: 'Bengaluru', updated: true });
    expect(result).not.toHaveProperty('latitude');
    expect(result).not.toHaveProperty('longitude');
    expect(result).not.toHaveProperty('location');
    expect(result).not.toHaveProperty('isProfileComplete');
    expect(completion).not.toHaveBeenCalled();
    expect(JSON.stringify(profiles.updateProfileLocation.mock.calls)).not.toContain('isProfileComplete');
  });

  it('returns profile not found and does not write when the user has no profile', async () => {
    profiles.findProfileByUserId.mockResolvedValue(null);

    await expect(
      updateOwnLocation(userId, { city: 'Bengaluru', latitude: 12.9716, longitude: 77.5946 })
    ).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'PROFILE_NOT_FOUND'
    });
    expect(profiles.updateProfileLocation).not.toHaveBeenCalled();
    expect(completion).not.toHaveBeenCalled();
  });

  it('replaces the previous city and coordinates on a later save', async () => {
    await updateOwnLocation(userId, { city: 'Bengaluru', latitude: 12.9716, longitude: 77.5946 });
    const replaced = await updateOwnLocation(userId, { city: 'Kochi', latitude: 9.9312, longitude: 76.2673 });

    expect(profiles.updateProfileLocation).toHaveBeenNthCalledWith(1, userId, {
      city: 'Bengaluru',
      latitude: 12.9716,
      longitude: 77.5946
    });
    expect(profiles.updateProfileLocation).toHaveBeenNthCalledWith(2, userId, {
      city: 'Kochi',
      latitude: 9.9312,
      longitude: 76.2673
    });
    expect(replaced).toEqual({ city: 'Kochi', updated: true });
    expect(completion).not.toHaveBeenCalled();
    expect(JSON.stringify(profiles.updateProfileLocation.mock.calls)).not.toContain('isProfileComplete');
  });
});
