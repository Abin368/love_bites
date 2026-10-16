import { randomUUID } from 'crypto';
import request from 'supertest';
import { Feature } from '../../src/database/models/feature.model';
import { Plan } from '../../src/database/models/plan.model';
import { PlanFeature } from '../../src/database/models/plan-feature.model';
import { Subscription } from '../../src/database/models/subscription.model';
import { UsageLimit } from '../../src/database/models/usage-limit.model';
import { User, UserRole } from '../../src/database/models/user.model';
import { signAccessToken } from '../../src/utils/jwt';
import { redis, resetMemoryRedis } from '../../src/config/redis';

jest.mock('../../src/config/redis', () => jest.requireActual('../helpers/memory-redis'));

import { app } from '../../src/app';
import { ensurePlanCatalog } from './plan-catalog.fixture';

const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';
const PLAN_FIELDS = ['billingInterval', 'code', 'currency', 'id', 'name', 'priceInCents'];
const SEEDED_PLANS = [
  {
    code: 'FREE',
    name: 'Free Tier',
    priceInCents: 0,
    currency: 'INR',
    billingInterval: 'NONE'
  },
  {
    code: 'PREMIUM_MONTHLY',
    name: 'Love Bite Premium (Monthly)',
    priceInCents: 49900,
    currency: 'INR',
    billingInterval: 'MONTH'
  },
  {
    code: 'PREMIUM_YEARLY',
    name: 'Love Bite Premium (Yearly)',
    priceInCents: 399900,
    currency: 'INR',
    billingInterval: 'YEAR'
  }
];

const rateLimitKeys: string[] = [];
const originalEval = redis.eval.bind(redis);

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

function publicGet() {
  return request(app).get('/api/v1/subscriptions/plans');
}

function tokenFor(userId: string, role: UserRole, isVerified: boolean): string {
  return signAccessToken({
    sub: userId,
    role,
    isVerified,
    isProfileComplete: false
  });
}

async function createUser(input: { role?: UserRole; emailVerified?: boolean; status?: 'UNVERIFIED' | 'ACTIVE' } = {}): Promise<User> {
  return User.create({
    email: `plans-${randomUUID()}@example.com`,
    phone: null,
    passwordHash: PASSWORD_HASH,
    role: input.role ?? 'USER',
    status: input.status ?? 'ACTIVE',
    emailVerified: input.emailVerified ?? true,
    phoneVerified: false
  });
}

function catalogShape(body: { data: Array<Record<string, unknown>> }) {
  return body.data.map(({ id: _id, ...plan }) => plan);
}

async function catalogFingerprint(): Promise<string> {
  const [plans, features, planFeatures, usageLimits, subscriptions] = await Promise.all([
    Plan.findAll({ order: [['id', 'ASC']] }),
    Feature.findAll({ order: [['id', 'ASC']] }),
    PlanFeature.findAll({ order: [['id', 'ASC']] }),
    UsageLimit.findAll({ order: [['id', 'ASC']] }),
    Subscription.findAll({ order: [['id', 'ASC']] })
  ]);

  return JSON.stringify({
    plans: plans.map((row) => row.get({ plain: true })),
    features: features.map((row) => row.get({ plain: true })),
    planFeatures: planFeatures.map((row) => row.get({ plain: true })),
    usageLimits: usageLimits.map((row) => row.get({ plain: true })),
    subscriptions: subscriptions.map((row) => row.get({ plain: true }))
  });
}

