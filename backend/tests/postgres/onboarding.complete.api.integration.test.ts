import { randomUUID } from 'crypto';
import request from 'supertest';
import { literal, QueryTypes } from 'sequelize';
import { app } from '../../src/app';
import { sequelize } from '../../src/config/database';
import { DatingPreference } from '../../src/database/models/dating-preference.model';
import { Gender } from '../../src/database/models/gender.model';
import { Interest } from '../../src/database/models/interest.model';
import { Profile } from '../../src/database/models/profile.model';
import { ProfilePhoto } from '../../src/database/models/profile-photo.model';
import { RelationshipIntention } from '../../src/database/models/relationship-intention.model';
import { User } from '../../src/database/models/user.model';
import { UserDatingPreferenceIntention } from '../../src/database/models/user-dating-preference-intention.model';
import { UserInterest } from '../../src/database/models/user-interest.model';
import { UserRelationshipIntention } from '../../src/database/models/user-relationship-intention.model';
import { findProfileCompletion } from '../../src/modules/users/users.data-access';
import { signAccessToken } from '../../src/utils/jwt';

const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';
const POINT = "ST_GeogFromText('SRID=4326;POINT(77.5946 12.9716)')";

const SUCCESS_BODY = {
  success: true,
  data: {
    isProfileComplete: true,
    status: 'ACTIVE'
  },
  message: 'Onboarding complete! Welcome to Love Bite.'
};

