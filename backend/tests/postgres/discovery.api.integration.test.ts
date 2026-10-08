import { randomUUID } from 'crypto';
import request from 'supertest';
import { literal, QueryTypes } from 'sequelize';
import { sequelize } from '../../src/config/database';
import { Block } from '../../src/database/models/block.model';
import { BoostSession } from '../../src/database/models/boost-session.model';
import { DatingPreference } from '../../src/database/models/dating-preference.model';
import { Gender } from '../../src/database/models/gender.model';
import { Interest } from '../../src/database/models/interest.model';
import { Like } from '../../src/database/models/like.model';
import { Profile } from '../../src/database/models/profile.model';
import { ProfilePhoto } from '../../src/database/models/profile-photo.model';
import { RelationshipIntention } from '../../src/database/models/relationship-intention.model';
import { User, UserStatus } from '../../src/database/models/user.model';
import { UserDatingPreferenceGender } from '../../src/database/models/user-dating-preference-gender.model';
import { UserDatingPreferenceIntention } from '../../src/database/models/user-dating-preference-intention.model';
import { UserInterest } from '../../src/database/models/user-interest.model';
import { UserRelationshipIntention } from '../../src/database/models/user-relationship-intention.model';
import { signAccessToken } from '../../src/utils/jwt';

const mockPhotoStorage = {
  createUploadUrl: jest.fn(),
  createDownloadUrl: jest.fn(async () => ({
    url: 'https://download.test/signed',
    expiresInSeconds: 3600
  }))
};

jest.mock('../../src/integrations/storage/s3.provider', () => ({
  photoStorage: mockPhotoStorage
}));

import { app } from '../../src/app';

const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';
const ORIGIN = { latitude: 12.9716, longitude: 77.5946 };

interface Point {
  latitude: number;
  longitude: number;
}

interface Catalog {
  man: Gender;
  woman: Gender;
  longTerm: RelationshipIntention;
  casual: RelationshipIntention;
  hiking: Interest;
}

interface BuiltUser {
  user: User;
  storageKey: string | null;
}

function north(kilometres: number): Point {
  return {
    latitude: ORIGIN.latitude + kilometres / 111.32,
    longitude: ORIGIN.longitude
  };
}

function timestamps(): { createdAt: Date; updatedAt: Date } {
  const now = new Date();
  return { createdAt: now, updatedAt: now };
}

function tokenFor(userId: string, role: 'USER' | 'ADMIN' = 'USER'): string {
  return signAccessToken({
    sub: userId,
    role,
    isVerified: true,
    isProfileComplete: true
  });
}

function authHeader(userId: string, role: 'USER' | 'ADMIN' = 'USER') {
  return { Authorization: `Bearer ${tokenFor(userId, role)}` };
}

async function catalogs(): Promise<Catalog> {
  const suffix = randomUUID();
  const [man, woman, longTerm, casual, hiking] = await Promise.all([
    Gender.create({ code: `man-${suffix}`, name: 'Man', isActive: true }),
    Gender.create({ code: `woman-${suffix}`, name: 'Woman', isActive: true }),
    RelationshipIntention.create({
      code: `lt-${suffix}`,
      name: 'Long-term relationship',
      isActive: true,
      displayOrder: 1,
      ...timestamps()
    }),
    RelationshipIntention.create({
      code: `cas-${suffix}`,
      name: 'Something casual',
      isActive: true,
      displayOrder: 2,
      ...timestamps()
    }),
    Interest.create({
      code: `hik-${suffix}`,
      name: 'Hiking',
      category: 'Outdoors',
      isActive: true,
      displayOrder: 1,
      ...timestamps()
    })
  ]);
  return { man, woman, longTerm, casual, hiking };
}

async function setLocation(userId: string, point: Point, city = 'Bengaluru'): Promise<void> {
  await Profile.update(
    {
      city,
      location: literal(`ST_GeogFromText('SRID=4326;POINT(${point.longitude} ${point.latitude})')`)
    },
    { where: { userId } }
  );
}

async function setCreatedAt(userId: string, createdAt: string): Promise<void> {
  await sequelize.query(`UPDATE profiles SET created_at = :createdAt WHERE user_id = :userId`, {
    replacements: { userId, createdAt }
  });
}

async function ageOf(userId: string): Promise<number> {
  const rows = await sequelize.query<{ age: number | string }>(
    `SELECT CAST(EXTRACT(YEAR FROM AGE(date_of_birth)) AS int) AS age
     FROM profiles
     WHERE user_id = CAST(:userId AS uuid)`,
    { replacements: { userId }, type: QueryTypes.SELECT }
  );
  return Number(rows[0].age);
}

