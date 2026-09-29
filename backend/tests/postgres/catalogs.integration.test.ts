import request from 'supertest';
import { QueryInterface } from 'sequelize';
import { sequelize } from '../../src/config/database';
import { Gender } from '../../src/database/models/gender.model';
import { Interest } from '../../src/database/models/interest.model';
import { RelationshipIntention } from '../../src/database/models/relationship-intention.model';
import { redis, resetMemoryRedis } from '../../src/config/redis';

jest.mock('../../src/config/redis', () => jest.requireActual('../helpers/memory-redis'));

import { app } from '../../src/app';

const rateLimitKeys: string[] = [];
const originalEval = redis.eval.bind(redis);

interface Seeder {
  up: (queryInterface: QueryInterface) => Promise<void>;
  down: (queryInterface: QueryInterface) => Promise<void>;
}

const genderSeeder = require('../../src/database/seeders/20260929120001-seed-genders') as Seeder;
const intentionSeeder = require('../../src/database/seeders/20260929120002-seed-relationship-intentions') as Seeder;

const GENDER_SEED = [
  { code: 'MAN', name: 'Man' },
  { code: 'WOMAN', name: 'Woman' },
  { code: 'NON_BINARY', name: 'Non-binary' },
  { code: 'PREFER_NOT_TO_SAY', name: 'Prefer not to say' }
];

const INTENTION_SEED = [
  { code: 'LONG_TERM_RELATIONSHIP', name: 'Long-term relationship' },
  { code: 'SOMETHING_CASUAL', name: 'Something casual' },
  { code: 'FRIENDSHIP', name: 'Friendship' },
  { code: 'NOT_SURE_YET', name: 'Not sure yet' }
];

function queryInterface(): QueryInterface {
  return sequelize.getQueryInterface();
}

function timestamps(): { createdAt: Date; updatedAt: Date } {
  const now = new Date();
  return { createdAt: now, updatedAt: now };
}

beforeEach(() => {
  resetMemoryRedis();
  rateLimitKeys.length = 0;
  jest.spyOn(redis, 'eval').mockImplementation(async (script: string, numKeys: number, ...args: Array<string | number>) => {
    rateLimitKeys.push(String(args[0]));
    return originalEval(script, numKeys, ...args);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function publicGet(path: string) {
  return request(app).get(path);
}

describe('public gender catalog', () => {
  it('returns 200 without authentication and ignores a bearer token', async () => {
    const anonymous = await publicGet('/api/v1/genders');
    expect(anonymous.status).toBe(200);
    expect(anonymous.body.success).toBe(true);

    const withToken = await request(app).get('/api/v1/genders').set('Authorization', 'Bearer not-a-token');
    expect(withToken.status).toBe(200);
    expect(withToken.body.success).toBe(true);
  });

  it('returns only active genders in display order with the public shape', async () => {
    await Gender.create({ code: 'TEST_LATER', name: 'Test later', isActive: true, displayOrder: 30 });
    await Gender.create({ code: 'TEST_HIDDEN', name: 'Test hidden', isActive: false, displayOrder: 1 });
    await Gender.create({ code: 'TEST_FIRST', name: 'Test first', isActive: true, displayOrder: 10 });

    const response = await publicGet('/api/v1/genders');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: 'Genders retrieved successfully',
      data: [
        expect.objectContaining({ code: 'TEST_FIRST', name: 'Test first' }),
        expect.objectContaining({ code: 'TEST_LATER', name: 'Test later' })
      ]
    });
    expect(response.body.data).toHaveLength(2);
    for (const item of response.body.data) {
      expect(Object.keys(item).sort()).toEqual(['code', 'id', 'name']);
      expect(item.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    }
    expect(response.body.data.map((item: { code: string }) => item.code)).toEqual(['TEST_FIRST', 'TEST_LATER']);
  });

  it('returns an empty array when no active genders exist', async () => {
    await Gender.create({ code: 'TEST_HIDDEN', name: 'Test hidden', isActive: false, displayOrder: 1 });

    const response = await publicGet('/api/v1/genders');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: [],
      message: 'Genders retrieved successfully'
    });
  });
});

describe('public relationship intention catalog', () => {
  it('returns 200 without authentication and ignores a bearer token', async () => {
    const anonymous = await publicGet('/api/v1/relationship-intentions');
    expect(anonymous.status).toBe(200);

    const withToken = await request(app)
      .get('/api/v1/relationship-intentions')
      .set('Authorization', 'Bearer not-a-token');
    expect(withToken.status).toBe(200);
    expect(withToken.body.success).toBe(true);
  });

  it('returns only active intentions in display order with the public shape', async () => {
    await RelationshipIntention.create({
      code: 'TEST_LATER',
      name: 'Test later',
      description: 'hidden description',
      isActive: true,
      displayOrder: 30,
      ...timestamps()
    });
    await RelationshipIntention.create({
      code: 'TEST_HIDDEN',
      name: 'Test hidden',
      isActive: false,
      displayOrder: 1,
      ...timestamps()
    });
    await RelationshipIntention.create({
      code: 'TEST_FIRST',
      name: 'Test first',
      isActive: true,
      displayOrder: 10,
      ...timestamps()
    });

    const response = await publicGet('/api/v1/relationship-intentions');

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Relationship intentions retrieved successfully');
    expect(response.body.data.map((item: { code: string }) => item.code)).toEqual(['TEST_FIRST', 'TEST_LATER']);
    for (const item of response.body.data) {
      expect(Object.keys(item).sort()).toEqual(['code', 'id', 'name']);
      expect(item).not.toHaveProperty('description');
    }
  });

  it('returns an empty array when no active intentions exist', async () => {
    const response = await publicGet('/api/v1/relationship-intentions');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: [],
      message: 'Relationship intentions retrieved successfully'
    });
  });
});

