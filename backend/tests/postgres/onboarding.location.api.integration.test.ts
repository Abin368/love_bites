import { randomUUID } from 'crypto';
import request from 'supertest';
import { literal } from 'sequelize';
import { app } from '../../src/app';
import { sequelize } from '../../src/config/database';
import { Gender } from '../../src/database/models/gender.model';
import { Profile } from '../../src/database/models/profile.model';
import { User } from '../../src/database/models/user.model';
import { createUser, findProfileCompletion } from '../../src/modules/users/users.data-access';
import { signAccessToken } from '../../src/utils/jwt';

const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';
const BENGALURU_LATITUDE = 12.9716;
const BENGALURU_LONGITUDE = 77.5946;
const KOCHI_LATITUDE = 9.9312;
const KOCHI_LONGITUDE = 76.2673;

function userInput() {
  return {
    email: `location-${randomUUID()}@example.com`,
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

function authHeader(userId: string, role: 'USER' | 'ADMIN' = 'USER') {
  return { Authorization: `Bearer ${tokenFor(userId, role)}` };
}

function locationBody(overrides: Record<string, unknown> = {}) {
  return {
    city: 'Bengaluru',
    latitude: BENGALURU_LATITUDE,
    longitude: BENGALURU_LONGITUDE,
    ...overrides
  };
}

async function createGender() {
  return Gender.create({
    code: `g-${randomUUID()}`,
    name: 'Man',
    isActive: true
  });
}

async function createProfile(userId: string, genderId: string, isProfileComplete = false) {
  return Profile.create({
    userId,
    firstName: 'John',
    dateOfBirth: '1998-05-10',
    genderId,
    isProfileComplete
  });
}

interface StoredLocation {
  city: string | null;
  location_is_null: boolean;
  is_profile_complete: boolean;
  longitude: string | null;
  latitude: string | null;
}

async function readStoredLocation(userId: string): Promise<StoredLocation> {
  const [rows] = await sequelize.query(
    `SELECT city,
            location IS NULL AS location_is_null,
            is_profile_complete,
            ST_X(location::geometry) AS longitude,
            ST_Y(location::geometry) AS latitude
     FROM profiles
     WHERE user_id = :userId`,
    { replacements: { userId } }
  );
  return (rows as StoredLocation[])[0];
}

describe('PUT /api/v1/onboarding/location', () => {
  it('rejects an unauthenticated request and a non-USER role', async () => {
    const missing = await request(app).put('/api/v1/onboarding/location').send(locationBody());
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
    const forbidden = await request(app)
      .put('/api/v1/onboarding/location')
      .set(authHeader(admin.id, 'ADMIN'))
      .send(locationBody());
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
  });

  it('returns profile not found and does not create a profile', async () => {
    const user = await createUser(userInput());

    const response = await request(app)
      .put('/api/v1/onboarding/location')
      .set(authHeader(user.id))
      .send(locationBody());

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('PROFILE_NOT_FOUND');
    expect(await Profile.count({ where: { userId: user.id } })).toBe(0);
    expect(await findProfileCompletion(user.id)).toBe(false);
  });

  it('stores a geography point, replaces it, and keeps completion unchanged', async () => {
    const user = await createUser(userInput());
    const other = await createUser(userInput());
    const gender = await createGender();
    await createProfile(user.id, gender.id, false);
    await createProfile(other.id, gender.id, true);
    await Profile.update(
      {
        city: 'Kochi',
        location: literal(`ST_GeogFromText('SRID=4326;POINT(${KOCHI_LONGITUDE} ${KOCHI_LATITUDE})')`)
      },
      { where: { userId: other.id } }
    );
    expect(await findProfileCompletion(user.id)).toBe(false);
    expect(await findProfileCompletion(other.id)).toBe(true);

    const saved = await request(app)
      .put('/api/v1/onboarding/location')
      .set(authHeader(user.id))
      .send(locationBody({ city: '  Bengaluru  ' }));

    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({
      success: true,
      data: { city: 'Bengaluru', updated: true },
      message: 'Location updated successfully'
    });
    expect(saved.body.data).not.toHaveProperty('latitude');
    expect(saved.body.data).not.toHaveProperty('longitude');
    expect(saved.body.data).not.toHaveProperty('location');
    expect(JSON.stringify(saved.body)).not.toContain(String(BENGALURU_LATITUDE));
    expect(JSON.stringify(saved.body)).not.toContain(String(BENGALURU_LONGITUDE));

    const stored = await readStoredLocation(user.id);
    expect(stored.city).toBe('Bengaluru');
    expect(stored.location_is_null).toBe(false);
    expect(stored.is_profile_complete).toBe(false);
    expect(Number(stored.longitude)).toBeCloseTo(BENGALURU_LONGITUDE, 4);
    expect(Number(stored.latitude)).toBeCloseTo(BENGALURU_LATITUDE, 4);
    expect(await findProfileCompletion(user.id)).toBe(false);

    const [geographyRows] = await sequelize.query(
      `SELECT type, srid
       FROM geography_columns
       WHERE f_table_schema = 'public'
         AND f_table_name = 'profiles'
         AND f_geography_column = 'location'`
    );
    const geography = (geographyRows as Array<{ type: string; srid: number | string }>)[0];
    expect(geography.type).toBe('Point');
    expect(Number(geography.srid)).toBe(4326);

    const fetched = await request(app).get('/api/v1/profile').set(authHeader(user.id));
    expect(fetched.status).toBe(200);
    expect(fetched.body.data.city).toBe('Bengaluru');
    expect(fetched.body.data.isProfileComplete).toBe(false);
    expect(fetched.body.data).not.toHaveProperty('location');
    expect(fetched.body.data).not.toHaveProperty('latitude');
    expect(fetched.body.data).not.toHaveProperty('longitude');
    expect(JSON.stringify(fetched.body)).not.toContain(String(BENGALURU_LATITUDE));
    expect(JSON.stringify(fetched.body)).not.toContain(String(BENGALURU_LONGITUDE));

    const replaced = await request(app)
      .put('/api/v1/onboarding/location')
      .set(authHeader(user.id))
      .send(locationBody({ city: 'Mumbai', latitude: 19.076, longitude: 72.8777 }));
    expect(replaced.status).toBe(200);
    expect(replaced.body.data).toEqual({ city: 'Mumbai', updated: true });
    const replacedPoint = await readStoredLocation(user.id);
    expect(replacedPoint.city).toBe('Mumbai');
    expect(replacedPoint.is_profile_complete).toBe(false);
    expect(Number(replacedPoint.longitude)).toBeCloseTo(72.8777, 4);
    expect(Number(replacedPoint.latitude)).toBeCloseTo(19.076, 4);
    expect(await Profile.count({ where: { userId: user.id } })).toBe(1);

    const otherPoint = await readStoredLocation(other.id);
    expect(otherPoint.city).toBe('Kochi');
    expect(otherPoint.is_profile_complete).toBe(true);
    expect(Number(otherPoint.longitude)).toBeCloseTo(KOCHI_LONGITUDE, 4);
    expect(Number(otherPoint.latitude)).toBeCloseTo(KOCHI_LATITUDE, 4);
    expect(await findProfileCompletion(other.id)).toBe(true);
  });

  it('leaves an already complete profile complete', async () => {
    const user = await createUser(userInput());
    const gender = await createGender();
    await createProfile(user.id, gender.id, true);
    expect(await findProfileCompletion(user.id)).toBe(true);

    const saved = await request(app)
      .put('/api/v1/onboarding/location')
      .set(authHeader(user.id))
      .send(locationBody());

    expect(saved.status).toBe(200);
    expect(saved.body.data).toEqual({ city: 'Bengaluru', updated: true });
    const stored = await readStoredLocation(user.id);
    expect(stored.city).toBe('Bengaluru');
    expect(stored.is_profile_complete).toBe(true);
    expect(await findProfileCompletion(user.id)).toBe(true);

    const fetched = await request(app).get('/api/v1/profile').set(authHeader(user.id));
    expect(fetched.body.data.city).toBe('Bengaluru');
    expect(fetched.body.data.isProfileComplete).toBe(true);
    expect(fetched.body.data).not.toHaveProperty('location');
  });

  it('rejects invalid coordinates and leaves the stored city and point unchanged', async () => {
    const user = await createUser(userInput());
    const gender = await createGender();
    await createProfile(user.id, gender.id, false);
    await Profile.update(
      {
        city: 'Kochi',
        location: literal(`ST_GeogFromText('SRID=4326;POINT(${KOCHI_LONGITUDE} ${KOCHI_LATITUDE})')`)
      },
      { where: { userId: user.id } }
    );

    const invalid = await request(app)
      .put('/api/v1/onboarding/location')
      .set(authHeader(user.id))
      .send(locationBody({ city: 'Mumbai', latitude: 91, longitude: 181 }));

    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    const stored = await readStoredLocation(user.id);
    expect(stored.city).toBe('Kochi');
    expect(stored.is_profile_complete).toBe(false);
    expect(Number(stored.longitude)).toBeCloseTo(KOCHI_LONGITUDE, 4);
    expect(Number(stored.latitude)).toBeCloseTo(KOCHI_LATITUDE, 4);
    expect(await findProfileCompletion(user.id)).toBe(false);
  });
});