async function distanceKm(leftUserId: string, rightUserId: string): Promise<number> {
  const rows = await sequelize.query<{ km: string | number }>(
    `SELECT ROUND(CAST(ST_Distance(a.location, b.location) / 1000.0 AS numeric), 1) AS km
     FROM profiles a
     INNER JOIN profiles b ON b.user_id = CAST(:rightUserId AS uuid)
     WHERE a.user_id = CAST(:leftUserId AS uuid)`,
    { replacements: { leftUserId, rightUserId }, type: QueryTypes.SELECT }
  );
  return Number(rows[0].km);
}

async function insertMatch(
  leftUserId: string,
  rightUserId: string,
  status: 'ACTIVE' | 'UNMATCHED' | 'UNDONE'
): Promise<void> {
  await sequelize.query(
    `INSERT INTO matches (
       id, user_one_id, user_two_id, status, matched_at, created_at, updated_at
     )
     VALUES (
       gen_random_uuid(),
       LEAST(CAST(:leftUserId AS uuid), CAST(:rightUserId AS uuid)),
       GREATEST(CAST(:leftUserId AS uuid), CAST(:rightUserId AS uuid)),
       :status,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
     )`,
    { replacements: { leftUserId, rightUserId, status } }
  );
}

async function buildUser(input: {
  genderId: string;
  preferredGenderIds?: string[];
  ownIntentionIds?: string[];
  preferredIntentionIds?: string[];
  interestId?: string | null;
  point?: Point | null;
  dateOfBirth?: string;
  firstName?: string;
  minAge?: number;
  maxAge?: number;
  maxDistanceKm?: number;
  complete?: boolean;
  primaryPhoto?: boolean;
  status?: UserStatus;
  emailVerified?: boolean;
  phoneOnly?: boolean;
  bio?: string | null;
  occupation?: string | null;
  education?: string | null;
  preferences?: boolean;
}): Promise<BuiltUser> {
  const emailVerified = input.emailVerified ?? true;
  const user = await User.create({
    email: input.phoneOnly ? null : `discovery-${randomUUID()}@example.com`,
    phone: input.phoneOnly ? `+${randomUUID().replace(/-/g, '').slice(0, 15)}` : null,
    passwordHash: PASSWORD_HASH,
    role: 'USER',
    status: input.status ?? 'ACTIVE',
    emailVerified: input.phoneOnly ? false : emailVerified,
    phoneVerified: input.phoneOnly ? emailVerified : false
  });
  await Profile.create({
    userId: user.id,
    firstName: input.firstName ?? 'Jordan',
    dateOfBirth: input.dateOfBirth ?? '1990-06-15',
    genderId: input.genderId,
    bio: input.bio === undefined ? 'Coffee and long walks.' : input.bio,
    occupation: input.occupation === undefined ? 'Designer' : input.occupation,
    education: input.education === undefined ? 'NID' : input.education,
    isProfileComplete: input.complete ?? true
  });

  const point = input.point === undefined ? ORIGIN : input.point;
  if (point) {
    await setLocation(user.id, point);
  }

  if (input.preferences !== false) {
    await DatingPreference.create({
      userId: user.id,
      minAge: input.minAge ?? 18,
      maxAge: input.maxAge ?? 100,
      maxDistanceKm: input.maxDistanceKm ?? 50,
      ...timestamps()
    });
  }

  const preferredGenderIds = input.preferredGenderIds ?? [];
  if (preferredGenderIds.length > 0) {
    await UserDatingPreferenceGender.bulkCreate(
      preferredGenderIds.map((genderId) => ({ userId: user.id, genderId, createdAt: new Date() }))
    );
  }

  const preferredIntentionIds = input.preferredIntentionIds ?? [];
  if (preferredIntentionIds.length > 0) {
    await UserDatingPreferenceIntention.bulkCreate(
      preferredIntentionIds.map((relationshipIntentionId) => ({
        userId: user.id,
        relationshipIntentionId,
        createdAt: new Date()
      }))
    );
  }

  const ownIntentionIds = input.ownIntentionIds ?? [];
  if (ownIntentionIds.length > 0) {
    await UserRelationshipIntention.bulkCreate(
      ownIntentionIds.map((relationshipIntentionId) => ({
        userId: user.id,
        relationshipIntentionId,
        createdAt: new Date()
      }))
    );
  }

  if (input.interestId) {
    await UserInterest.create({ userId: user.id, interestId: input.interestId, createdAt: new Date() });
  }

  let storageKey: string | null = null;
  if (input.primaryPhoto !== false) {
    storageKey = `photos/${user.id}/${randomUUID()}.webp`;
    await ProfilePhoto.create({
      userId: user.id,
      storageKey,
      mimeType: 'image/jpeg',
      fileSizeBytes: 2048,
      displayOrder: 1,
      isPrimary: true,
      ...timestamps()
    });
  }

  return { user, storageKey };
}

