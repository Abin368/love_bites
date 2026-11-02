import { randomUUID } from 'crypto';
import request from 'supertest';
import { sequelize } from '../../src/config/database';
import { Payment } from '../../src/database/models/payment.model';
import { Plan } from '../../src/database/models/plan.model';
import { PlanPriceChange } from '../../src/database/models/plan-price-change.model';
import { Subscription } from '../../src/database/models/subscription.model';
import { User, UserRole } from '../../src/database/models/user.model';
import { signAccessToken } from '../../src/utils/jwt';

jest.mock('../../src/config/redis', () => jest.requireActual('../helpers/memory-redis'));

import { app } from '../../src/app';

const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';

function timestamps(): { createdAt: Date; updatedAt: Date } {
  const now = new Date();
  return { createdAt: now, updatedAt: now };
}

function tokenFor(userId: string, role: UserRole): string {
  return signAccessToken({
    sub: userId,
    role,
    isVerified: true,
    isProfileComplete: false
  });
}

async function createUser(role: UserRole): Promise<User> {
  return User.create({
    email: `plan-price-${randomUUID()}@example.com`,
    phone: null,
    passwordHash: PASSWORD_HASH,
    role,
    status: 'ACTIVE',
    emailVerified: true,
    phoneVerified: false
  });
}

async function createPlan(input: {
  code: string;
  priceInCents: number;
  currency?: string;
  isActive?: boolean;
  displayOrder?: number;
}): Promise<Plan> {
  return Plan.create({
    code: input.code,
    name: input.code,
    billingInterval: input.code === 'FREE' ? 'NONE' : input.code === 'PREMIUM_YEARLY' ? 'YEAR' : 'MONTH',
    priceInCents: input.priceInCents,
    currency: input.currency ?? 'INR',
    isActive: input.isActive ?? true,
    displayOrder: input.displayOrder ?? 1,
    ...timestamps()
  });
}

function patch(planId: string, token?: string) {
  const call = request(app).patch(`/api/v1/admin/config/plans/${planId}`);
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
}

