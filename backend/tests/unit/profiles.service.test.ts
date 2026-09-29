import { UniqueConstraintError } from 'sequelize';
import { ConflictError, NotFoundError, UnprocessableEntityError, ValidationError } from '../../src/utils/errors';

jest.mock('../../src/modules/profiles/profiles.data-access');

import * as profilesDataAccess from '../../src/modules/profiles/profiles.data-access';
import {
  createOwnProfile,
  evaluateIsProfileComplete,
  getOwnProfile,
  updateOwnProfile
} from '../../src/modules/profiles/profiles.service';

const dataAccess = profilesDataAccess as jest.Mocked<typeof profilesDataAccess>;
const userId = 'user-1';
const genderId = '9a12c4b5-8821-4122-901b-5e4d29381001';

const createBody = {
  firstName: 'John',
  dateOfBirth: '1998-05-10',
  genderId,
  bio: 'Hello',
  occupation: 'Engineer',
  education: 'B.Tech'
};

function profileRow(overrides: Record<string, unknown> = {}) {
  const gender = { id: genderId, code: 'MAN', name: 'Man' };
  return {
    id: 'profile-1',
    userId,
    firstName: 'John',
    dateOfBirth: '1998-05-10',
    bio: 'Hello',
    occupation: 'Engineer',
    education: 'B.Tech',
    city: null,
    location: null,
    isProfileComplete: false,
    get(key: string) {
      return key === 'gender' ? gender : undefined;
    },
    ...overrides
  };
}

describe('profile completion', () => {
  const ready = {
    city: 'Kochi',
    location: { type: 'Point' },
    activePhotoCount: 1,
    hasPrimaryPhoto: true,
    interestCount: 3,
    intentionCount: 1,
    hasDatingPreferences: true
  };

  it('stays incomplete without city and location', () => {
    expect(evaluateIsProfileComplete({ ...ready, city: null, location: null })).toBe(false);
    expect(evaluateIsProfileComplete({ ...ready, city: 'Kochi', location: null })).toBe(false);
    expect(evaluateIsProfileComplete({ ...ready, city: null })).toBe(false);
  });

  it('stays incomplete when any other onboarding requirement is missing', () => {
    expect(evaluateIsProfileComplete({ ...ready, activePhotoCount: 0, hasPrimaryPhoto: false })).toBe(false);
    expect(evaluateIsProfileComplete({ ...ready, hasPrimaryPhoto: false })).toBe(false);
    expect(evaluateIsProfileComplete({ ...ready, interestCount: 2 })).toBe(false);
    expect(evaluateIsProfileComplete({ ...ready, interestCount: 11 })).toBe(false);
    expect(evaluateIsProfileComplete({ ...ready, intentionCount: 0 })).toBe(false);
    expect(evaluateIsProfileComplete({ ...ready, hasDatingPreferences: false })).toBe(false);
  });

  it('is complete only when every documented requirement is present', () => {
    expect(evaluateIsProfileComplete(ready)).toBe(true);
  });
});

describe('profile service', () => {
  beforeEach(() => {
    dataAccess.findGenderById.mockResolvedValue({ id: genderId, isActive: true } as never);
    dataAccess.findProfileByUserId.mockResolvedValue(null);
    dataAccess.createProfile.mockResolvedValue(profileRow() as never);
    dataAccess.updateProfile.mockResolvedValue(undefined);
  });

  it('returns the authenticated user profile without security fields', async () => {
    dataAccess.findProfileByUserId.mockResolvedValue(profileRow() as never);
    const profile = await getOwnProfile(userId);
    expect(profile).toEqual({
      id: 'profile-1',
      userId,
      firstName: 'John',
      dateOfBirth: '1998-05-10',
      gender: { id: genderId, code: 'MAN', name: 'Man' },
      bio: 'Hello',
      occupation: 'Engineer',
      education: 'B.Tech',
      city: null,
      isProfileComplete: false
    });
    expect(profile).not.toHaveProperty('passwordHash');
    expect(profile).not.toHaveProperty('location');
  });

  it('returns profile not found when the user has no profile', async () => {
    await expect(getOwnProfile(userId)).rejects.toMatchObject({
      statusCode: 404,
      errorCode: 'PROFILE_NOT_FOUND'
    });
    expect(dataAccess.createProfile).not.toHaveBeenCalled();
  });

  it('creates a profile for the supplied user id and leaves completion false', async () => {
    dataAccess.findProfileByUserId.mockResolvedValueOnce(null).mockResolvedValueOnce(profileRow() as never);

    const profile = await createOwnProfile(userId, createBody);

    expect(dataAccess.createProfile).toHaveBeenCalledWith({
      userId,
      firstName: 'John',
      dateOfBirth: '1998-05-10',
      genderId,
      bio: 'Hello',
      occupation: 'Engineer',
      education: 'B.Tech'
    });
    expect(profile.isProfileComplete).toBe(false);
    expect(profile.city).toBeNull();
  });

  it('rejects a duplicate profile before insert', async () => {
    dataAccess.findProfileByUserId.mockResolvedValue(profileRow() as never);
    await expect(createOwnProfile(userId, createBody)).rejects.toBeInstanceOf(ConflictError);
    expect(dataAccess.createProfile).not.toHaveBeenCalled();
  });

  it('maps a unique-constraint race to the duplicate profile error', async () => {
    dataAccess.createProfile.mockRejectedValue(new UniqueConstraintError({ message: 'duplicate' }));
    await expect(createOwnProfile(userId, createBody)).rejects.toMatchObject({
      statusCode: 409,
      errorCode: 'PROFILE_ALREADY_EXISTS'
    });
  });

  it('rejects an inactive or missing gender', async () => {
    dataAccess.findGenderById.mockResolvedValueOnce({ id: genderId, isActive: false } as never);
    await expect(createOwnProfile(userId, createBody)).rejects.toMatchObject({
      statusCode: 400,
      errorCode: 'INVALID_GENDER'
    });

    dataAccess.findGenderById.mockResolvedValueOnce(null);
    await expect(createOwnProfile(userId, createBody)).rejects.toBeInstanceOf(ValidationError);
    expect(dataAccess.createProfile).not.toHaveBeenCalled();
  });

  it('rejects an underage date of birth before writing', async () => {
    await expect(createOwnProfile(userId, { ...createBody, dateOfBirth: '2015-01-01' })).rejects.toBeInstanceOf(
      UnprocessableEntityError
    );
    expect(dataAccess.createProfile).not.toHaveBeenCalled();
  });

  it('updates only the authenticated user and rejects a missing profile or empty patch', async () => {
    dataAccess.findProfileByUserId.mockResolvedValue(profileRow() as never);
    await updateOwnProfile(userId, { bio: 'Updated' });
    expect(dataAccess.updateProfile).toHaveBeenCalledWith(userId, { bio: 'Updated' });

    dataAccess.findProfileByUserId.mockResolvedValue(null);
    await expect(updateOwnProfile(userId, { firstName: 'Ada' })).rejects.toBeInstanceOf(NotFoundError);
    expect(dataAccess.updateProfile).toHaveBeenCalledTimes(1);

    await expect(updateOwnProfile(userId, {})).rejects.toBeInstanceOf(ValidationError);
  });
});