interface StoredProfile {
  first_name: string;
  date_of_birth: string;
  gender_id: string;
  bio: string | null;
  occupation: string | null;
  education: string | null;
  city: string | null;
  location_is_null: boolean;
  is_profile_complete: boolean;
  updated_at: Date;
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

function complete(userId: string) {
  return request(app).post('/api/v1/onboarding/complete').set(authHeader(userId));
}

function detailFields(body: { error?: { details?: Array<{ field?: string }> } }): string[] {
  return (body.error?.details ?? []).map((detail) => detail.field ?? '');
}

async function readStoredProfile(userId: string): Promise<StoredProfile> {
  const rows = await sequelize.query<StoredProfile>(
    `SELECT first_name, date_of_birth::text AS date_of_birth, gender_id, bio, occupation, education, city,
            location IS NULL AS location_is_null, is_profile_complete, updated_at
     FROM profiles
     WHERE user_id = :userId`,
    { replacements: { userId }, type: QueryTypes.SELECT }
  );
  return rows[0];
}

async function createAccount(emailVerified: boolean, status: 'ACTIVE' | 'UNVERIFIED' = 'ACTIVE') {
  return User.create({
    email: `complete-${randomUUID()}@example.com`,
    passwordHash: PASSWORD_HASH,
    role: 'USER',
    status,
    emailVerified,
    phoneVerified: false
  });
}

async function addProfile(userId: string, isProfileComplete = false) {
  const gender = await Gender.create({
    code: `g-${suffix()}`,
    name: 'Man',
    isActive: true
  });
  return Profile.create({
    userId,
    firstName: 'John',
    dateOfBirth: '1998-05-10',
    genderId: gender.id,
    bio: 'Coffee and long walks.',
    occupation: 'Engineer',
    education: 'B.Tech',
    isProfileComplete
  });
}

async function addPhoto(userId: string, isPrimary: boolean) {
  const now = new Date();
  return ProfilePhoto.create({
    userId,
    storageKey: `photos/${userId}/${randomUUID()}.webp`,
    mimeType: 'image/webp',
    fileSizeBytes: 1200,
    displayOrder: 1,
    isPrimary,
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

async function addIntentionCatalog() {
  const now = new Date();
  return RelationshipIntention.create({
    code: `R${suffix()}`,
    name: 'Long-term',
    description: 'Hidden',
    isActive: true,
    displayOrder: 1,
    createdAt: now,
    updatedAt: now
  });
}

async function addOwnIntention(userId: string) {
  const intention = await addIntentionCatalog();
  await UserRelationshipIntention.create({
    userId,
    relationshipIntentionId: intention.id,
    createdAt: new Date()
  });
  return intention;
}

async function addDatingPreference(userId: string, relationshipIntentionId?: string) {
  const now = new Date();
  await DatingPreference.create({
    userId,
    minAge: 22,
    maxAge: 32,
    maxDistanceKm: 40,
    createdAt: now,
    updatedAt: now
  });
  if (relationshipIntentionId) {
    await UserDatingPreferenceIntention.create({
      userId,
      relationshipIntentionId,
      createdAt: now
    });
  }
}

async function setLocation(userId: string, city: string | null, withPoint: boolean) {
  await Profile.update(
    {
      city,
      location: withPoint ? literal(POINT) : null
    },
    { where: { userId } }
  );
}

async function prepareReadyUser(
  overrides: {
    emailVerified?: boolean;
    accountStatus?: 'ACTIVE' | 'UNVERIFIED';
    profile?: boolean;
    photo?: 'primary' | 'none' | 'not-primary' | 'deleted';
    interestCount?: number;
    ownIntention?: boolean;
    datingPreference?: boolean;
    preferenceIntention?: boolean;
    location?: 'full' | 'missing-city' | 'blank-city' | 'null-point' | 'absent';
  } = {}
) {
  const emailVerified = overrides.emailVerified ?? true;
  const user = await createAccount(emailVerified, overrides.accountStatus ?? (emailVerified ? 'ACTIVE' : 'UNVERIFIED'));
  if (overrides.profile === false) {
    return user;
  }

  await addProfile(user.id);
  const photo = overrides.photo ?? 'primary';
  if (photo === 'primary' || photo === 'deleted') {
    const created = await addPhoto(user.id, true);
    if (photo === 'deleted') {
      await created.destroy();
    }
  } else if (photo === 'not-primary') {
    await addPhoto(user.id, false);
  }

  await addInterests(user.id, overrides.interestCount ?? 3);

  let preferenceIntentionId: string | undefined;
  if (overrides.ownIntention === false) {
    if (overrides.preferenceIntention) {
      const intention = await addIntentionCatalog();
      preferenceIntentionId = intention.id;
    }
  } else {
    await addOwnIntention(user.id);
  }

  if (overrides.datingPreference !== false) {
    await addDatingPreference(user.id, preferenceIntentionId);
  }

  const location = overrides.location ?? 'full';
  if (location === 'full') {
    await setLocation(user.id, 'Bengaluru', true);
  } else if (location === 'missing-city') {
    await setLocation(user.id, null, true);
  } else if (location === 'blank-city') {
    await setLocation(user.id, '   ', true);
  } else if (location === 'null-point') {
    await setLocation(user.id, 'Bengaluru', false);
  }

  return user;
}

describe('POST /api/v1/onboarding/complete', () => {
  it('rejects an unauthenticated request and a non-USER role', async () => {
    const missing = await request(app).post('/api/v1/onboarding/complete');
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
    const forbidden = await request(app).post('/api/v1/onboarding/complete').set(authHeader(admin.id, 'ADMIN'));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects an unverified user and leaves the completion flag false', async () => {
    const user = await prepareReadyUser({ emailVerified: false, accountStatus: 'UNVERIFIED' });
    const before = await readStoredProfile(user.id);

    const response = await complete(user.id);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('PROFILE_INCOMPLETE');
    expect(detailFields(response.body)).toEqual(['VERIFICATION']);
    const after = await readStoredProfile(user.id);
    expect(after.is_profile_complete).toBe(false);
    expect(after.updated_at).toEqual(before.updated_at);
    expect(await User.findByPk(user.id)).toMatchObject({ status: 'UNVERIFIED' });
  });

  it('rejects a verified user with no profile and does not create one', async () => {
    const user = await prepareReadyUser({ profile: false });

    const response = await complete(user.id);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('PROFILE_INCOMPLETE');
    expect(detailFields(response.body)).toEqual([
      'BASIC_PROFILE',
      'PHOTOS',
      'INTERESTS',
      'RELATIONSHIP_INTENTIONS',
      'DATING_PREFERENCES',
      'LOCATION'
    ]);
    expect(await Profile.count({ where: { userId: user.id } })).toBe(0);
    expect(await findProfileCompletion(user.id)).toBe(false);
  });

  it('rejects a profile with no active photos', async () => {
    const user = await prepareReadyUser({ photo: 'none' });
    const response = await complete(user.id);
    expect(response.status).toBe(400);
    expect(detailFields(response.body)).toEqual(['PHOTOS']);
    expect(await findProfileCompletion(user.id)).toBe(false);
  });

  it('rejects active photos that have no primary', async () => {
    const user = await prepareReadyUser({ photo: 'not-primary' });
    const response = await complete(user.id);
    expect(response.status).toBe(400);
    expect(detailFields(response.body)).toEqual(['PHOTOS']);
  });

  it('does not count a soft-deleted photo', async () => {
    const user = await prepareReadyUser({ photo: 'deleted' });
    const response = await complete(user.id);
    expect(response.status).toBe(400);
    expect(detailFields(response.body)).toEqual(['PHOTOS']);
    expect(await ProfilePhoto.count({ where: { userId: user.id } })).toBe(0);
    expect(await findProfileCompletion(user.id)).toBe(false);
  });

  it('rejects fewer than 3 own interests', async () => {
    const user = await prepareReadyUser({ interestCount: 2 });
    const response = await complete(user.id);
    expect(response.status).toBe(400);
    expect(detailFields(response.body)).toEqual(['INTERESTS']);
  });

  it('accepts 3 own interests when that is the only remaining gap elsewhere', async () => {
    const user = await prepareReadyUser({ interestCount: 3, location: 'absent' });
    const response = await complete(user.id);
    expect(response.status).toBe(400);
    expect(detailFields(response.body)).toEqual(['LOCATION']);
    expect(detailFields(response.body)).not.toContain('INTERESTS');
  });

  it('rejects more than 10 linked interests', async () => {
    const user = await prepareReadyUser({ interestCount: 11 });
    const response = await complete(user.id);
    expect(response.status).toBe(400);
    expect(detailFields(response.body)).toEqual(['INTERESTS']);
    expect(await findProfileCompletion(user.id)).toBe(false);
  });

  it('rejects a user with no own relationship intention', async () => {
    const user = await prepareReadyUser({ ownIntention: false });
    const response = await complete(user.id);
    expect(response.status).toBe(400);
    expect(detailFields(response.body)).toEqual(['RELATIONSHIP_INTENTIONS']);
  });

  it('does not treat another user relationship intention as the caller intention', async () => {
    const user = await prepareReadyUser({ ownIntention: false });
    const other = await prepareReadyUser();

    const response = await complete(user.id);

    expect(response.status).toBe(400);
    expect(detailFields(response.body)).toEqual(['RELATIONSHIP_INTENTIONS']);
    expect(await findProfileCompletion(user.id)).toBe(false);
    expect(await findProfileCompletion(other.id)).toBe(false);
    expect(await UserRelationshipIntention.count({ where: { userId: other.id } })).toBe(1);
    expect(await UserRelationshipIntention.count({ where: { userId: user.id } })).toBe(0);
  });

  it('does not treat a dating-preference intention as an own intention', async () => {
    const user = await prepareReadyUser({ ownIntention: false, preferenceIntention: true });
    const response = await complete(user.id);
    expect(response.status).toBe(400);
    expect(detailFields(response.body)).toEqual(['RELATIONSHIP_INTENTIONS']);
    expect(detailFields(response.body)).not.toContain('DATING_PREFERENCES');
    expect(await UserDatingPreferenceIntention.count({ where: { userId: user.id } })).toBe(1);
    expect(await UserRelationshipIntention.count({ where: { userId: user.id } })).toBe(0);
  });

  it('rejects a user with no dating preferences row', async () => {
    const user = await prepareReadyUser({ datingPreference: false });
    const response = await complete(user.id);
    expect(response.status).toBe(400);
    expect(detailFields(response.body)).toEqual(['DATING_PREFERENCES']);
  });

  it('rejects a missing city, a blank city, and a null location', async () => {
    const missingCity = await prepareReadyUser({ location: 'missing-city' });
    const missingCityResponse = await complete(missingCity.id);
    expect(missingCityResponse.status).toBe(400);
    expect(detailFields(missingCityResponse.body)).toEqual(['LOCATION']);

    const blankCity = await prepareReadyUser({ location: 'blank-city' });
    const blankCityResponse = await complete(blankCity.id);
    expect(blankCityResponse.status).toBe(400);
    expect(detailFields(blankCityResponse.body)).toEqual(['LOCATION']);
    expect((await readStoredProfile(blankCity.id)).city).toBe('   ');

    const nullPoint = await prepareReadyUser({ location: 'null-point' });
    const nullPointResponse = await complete(nullPoint.id);
    expect(nullPointResponse.status).toBe(400);
    expect(detailFields(nullPointResponse.body)).toEqual(['LOCATION']);
    expect((await readStoredProfile(nullPoint.id)).location_is_null).toBe(true);
    expect(await findProfileCompletion(nullPoint.id)).toBe(false);
  });

  it('does not write when a prerequisite is missing', async () => {
    const user = await prepareReadyUser({ photo: 'none' });
    const before = await readStoredProfile(user.id);
    expect(before.is_profile_complete).toBe(false);

    const response = await complete(user.id);

    expect(response.status).toBe(400);
    const after = await readStoredProfile(user.id);
    expect(after).toEqual(before);
    expect((await User.findByPk(user.id))?.status).toBe('ACTIVE');
  });

  it('completes onboarding when every prerequisite is satisfied, including empty preference junctions', async () => {
    const user = await prepareReadyUser();
    const before = await readStoredProfile(user.id);
    expect(before.is_profile_complete).toBe(false);
    expect(await UserDatingPreferenceIntention.count({ where: { userId: user.id } })).toBe(0);

    const response = await complete(user.id);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(SUCCESS_BODY);
    expect(Object.keys(response.body.data).sort()).toEqual(['isProfileComplete', 'status']);
    expect(JSON.stringify(response.body)).not.toContain('77.5946');
    expect(JSON.stringify(response.body)).not.toContain('12.9716');
    expect(response.body.data).not.toHaveProperty('location');
    expect(response.body.data).not.toHaveProperty('latitude');
    expect(response.body.data).not.toHaveProperty('longitude');
    expect(response.body.data).not.toHaveProperty('completedSteps');
    expect(response.body.data).not.toHaveProperty('nextStep');

    const after = await readStoredProfile(user.id);
    expect(after.is_profile_complete).toBe(true);
    expect(after.first_name).toBe(before.first_name);
    expect(after.date_of_birth).toBe(before.date_of_birth);
    expect(after.gender_id).toBe(before.gender_id);
    expect(after.bio).toBe(before.bio);
    expect(after.occupation).toBe(before.occupation);
    expect(after.education).toBe(before.education);
    expect(after.city).toBe(before.city);
    expect(after.location_is_null).toBe(false);
    expect((await User.findByPk(user.id))?.status).toBe('ACTIVE');
  });

  it('returns the same success response when completion is repeated', async () => {
    const user = await prepareReadyUser();
    const first = await complete(user.id);
    expect(first.status).toBe(200);
    expect(first.body).toEqual(SUCCESS_BODY);
    const afterFirst = await readStoredProfile(user.id);
    expect(afterFirst.is_profile_complete).toBe(true);

    const second = await complete(user.id);

    expect(second.status).toBe(200);
    expect(second.body).toEqual(SUCCESS_BODY);
    expect(second.status).not.toBe(409);
    const afterSecond = await readStoredProfile(user.id);
    expect(afterSecond.is_profile_complete).toBe(true);
    expect(afterSecond.updated_at).toEqual(afterFirst.updated_at);
    expect(afterSecond.first_name).toBe(afterFirst.first_name);
    expect(afterSecond.city).toBe(afterFirst.city);
  });
});
