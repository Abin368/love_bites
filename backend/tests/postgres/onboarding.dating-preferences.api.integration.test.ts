import { randomUUID } from 'crypto';
import request from 'supertest';
import { app } from '../../src/app';
import { DatingPreference } from '../../src/database/models/dating-preference.model';
import { Gender } from '../../src/database/models/gender.model';
import { Profile } from '../../src/database/models/profile.model';
import { RelationshipIntention } from '../../src/database/models/relationship-intention.model';
import { User } from '../../src/database/models/user.model';
import { UserDatingPreferenceGender } from '../../src/database/models/user-dating-preference-gender.model';
import { UserDatingPreferenceIntention } from '../../src/database/models/user-dating-preference-intention.model';
import { UserRelationshipIntention } from '../../src/database/models/user-relationship-intention.model';
import { createUser } from '../../src/modules/users/users.data-access';
import { signAccessToken } from '../../src/utils/jwt';

const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';

function userInput() {
  return {
    email: `preferences-${randomUUID()}@example.com`,
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

function suffix(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}

async function createGender(displayOrder: number, isActive = true) {
  return Gender.create({
    code: `G${displayOrder}${suffix()}`,
    name: `Gender ${displayOrder}`,
    isActive,
    displayOrder
  });
}

async function createIntention(displayOrder: number, isActive = true) {
  const now = new Date();
  return RelationshipIntention.create({
    code: `P${displayOrder}${suffix()}`,
    name: `Preferred ${displayOrder}`,
    description: 'Not part of the response',
    isActive,
    displayOrder,
    createdAt: now,
    updatedAt: now
  });
}

function body(input: {
  genderIds?: string[];
  intentionIds?: string[];
  minAge?: number;
  maxAge?: number;
  maxDistanceKm?: number;
}) {
  return {
    minAge: input.minAge ?? 22,
    maxAge: input.maxAge ?? 32,
    maxDistanceKm: input.maxDistanceKm ?? 40,
    interestedInGenderIds: input.genderIds ?? [],
    preferredIntentionIds: input.intentionIds ?? []
  };
}

async function save(userId: string, payload: Record<string, unknown>) {
  return request(app).put('/api/v1/onboarding/dating-preferences').set(authHeader(userId)).send(payload);
}

async function genderIdsFor(userId: string): Promise<string[]> {
  const rows = await UserDatingPreferenceGender.findAll({ where: { userId }, attributes: ['genderId'] });
  return rows.map((row) => row.genderId).sort();
}

async function intentionIdsFor(userId: string): Promise<string[]> {
  const rows = await UserDatingPreferenceIntention.findAll({
    where: { userId },
    attributes: ['relationshipIntentionId']
  });
  return rows.map((row) => row.relationshipIntentionId).sort();
}

describe('PUT /api/v1/onboarding/dating-preferences', () => {
  it('rejects an unauthenticated request and a non-USER role', async () => {
    const missing = await request(app).put('/api/v1/onboarding/dating-preferences').send(body({}));
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
      .put('/api/v1/onboarding/dating-preferences')
      .set(authHeader(admin.id, 'ADMIN'))
      .send(body({}));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
    expect(await DatingPreference.count({ where: { userId: admin.id } })).toBe(0);
  });

  it('creates the preference row and both junction sets for an authenticated user', async () => {
    const user = await createUser(userInput());
    const laterGender = await createGender(2);
    const earlierGender = await createGender(1);
    const laterIntention = await createIntention(2);
    const earlierIntention = await createIntention(1);

    const response = await save(
      user.id,
      body({
        genderIds: [laterGender.id, earlierGender.id],
        intentionIds: [laterIntention.id, earlierIntention.id]
      })
    );

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Dating preferences updated successfully');
    expect(response.body.data).toEqual({
      minAge: 22,
      maxAge: 32,
      maxDistanceKm: 40,
      interestedInGenders: [
        { id: earlierGender.id, code: earlierGender.code, name: earlierGender.name },
        { id: laterGender.id, code: laterGender.code, name: laterGender.name }
      ],
      preferredIntentions: [
        { id: earlierIntention.id, code: earlierIntention.code, name: earlierIntention.name },
        { id: laterIntention.id, code: laterIntention.code, name: laterIntention.name }
      ]
    });
    expect(response.body.data).not.toHaveProperty('userId');
    expect(response.body.data.interestedInGenders[0]).not.toHaveProperty('displayOrder');

    const stored = await DatingPreference.findOne({ where: { userId: user.id } });
    expect(stored).toMatchObject({ minAge: 22, maxAge: 32, maxDistanceKm: 40 });
    expect(await genderIdsFor(user.id)).toEqual([earlierGender.id, laterGender.id].sort());
    expect(await intentionIdsFor(user.id)).toEqual([earlierIntention.id, laterIntention.id].sort());
    expect(await UserRelationshipIntention.count({ where: { userId: user.id } })).toBe(0);
  });

  it('replaces the previous preference values and junction rows', async () => {
    const user = await createUser(userInput());
    const firstGender = await createGender(1);
    const secondGender = await createGender(2);
    const firstIntention = await createIntention(1);
    const secondIntention = await createIntention(2);

    expect((await save(user.id, body({ genderIds: [firstGender.id], intentionIds: [firstIntention.id] }))).status).toBe(200);

    const replaced = await save(user.id, body({
      minAge: 25,
      maxAge: 40,
      maxDistanceKm: 10,
      genderIds: [secondGender.id],
      intentionIds: [secondIntention.id]
    }));

    expect(replaced.status).toBe(200);
    expect(replaced.body.data).toMatchObject({
      minAge: 25,
      maxAge: 40,
      maxDistanceKm: 10,
      interestedInGenders: [{ id: secondGender.id, code: secondGender.code, name: secondGender.name }],
      preferredIntentions: [{ id: secondIntention.id, code: secondIntention.code, name: secondIntention.name }]
    });
    expect(await DatingPreference.count({ where: { userId: user.id } })).toBe(1);
    expect(await genderIdsFor(user.id)).toEqual([secondGender.id]);
    expect(await intentionIdsFor(user.id)).toEqual([secondIntention.id]);
  });

  it('removes previous junction rows when the submitted lists are empty', async () => {
    const user = await createUser(userInput());
    const gender = await createGender(1);
    const intention = await createIntention(1);
    await save(user.id, body({ genderIds: [gender.id], intentionIds: [intention.id] }));

    const cleared = await save(user.id, body({ minAge: 21, maxAge: 30, maxDistanceKm: 15, genderIds: [], intentionIds: [] }));

    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toEqual({
      minAge: 21,
      maxAge: 30,
      maxDistanceKm: 15,
      interestedInGenders: [],
      preferredIntentions: []
    });
    expect(await DatingPreference.count({ where: { userId: user.id } })).toBe(1);
    expect(await genderIdsFor(user.id)).toEqual([]);
    expect(await intentionIdsFor(user.id)).toEqual([]);
  });

  it('rejects an inactive or unknown gender without writing', async () => {
    const user = await createUser(userInput());
    const inactive = await createGender(1, false);
    const active = await createGender(2);
    const intention = await createIntention(1);

    const inactiveResponse = await save(user.id, body({ genderIds: [inactive.id], intentionIds: [intention.id] }));
    expect(inactiveResponse.status).toBe(400);
    expect(inactiveResponse.body.error.code).toBe('INVALID_GENDER');

    const unknownResponse = await save(user.id, body({ genderIds: [randomUUID()], intentionIds: [intention.id] }));
    expect(unknownResponse.status).toBe(400);
    expect(unknownResponse.body.error.code).toBe('INVALID_GENDER');

    expect(await DatingPreference.count({ where: { userId: user.id } })).toBe(0);
    expect(await genderIdsFor(user.id)).toEqual([]);
    expect(await intentionIdsFor(user.id)).toEqual([]);
    expect(active.id).not.toBe(inactive.id);
  });

  it('rejects an inactive or unknown relationship intention without writing', async () => {
    const user = await createUser(userInput());
    const gender = await createGender(1);
    const inactive = await createIntention(1, false);

    const inactiveResponse = await save(user.id, body({ genderIds: [gender.id], intentionIds: [inactive.id] }));
    expect(inactiveResponse.status).toBe(400);
    expect(inactiveResponse.body.error.code).toBe('INVALID_RELATIONSHIP_INTENTION');

    const unknownResponse = await save(user.id, body({ genderIds: [gender.id], intentionIds: [randomUUID()] }));
    expect(unknownResponse.status).toBe(400);
    expect(unknownResponse.body.error.code).toBe('INVALID_RELATIONSHIP_INTENTION');

    expect(await DatingPreference.count({ where: { userId: user.id } })).toBe(0);
    expect(await UserRelationshipIntention.count({ where: { userId: user.id } })).toBe(0);
  });

  it('rejects a malformed request and an extra field', async () => {
    const user = await createUser(userInput());
    const gender = await createGender(1);
    const intention = await createIntention(1);

    const malformed = await save(user.id, body({ minAge: 17, genderIds: [gender.id], intentionIds: [intention.id] }));
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');

    const badGender = await save(user.id, body({ genderIds: ['not-a-uuid'], intentionIds: [intention.id] }));
    expect(badGender.status).toBe(400);
    expect(badGender.body.error.code).toBe('VALIDATION_ERROR');

    const extra = await save(user.id, {
      ...body({ genderIds: [gender.id], intentionIds: [intention.id] }),
      userId: user.id
    });
    expect(extra.status).toBe(400);
    expect(extra.body.error.code).toBe('VALIDATION_ERROR');

    expect(await DatingPreference.count({ where: { userId: user.id } })).toBe(0);
  });

  it('does not change another user preferences or profile completion', async () => {
    const user = await createUser(userInput());
    const other = await createUser(userInput());
    const gender = await createGender(1);
    const otherGender = await createGender(2);
    const intention = await createIntention(1);
    const otherIntention = await createIntention(2);
    const profileGender = await createGender(3);
    await Profile.create({
      userId: user.id,
      firstName: 'Ada',
      dateOfBirth: '1992-04-04',
      genderId: profileGender.id,
      city: 'Kochi',
      isProfileComplete: true
    });
    await save(other.id, body({ minAge: 30, maxAge: 40, maxDistanceKm: 80, genderIds: [otherGender.id], intentionIds: [otherIntention.id] }));

    const response = await save(user.id, body({ genderIds: [gender.id], intentionIds: [intention.id] }));

    expect(response.status).toBe(200);
    const profile = await Profile.findOne({ where: { userId: user.id } });
    expect(profile?.isProfileComplete).toBe(true);
    expect(profile?.city).toBe('Kochi');
    expect(await genderIdsFor(other.id)).toEqual([otherGender.id]);
    expect(await intentionIdsFor(other.id)).toEqual([otherIntention.id]);
    const otherPreference = await DatingPreference.findOne({ where: { userId: other.id } });
    expect(otherPreference).toMatchObject({ minAge: 30, maxAge: 40, maxDistanceKm: 80 });
    expect(await genderIdsFor(user.id)).toEqual([gender.id]);
  });

  it('rolls back a failed replacement and keeps the previous rows', async () => {
    const user = await createUser(userInput());
    const other = await createUser(userInput());
    const firstGender = await createGender(1);
    const secondGender = await createGender(2);
    const firstIntention = await createIntention(1);
    const secondIntention = await createIntention(2);
    await save(user.id, body({ minAge: 22, maxAge: 32, maxDistanceKm: 40, genderIds: [firstGender.id], intentionIds: [firstIntention.id] }));
    await save(other.id, body({ genderIds: [firstGender.id], intentionIds: [firstIntention.id] }));
    const bulkCreate = jest
      .spyOn(UserDatingPreferenceIntention, 'bulkCreate')
      .mockRejectedValueOnce(new Error('forced insert failure'));

    try {
      const response = await save(user.id, body({
        minAge: 28,
        maxAge: 35,
        maxDistanceKm: 12,
        genderIds: [secondGender.id],
        intentionIds: [secondIntention.id]
      }));

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INTERNAL_SERVER_ERROR');
      const stored = await DatingPreference.findOne({ where: { userId: user.id } });
      expect(stored).toMatchObject({ minAge: 22, maxAge: 32, maxDistanceKm: 40 });
      expect(await genderIdsFor(user.id)).toEqual([firstGender.id]);
      expect(await intentionIdsFor(user.id)).toEqual([firstIntention.id]);
      expect(await genderIdsFor(other.id)).toEqual([firstGender.id]);
      expect(await intentionIdsFor(other.id)).toEqual([firstIntention.id]);
    } finally {
      bulkCreate.mockRestore();
    }
  });
});
