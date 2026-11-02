import { randomUUID } from 'crypto';
import { sequelize } from '../../src/config/database';
import { Plan } from '../../src/database/models/plan.model';
import { Subscription, SubscriptionStatus } from '../../src/database/models/subscription.model';
import { User } from '../../src/database/models/user.model';
import {
  expireElapsedNonterminalSubscription,
  findQualifyingPremiumSubscription,
  lockNonterminalSubscription
} from '../../src/modules/subscriptions/subscriptions.data-access';

const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$integration-test-hash';
const NOW = new Date('2026-06-15T12:00:00.000Z');
const BEFORE = new Date('2026-06-15T11:00:00.000Z');
const AFTER = new Date('2026-06-15T13:00:00.000Z');
const PERIOD_START = new Date('2026-05-15T12:00:00.000Z');
const CANCELED_AT = new Date('2026-05-01T00:00:00.000Z');
const PRIOR_ENDED_AT = new Date('2026-01-01T00:00:00.000Z');
const PROVIDER_SUBSCRIPTION_ID = 'sub_preserve';
const PROVIDER_CUSTOMER_ID = 'cust_preserve';
const NONTERMINAL_STATUSES = ['ACTIVE', 'PAST_DUE', 'GRACE_PERIOD'] as const;

type NonterminalStatus = (typeof NONTERMINAL_STATUSES)[number];

function timestamps(): { createdAt: Date; updatedAt: Date } {
  const stamped = new Date('2026-05-15T12:00:00.000Z');
  return { createdAt: stamped, updatedAt: stamped };
}

async function createUser(): Promise<User> {
  return User.create({
    email: `expire-${randomUUID()}@example.com`,
    phone: null,
    passwordHash: PASSWORD_HASH,
    role: 'USER',
    status: 'ACTIVE',
    emailVerified: false,
    phoneVerified: false
  });
}

async function createPlan(): Promise<Plan> {
  return Plan.create({
    code: 'PREMIUM_MONTHLY',
    name: 'Love Bite Premium (Monthly)',
    billingInterval: 'MONTH',
    priceInCents: 49900,
    currency: 'INR',
    isActive: true,
    displayOrder: 1,
    ...timestamps()
  });
}

async function createSubscription(input: {
  userId: string;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodEnd: Date;
  gracePeriodEnd: Date | null;
  autoRenew?: boolean;
  canceledAt?: Date | null;
  endedAt?: Date | null;
}): Promise<Subscription> {
  return Subscription.create({
    userId: input.userId,
    planId: input.planId,
    provider: 'RAZORPAY',
    providerSubscriptionId: PROVIDER_SUBSCRIPTION_ID,
    providerCustomerId: PROVIDER_CUSTOMER_ID,
    status: input.status,
    autoRenew: input.autoRenew ?? false,
    currentPeriodStart: PERIOD_START,
    currentPeriodEnd: input.currentPeriodEnd,
    gracePeriodEnd: input.gracePeriodEnd,
    canceledAt: input.canceledAt === undefined ? null : input.canceledAt,
    endedAt: input.endedAt === undefined ? null : input.endedAt,
    ...timestamps()
  });
}

async function expire(userId: string, now: Date): Promise<number> {
  return sequelize.transaction(async (transaction) => {
    await lockNonterminalSubscription(userId, transaction);
    return expireElapsedNonterminalSubscription(userId, now, transaction);
  });
}

async function expireAndQualify(userId: string, now: Date) {
  return sequelize.transaction(async (transaction) => {
    await lockNonterminalSubscription(userId, transaction);
    const expired = await expireElapsedNonterminalSubscription(userId, now, transaction);
    const qualifying = await findQualifyingPremiumSubscription(userId, transaction, now);
    return { expired, qualifying };
  });
}

function expectPreserved(row: Subscription, periodEnd: Date, gracePeriodEnd: Date | null): void {
  expect(row.provider).toBe('RAZORPAY');
  expect(row.providerSubscriptionId).toBe(PROVIDER_SUBSCRIPTION_ID);
  expect(row.providerCustomerId).toBe(PROVIDER_CUSTOMER_ID);
  expect(row.autoRenew).toBe(false);
  expect(row.canceledAt?.toISOString()).toBe(CANCELED_AT.toISOString());
  expect(row.currentPeriodStart.toISOString()).toBe(PERIOD_START.toISOString());
  expect(row.currentPeriodEnd.toISOString()).toBe(periodEnd.toISOString());
  expect(row.gracePeriodEnd?.toISOString() ?? null).toBe(gracePeriodEnd?.toISOString() ?? null);
}