async function eligiblePair(options?: {
  candidatePoint?: Point | null;
  viewerPoint?: Point | null;
  viewerMaxDistanceKm?: number;
  candidateMaxDistanceKm?: number;
  viewerMinAge?: number;
  viewerMaxAge?: number;
  candidateMinAge?: number;
  candidateMaxAge?: number;
  viewerDateOfBirth?: string;
  candidateDateOfBirth?: string;
  viewerPreferredGenderIds?: string[];
  candidatePreferredGenderIds?: string[];
  viewerPreferredIntentionIds?: string[];
  candidatePreferredIntentionIds?: string[];
  viewerOwnIntentionIds?: string[];
  candidateOwnIntentionIds?: string[];
  candidateComplete?: boolean;
  candidatePrimaryPhoto?: boolean;
  candidateStatus?: UserStatus;
  candidatePreferences?: boolean;
}) {
  const catalog = await catalogs();
  const viewer = await buildUser({
    genderId: catalog.man.id,
    preferredGenderIds: options?.viewerPreferredGenderIds ?? [catalog.woman.id],
    ownIntentionIds: options?.viewerOwnIntentionIds ?? [catalog.longTerm.id],
    preferredIntentionIds: options?.viewerPreferredIntentionIds ?? [catalog.longTerm.id],
    interestId: catalog.hiking.id,
    point: options?.viewerPoint === undefined ? ORIGIN : options.viewerPoint,
    dateOfBirth: options?.viewerDateOfBirth ?? '1990-06-15',
    firstName: 'Alex',
    minAge: options?.viewerMinAge,
    maxAge: options?.viewerMaxAge,
    maxDistanceKm: options?.viewerMaxDistanceKm
  });
  const candidate = await buildUser({
    genderId: catalog.woman.id,
    preferredGenderIds: options?.candidatePreferredGenderIds ?? [catalog.man.id],
    ownIntentionIds: options?.candidateOwnIntentionIds ?? [catalog.longTerm.id, catalog.casual.id],
    preferredIntentionIds: options?.candidatePreferredIntentionIds ?? [catalog.longTerm.id],
    interestId: catalog.hiking.id,
    point: options?.candidatePoint === undefined ? north(2) : options.candidatePoint,
    dateOfBirth: options?.candidateDateOfBirth ?? '2000-06-15',
    firstName: 'Jordan',
    minAge: options?.candidateMinAge,
    maxAge: options?.candidateMaxAge,
    maxDistanceKm: options?.candidateMaxDistanceKm,
    complete: options?.candidateComplete,
    primaryPhoto: options?.candidatePrimaryPhoto,
    status: options?.candidateStatus,
    preferences: options?.candidatePreferences,
    bio: 'Designer & coffee enthusiast.',
    occupation: 'Product Designer',
    education: 'NID'
  });
  return { catalog, viewer, candidate };
}

async function discover(userId: string) {
  return request(app).get('/api/v1/discovery').set(authHeader(userId));
}