describe('PATCH /api/v1/admin/config/plans/:planId', () => {
  it('rejects a missing token, an invalid token, and a USER token', async () => {
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    const user = await createUser('USER');

    const missing = await patch(plan.id).send({ priceInCents: 100, reason: 'Change' });
    const invalid = await patch(plan.id)
      .set('Authorization', 'Bearer not-a-token')
      .send({ priceInCents: 100, reason: 'Change' });
    const forbidden = await patch(plan.id, tokenFor(user.id, 'USER')).send({ priceInCents: 100, reason: 'Change' });

    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('AUTH_REQUIRED');
    expect(invalid.status).toBe(401);
    expect(invalid.body.error.code).toBe('INVALID_TOKEN');
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
    expect(await PlanPriceChange.count()).toBe(0);
    await plan.reload();
    expect(plan.priceInCents).toBe(49900);
  });

  it('rejects a malformed plan id, an unknown plan, query parameters, and unknown fields', async () => {
    const admin = await createUser('ADMIN');
    const token = tokenFor(admin.id, 'ADMIN');

    const malformed = await patch('not-a-uuid', token).send({ priceInCents: 100, reason: 'Change' });
    const missing = await patch(randomUUID(), token).send({ priceInCents: 100, reason: 'Change' });
    const query = await patch(randomUUID(), token).query({ userId: admin.id }).send({ priceInCents: 100, reason: 'Change' });
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    const unknown = await patch(plan.id, token).send({ priceInCents: 100, reason: 'Change', name: 'Renamed' });

    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
    expect(malformed.body.error.details).toEqual([{ field: 'planId', message: 'Plan id must be a valid UUID.' }]);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(missing.body.error.message).toBe('Resource not found');
    expect(query.status).toBe(400);
    expect(query.body.error.code).toBe('VALIDATION_ERROR');
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.details.some((detail: { code?: string }) => detail.code === 'unrecognized_keys')).toBe(true);
    expect(await PlanPriceChange.count()).toBe(0);
    await plan.reload();
    expect(plan.priceInCents).toBe(49900);
    expect(plan.name).toBe('PREMIUM_MONTHLY');
  });

  it('rejects a missing, blank, or non-pricing body and invalid price or currency values', async () => {
    const admin = await createUser('ADMIN');
    const token = tokenFor(admin.id, 'ADMIN');
    const premium = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    const legacy = await createPlan({ code: 'PREMIUM_YEARLY', priceInCents: 399900, currency: 'USD' });
    const beforePremium = premium.updatedAt.toISOString();
    const beforeLegacy = legacy.updatedAt.toISOString();

    const cases = [
      { planId: premium.id, body: { priceInCents: 100 } },
      { planId: premium.id, body: { priceInCents: 100, reason: '   ' } },
      { planId: premium.id, body: { reason: 'Because' } },
      { planId: premium.id, body: { priceInCents: -1, reason: 'Because' } },
      { planId: premium.id, body: { priceInCents: 10.5, reason: 'Because' } },
      { planId: premium.id, body: { priceInCents: '100', reason: 'Because' } },
      { planId: premium.id, body: { priceInCents: null, reason: 'Because' } },
      { planId: premium.id, body: { priceInCents: 2_147_483_648, reason: 'Because' } },
      { planId: premium.id, body: { currency: 'USD', reason: 'Because' } },
      { planId: premium.id, body: { currency: 'inr', reason: 'Because' } },
      { planId: premium.id, body: { priceInCents: 0, reason: 'Because' } },
      { planId: legacy.id, body: { priceInCents: 1000, reason: 'Because' } }
    ];

    for (const item of cases) {
      const response = await patch(item.planId, token).send(item.body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }

    expect(await PlanPriceChange.count()).toBe(0);
    await premium.reload();
    await legacy.reload();
    expect(premium.priceInCents).toBe(49900);
    expect(premium.currency).toBe('INR');
    expect(premium.updatedAt.toISOString()).toBe(beforePremium);
    expect(legacy.priceInCents).toBe(399900);
    expect(legacy.currency).toBe('USD');
    expect(legacy.updatedAt.toISOString()).toBe(beforeLegacy);
  });

  it('updates price, corrects currency to INR, and records the audit without touching subscriptions or payments', async () => {
    const admin = await createUser('ADMIN');
    const subscriber = await createUser('USER');
    const token = tokenFor(admin.id, 'ADMIN');
    const monthly = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900, displayOrder: 2 });
    const yearly = await createPlan({ code: 'PREMIUM_YEARLY', priceInCents: 1200, currency: 'USD', displayOrder: 3 });
    const free = await createPlan({ code: 'FREE', priceInCents: 50, isActive: false, displayOrder: 1 });
    const subscription = await Subscription.create({
      userId: subscriber.id,
      planId: monthly.id,
      currentPeriodStart: new Date('2026-10-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-11-01T00:00:00.000Z'),
      ...timestamps()
    });
    const payment = await Payment.create({
      userId: subscriber.id,
      subscriptionId: subscription.id,
      amountInCents: 49900,
      currency: 'INR',
      paymentType: 'SUBSCRIPTION_INITIAL',
      ...timestamps()
    });
    const subscriptionBefore = subscription.get({ plain: true });
    const paymentBefore = payment.get({ plain: true });

    const priceOnly = await patch(monthly.id, token).send({ priceInCents: 59900, reason: '  Monthly launch  ' });
    const currencyOnly = await patch(yearly.id, token).send({ currency: 'INR', reason: 'Correct to INR' });
    const combined = await patch(yearly.id, token).send({
      priceInCents: 250000,
      currency: 'INR',
      reason: 'Yearly launch'
    });
    const freeZero = await patch(free.id, token).send({ priceInCents: 0, reason: 'Free stays free' });
    const catalog = await request(app).get('/api/v1/subscriptions/plans');

    expect(priceOnly.status).toBe(200);
    expect(priceOnly.body).toMatchObject({
      success: true,
      message: 'Plan price updated.',
      data: {
        id: monthly.id,
        code: 'PREMIUM_MONTHLY',
        priceInCents: 59900,
        currency: 'INR',
        isActive: true
      }
    });
    expect(currencyOnly.body.data).toMatchObject({ priceInCents: 1200, currency: 'INR' });
    expect(combined.body.data).toMatchObject({ priceInCents: 250000, currency: 'INR' });
    expect(freeZero.status).toBe(200);
    expect(freeZero.body.data).toMatchObject({ priceInCents: 0, currency: 'INR', isActive: false });
    expect(catalog.status).toBe(200);
    expect(catalog.body.data.map((item: { code: string }) => item.code)).toEqual(['PREMIUM_MONTHLY', 'PREMIUM_YEARLY']);
    expect(catalog.body.data.find((item: { code: string }) => item.code === 'PREMIUM_MONTHLY').priceInCents).toBe(59900);

    const audits = await PlanPriceChange.findAll({ order: [['createdAt', 'ASC'], ['id', 'ASC']] });
    expect(audits).toHaveLength(4);
    const monthlyAudit = audits.find((row) => row.planId === monthly.id);
    expect(monthlyAudit).toMatchObject({
      adminUserId: admin.id,
      planId: monthly.id,
      oldPriceInCents: 49900,
      newPriceInCents: 59900,
      oldCurrency: 'INR',
      newCurrency: 'INR',
      action: 'PLAN_PRICE_CHANGED',
      reason: 'Monthly launch'
    });
    expect(monthlyAudit?.createdAt).toBeInstanceOf(Date);
    expect(audits.find((row) => row.planId === yearly.id && row.oldCurrency === 'USD')).toMatchObject({
      oldPriceInCents: 1200,
      newPriceInCents: 1200,
      newCurrency: 'INR',
      reason: 'Correct to INR'
    });
    expect(audits.filter((row) => row.planId === free.id)).toHaveLength(1);

    await free.reload();
    expect(free.isActive).toBe(false);
    await subscription.reload();
    await payment.reload();
    expect(subscription.get({ plain: true })).toEqual(subscriptionBefore);
    expect(payment.get({ plain: true })).toEqual(paymentBefore);
  });

  it('returns the current price when nothing changed and does not write an audit or updated_at', async () => {
    const admin = await createUser('ADMIN');
    const token = tokenFor(admin.id, 'ADMIN');
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    const before = plan.updatedAt.toISOString();

    const samePrice = await patch(plan.id, token).send({ priceInCents: 49900, reason: 'No change' });
    const sameCurrency = await patch(plan.id, token).send({ currency: 'INR', reason: 'Already INR' });

    expect(samePrice.status).toBe(200);
    expect(samePrice.body.message).toBe('Plan price is unchanged.');
    expect(samePrice.body.data.updatedAt).toBe(before);
    expect(sameCurrency.status).toBe(200);
    expect(sameCurrency.body.message).toBe('Plan price is unchanged.');
    expect(await PlanPriceChange.count()).toBe(0);
    await plan.reload();
    expect(plan.priceInCents).toBe(49900);
    expect(plan.currency).toBe('INR');
    expect(plan.updatedAt.toISOString()).toBe(before);
  });

  it('rolls back the plan update when the audit insert fails', async () => {
    const admin = await createUser('ADMIN');
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    await sequelize.query('DROP TRIGGER IF EXISTS trg_fail_plan_price_audit ON plan_price_changes');
    await sequelize.query('DROP FUNCTION IF EXISTS fail_plan_price_audit()');
    await sequelize.query(`
      CREATE OR REPLACE FUNCTION fail_plan_price_audit()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'audit insert failed';
      END;
      $$;
    `);
    await sequelize.query(`
      CREATE TRIGGER trg_fail_plan_price_audit
      BEFORE INSERT ON plan_price_changes
      FOR EACH ROW
      EXECUTE FUNCTION fail_plan_price_audit();
    `);

    try {
      const response = await patch(plan.id, tokenFor(admin.id, 'ADMIN')).send({
        priceInCents: 100,
        reason: 'Should roll back'
      });
      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(await PlanPriceChange.count()).toBe(0);
      await plan.reload();
      expect(plan.priceInCents).toBe(49900);
    } finally {
      await sequelize.query('DROP TRIGGER IF EXISTS trg_fail_plan_price_audit ON plan_price_changes');
      await sequelize.query('DROP FUNCTION IF EXISTS fail_plan_price_audit()');
    }
  });

  it('keeps concurrent price changes consistent with their audit rows', async () => {
    const admin = await createUser('ADMIN');
    const token = tokenFor(admin.id, 'ADMIN');
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 1000 });

    const [first, second] = await Promise.all([
      patch(plan.id, token).send({ priceInCents: 2000, reason: 'Set 2000' }),
      patch(plan.id, token).send({ priceInCents: 3000, reason: 'Set 3000' })
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await plan.reload();
    const audits = await PlanPriceChange.findAll();
    expect(audits).toHaveLength(2);
    expect(audits.filter((row) => row.oldPriceInCents === 1000)).toHaveLength(1);
    const committed = audits.find((row) => row.newPriceInCents === plan.priceInCents);
    const previous = audits.find((row) => row.newPriceInCents === committed?.oldPriceInCents);
    expect(committed?.planId).toBe(plan.id);
    expect(committed?.adminUserId).toBe(admin.id);
    expect(previous?.oldPriceInCents).toBe(1000);
    expect(previous?.newPriceInCents).toBe(committed?.oldPriceInCents);
    expect([2000, 3000]).toContain(plan.priceInCents);
  });

  it('keeps the audit row when the admin is hard-deleted and blocks plan deletion', async () => {
    const admin = await createUser('ADMIN');
    const plan = await createPlan({ code: 'PREMIUM_MONTHLY', priceInCents: 49900 });
    const updated = await patch(plan.id, tokenFor(admin.id, 'ADMIN')).send({
      priceInCents: 51000,
      reason: 'Retain this history'
    });
    expect(updated.status).toBe(200);

    await User.destroy({ where: { id: admin.id }, force: true });
    const audit = await PlanPriceChange.findOne({ where: { planId: plan.id } });
    expect(audit?.adminUserId).toBeNull();
    expect(audit?.newPriceInCents).toBe(51000);
    expect(audit?.reason).toBe('Retain this history');

    const deletion = await Plan.destroy({ where: { id: plan.id } }).then(
      () => null,
      (error: { parent?: { code?: string; constraint?: string } }) => error
    );
    expect(deletion?.parent?.code).toBe('23001');
    expect(deletion?.parent?.constraint).toBe('fk_plan_price_changes_plan');
    expect(await Plan.count({ where: { id: plan.id } })).toBe(1);
    expect(await PlanPriceChange.count({ where: { planId: plan.id } })).toBe(1);
  });
});
