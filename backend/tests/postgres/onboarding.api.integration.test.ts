import { randomUUID } from 'crypto';
import request from 'supertest';
import { app } from '../../src/app';
import { Gender } from '../../src/database/models/gender.model';
import { Interest } from '../../src/database/models/interest.model';
import { Profile } from '../../src/database/models/profile.model';
import { RelationshipIntention } from '../../src/database/models/relationship-intention.model';
import { User } from '../../src/database/models/user.model';
import { UserInterest } from '../../src/database/models/user-interest.model';
import { UserRelationshipIntention } from '../../src/database/models/user-relationship-intention.model';
import { createUser } from '../../src/modules/users/users.data-access';
import { signAccessToken } from '../../src/utils/jwt';

const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';

function userInput() {
  return {
    email: `onboarding-${randomUUID()}@example.com`,
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

function timestamps(): { createdAt: Date; updatedAt: Date } {
  const now = new Date();
  return { createdAt: now, updatedAt: now };
}

async function createInterest(displayOrder: number, isActive = true, category: string | null = 'Test') {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  return Interest.create({
    code: `I${displayOrder}${suffix}`,
    name: `Interest ${displayOrder}`,
    category,
    isActive,
    displayOrder,
    ...timestamps()
  });
}

async function createIntention(displayOrder: number, isActive = true) {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  return RelationshipIntention.create({
    code: `R${displayOrder}${suffix}`,
    name: `Intention ${displayOrder}`,
    description: 'Not part of the response',
    isActive,
    displayOrder,
    ...timestamps()
  });
}

async function interestIdsFor(userId: string): Promise<string[]> {
  const rows = await UserInterest.findAll({ where: { userId }, attributes: ['interestId'] });
  return rows.map((row) => row.interestId).sort();
}

async function intentionIdsFor(userId: string): Promise<string[]> {
  const rows = await UserRelationshipIntention.findAll({
    where: { userId },
    attributes: ['relationshipIntentionId']
  });
  return rows.map((row) => row.relationshipIntentionId).sort();
}

async function seedInterests(userId: string, interestIds: string[]): Promise<void> {
  const createdAt = new Date();
  await UserInterest.bulkCreate(interestIds.map((interestId) => ({ userId, interestId, createdAt })));
}

async function seedIntentions(userId: string, relationshipIntentionIds: string[]): Promise<void> {
  const createdAt = new Date();
  await UserRelationshipIntention.bulkCreate(
    relationshipIntentionIds.map((relationshipIntentionId) => ({ userId, relationshipIntentionId, createdAt }))
  );
}

describe('PUT /api/v1/onboarding/interests', () => {
  it('rejects an unauthenticated request', async () => {
    const response = await request(app).put('/api/v1/onboarding/interests').send({ interestIds: [] });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');
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
      .put('/api/v1/onboarding/interests')
      .set(authHeader(admin.id, 'ADMIN'))
      .send({ interestIds: [randomUUID(), randomUUID(), randomUUID()] });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(await interestIdsFor(admin.id)).toEqual([]);
  });

  it('saves 3 interests and returns catalog records in display order', async () => {
    const user = await createUser(userInput());
    const third = await createInterest(30, true, null);
    const first = await createInterest(10, true, 'Food');
    const second = await createInterest(20, true, 'Sport');

    const response = await request(app)
      .put('/api/v1/onboarding/interests')
      .set(authHeader(user.id))
      .send({ interestIds: [third.id, first.id, second.id] });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Interests updated successfully');
    expect(response.body.data).toEqual([
      { id: first.id, code: first.code, name: first.name, category: 'Food' },
      { id: second.id, code: second.code, name: second.name, category: 'Sport' },
      { id: third.id, code: third.code, name: third.name, category: null }
    ]);
    for (const item of response.body.data) {
      expect(Object.keys(item).sort()).toEqual(['category', 'code', 'id', 'name']);
    }
    expect(await interestIdsFor(user.id)).toEqual([first.id, second.id, third.id].sort());
    expect(await Profile.count({ where: { userId: user.id } })).toBe(0);
  });

  it('saves 10 interests', async () => {
    const user = await createUser(userInput());
    const created = [];
    for (let order = 1; order <= 10; order += 1) {
      created.push(await createInterest(order));
    }

    const response = await request(app)
      .put('/api/v1/onboarding/interests')
      .set(authHeader(user.id))
      .send({ interestIds: created.map((row) => row.id) });

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(10);
    expect(await interestIdsFor(user.id)).toEqual(created.map((row) => row.id).sort());
  });

  it('rejects fewer than 3 and leaves stored selections unchanged', async () => {
    const user = await createUser(userInput());
    const existing = [await createInterest(1), await createInterest(2), await createInterest(3)];
    await seedInterests(user.id, existing.map((row) => row.id));

    const response = await request(app)
      .put('/api/v1/onboarding/interests')
      .set(authHeader(user.id))
      .send({ interestIds: existing.slice(0, 2).map((row) => row.id) });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await interestIdsFor(user.id)).toEqual(existing.map((row) => row.id).sort());
  });

  it('rejects more than 10 and leaves stored selections unchanged', async () => {
    const user = await createUser(userInput());
    const existing = [await createInterest(1), await createInterest(2), await createInterest(3)];
    await seedInterests(user.id, existing.map((row) => row.id));
    const tooMany = [];
    for (let order = 1; order <= 11; order += 1) {
      tooMany.push(await createInterest(100 + order));
    }

    const response = await request(app)
      .put('/api/v1/onboarding/interests')
      .set(authHeader(user.id))
      .send({ interestIds: tooMany.map((row) => row.id) });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await interestIdsFor(user.id)).toEqual(existing.map((row) => row.id).sort());
  });

  it('rejects an invalid uuid and leaves stored selections unchanged', async () => {
    const user = await createUser(userInput());
    const existing = [await createInterest(1), await createInterest(2), await createInterest(3)];
    await seedInterests(user.id, existing.map((row) => row.id));

    const response = await request(app)
      .put('/api/v1/onboarding/interests')
      .set(authHeader(user.id))
      .send({ interestIds: [existing[0].id, existing[1].id, 'not-a-uuid'] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await interestIdsFor(user.id)).toEqual(existing.map((row) => row.id).sort());
  });

  it('rejects duplicate ids and leaves stored selections unchanged', async () => {
    const user = await createUser(userInput());
    const existing = [await createInterest(1), await createInterest(2), await createInterest(3)];
    await seedInterests(user.id, existing.map((row) => row.id));

    const response = await request(app)
      .put('/api/v1/onboarding/interests')
      .set(authHeader(user.id))
      .send({ interestIds: [existing[0].id, existing[1].id, existing[0].id.toUpperCase()] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await interestIdsFor(user.id)).toEqual(existing.map((row) => row.id).sort());
  });

  it('rejects an unknown id and leaves stored selections unchanged', async () => {
    const user = await createUser(userInput());
    const existing = [await createInterest(1), await createInterest(2), await createInterest(3)];
    await seedInterests(user.id, existing.map((row) => row.id));

    const response = await request(app)
      .put('/api/v1/onboarding/interests')
      .set(authHeader(user.id))
      .send({ interestIds: [existing[0].id, existing[1].id, randomUUID()] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_INTEREST');
    expect(response.body.error.details.length).toBeGreaterThan(0);
    expect(await interestIdsFor(user.id)).toEqual(existing.map((row) => row.id).sort());
  });

  it('rejects an inactive interest and leaves stored selections unchanged', async () => {
    const user = await createUser(userInput());
    const existing = [await createInterest(1), await createInterest(2), await createInterest(3)];
    const inactive = await createInterest(4, false);
    await seedInterests(user.id, existing.map((row) => row.id));

    const response = await request(app)
      .put('/api/v1/onboarding/interests')
      .set(authHeader(user.id))
      .send({ interestIds: [existing[0].id, existing[1].id, inactive.id] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_INTEREST');
    expect(await interestIdsFor(user.id)).toEqual(existing.map((row) => row.id).sort());
  });

  it('replaces the caller selections and does not change another user', async () => {
    const user = await createUser(userInput());
    const other = await createUser(userInput());
    const first = await createInterest(1);
    const second = await createInterest(2);
    const third = await createInterest(3);
    const fourth = await createInterest(4);
    await seedInterests(user.id, [first.id, second.id, third.id]);
    await seedInterests(other.id, [first.id, second.id, fourth.id]);

    const response = await request(app)
      .put('/api/v1/onboarding/interests')
      .set(authHeader(user.id))
      .send({ interestIds: [second.id, third.id, fourth.id], userId: other.id });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await interestIdsFor(user.id)).toEqual([first.id, second.id, third.id].sort());
    expect(await interestIdsFor(other.id)).toEqual([first.id, second.id, fourth.id].sort());

    const replaced = await request(app)
      .put('/api/v1/onboarding/interests')
      .set(authHeader(user.id))
      .send({ interestIds: [second.id, third.id, fourth.id] });

    expect(replaced.status).toBe(200);
    expect(replaced.body.data.map((item: { id: string }) => item.id).sort()).toEqual([second.id, third.id, fourth.id].sort());
    expect(await interestIdsFor(user.id)).toEqual([second.id, third.id, fourth.id].sort());
    expect(await interestIdsFor(other.id)).toEqual([first.id, second.id, fourth.id].sort());
  });

  it('does not change profile completion', async () => {
    const user = await createUser(userInput());
    const gender = await Gender.create({
      code: `g-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      name: 'Man',
      isActive: true
    });
    await Profile.create({
      userId: user.id,
      firstName: 'John',
      dateOfBirth: '1998-05-10',
      genderId: gender.id,
      city: 'Kochi',
      isProfileComplete: true
    });
    const selected = [await createInterest(1), await createInterest(2), await createInterest(3)];

    const response = await request(app)
      .put('/api/v1/onboarding/interests')
      .set(authHeader(user.id))
      .send({ interestIds: selected.map((row) => row.id) });

    expect(response.status).toBe(200);
    const profile = await Profile.findOne({ where: { userId: user.id } });
    expect(profile?.isProfileComplete).toBe(true);
    expect(profile?.city).toBe('Kochi');
  });

  it('rolls back a failed replacement and keeps the previous rows', async () => {
    const user = await createUser(userInput());
    const other = await createUser(userInput());
    const existing = [await createInterest(1), await createInterest(2), await createInterest(3)];
    const next = [await createInterest(4), await createInterest(5), await createInterest(6)];
    await seedInterests(user.id, existing.map((row) => row.id));
    await seedInterests(other.id, existing.map((row) => row.id));
    const bulkCreate = jest.spyOn(UserInterest, 'bulkCreate').mockRejectedValueOnce(new Error('forced insert failure'));

    try {
      const response = await request(app)
        .put('/api/v1/onboarding/interests')
        .set(authHeader(user.id))
        .send({ interestIds: next.map((row) => row.id) });

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(await interestIdsFor(user.id)).toEqual(existing.map((row) => row.id).sort());
      expect(await interestIdsFor(other.id)).toEqual(existing.map((row) => row.id).sort());
    } finally {
      bulkCreate.mockRestore();
    }
  });
});

describe('PUT /api/v1/onboarding/relationship-intentions', () => {
  it('rejects an unauthenticated request', async () => {
    const response = await request(app)
      .put('/api/v1/onboarding/relationship-intentions')
      .send({ relationshipIntentionIds: [] });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('saves one intention and returns the catalog record', async () => {
    const user = await createUser(userInput());
    const intention = await createIntention(2);

    const response = await request(app)
      .put('/api/v1/onboarding/relationship-intentions')
      .set(authHeader(user.id))
      .send({ relationshipIntentionIds: [intention.id] });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Relationship intentions updated successfully');
    expect(response.body.data).toEqual([{ id: intention.id, code: intention.code, name: intention.name }]);
    expect(Object.keys(response.body.data[0]).sort()).toEqual(['code', 'id', 'name']);
    expect(response.body.data[0]).not.toHaveProperty('description');
    expect(await intentionIdsFor(user.id)).toEqual([intention.id]);
  });

  it('saves multiple intentions in display order', async () => {
    const user = await createUser(userInput());
    const later = await createIntention(20);
    const earlier = await createIntention(10);

    const response = await request(app)
      .put('/api/v1/onboarding/relationship-intentions')
      .set(authHeader(user.id))
      .send({ relationshipIntentionIds: [later.id, earlier.id] });

    expect(response.status).toBe(200);
    expect(response.body.data.map((item: { id: string }) => item.id)).toEqual([earlier.id, later.id]);
    expect(await intentionIdsFor(user.id)).toEqual([earlier.id, later.id].sort());
  });

  it('rejects zero intentions and leaves stored selections unchanged', async () => {
    const user = await createUser(userInput());
    const existing = await createIntention(1);
    await seedIntentions(user.id, [existing.id]);

    const response = await request(app)
      .put('/api/v1/onboarding/relationship-intentions')
      .set(authHeader(user.id))
      .send({ relationshipIntentionIds: [] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await intentionIdsFor(user.id)).toEqual([existing.id]);
  });

  it('rejects an invalid uuid and leaves stored selections unchanged', async () => {
    const user = await createUser(userInput());
    const existing = await createIntention(1);
    await seedIntentions(user.id, [existing.id]);

    const response = await request(app)
      .put('/api/v1/onboarding/relationship-intentions')
      .set(authHeader(user.id))
      .send({ relationshipIntentionIds: ['not-a-uuid'] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await intentionIdsFor(user.id)).toEqual([existing.id]);
  });

  it('rejects duplicate ids and leaves stored selections unchanged', async () => {
    const user = await createUser(userInput());
    const existing = await createIntention(1);
    await seedIntentions(user.id, [existing.id]);
    const next = await createIntention(2);

    const response = await request(app)
      .put('/api/v1/onboarding/relationship-intentions')
      .set(authHeader(user.id))
      .send({ relationshipIntentionIds: [next.id, next.id.toUpperCase()] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await intentionIdsFor(user.id)).toEqual([existing.id]);
  });

  it('rejects an unknown id and leaves stored selections unchanged', async () => {
    const user = await createUser(userInput());
    const existing = await createIntention(1);
    await seedIntentions(user.id, [existing.id]);

    const response = await request(app)
      .put('/api/v1/onboarding/relationship-intentions')
      .set(authHeader(user.id))
      .send({ relationshipIntentionIds: [randomUUID()] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_RELATIONSHIP_INTENTION');
    expect(await intentionIdsFor(user.id)).toEqual([existing.id]);
  });

  it('rejects an inactive intention and leaves stored selections unchanged', async () => {
    const user = await createUser(userInput());
    const existing = await createIntention(1);
    const inactive = await createIntention(2, false);
    await seedIntentions(user.id, [existing.id]);

    const response = await request(app)
      .put('/api/v1/onboarding/relationship-intentions')
      .set(authHeader(user.id))
      .send({ relationshipIntentionIds: [inactive.id] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_RELATIONSHIP_INTENTION');
    expect(await intentionIdsFor(user.id)).toEqual([existing.id]);
  });

  it('replaces the caller selections and does not change another user', async () => {
    const user = await createUser(userInput());
    const other = await createUser(userInput());
    const first = await createIntention(1);
    const second = await createIntention(2);
    const third = await createIntention(3);
    await seedIntentions(user.id, [first.id, second.id]);
    await seedIntentions(other.id, [first.id, third.id]);

    const rejected = await request(app)
      .put('/api/v1/onboarding/relationship-intentions')
      .set(authHeader(user.id))
      .send({ relationshipIntentionIds: [second.id], userId: other.id });
    expect(rejected.status).toBe(400);
    expect(await intentionIdsFor(user.id)).toEqual([first.id, second.id].sort());
    expect(await intentionIdsFor(other.id)).toEqual([first.id, third.id].sort());

    const replaced = await request(app)
      .put('/api/v1/onboarding/relationship-intentions')
      .set(authHeader(user.id))
      .send({ relationshipIntentionIds: [second.id, third.id] });

    expect(replaced.status).toBe(200);
    expect(await intentionIdsFor(user.id)).toEqual([second.id, third.id].sort());
    expect(await intentionIdsFor(other.id)).toEqual([first.id, third.id].sort());
  });

  it('does not change profile completion', async () => {
    const user = await createUser(userInput());
    const gender = await Gender.create({
      code: `g-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      name: 'Woman',
      isActive: true
    });
    await Profile.create({
      userId: user.id,
      firstName: 'Ada',
      dateOfBirth: '1995-04-02',
      genderId: gender.id,
      isProfileComplete: false
    });
    const intention = await createIntention(1);

    const response = await request(app)
      .put('/api/v1/onboarding/relationship-intentions')
      .set(authHeader(user.id))
      .send({ relationshipIntentionIds: [intention.id] });

    expect(response.status).toBe(200);
    const profile = await Profile.findOne({ where: { userId: user.id } });
    expect(profile?.isProfileComplete).toBe(false);
  });

  it('rolls back a failed replacement and keeps the previous rows', async () => {
    const user = await createUser(userInput());
    const other = await createUser(userInput());
    const existing = await createIntention(1);
    const next = [await createIntention(2), await createIntention(3)];
    await seedIntentions(user.id, [existing.id]);
    await seedIntentions(other.id, [existing.id]);
    const bulkCreate = jest
      .spyOn(UserRelationshipIntention, 'bulkCreate')
      .mockRejectedValueOnce(new Error('forced insert failure'));

    try {
      const response = await request(app)
        .put('/api/v1/onboarding/relationship-intentions')
        .set(authHeader(user.id))
        .send({ relationshipIntentionIds: next.map((row) => row.id) });

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(await intentionIdsFor(user.id)).toEqual([existing.id]);
      expect(await intentionIdsFor(other.id)).toEqual([existing.id]);
    } finally {
      bulkCreate.mockRestore();
    }
  });
});
