import { randomUUID } from 'crypto';
import request from 'supertest';
import { literal } from 'sequelize';
import { app } from '../../src/app';
import { DatingPreference } from '../../src/database/models/dating-preference.model';
import { Gender } from '../../src/database/models/gender.model';
import { Interest } from '../../src/database/models/interest.model';
import { Profile } from '../../src/database/models/profile.model';
import { ProfilePhoto } from '../../src/database/models/profile-photo.model';
import { RelationshipIntention } from '../../src/database/models/relationship-intention.model';
import { User } from '../../src/database/models/user.model';
import { UserInterest } from '../../src/database/models/user-interest.model';
import { UserRelationshipIntention } from '../../src/database/models/user-relationship-intention.model';
import { createUser, findProfileCompletion } from '../../src/modules/users/users.data-access';
import { signAccessToken } from '../../src/utils/jwt';

const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';
const PREREQUISITES = [
  'VERIFICATION',
  'BASIC_PROFILE',
  'PHOTOS',
  'INTERESTS',
  'RELATIONSHIP_INTENTIONS',
  'DATING_PREFERENCES',
  'LOCATION'
];

function userInput(emailVerified = false) {
  return {
    email: `status-${randomUUID()}@example.com`,
    phone: null,
    passwordHash: PASSWORD_HASH,
    role: 'USER' as const,
    status: 'UNVERIFIED' as const,
    emailVerified,
    phoneVerified: false
  };
}

function tokenFor(userId: string, role: 'USER' | 'ADMIN' = 'USER'): string {
  return signAccessToken({
    sub: userId,
    role,
    isVerified: false,
    isProfileComplete: false
  });
}

function authHeader(userId: string, role: 'USER' | 'ADMIN' = 'USER') {
  return { Authorization: `Bearer ${tokenFor(userId, role)}` };
}

function suffix(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}

async function createGender() {
  return Gender.create({
    code: `g-${suffix()}`,
    name: 'Man',
    isActive: true
  });
}

async function addProfile(userId: string, isProfileComplete = false) {
  const gender = await createGender();
  return Profile.create({
    userId,
    firstName: 'John',
    dateOfBirth: '1998-05-10',
    genderId: gender.id,
    isProfileComplete
  });
}

async function addPrimaryPhoto(userId: string) {
  const now = new Date();
  await ProfilePhoto.create({
    userId,
    storageKey: `photos/${userId}/${randomUUID()}.webp`,
    mimeType: 'image/webp',
    fileSizeBytes: 1200,
    displayOrder: 1,
    isPrimary: true,
    createdAt: now,
    updatedAt: now
  });
}

async function addInterests(userId: string, count: number) {
  const now = new Date();
  for (let index = 0; index < count; index += 1) {
    const interest = await Interest.create({
      code: `I${index}${suffix()}`,
      name: `Interest ${index}`,
      category: 'Test',
      isActive: true,
      displayOrder: index + 1,
      createdAt: now,
      updatedAt: now
    });
    await UserInterest.create({ userId, interestId: interest.id, createdAt: now });
  }
}

async function addIntention(userId: string) {
  const now = new Date();
  const intention = await RelationshipIntention.create({
    code: `R${suffix()}`,
    name: 'Long-term',
    description: 'Hidden',
    isActive: true,
    displayOrder: 1,
    createdAt: now,
    updatedAt: now
  });
  await UserRelationshipIntention.create({
    userId,
    relationshipIntentionId: intention.id,
    createdAt: now
  });
}

async function addDatingPreference(userId: string) {
  const now = new Date();
  await DatingPreference.create({
    userId,
    minAge: 22,
    maxAge: 32,
    maxDistanceKm: 40,
    createdAt: now,
    updatedAt: now
  });
}

async function addLocation(userId: string) {
  await Profile.update(
    {
      city: 'Bengaluru',
      location: literal("ST_GeogFromText('SRID=4326;POINT(77.5946 12.9716)')")
    },
    { where: { userId } }
  );
}

async function getStatus(userId: string) {
  return request(app).get('/api/v1/onboarding/status').set(authHeader(userId));
}