describe('public interest catalog', () => {
  it('returns 200 without authentication and ignores a bearer token', async () => {
    const anonymous = await publicGet('/api/v1/interests');
    expect(anonymous.status).toBe(200);
    expect(anonymous.body.success).toBe(true);

    const withToken = await request(app).get('/api/v1/interests').set('Authorization', 'Bearer not-a-token');
    expect(withToken.status).toBe(200);
  });

  it('returns only active interests in display order with the public shape', async () => {
    await Interest.create({
      code: 'TEST_LATER',
      name: 'Test interest later',
      category: 'Test category',
      isActive: true,
      displayOrder: 30,
      ...timestamps()
    });
    await Interest.create({
      code: 'TEST_HIDDEN',
      name: 'Test interest hidden',
      category: 'Test category',
      isActive: false,
      displayOrder: 1,
      ...timestamps()
    });
    await Interest.create({
      code: 'TEST_FIRST',
      name: 'Test interest first',
      category: null,
      isActive: true,
      displayOrder: 10,
      ...timestamps()
    });

    const response = await publicGet('/api/v1/interests');

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Interests retrieved successfully');
    expect(response.body.data).toEqual([
      expect.objectContaining({
        code: 'TEST_FIRST',
        name: 'Test interest first',
        category: null
      }),
      expect.objectContaining({
        code: 'TEST_LATER',
        name: 'Test interest later',
        category: 'Test category'
      })
    ]);
    for (const item of response.body.data) {
      expect(Object.keys(item).sort()).toEqual(['category', 'code', 'id', 'name']);
    }
  });

  it('returns 200 and an empty array when the catalog has no rows', async () => {
    const response = await publicGet('/api/v1/interests');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: [],
      message: 'Interests retrieved successfully'
    });
  });
});

describe('catalog seeders', () => {
  it('seeds genders and relationship intentions idempotently and does not seed interests', async () => {
    await genderSeeder.up(queryInterface());
    await genderSeeder.up(queryInterface());
    await intentionSeeder.up(queryInterface());
    await intentionSeeder.up(queryInterface());

    const genders = await publicGet('/api/v1/genders');
    const intentions = await publicGet('/api/v1/relationship-intentions');
    const interests = await publicGet('/api/v1/interests');

    expect(genders.body.data.map((item: { code: string; name: string }) => ({ code: item.code, name: item.name }))).toEqual(
      GENDER_SEED
    );
    expect(intentions.body.data.map((item: { code: string; name: string }) => ({ code: item.code, name: item.name }))).toEqual(
      INTENTION_SEED
    );
    expect(interests.body).toEqual({
      success: true,
      data: [],
      message: 'Interests retrieved successfully'
    });
    expect(await Gender.count()).toBe(4);
    expect(await RelationshipIntention.count()).toBe(4);
    expect(await Interest.count()).toBe(0);

    await genderSeeder.down(queryInterface());
    await intentionSeeder.down(queryInterface());
    expect(await Gender.count()).toBe(0);
    expect(await RelationshipIntention.count()).toBe(0);
  });
});

describe('public catalog rate limit', () => {
  async function capturedKey(path: string): Promise<string> {
    rateLimitKeys.length = 0;
    const response = await publicGet(path);
    expect(response.status).toBe(200);
    expect(rateLimitKeys).toHaveLength(1);
    return rateLimitKeys[0];
  }

  it('uses the shared public IP limiter on every catalog route', async () => {
    const genderKey = await capturedKey('/api/v1/genders');
    resetMemoryRedis();
    const interestKey = await capturedKey('/api/v1/interests');
    resetMemoryRedis();
    const intentionKey = await capturedKey('/api/v1/relationship-intentions');

    expect(genderKey).toBe(interestKey);
    expect(genderKey).toBe(intentionKey);
    expect(genderKey.startsWith('ratelimit:public:')).toBe(true);
    expect(genderKey).not.toContain('genders');
    expect(genderKey).not.toContain('interests');
  });

  it('blocks the 101st request on the public limiter without requiring 101 HTTP calls', async () => {
    const key = await capturedKey('/api/v1/genders');
    resetMemoryRedis();
    const now = Date.now();
    for (let index = 0; index < 99; index += 1) {
      await originalEval('prefill', 1, key, now, 60_000, 100, `prefill-${index}`);
    }

    const allowed = await publicGet('/api/v1/genders');
    const blocked = await publicGet('/api/v1/interests');

    expect(allowed.status).toBe(200);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
});