describe('GET /api/v1/discovery', () => {
  it('rejects a missing token, an invalid token, and a non-USER role', async () => {
    const missing = await request(app).get('/api/v1/discovery');
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('AUTH_REQUIRED');

    const invalid = await request(app).get('/api/v1/discovery').set({ Authorization: 'Bearer not-a-token' });
    expect(invalid.status).toBe(401);
    expect(invalid.body.error.code).toBe('INVALID_TOKEN');

    const admin = await User.create({
      email: `admin-${randomUUID()}@example.com`,
      passwordHash: PASSWORD_HASH,
      role: 'ADMIN',
      status: 'ACTIVE',
      emailVerified: true,
      phoneVerified: false
    });
    const forbidden = await request(app).get('/api/v1/discovery').set(authHeader(admin.id, 'ADMIN'));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects suspended, banned, and deleted callers', async () => {
    const suspended = await User.create({
      email: `suspended-${randomUUID()}@example.com`,
      passwordHash: PASSWORD_HASH,
      role: 'USER',
      status: 'SUSPENDED',
      emailVerified: true,
      phoneVerified: false
    });
    const suspendedResponse = await discover(suspended.id);
    expect(suspendedResponse.status).toBe(403);
    expect(suspendedResponse.body.error.code).toBe('ACCOUNT_SUSPENDED');

    const banned = await User.create({
      email: `banned-${randomUUID()}@example.com`,
      passwordHash: PASSWORD_HASH,
      role: 'USER',
      status: 'BANNED',
      emailVerified: true,
      phoneVerified: false
    });
    const bannedResponse = await discover(banned.id);
    expect(bannedResponse.status).toBe(403);
    expect(bannedResponse.body.error.code).toBe('ACCOUNT_BANNED');

    const deleted = await User.create({
      email: `deleted-${randomUUID()}@example.com`,
      passwordHash: PASSWORD_HASH,
      role: 'USER',
      status: 'ACTIVE',
      emailVerified: true,
      phoneVerified: false
    });
    await deleted.destroy();
    const deletedResponse = await discover(deleted.id);
    expect(deletedResponse.status).toBe(401);
    expect(deletedResponse.body.error.code).toBe('INVALID_TOKEN');
  });

  it('rejects an unverified caller with the existing verification errors', async () => {
    const catalog = await catalogs();
    const emailUser = await buildUser({
      genderId: catalog.man.id,
      emailVerified: false,
      preferredGenderIds: [catalog.woman.id],
      ownIntentionIds: [catalog.longTerm.id],
      preferredIntentionIds: [catalog.longTerm.id]
    });
    const emailResponse = await discover(emailUser.user.id);
    expect(emailResponse.status).toBe(403);
    expect(emailResponse.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(emailResponse.body.success).toBe(false);

    const phoneUser = await buildUser({
      genderId: catalog.woman.id,
      phoneOnly: true,
      emailVerified: false,
      preferredGenderIds: [catalog.man.id],
      ownIntentionIds: [catalog.longTerm.id],
      preferredIntentionIds: [catalog.longTerm.id]
    });
    const phoneResponse = await discover(phoneUser.user.id);
    expect(phoneResponse.status).toBe(403);
    expect(phoneResponse.body.error.code).toBe('PHONE_NOT_VERIFIED');
  });

  it('rejects incomplete onboarding, a missing preference row, and a viewer without a location', async () => {
    const catalog = await catalogs();
    const incomplete = await buildUser({
      genderId: catalog.man.id,
      complete: false,
      preferredGenderIds: [catalog.woman.id],
      ownIntentionIds: [catalog.longTerm.id],
      preferredIntentionIds: [catalog.longTerm.id]
    });
    const incompleteResponse = await discover(incomplete.user.id);
    expect(incompleteResponse.status).toBe(400);
    expect(incompleteResponse.body.error.code).toBe('PROFILE_INCOMPLETE');
    expect(incompleteResponse.body.data).toBeUndefined();

    const missingPreferences = await buildUser({
      genderId: catalog.man.id,
      preferences: false,
      point: ORIGIN
    });
    const missingPreferencesResponse = await discover(missingPreferences.user.id);
    expect(missingPreferencesResponse.status).toBe(400);
    expect(missingPreferencesResponse.body.error.code).toBe('PROFILE_INCOMPLETE');

    const missingLocation = await buildUser({
      genderId: catalog.man.id,
      point: null,
      preferredGenderIds: [catalog.woman.id],
      ownIntentionIds: [catalog.longTerm.id],
      preferredIntentionIds: [catalog.longTerm.id]
    });
    const missingLocationResponse = await discover(missingLocation.user.id);
    expect(missingLocationResponse.status).toBe(400);
    expect(missingLocationResponse.body.error.code).toBe('PROFILE_INCOMPLETE');
  });

  it('returns one eligible candidate card and omits private fields', async () => {
    const { catalog, viewer, candidate } = await eligiblePair();
    const second = await ProfilePhoto.create({
      userId: candidate.user.id,
      storageKey: `photos/${candidate.user.id}/${randomUUID()}.webp`,
      mimeType: 'image/webp',
      fileSizeBytes: 1024,
      displayOrder: 2,
      isPrimary: false,
      ...timestamps()
    });
    const removed = await ProfilePhoto.create({
      userId: candidate.user.id,
      storageKey: `photos/${candidate.user.id}/removed-${randomUUID()}.webp`,
      mimeType: 'image/jpeg',
      fileSizeBytes: 1024,
      displayOrder: 3,
      isPrimary: false,
      ...timestamps()
    });
    await removed.destroy();

    const response = await discover(viewer.user.id);
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Discovery candidate retrieved successfully');

    const card = response.body.data.candidate;
    const expectedDistance = await distanceKm(candidate.user.id, viewer.user.id);
    const expectedAge = await ageOf(candidate.user.id);
    expect(card).toEqual({
      id: candidate.user.id,
      firstName: 'Jordan',
      age: expectedAge,
      gender: { id: catalog.woman.id, code: catalog.woman.code, name: 'Woman' },
      bio: 'Designer & coffee enthusiast.',
      occupation: 'Product Designer',
      education: 'NID',
      city: 'Bengaluru',
      distanceKm: expectedDistance,
      photos: [
        {
          id: expect.any(String),
          url: 'https://download.test/signed',
          displayOrder: 1,
          isPrimary: true
        },
        {
          id: second.id,
          url: 'https://download.test/signed',
          displayOrder: 2,
          isPrimary: false
        }
      ],
      interests: [
        { id: catalog.hiking.id, code: catalog.hiking.code, name: 'Hiking', category: 'Outdoors' }
      ],
      relationshipIntentions: expect.arrayContaining([
        { id: catalog.longTerm.id, code: catalog.longTerm.code, name: 'Long-term relationship' },
        { id: catalog.casual.id, code: catalog.casual.code, name: 'Something casual' }
      ])
    });
    expect(card.relationshipIntentions).toHaveLength(2);
    expect(card.distanceKm).toEqual(Math.round(card.distanceKm * 10) / 10);
    expect(typeof card.distanceKm).toBe('number');
    expect(typeof card.age).toBe('number');

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('storageKey');
    expect(serialized).not.toContain(candidate.storageKey ?? '');
    expect(serialized).not.toContain(viewer.user.email ?? '');
    expect(serialized).not.toContain(PASSWORD_HASH);
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('latitude');
    expect(serialized).not.toContain('longitude');
    expect(serialized).not.toContain('refreshToken');
    expect(serialized).not.toContain('accessToken');
    expect(serialized).not.toContain(String(ORIGIN.latitude));
    expect(serialized).not.toContain(String(ORIGIN.longitude));
    expect(card).not.toHaveProperty('location');
    expect(card).not.toHaveProperty('email');
    expect(card).not.toHaveProperty('phone');
    expect(card.photos[0]).not.toHaveProperty('storageKey');
  });

  it('returns candidate null when nobody is eligible and never returns the viewer', async () => {
    const catalog = await catalogs();
    const viewer = await buildUser({
      genderId: catalog.man.id,
      preferredGenderIds: [catalog.man.id, catalog.woman.id],
      ownIntentionIds: [catalog.longTerm.id],
      preferredIntentionIds: [catalog.longTerm.id],
      firstName: 'Alex'
    });
    await setCreatedAt(viewer.user.id, '2024-01-01T00:00:00.000Z');
    await BoostSession.create({
      userId: viewer.user.id,
      multiplier: '9.00',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      isActive: true,
      createdAt: new Date()
    });

    const alone = await discover(viewer.user.id);
    expect(alone.status).toBe(200);
    expect(alone.body.data).toEqual({ candidate: null });

    const candidate = await buildUser({
      genderId: catalog.woman.id,
      preferredGenderIds: [catalog.man.id],
      ownIntentionIds: [catalog.longTerm.id],
      preferredIntentionIds: [catalog.longTerm.id],
      point: north(2),
      firstName: 'Jordan'
    });
    await setCreatedAt(candidate.user.id, '2020-01-01T00:00:00.000Z');

    const response = await discover(viewer.user.id);
    expect(response.status).toBe(200);
    expect(response.body.data.candidate.id).toBe(candidate.user.id);
    expect(response.body.data.candidate.id).not.toBe(viewer.user.id);
  });

  it('excludes incomplete profiles, profiles without an active primary photo, inactive users, and soft-deleted users', async () => {
    const incomplete = await eligiblePair({ candidateComplete: false });
    const incompleteResponse = await discover(incomplete.viewer.user.id);
    expect(incompleteResponse.status).toBe(200);
    expect(incompleteResponse.body.data.candidate).toBeNull();

    const noPrimary = await eligiblePair({ candidatePrimaryPhoto: false });
    await ProfilePhoto.create({
      userId: noPrimary.candidate.user.id,
      storageKey: `photos/${noPrimary.candidate.user.id}/${randomUUID()}.webp`,
      mimeType: 'image/jpeg',
      fileSizeBytes: 1024,
      displayOrder: 1,
      isPrimary: false,
      ...timestamps()
    });
    const noPrimaryResponse = await discover(noPrimary.viewer.user.id);
    expect(noPrimaryResponse.body.data.candidate).toBeNull();

    const removedPhoto = await eligiblePair();
    await ProfilePhoto.destroy({ where: { userId: removedPhoto.candidate.user.id } });
    const removedPhotoResponse = await discover(removedPhoto.viewer.user.id);
    expect(removedPhotoResponse.body.data.candidate).toBeNull();

    const suspended = await eligiblePair({ candidateStatus: 'SUSPENDED' });
    const suspendedResponse = await discover(suspended.viewer.user.id);
    expect(suspendedResponse.body.data.candidate).toBeNull();

    const deleted = await eligiblePair();
    await deleted.candidate.user.destroy();
    const deletedResponse = await discover(deleted.viewer.user.id);
    expect(deletedResponse.body.data.candidate).toBeNull();
  });

  it('applies mutual age ranges inclusively', async () => {
    const inside = await eligiblePair({
      viewerMinAge: 18,
      viewerMaxAge: 40,
      candidateMinAge: 30,
      candidateMaxAge: 50,
      viewerDateOfBirth: '1990-06-15',
      candidateDateOfBirth: '2000-06-15'
    });
    const insideResponse = await discover(inside.viewer.user.id);
    expect(insideResponse.body.data.candidate.id).toBe(inside.candidate.user.id);

    const tooOldForViewer = await eligiblePair({
      viewerMinAge: 18,
      viewerMaxAge: 30,
      candidateDateOfBirth: '1970-06-15'
    });
    const tooOldResponse = await discover(tooOldForViewer.viewer.user.id);
    expect(tooOldResponse.body.data.candidate).toBeNull();

    const viewerTooOldForCandidate = await eligiblePair({
      viewerDateOfBirth: '1990-06-15',
      candidateDateOfBirth: '2000-06-15',
      viewerMinAge: 18,
      viewerMaxAge: 40,
      candidateMinAge: 18,
      candidateMaxAge: 25
    });
    const viewerTooOldResponse = await discover(viewerTooOldForCandidate.viewer.user.id);
    expect(viewerTooOldResponse.body.data.candidate).toBeNull();
  });

  it('applies mutual gender preferences and treats an empty list as no match', async () => {
    const matching = await eligiblePair();
    const matchingResponse = await discover(matching.viewer.user.id);
    expect(matchingResponse.body.data.candidate.id).toBe(matching.candidate.user.id);

    const rejectedByCandidate = await eligiblePair({
      candidatePreferredGenderIds: []
    });
    await UserDatingPreferenceGender.create({
      userId: rejectedByCandidate.candidate.user.id,
      genderId: rejectedByCandidate.catalog.woman.id,
      createdAt: new Date()
    });
    const rejectedResponse = await discover(rejectedByCandidate.viewer.user.id);
    expect(rejectedResponse.body.data.candidate).toBeNull();

    const emptyViewerList = await eligiblePair({ viewerPreferredGenderIds: [] });
    const emptyResponse = await discover(emptyViewerList.viewer.user.id);
    expect(emptyResponse.body.data.candidate).toBeNull();
  });

  it('applies mutual relationship intentions and treats an empty list as no match', async () => {
    const matching = await eligiblePair();
    const matchingResponse = await discover(matching.viewer.user.id);
    const intentionIds = matchingResponse.body.data.candidate.relationshipIntentions.map(
      (intention: { id: string }) => intention.id
    );
    expect(intentionIds).toEqual(expect.arrayContaining([matching.catalog.longTerm.id, matching.catalog.casual.id]));

    const rejectedByCandidate = await eligiblePair({
      candidatePreferredIntentionIds: []
    });
    await UserDatingPreferenceIntention.create({
      userId: rejectedByCandidate.candidate.user.id,
      relationshipIntentionId: rejectedByCandidate.catalog.casual.id,
      createdAt: new Date()
    });
    const rejectedResponse = await discover(rejectedByCandidate.viewer.user.id);
    expect(rejectedResponse.body.data.candidate).toBeNull();

    const emptyViewerList = await eligiblePair({ viewerPreferredIntentionIds: [] });
    const emptyResponse = await discover(emptyViewerList.viewer.user.id);
    expect(emptyResponse.body.data.candidate).toBeNull();
  });

  it('applies mutual distance and excludes a candidate with no location', async () => {
    const near = await eligiblePair({
      candidatePoint: north(2),
      viewerMaxDistanceKm: 30,
      candidateMaxDistanceKm: 30
    });
    const nearResponse = await discover(near.viewer.user.id);
    expect(nearResponse.body.data.candidate.id).toBe(near.candidate.user.id);
    expect(typeof nearResponse.body.data.candidate.distanceKm).toBe('number');

    const outsideViewer = await eligiblePair({
      candidatePoint: north(80),
      viewerMaxDistanceKm: 10,
      candidateMaxDistanceKm: 200
    });
    const outsideViewerResponse = await discover(outsideViewer.viewer.user.id);
    expect(outsideViewerResponse.body.data.candidate).toBeNull();

    const outsideCandidate = await eligiblePair({
      candidatePoint: north(40),
      viewerMaxDistanceKm: 100,
      candidateMaxDistanceKm: 10
    });
    const outsideCandidateResponse = await discover(outsideCandidate.viewer.user.id);
    expect(outsideCandidateResponse.body.data.candidate).toBeNull();

    const missingPoint = await eligiblePair({ candidatePoint: null });
    const fallback = await buildUser({
      genderId: missingPoint.catalog.woman.id,
      preferredGenderIds: [missingPoint.catalog.man.id],
      ownIntentionIds: [missingPoint.catalog.longTerm.id],
      preferredIntentionIds: [missingPoint.catalog.longTerm.id],
      point: north(2),
      firstName: 'Fallback'
    });
    await setCreatedAt(missingPoint.candidate.user.id, '2024-06-01T00:00:00.000Z');
    await setCreatedAt(fallback.user.id, '2020-01-01T00:00:00.000Z');
    await BoostSession.create({
      userId: missingPoint.candidate.user.id,
      multiplier: '5.00',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      isActive: true,
      createdAt: new Date()
    });
    const missingPointResponse = await discover(missingPoint.viewer.user.id);
    expect(missingPointResponse.body.data.candidate.id).toBe(fallback.user.id);
  });

  it('excludes the viewer active like, pass, and super-like, and keeps an undone action eligible', async () => {
    const liked = await eligiblePair();
    await Like.create({
      fromUserId: liked.viewer.user.id,
      toUserId: liked.candidate.user.id,
      action: 'LIKE',
      ...timestamps()
    });
    expect((await discover(liked.viewer.user.id)).body.data.candidate).toBeNull();

    const passed = await eligiblePair();
    await Like.create({
      fromUserId: passed.viewer.user.id,
      toUserId: passed.candidate.user.id,
      action: 'PASS',
      ...timestamps()
    });
    expect((await discover(passed.viewer.user.id)).body.data.candidate).toBeNull();

    const superLiked = await eligiblePair();
    await Like.create({
      fromUserId: superLiked.viewer.user.id,
      toUserId: superLiked.candidate.user.id,
      action: 'SUPER_LIKE',
      ...timestamps()
    });
    expect((await discover(superLiked.viewer.user.id)).body.data.candidate).toBeNull();

    const undone = await eligiblePair();
    await Like.create({
      fromUserId: undone.viewer.user.id,
      toUserId: undone.candidate.user.id,
      action: 'PASS',
      isUndone: true,
      ...timestamps()
    });
    const undoneResponse = await discover(undone.viewer.user.id);
    expect(undoneResponse.body.data.candidate.id).toBe(undone.candidate.user.id);

    const incoming = await eligiblePair();
    await Like.create({
      fromUserId: incoming.candidate.user.id,
      toUserId: incoming.viewer.user.id,
      action: 'PASS',
      ...timestamps()
    });
    const incomingResponse = await discover(incoming.viewer.user.id);
    expect(incomingResponse.body.data.candidate.id).toBe(incoming.candidate.user.id);
  });

  it('excludes an active match and still returns unmatched or undone matches', async () => {
    const active = await eligiblePair();
    await insertMatch(active.viewer.user.id, active.candidate.user.id, 'ACTIVE');
    expect((await discover(active.viewer.user.id)).body.data.candidate).toBeNull();

    const unmatched = await eligiblePair();
    await insertMatch(unmatched.viewer.user.id, unmatched.candidate.user.id, 'UNMATCHED');
    expect((await discover(unmatched.viewer.user.id)).body.data.candidate.id).toBe(unmatched.candidate.user.id);

    const undone = await eligiblePair();
    await insertMatch(undone.viewer.user.id, undone.candidate.user.id, 'UNDONE');
    expect((await discover(undone.viewer.user.id)).body.data.candidate.id).toBe(undone.candidate.user.id);
  });

  it('excludes a block in either direction', async () => {
    const viewerBlocked = await eligiblePair();
    await Block.create({
      blockerId: viewerBlocked.viewer.user.id,
      blockedId: viewerBlocked.candidate.user.id,
      createdAt: new Date()
    });
    expect((await discover(viewerBlocked.viewer.user.id)).body.data.candidate).toBeNull();

    const candidateBlocked = await eligiblePair();
    await Block.create({
      blockerId: candidateBlocked.candidate.user.id,
      blockedId: candidateBlocked.viewer.user.id,
      createdAt: new Date()
    });
    expect((await discover(candidateBlocked.viewer.user.id)).body.data.candidate).toBeNull();
  });

  it('ranks by active boost multiplier and then newer profile creation time', async () => {
    const boosted = await eligiblePair();
    const plain = await buildUser({
      genderId: boosted.catalog.woman.id,
      preferredGenderIds: [boosted.catalog.man.id],
      ownIntentionIds: [boosted.catalog.longTerm.id],
      preferredIntentionIds: [boosted.catalog.longTerm.id],
      point: north(3),
      firstName: 'Newer'
    });
    await setCreatedAt(boosted.candidate.user.id, '2020-01-01T00:00:00.000Z');
    await setCreatedAt(plain.user.id, '2024-01-01T00:00:00.000Z');
    await BoostSession.create({
      userId: boosted.candidate.user.id,
      multiplier: '2.00',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      isActive: true,
      createdAt: new Date()
    });
    const boostedResponse = await discover(boosted.viewer.user.id);
    expect(boostedResponse.body.data.candidate.id).toBe(boosted.candidate.user.id);

    const higher = await eligiblePair();
    const lower = await buildUser({
      genderId: higher.catalog.woman.id,
      preferredGenderIds: [higher.catalog.man.id],
      ownIntentionIds: [higher.catalog.longTerm.id],
      preferredIntentionIds: [higher.catalog.longTerm.id],
      point: north(3),
      firstName: 'Lower'
    });
    await setCreatedAt(higher.candidate.user.id, '2020-01-01T00:00:00.000Z');
    await setCreatedAt(lower.user.id, '2024-06-01T00:00:00.000Z');
    await BoostSession.create({
      userId: higher.candidate.user.id,
      multiplier: '4.00',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      isActive: true,
      createdAt: new Date()
    });
    await BoostSession.create({
      userId: lower.user.id,
      multiplier: '2.00',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      isActive: true,
      createdAt: new Date()
    });
    const higherResponse = await discover(higher.viewer.user.id);
    expect(higherResponse.body.data.candidate.id).toBe(higher.candidate.user.id);

    const ties = await eligiblePair();
    const newerTie = await buildUser({
      genderId: ties.catalog.woman.id,
      preferredGenderIds: [ties.catalog.man.id],
      ownIntentionIds: [ties.catalog.longTerm.id],
      preferredIntentionIds: [ties.catalog.longTerm.id],
      point: north(3),
      firstName: 'Newer tie'
    });
    await setCreatedAt(ties.candidate.user.id, '2021-01-01T00:00:00.000Z');
    await setCreatedAt(newerTie.user.id, '2023-01-01T00:00:00.000Z');
    await BoostSession.create({
      userId: ties.candidate.user.id,
      multiplier: '2.00',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      isActive: true,
      createdAt: new Date()
    });
    await BoostSession.create({
      userId: newerTie.user.id,
      multiplier: '2.00',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      isActive: true,
      createdAt: new Date()
    });
    const tieResponse = await discover(ties.viewer.user.id);
    expect(tieResponse.body.data.candidate.id).toBe(newerTie.user.id);

    const unboosted = await eligiblePair();
    const newerPlain = await buildUser({
      genderId: unboosted.catalog.woman.id,
      preferredGenderIds: [unboosted.catalog.man.id],
      ownIntentionIds: [unboosted.catalog.longTerm.id],
      preferredIntentionIds: [unboosted.catalog.longTerm.id],
      point: north(3),
      firstName: 'Newer plain'
    });
    await setCreatedAt(unboosted.candidate.user.id, '2019-01-01T00:00:00.000Z');
    await setCreatedAt(newerPlain.user.id, '2022-01-01T00:00:00.000Z');
    await BoostSession.create({
      userId: unboosted.candidate.user.id,
      multiplier: '9.00',
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
      isActive: true,
      createdAt: new Date()
    });
    await BoostSession.create({
      userId: unboosted.candidate.user.id,
      multiplier: '8.00',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      isActive: false,
      createdAt: new Date()
    });
    const plainResponse = await discover(unboosted.viewer.user.id);
    expect(plainResponse.body.data.candidate.id).toBe(newerPlain.user.id);
  });
});