describe('GET /api/v1/onboarding/status', () => {
  it('rejects an unauthenticated request and a non-USER role', async () => {
    const missing = await request(app).get('/api/v1/onboarding/status');
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
    const forbidden = await request(app).get('/api/v1/onboarding/status').set(authHeader(admin.id, 'ADMIN'));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
  });

  it('returns verification or basic profile when the user has no profile', async () => {
    const verified = await createUser(userInput(true));
    const verifiedStatus = await getStatus(verified.id);
    expect(verifiedStatus.status).toBe(200);
    expect(verifiedStatus.body).toEqual({
      success: true,
      data: {
        isVerified: true,
        isProfileComplete: false,
        completedSteps: ['VERIFICATION'],
        nextStep: 'BASIC_PROFILE'
      },
      message: 'Onboarding status retrieved successfully'
    });
    expect(await Profile.count({ where: { userId: verified.id } })).toBe(0);

    const unverified = await createUser(userInput(false));
    const unverifiedStatus = await getStatus(unverified.id);
    expect(unverifiedStatus.status).toBe(200);
    expect(unverifiedStatus.body.data).toEqual({
      isVerified: false,
      isProfileComplete: false,
      completedSteps: [],
      nextStep: 'VERIFICATION'
    });
  });

  it('advances through each prerequisite and keeps the stored flag false', async () => {
    const user = await createUser(userInput(true));
    await addProfile(user.id);

    const photosNext = await getStatus(user.id);
    expect(photosNext.body.data.completedSteps).toEqual(['VERIFICATION', 'BASIC_PROFILE']);
    expect(photosNext.body.data.nextStep).toBe('PHOTOS');
    expect(photosNext.body.data.isProfileComplete).toBe(false);

    await addPrimaryPhoto(user.id);
    await addInterests(user.id, 2);
    const interestsNext = await getStatus(user.id);
    expect(interestsNext.body.data.completedSteps).toEqual(['VERIFICATION', 'BASIC_PROFILE', 'PHOTOS']);
    expect(interestsNext.body.data.nextStep).toBe('INTERESTS');

    await addInterests(user.id, 3);
    const intentionsNext = await getStatus(user.id);
    expect(intentionsNext.body.data.nextStep).toBe('RELATIONSHIP_INTENTIONS');
    expect(intentionsNext.body.data.completedSteps).toContain('INTERESTS');
    expect(intentionsNext.body.data.completedSteps).not.toContain('RELATIONSHIP_INTENTIONS');

    await addIntention(user.id);
    const preferencesNext = await getStatus(user.id);
    expect(preferencesNext.body.data.nextStep).toBe('DATING_PREFERENCES');

    await addDatingPreference(user.id);
    const locationNext = await getStatus(user.id);
    expect(locationNext.body.data.nextStep).toBe('LOCATION');
    expect(locationNext.body.data.completedSteps).toEqual([
      'VERIFICATION',
      'BASIC_PROFILE',
      'PHOTOS',
      'INTERESTS',
      'RELATIONSHIP_INTENTIONS',
      'DATING_PREFERENCES'
    ]);

    expect(await findProfileCompletion(user.id)).toBe(false);
    await addLocation(user.id);
    const completeNext = await getStatus(user.id);
    expect(completeNext.body.data.completedSteps).toEqual(PREREQUISITES);
    expect(completeNext.body.data.nextStep).toBe('COMPLETE');
    expect(completeNext.body.data.isProfileComplete).toBe(false);
    expect(await findProfileCompletion(user.id)).toBe(false);
    expect(Object.keys(completeNext.body.data).sort()).toEqual([
      'completedSteps',
      'isProfileComplete',
      'isVerified',
      'nextStep'
    ]);
    expect(JSON.stringify(completeNext.body)).not.toContain('77.5946');
    expect(JSON.stringify(completeNext.body)).not.toContain('12.9716');
    expect(JSON.stringify(completeNext.body)).not.toContain('storageKey');
    expect(completeNext.body.data).not.toHaveProperty('location');
    expect(completeNext.body.data).not.toHaveProperty('latitude');
    expect(completeNext.body.data).not.toHaveProperty('longitude');
    expect(completeNext.body.data).not.toHaveProperty('photos');
  });

  it('returns a null next step when the stored flag is already true and does not clear it', async () => {
    const user = await createUser(userInput(true));
    await addProfile(user.id, true);
    await addPrimaryPhoto(user.id);
    await addInterests(user.id, 3);
    await addIntention(user.id);
    await addDatingPreference(user.id);
    await addLocation(user.id);
    expect(await findProfileCompletion(user.id)).toBe(true);

    const status = await getStatus(user.id);
    expect(status.status).toBe(200);
    expect(status.body.data.isProfileComplete).toBe(true);
    expect(status.body.data.completedSteps).toEqual(PREREQUISITES);
    expect(status.body.data.nextStep).toBeNull();
    expect(await findProfileCompletion(user.id)).toBe(true);
  });

  it('ignores another user when choosing the first incomplete step', async () => {
    const user = await createUser(userInput(true));
    const other = await createUser(userInput(true));
    await addProfile(user.id);
    await addProfile(other.id, true);
    await addPrimaryPhoto(other.id);
    await addInterests(other.id, 3);
    await addIntention(other.id);
    await addDatingPreference(other.id);
    await addLocation(other.id);

    const status = await getStatus(user.id);
    expect(status.body.data.completedSteps).toEqual(['VERIFICATION', 'BASIC_PROFILE']);
    expect(status.body.data.nextStep).toBe('PHOTOS');
    expect(status.body.data.isProfileComplete).toBe(false);
    expect(await findProfileCompletion(other.id)).toBe(true);
    expect(await findProfileCompletion(user.id)).toBe(false);
  });
});
