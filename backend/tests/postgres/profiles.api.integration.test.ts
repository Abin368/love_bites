import { randomUUID } from 'crypto';
import request from 'supertest';
import { literal } from 'sequelize';
import { app } from '../../src/app';
import { sequelize } from '../../src/config/database';
import { Gender } from '../../src/database/models/gender.model';
import { Profile } from '../../src/database/models/profile.model';
import { User } from '../../src/database/models/user.model';
import { findProfileByUserId } from '../../src/modules/profiles/profiles.data-access';
import { createUser, findProfileCompletion } from '../../src/modules/users/users.data-access';
import { signAccessToken } from '../../src/utils/jwt';

const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';

function userInput() {
  return {
    email: `profile-api-${randomUUID()}@example.com`,
    phone: null,
    passwordHash: PASSWORD_HASH,
    role: 'USER' as const,
    status: 'UNVERIFIED' as const,
    emailVerified: false,
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

async function createGender(isActive = true) {
  return Gender.create({
    code: `g-${randomUUID()}`,
    name: isActive ? 'Man' : 'Inactive',
    isActive
  });
}

function profileBody(genderId: string, overrides: Record<string, unknown> = {}) {
  return {
    firstName: 'John',
    dateOfBirth: '1998-05-10',
    genderId,
    bio: 'Coffee and long walks.',
    occupation: 'Engineer',
    education: 'B.Tech',
    ...overrides
  };
}

describe('PostgreSQL profile API', () => {
  it('rejects unauthenticated profile requests', async () => {
    const missing = await request(app).get('/api/v1/profile');
    const create = await request(app).post('/api/v1/profile').send({});
    const update = await request(app).patch('/api/v1/profile').send({ firstName: 'Ada' });

    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('AUTH_REQUIRED');
    expect(create.status).toBe(401);
    expect(update.status).toBe(401);
  });

  it('rejects a non-USER role', async () => {
    const admin = await User.create({
      email: `admin-${randomUUID()}@example.com`,
      passwordHash: PASSWORD_HASH,
      role: 'ADMIN',
      status: 'ACTIVE',
      emailVerified: true,
      phoneVerified: false
    });

    const response = await request(app)
      .get('/api/v1/profile')
      .set('Authorization', `Bearer ${tokenFor(admin.id, 'ADMIN')}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('returns profile not found and does not create a row', async () => {
    const user = await createUser(userInput());
    const response = await request(app)
      .get('/api/v1/profile')
      .set('Authorization', `Bearer ${tokenFor(user.id)}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('PROFILE_NOT_FOUND');
    expect(await Profile.count({ where: { userId: user.id } })).toBe(0);
    expect(await findProfileCompletion(user.id)).toBe(false);
  });

  it('creates, reads, and partially updates only the authenticated user profile', async () => {
    const user = await createUser(userInput());
    const other = await createUser(userInput());
    const gender = await createGender();
    const token = tokenFor(user.id);

    const created = await request(app)
      .post('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send(profileBody(gender.id, { firstName: '  John  ' }));

    expect(created.status).toBe(201);
    expect(created.body.message).toBe('Profile created successfully');
    expect(Object.keys(created.body.data).sort()).toEqual(
      ['bio', 'city', 'dateOfBirth', 'education', 'firstName', 'gender', 'id', 'isProfileComplete', 'occupation', 'userId'].sort()
    );
    expect(created.body.data).toMatchObject({
      userId: user.id,
      firstName: 'John',
      dateOfBirth: '1998-05-10',
      gender: { id: gender.id, code: gender.code, name: 'Man' },
      bio: 'Coffee and long walks.',
      occupation: 'Engineer',
      education: 'B.Tech',
      city: null,
      isProfileComplete: false
    });
    expect(created.body.data).not.toHaveProperty('passwordHash');
    expect(created.body.data).not.toHaveProperty('location');
    expect(JSON.stringify(created.body)).not.toContain('passwordHash');

    const [rows] = await sequelize.query(
      `SELECT city, location IS NULL AS location_is_null, is_profile_complete
       FROM profiles WHERE user_id = :userId`,
      { replacements: { userId: user.id } }
    );
    const row = (rows as Array<{ city: string | null; location_is_null: boolean; is_profile_complete: boolean }>)[0];
    expect(row.city).toBeNull();
    expect(row.location_is_null).toBe(true);
    expect(row.is_profile_complete).toBe(false);
    expect(await findProfileCompletion(user.id)).toBe(false);
    expect(await findProfileByUserId(other.id)).toBeNull();

    const fetched = await request(app).get('/api/v1/profile').set('Authorization', `Bearer ${token}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.message).toBe('Profile retrieved successfully');
    expect(fetched.body.data.id).toBe(created.body.data.id);
    expect(fetched.body.data.userId).toBe(user.id);

    const otherView = await request(app)
      .get('/api/v1/profile')
      .set('Authorization', `Bearer ${tokenFor(other.id)}`);
    expect(otherView.status).toBe(404);
    expect(otherView.body.error.code).toBe('PROFILE_NOT_FOUND');

    const updated = await request(app)
      .patch('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ bio: 'Updated bio' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.bio).toBe('Updated bio');
    expect(updated.body.data.firstName).toBe('John');
    expect(updated.body.data.dateOfBirth).toBe('1998-05-10');
    expect(updated.body.data.isProfileComplete).toBe(false);
    expect(updated.body.data.city).toBeNull();
  });

  it('rejects invalid profile writes', async () => {
    const user = await createUser(userInput());
    const other = await createUser(userInput());
    const gender = await createGender();
    const inactive = await createGender(false);
    const token = tokenFor(user.id);
    const auth = { Authorization: `Bearer ${token}` };

    const missingFields = await request(app).post('/api/v1/profile').set(auth).send({ firstName: 'John' });
    expect(missingFields.status).toBe(400);
    expect(missingFields.body.error.code).toBe('VALIDATION_ERROR');

    const underage = await request(app)
      .post('/api/v1/profile')
      .set(auth)
      .send(profileBody(gender.id, { dateOfBirth: '2015-01-01' }));
    expect(underage.status).toBe(422);
    expect(underage.body.error.code).toBe('UNDERAGE_NOT_PERMITTED');

    const missingGender = await request(app)
      .post('/api/v1/profile')
      .set(auth)
      .send(profileBody(randomUUID()));
    expect(missingGender.status).toBe(400);
    expect(missingGender.body.error.code).toBe('INVALID_GENDER');

    const inactiveGender = await request(app)
      .post('/api/v1/profile')
      .set(auth)
      .send(profileBody(inactive.id));
    expect(inactiveGender.status).toBe(400);
    expect(inactiveGender.body.error.code).toBe('INVALID_GENDER');

    const ownedByBody = await request(app)
      .post('/api/v1/profile')
      .set(auth)
      .send(profileBody(gender.id, { userId: other.id }));
    expect(ownedByBody.status).toBe(400);
    expect(ownedByBody.body.error.code).toBe('VALIDATION_ERROR');

    const withInterests = await request(app)
      .post('/api/v1/profile')
      .set(auth)
      .send(profileBody(gender.id, { interests: [gender.id] }));
    expect(withInterests.status).toBe(400);
    expect(withInterests.body.error.code).toBe('VALIDATION_ERROR');

    const withIntentions = await request(app)
      .post('/api/v1/profile')
      .set(auth)
      .send(profileBody(gender.id, { relationshipIntentions: [gender.id] }));
    expect(withIntentions.status).toBe(400);
    expect(withIntentions.body.error.code).toBe('VALIDATION_ERROR');

    const clientCompletion = await request(app)
      .post('/api/v1/profile')
      .set(auth)
      .send(profileBody(gender.id, { isProfileComplete: true }));
    expect(clientCompletion.status).toBe(400);
    expect(clientCompletion.body.error.code).toBe('VALIDATION_ERROR');
    expect(await findProfileByUserId(user.id)).toBeNull();
    expect(await findProfileByUserId(other.id)).toBeNull();

    const created = await request(app).post('/api/v1/profile').set(auth).send(profileBody(gender.id));
    expect(created.status).toBe(201);

    const duplicate = await request(app).post('/api/v1/profile').set(auth).send(profileBody(gender.id));
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('PROFILE_ALREADY_EXISTS');

    const emptyPatch = await request(app).patch('/api/v1/profile').set(auth).send({});
    expect(emptyPatch.status).toBe(400);
    expect(emptyPatch.body.error.code).toBe('VALIDATION_ERROR');

    const patchUnderage = await request(app)
      .patch('/api/v1/profile')
      .set(auth)
      .send({ dateOfBirth: '2015-01-01' });
    expect(patchUnderage.status).toBe(422);
    expect(patchUnderage.body.error.code).toBe('UNDERAGE_NOT_PERMITTED');

    const patchInactive = await request(app)
      .patch('/api/v1/profile')
      .set(auth)
      .send({ genderId: inactive.id });
    expect(patchInactive.status).toBe(400);
    expect(patchInactive.body.error.code).toBe('INVALID_GENDER');

    const patchMissingGender = await request(app)
      .patch('/api/v1/profile')
      .set(auth)
      .send({ genderId: randomUUID() });
    expect(patchMissingGender.status).toBe(400);
    expect(patchMissingGender.body.error.code).toBe('INVALID_GENDER');

    const patchOwner = await request(app)
      .patch('/api/v1/profile')
      .set(auth)
      .send({ userId: other.id, firstName: 'Hacked' });
    expect(patchOwner.status).toBe(400);

    const patchInterests = await request(app)
      .patch('/api/v1/profile')
      .set(auth)
      .send({ interests: [gender.id] });
    expect(patchInterests.status).toBe(400);
    expect(patchInterests.body.error.code).toBe('VALIDATION_ERROR');

    const patchIntentions = await request(app)
      .patch('/api/v1/profile')
      .set(auth)
      .send({ relationshipIntentions: [gender.id], bio: 'Should not save' });
    expect(patchIntentions.status).toBe(400);
    expect(patchIntentions.body.error.code).toBe('VALIDATION_ERROR');

    const patchCompletion = await request(app)
      .patch('/api/v1/profile')
      .set(auth)
      .send({ isProfileComplete: true, city: 'Kochi' });
    expect(patchCompletion.status).toBe(400);

    const stored = await findProfileByUserId(user.id);
    expect(stored?.firstName).toBe('John');
    expect(stored?.dateOfBirth).toBe('1998-05-10');
    expect(stored?.genderId).toBe(gender.id);
    expect(stored?.city).toBeNull();
    expect(stored?.isProfileComplete).toBe(false);
    expect(await findProfileByUserId(other.id)).toBeNull();

    const noProfileUser = await createUser(userInput());
    const missingProfile = await request(app)
      .patch('/api/v1/profile')
      .set('Authorization', `Bearer ${tokenFor(noProfileUser.id)}`)
      .send({ bio: 'Nope' });
    expect(missingProfile.status).toBe(404);
    expect(missingProfile.body.error.code).toBe('PROFILE_NOT_FOUND');
  });

  it('does not mark a basic profile complete and does not clear an existing completion flag', async () => {
    const user = await createUser(userInput());
    const gender = await createGender();
    const token = tokenFor(user.id);

    const created = await request(app)
      .post('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send(profileBody(gender.id));
    expect(created.body.data.isProfileComplete).toBe(false);
    expect(await findProfileCompletion(user.id)).toBe(false);

    await Profile.update(
      {
        city: 'Kochi',
        location: literal("ST_GeogFromText('SRID=4326;POINT(76.2673 9.9312)')"),
        isProfileComplete: true
      },
      { where: { userId: user.id } }
    );
    expect(await findProfileCompletion(user.id)).toBe(true);

    const updated = await request(app)
      .patch('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ occupation: 'Designer' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.occupation).toBe('Designer');
    expect(updated.body.data.city).toBe('Kochi');
    expect(updated.body.data).not.toHaveProperty('location');
    expect(updated.body.data.isProfileComplete).toBe(true);
    expect(await findProfileCompletion(user.id)).toBe(true);
  });
});
