import { randomUUID } from 'crypto';
import { literal } from 'sequelize';
import { sequelize } from '../../src/config/database';
import { Gender } from '../../src/database/models/gender.model';
import { Profile } from '../../src/database/models/profile.model';
import {
  createProfile,
  findProfileByUserId,
  updateProfile
} from '../../src/modules/profiles/profiles.data-access';
import { createUser, findProfileCompletion } from '../../src/modules/users/users.data-access';

const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';
const KOCHI_LONGITUDE = 76.2673;
const KOCHI_LATITUDE = 9.9312;

function userInput() {
  return {
    email: `profile-${randomUUID()}@example.com`,
    phone: null,
    passwordHash: PASSWORD_HASH,
    role: 'USER' as const,
    status: 'UNVERIFIED' as const,
    emailVerified: false,
    phoneVerified: false
  };
}

async function createGender() {
  return Gender.create({
    code: `g-${randomUUID()}`,
    name: 'Integration'
  });
}

describe('PostgreSQL profile foundation', () => {
  it('stores a partial profile with null city and location and keeps completion false', async () => {
    const user = await createUser(userInput());
    const gender = await createGender();

    const created = await createProfile({
      userId: user.id,
      firstName: 'Ada',
      dateOfBirth: '2000-01-15',
      genderId: gender.id,
      bio: 'Hello',
      occupation: 'Engineer',
      education: 'B.Tech'
    });

    expect(created.city).toBeNull();
    expect(created.location).toBeNull();
    expect(created.isProfileComplete).toBe(false);
    expect(await findProfileCompletion(user.id)).toBe(false);

    const [rows] = await sequelize.query(
      `SELECT first_name, date_of_birth::text AS date_of_birth, gender_id, bio, occupation, education,
              city, location IS NULL AS location_is_null, is_profile_complete
       FROM profiles
       WHERE user_id = :userId`,
      { replacements: { userId: user.id } }
    );
    const row = (rows as Array<Record<string, unknown>>)[0];
    expect(row.first_name).toBe('Ada');
    expect(row.date_of_birth).toBe('2000-01-15');
    expect(row.gender_id).toBe(gender.id);
    expect(row.bio).toBe('Hello');
    expect(row.occupation).toBe('Engineer');
    expect(row.education).toBe('B.Tech');
    expect(row.city).toBeNull();
    expect(row.location_is_null).toBe(true);
    expect(row.is_profile_complete).toBe(false);

    const found = await findProfileByUserId(user.id);
    const loadedGender = found?.get('gender') as Gender | undefined;
    expect(found?.id).toBe(created.id);
    expect(loadedGender?.id).toBe(gender.id);
    expect(loadedGender?.code).toBe(gender.code);
    expect(loadedGender?.name).toBe('Integration');
    expect(found?.get('user')).toBeUndefined();

    await updateProfile(user.id, {
      firstName: 'Grace',
      dateOfBirth: '1999-02-02',
      bio: 'Updated',
      occupation: null,
      education: 'M.Sc'
    });

    const updated = await findProfileByUserId(user.id);
    expect(updated?.firstName).toBe('Grace');
    expect(updated?.dateOfBirth).toBe('1999-02-02');
    expect(updated?.bio).toBe('Updated');
    expect(updated?.occupation).toBeNull();
    expect(updated?.education).toBe('M.Sc');
    expect(updated?.city).toBeNull();
    expect(updated?.location).toBeNull();
    expect(updated?.isProfileComplete).toBe(false);
    expect(await findProfileCompletion(user.id)).toBe(false);
  });

  it('stores city and a geography point on the same profile later', async () => {
    const user = await createUser(userInput());
    const gender = await createGender();
    await createProfile({
      userId: user.id,
      firstName: 'Ada',
      dateOfBirth: '2000-01-15',
      genderId: gender.id
    });

    await Profile.update(
      {
        city: 'Kochi',
        location: literal(`ST_GeogFromText('SRID=4326;POINT(${KOCHI_LONGITUDE} ${KOCHI_LATITUDE})')`)
      },
      { where: { userId: user.id } }
    );

    const [pointRows] = await sequelize.query(
      `SELECT city,
              ST_X(location::geometry) AS longitude,
              ST_Y(location::geometry) AS latitude
       FROM profiles
       WHERE user_id = :userId`,
      { replacements: { userId: user.id } }
    );
    const point = (pointRows as Array<{ city: string; longitude: string; latitude: string }>)[0];
    expect(point.city).toBe('Kochi');
    expect(Number(point.longitude)).toBeCloseTo(KOCHI_LONGITUDE, 4);
    expect(Number(point.latitude)).toBeCloseTo(KOCHI_LATITUDE, 4);

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

    const [indexRows] = await sequelize.query(
      `SELECT indexdef
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname = 'idx_profiles_location_gist'`
    );
    const indexdef = (indexRows as Array<{ indexdef: string }>)[0]?.indexdef ?? '';
    expect(indexdef.toLowerCase()).toContain('using gist');
    expect(indexdef).toContain('location');
  });

  it('still rejects an underage date of birth with chk_profiles_age_18_plus', async () => {
    const user = await createUser(userInput());
    const gender = await createGender();

    await expect(
      createProfile({
        userId: user.id,
        firstName: 'Young',
        dateOfBirth: '2015-01-01',
        genderId: gender.id
      })
    ).rejects.toMatchObject({
      name: 'SequelizeDatabaseError',
      parent: expect.objectContaining({
        code: '23514',
        constraint: 'chk_profiles_age_18_plus'
      })
    });

    expect(await findProfileByUserId(user.id)).toBeNull();
    expect(await findProfileCompletion(user.id)).toBe(false);
  });
});