describe('checkout subscription expiration', () => {
  it.each(NONTERMINAL_STATUSES)(
    'expires %s when current_period_end equals now and grace is null',
    async (status: NonterminalStatus) => {
      const user = await createUser();
      const plan = await createPlan();
      const row = await createSubscription({
        userId: user.id,
        planId: plan.id,
        status,
        currentPeriodEnd: NOW,
        gracePeriodEnd: null,
        canceledAt: CANCELED_AT
      });

      const count = await expire(user.id, NOW);
      await row.reload();

      expect(count).toBe(1);
      expect(row.status).toBe('EXPIRED');
      expect(row.endedAt?.toISOString()).toBe(NOW.toISOString());
      expectPreserved(row, NOW, null);
    }
  );

  it.each(NONTERMINAL_STATUSES)(
    'expires %s when current_period_end has passed and grace_period_end equals now',
    async (status: NonterminalStatus) => {
      const user = await createUser();
      const plan = await createPlan();
      const row = await createSubscription({
        userId: user.id,
        planId: plan.id,
        status,
        currentPeriodEnd: BEFORE,
        gracePeriodEnd: NOW,
        canceledAt: CANCELED_AT
      });

      const count = await expire(user.id, NOW);
      await row.reload();

      expect(count).toBe(1);
      expect(row.status).toBe('EXPIRED');
      expect(row.endedAt?.toISOString()).toBe(NOW.toISOString());
      expectPreserved(row, BEFORE, NOW);
    }
  );

  it.each(NONTERMINAL_STATUSES)(
    'does not expire %s when current_period_end is still ahead and grace is null',
    async (status: NonterminalStatus) => {
      const user = await createUser();
      const plan = await createPlan();
      const row = await createSubscription({
        userId: user.id,
        planId: plan.id,
        status,
        currentPeriodEnd: AFTER,
        gracePeriodEnd: null,
        canceledAt: CANCELED_AT
      });
      const before = row.toJSON();

      const count = await expire(user.id, NOW);
      await row.reload();

      expect(count).toBe(0);
      expect(row.toJSON()).toEqual(before);
    }
  );

  it.each(NONTERMINAL_STATUSES)(
    'does not expire %s when current_period_end is still ahead and grace has elapsed',
    async (status: NonterminalStatus) => {
      const user = await createUser();
      const plan = await createPlan();
      const row = await createSubscription({
        userId: user.id,
        planId: plan.id,
        status,
        currentPeriodEnd: AFTER,
        gracePeriodEnd: BEFORE,
        canceledAt: CANCELED_AT
      });
      const before = row.toJSON();

      const count = await expire(user.id, NOW);
      await row.reload();

      expect(count).toBe(0);
      expect(row.toJSON()).toEqual(before);
    }
  );

  it.each(NONTERMINAL_STATUSES)(
    'does not expire %s when current_period_end has passed and grace is still ahead',
    async (status: NonterminalStatus) => {
      const user = await createUser();
      const plan = await createPlan();
      const row = await createSubscription({
        userId: user.id,
        planId: plan.id,
        status,
        currentPeriodEnd: BEFORE,
        gracePeriodEnd: AFTER,
        canceledAt: CANCELED_AT
      });
      const before = row.toJSON();

      const count = await expire(user.id, NOW);
      await row.reload();

      expect(count).toBe(0);
      expect(row.toJSON()).toEqual(before);
    }
  );

  it('leaves an in-period canceled subscription unchanged when grace is still ahead', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const row = await createSubscription({
      userId: user.id,
      planId: plan.id,
      status: 'CANCELED',
      currentPeriodEnd: AFTER,
      gracePeriodEnd: AFTER,
      canceledAt: CANCELED_AT
    });
    const before = row.toJSON();

    const count = await expire(user.id, NOW);
    await row.reload();

    expect(count).toBe(0);
    expect(row.status).toBe('CANCELED');
    expect(row.endedAt).toBeNull();
    expect(row.toJSON()).toEqual(before);
  });

  it('leaves a lapsed canceled subscription unchanged when grace is still ahead', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const row = await createSubscription({
      userId: user.id,
      planId: plan.id,
      status: 'CANCELED',
      currentPeriodEnd: BEFORE,
      gracePeriodEnd: AFTER,
      canceledAt: CANCELED_AT
    });
    const before = row.toJSON();

    const count = await expire(user.id, NOW);
    await row.reload();

    expect(count).toBe(0);
    expect(row.status).toBe('CANCELED');
    expect(row.endedAt).toBeNull();
    expect(row.toJSON()).toEqual(before);
  });

  it('leaves an existing expired subscription unchanged', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const row = await createSubscription({
      userId: user.id,
      planId: plan.id,
      status: 'EXPIRED',
      currentPeriodEnd: BEFORE,
      gracePeriodEnd: null,
      canceledAt: CANCELED_AT,
      endedAt: PRIOR_ENDED_AT
    });
    const before = row.toJSON();

    const count = await expire(user.id, NOW);
    await row.reload();

    expect(count).toBe(0);
    expect(row.toJSON()).toEqual(before);
    expect(row.endedAt?.toISOString()).toBe(PRIOR_ENDED_AT.toISOString());
  });

  it('does not move ended_at when expiration is attempted again', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const row = await createSubscription({
      userId: user.id,
      planId: plan.id,
      status: 'ACTIVE',
      currentPeriodEnd: NOW,
      gracePeriodEnd: null,
      canceledAt: CANCELED_AT
    });

    expect(await expire(user.id, NOW)).toBe(1);
    const later = new Date('2026-06-16T12:00:00.000Z');
    expect(await expire(user.id, later)).toBe(0);
    await row.reload();

    expect(row.status).toBe('EXPIRED');
    expect(row.endedAt?.toISOString()).toBe(NOW.toISOString());
    expectPreserved(row, NOW, null);
  });

  it.each(NONTERMINAL_STATUSES)(
    'uses one explicit now for expiration and Premium eligibility of %s',
    async (status: NonterminalStatus) => {
      const elapsedUser = await createUser();
      const currentUser = await createUser();
      const graceUser = await createUser();
      const plan = await createPlan();
      const elapsed = await createSubscription({
        userId: elapsedUser.id,
        planId: plan.id,
        status,
        currentPeriodEnd: NOW,
        gracePeriodEnd: null,
        canceledAt: CANCELED_AT
      });
      const current = await createSubscription({
        userId: currentUser.id,
        planId: plan.id,
        status,
        currentPeriodEnd: AFTER,
        gracePeriodEnd: null,
        canceledAt: CANCELED_AT
      });
      const grace = await createSubscription({
        userId: graceUser.id,
        planId: plan.id,
        status,
        currentPeriodEnd: BEFORE,
        gracePeriodEnd: AFTER,
        canceledAt: CANCELED_AT
      });

      const elapsedDecision = await expireAndQualify(elapsedUser.id, NOW);
      const currentDecision = await expireAndQualify(currentUser.id, NOW);
      const graceDecision = await expireAndQualify(graceUser.id, NOW);
      await elapsed.reload();
      await current.reload();
      await grace.reload();

      expect(elapsedDecision.expired).toBe(1);
      expect(elapsedDecision.qualifying).toBeNull();
      expect(elapsed.status).toBe('EXPIRED');
      expect(elapsed.endedAt?.toISOString()).toBe(NOW.toISOString());
      expect(currentDecision.expired).toBe(0);
      expect(currentDecision.qualifying?.status).toBe(status);
      expect(currentDecision.qualifying?.currentPeriodEnd.toISOString()).toBe(AFTER.toISOString());
      expect(current.status).toBe(status);
      expect(graceDecision.expired).toBe(0);
      expect(graceDecision.qualifying?.status).toBe(status);
      expect(graceDecision.qualifying?.gracePeriodEnd?.toISOString()).toBe(AFTER.toISOString());
      expect(grace.status).toBe(status);
      expect(grace.endedAt).toBeNull();
    }
  );

  it('keeps the default clock when eligibility is called without now', async () => {
    const user = await createUser();
    const plan = await createPlan();
    await createSubscription({
      userId: user.id,
      planId: plan.id,
      status: 'ACTIVE',
      currentPeriodEnd: new Date(Date.now() + 60 * 60 * 1000),
      gracePeriodEnd: null
    });

    const qualifying = await sequelize.transaction((transaction) =>
      findQualifyingPremiumSubscription(user.id, transaction)
    );

    expect(qualifying?.status).toBe('ACTIVE');
  });

  it('does not overwrite a locked row that was changed to CANCELED before the conditional update', async () => {
    const user = await createUser();
    const plan = await createPlan();
    const row = await createSubscription({
      userId: user.id,
      planId: plan.id,
      status: 'ACTIVE',
      currentPeriodEnd: BEFORE,
      gracePeriodEnd: null,
      autoRenew: true
    });

    const count = await sequelize.transaction(async (transaction) => {
      const locked = await lockNonterminalSubscription(user.id, transaction);
      expect(locked?.id).toBe(row.id);
      await Subscription.update(
        { status: 'CANCELED', autoRenew: false, canceledAt: CANCELED_AT },
        { where: { id: row.id }, transaction }
      );
      return expireElapsedNonterminalSubscription(user.id, NOW, transaction);
    });
    await row.reload();

    expect(count).toBe(0);
    expect(row.status).toBe('CANCELED');
    expect(row.autoRenew).toBe(false);
    expect(row.canceledAt?.toISOString()).toBe(CANCELED_AT.toISOString());
    expect(row.endedAt).toBeNull();
    expect(row.providerSubscriptionId).toBe(PROVIDER_SUBSCRIPTION_ID);
  });

  it('repeats the nonterminal status and date conditions in the expiration update', async () => {
    const user = await createUser();
    const plan = await createPlan();
    await createSubscription({
      userId: user.id,
      planId: plan.id,
      status: 'ACTIVE',
      currentPeriodEnd: NOW,
      gracePeriodEnd: null
    });
    const previous = sequelize.options.logging;
    const statements: string[] = [];
    sequelize.options.logging = (message: string) => {
      statements.push(message);
    };

    try {
      expect(await expire(user.id, NOW)).toBe(1);
    } finally {
      sequelize.options.logging = previous;
    }

    const update = statements.find((statement) => statement.includes('UPDATE "subscriptions"'));
    expect(update).toEqual(expect.stringContaining('SET "status"'));
    expect(update).toEqual(expect.stringContaining('"ended_at"'));
    expect(update).toEqual(expect.stringContaining('"status" IN (\'ACTIVE\', \'PAST_DUE\', \'GRACE_PERIOD\')'));
    expect(update).toEqual(expect.stringContaining('"current_period_end" <='));
    expect(update).toEqual(expect.stringContaining('"grace_period_end" IS NULL'));
    expect(update).toEqual(expect.stringContaining('"grace_period_end" <='));
    expect(update).toEqual(expect.stringContaining('"user_id"'));
    expect(update).not.toMatch(/WHERE "id" =/);
  });

  it('removes an expired row from the single-active unique index', async () => {
    const user = await createUser();
    const other = await createUser();
    const plan = await createPlan();
    const row = await createSubscription({
      userId: user.id,
      planId: plan.id,
      status: 'PAST_DUE',
      currentPeriodEnd: BEFORE,
      gracePeriodEnd: null,
      canceledAt: CANCELED_AT
    });
    const untouched = await createSubscription({
      userId: other.id,
      planId: plan.id,
      status: 'GRACE_PERIOD',
      currentPeriodEnd: AFTER,
      gracePeriodEnd: null,
      canceledAt: CANCELED_AT
    });
    const untouchedBefore = untouched.toJSON();

    expect(await expire(user.id, NOW)).toBe(1);
    const replacement = await createSubscription({
      userId: user.id,
      planId: plan.id,
      status: 'ACTIVE',
      currentPeriodEnd: AFTER,
      gracePeriodEnd: null
    });
    await row.reload();
    await untouched.reload();

    expect(row.status).toBe('EXPIRED');
    expect(replacement.status).toBe('ACTIVE');
    expect(untouched.toJSON()).toEqual(untouchedBefore);
    const [covered] = await sequelize.query(
      `SELECT id
       FROM subscriptions
       WHERE user_id = :userId
         AND status IN ('ACTIVE', 'PAST_DUE', 'GRACE_PERIOD')`,
      { replacements: { userId: user.id } }
    );
    expect(covered).toEqual([expect.objectContaining({ id: replacement.id })]);
  });
});