describe('GET /api/v1/subscriptions/plans', () => {
  it('returns active plans in display order without authentication', async () => {
    await Plan.create({ code: 'ORDER_LATER', name: 'Later', priceInCents: 100, currency: 'INR', billingInterval: 'MONTH', isActive: true, displayOrder: 30, ...timestamps() });
    await Plan.create({ code: 'ORDER_HIDDEN', name: 'Hidden', priceInCents: 50, currency: 'INR', billingInterval: 'YEAR', isActive: false, displayOrder: 1, ...timestamps() });
    await Plan.create({ code: 'ORDER_FIRST', name: 'First', priceInCents: 0, currency: 'INR', billingInterval: 'NONE', isActive: true, displayOrder: 10, ...timestamps() });

    const response = await publicGet();

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Plans retrieved successfully.');
    expect(response.body.data.map((item: { code: string }) => item.code)).toEqual(['ORDER_FIRST', 'ORDER_LATER']);
    expect(response.body.data.map((item: { code: string }) => item.code)).not.toContain('ORDER_HIDDEN');
  });

  it('returns the seeded prices and billing intervals and only the six public fields', async () => {
    await ensurePlanCatalog();
    await Plan.create({
      code: 'INACTIVE_EXTRA',
      name: 'Inactive extra',
      priceInCents: 1,
      currency: 'INR',
      billingInterval: 'MONTH',
      isActive: false,
      displayOrder: 0,
      ...timestamps()
    });

    const response = await publicGet();

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      message: 'Plans retrieved successfully.'
    });
    expect(catalogShape(response.body)).toEqual(SEEDED_PLANS);
    expect(response.body.data).toHaveLength(3);
    for (const item of response.body.data) {
      expect(Object.keys(item).sort()).toEqual(PLAN_FIELDS);
      expect(item.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(typeof item.priceInCents).toBe('number');
    }
  });

  it('returns an empty array when no active plans exist', async () => {
    await Plan.create({
      code: 'ONLY_INACTIVE',
      name: 'Only inactive',
      priceInCents: 10,
      currency: 'INR',
      billingInterval: 'MONTH',
      isActive: false,
      displayOrder: 1,
      ...timestamps()
    });

    const response = await publicGet();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: [],
      message: 'Plans retrieved successfully.'
    });
  });

  it('returns the same public list for an unverified USER token and an ADMIN token', async () => {
    await ensurePlanCatalog();
    const unverified = await createUser({ emailVerified: false, status: 'UNVERIFIED' });
    const admin = await createUser({ role: 'ADMIN' });

    const anonymous = await publicGet();
    const unverifiedResponse = await request(app)
      .get('/api/v1/subscriptions/plans')
      .set('Authorization', `Bearer ${tokenFor(unverified.id, 'USER', false)}`);
    const adminResponse = await request(app)
      .get('/api/v1/subscriptions/plans')
      .set('Authorization', `Bearer ${tokenFor(admin.id, 'ADMIN', true)}`);

    expect(anonymous.status).toBe(200);
    expect(unverifiedResponse.status).toBe(200);
    expect(adminResponse.status).toBe(200);
    expect(unverifiedResponse.body).toEqual(anonymous.body);
    expect(adminResponse.body).toEqual(anonymous.body);
  });

  it('does not write plans, features, plan features, usage limits, or subscriptions', async () => {
    await ensurePlanCatalog();
    const before = await catalogFingerprint();

    const first = await publicGet();
    const second = await publicGet();
    const after = await catalogFingerprint();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(after).toBe(before);
    expect(await PlanFeature.count()).toBe(0);
    expect(await Subscription.count()).toBe(0);
  });
});

describe('subscription plans public rate limit', () => {
  async function capturedKey(path: string): Promise<string> {
    rateLimitKeys.length = 0;
    const response = await request(app).get(path);
    expect(response.status).toBe(200);
    expect(rateLimitKeys).toHaveLength(1);
    return rateLimitKeys[0];
  }

  it('uses the shared public limiter and blocks the 101st request', async () => {
    const plansKey = await capturedKey('/api/v1/subscriptions/plans');
    resetMemoryRedis();
    const genderKey = await capturedKey('/api/v1/genders');

    expect(plansKey).toBe(genderKey);
    expect(plansKey.startsWith('ratelimit:public:')).toBe(true);

    resetMemoryRedis();
    const now = Date.now();
    for (let index = 0; index < 99; index += 1) {
      await originalEval('prefill', 1, plansKey, now, 60_000, 100, `prefill-${index}`);
    }

    const allowed = await publicGet();
    const blocked = await publicGet();

    expect(allowed.status).toBe(200);
    expect(blocked.status).toBe(429);
    expect(blocked.body.success).toBe(false);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.body.error.message).toBe('Too many requests. Please try again later.');
  });
});
