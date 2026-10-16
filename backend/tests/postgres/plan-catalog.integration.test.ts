import { Op, QueryInterface } from 'sequelize';
import { sequelize } from '../../src/config/database';
import { Feature } from '../../src/database/models/feature.model';
import { Plan } from '../../src/database/models/plan.model';
import { PlanFeature } from '../../src/database/models/plan-feature.model';
import { Subscription } from '../../src/database/models/subscription.model';
import { UsageLimit } from '../../src/database/models/usage-limit.model';
import { UsageRecord } from '../../src/database/models/usage-record.model';
import { UserCreditBalance } from '../../src/database/models/user-credit-balance.model';

interface Seeder {
  up: (queryInterface: QueryInterface) => Promise<void>;
  down: (queryInterface: QueryInterface) => Promise<void>;
}

const planCatalogSeeder = require('../../src/database/seeders/20261015120003-seed-plan-catalog') as Seeder;

const PLAN_SEED = [
  {
    code: 'FREE',
    name: 'Free Tier',
    billingInterval: 'NONE',
    priceInCents: 0,
    currency: 'INR',
    isActive: true,
    displayOrder: 1
  },
  {
    code: 'PREMIUM_MONTHLY',
    name: 'Love Bite Premium (Monthly)',
    billingInterval: 'MONTH',
    priceInCents: 49900,
    currency: 'INR',
    isActive: true,
    displayOrder: 2
  },
  {
    code: 'PREMIUM_YEARLY',
    name: 'Love Bite Premium (Yearly)',
    billingInterval: 'YEAR',
    priceInCents: 399900,
    currency: 'INR',
    isActive: true,
    displayOrder: 3
  }
];

const FEATURE_SEED = [
  {
    code: 'UNLIMITED_SWIPES',
    name: 'Unlimited Swipes',
    description: 'Unlimited daily Likes and Passes',
    isActive: true
  },
  {
    code: 'SEE_WHO_LIKED_YOU',
    name: 'See Who Liked You',
    description: 'Unlock admirer profiles in Who Liked You',
    isActive: true
  },
  {
    code: 'ADVANCED_FILTERS',
    name: 'Advanced Filters',
    description: 'Filter by education, occupation, and lifestyle',
    isActive: true
  },
  {
    code: 'UNDO_ACTION',
    name: 'Undo Last Action',
    description: 'Rewind accidental Left and Right swipes',
    isActive: true
  },
  {
    code: 'CHAT_MEDIA',
    name: 'Rich Media Chat',
    description: 'Send images, audio notes, GIFs, and videos',
    isActive: true
  },
  {
    code: 'AD_FREE',
    name: 'Ad-Free Experience',
    description: 'Zero third-party advertisements in app',
    isActive: true
  },
  {
    code: 'PRIORITY_VISIBILITY',
    name: 'Priority Profile Visibility',
    description: 'Elevated ranking in regional discovery queues',
    isActive: true
  },
  {
    code: 'MONTHLY_BOOST',
    name: 'Monthly Boost Credits',
    description: 'Monthly allocation of profile Boost sessions',
    isActive: true
  },
  {
    code: 'MONTHLY_SUPER_LIKE',
    name: 'Monthly Super Likes',
    description: 'Monthly allocation of Super Likes',
    isActive: true
  }
];

const LIMIT_SEED = [
  { planCode: 'FREE', metricKey: 'DAILY_LIKE_PASS', limitValue: 10, periodType: 'DAILY' },
  { planCode: 'FREE', metricKey: 'DAILY_TEXT_MESSAGES', limitValue: 20, periodType: 'DAILY' },
  { planCode: 'PREMIUM_MONTHLY', metricKey: 'DAILY_LIKE_PASS', limitValue: -1, periodType: 'DAILY' },
  { planCode: 'PREMIUM_MONTHLY', metricKey: 'DAILY_TEXT_MESSAGES', limitValue: -1, periodType: 'DAILY' },
  { planCode: 'PREMIUM_YEARLY', metricKey: 'DAILY_LIKE_PASS', limitValue: -1, periodType: 'DAILY' },
  { planCode: 'PREMIUM_YEARLY', metricKey: 'DAILY_TEXT_MESSAGES', limitValue: -1, periodType: 'DAILY' }
];

const SEEDED_PLAN_CODES = PLAN_SEED.map((plan) => plan.code);
const SEEDED_FEATURE_CODES = FEATURE_SEED.map((feature) => feature.code);
const MONTHLY_METRIC_KEYS = ['MONTHLY_SUPER_LIKES', 'MONTHLY_BOOST_CREDITS'];

function queryInterface(): QueryInterface {
  return sequelize.getQueryInterface();
}

function timestamps(): { createdAt: Date; updatedAt: Date } {
  const now = new Date();
  return { createdAt: now, updatedAt: now };
}

function planFields(plan: {
  code: string;
  name: string;
  billingInterval: string;
  priceInCents: number;
  currency: string;
  isActive: boolean;
  displayOrder: number;
}) {
  return {
    code: plan.code,
    name: plan.name,
    billingInterval: plan.billingInterval,
    priceInCents: plan.priceInCents,
    currency: plan.currency,
    isActive: plan.isActive,
    displayOrder: plan.displayOrder
  };
}

function featureFields(feature: { code: string; name: string; description: string | null; isActive: boolean }) {
  return {
    code: feature.code,
    name: feature.name,
    description: feature.description,
    isActive: feature.isActive
  };
}

function limitFields(limit: { planCode: string | null; metricKey: string; limitValue: number; periodType: string }) {
  return {
    planCode: limit.planCode,
    metricKey: limit.metricKey,
    limitValue: limit.limitValue,
    periodType: limit.periodType
  };
}

async function planRows() {
  const plans = await Plan.findAll({ order: [['displayOrder', 'ASC'], ['code', 'ASC']] });
  return plans.map((plan) => ({
    id: plan.id,
    code: plan.code,
    name: plan.name,
    billingInterval: plan.billingInterval,
    priceInCents: plan.priceInCents,
    currency: plan.currency,
    isActive: plan.isActive,
    displayOrder: plan.displayOrder
  }));
}

async function featureRows() {
  const features = await Feature.findAll({ order: [['code', 'ASC']] });
  return features.map((feature) => ({
    id: feature.id,
    code: feature.code,
    name: feature.name,
    description: feature.description,
    isActive: feature.isActive
  }));
}

async function limitRows() {
  const plans = await Plan.findAll({ attributes: ['id', 'code'] });
  const codeById = new Map(plans.map((plan) => [plan.id, plan.code]));
  const limits = await UsageLimit.findAll({ order: [['metricKey', 'ASC']] });
  return limits
    .map((limit) => ({
      id: limit.id,
      planCode: codeById.get(limit.planId) ?? null,
      metricKey: limit.metricKey,
      limitValue: limit.limitValue,
      periodType: limit.periodType
    }))
    .sort((left, right) =>
      `${left.planCode}:${left.metricKey}`.localeCompare(`${right.planCode}:${right.metricKey}`)
    );
}

describe('plan catalog seeder', () => {
  it('starts from an empty catalog and seeds plans, features, and daily limits idempotently', async () => {
    expect(await Plan.count()).toBe(0);
    expect(await Feature.count()).toBe(0);
    expect(await UsageLimit.count()).toBe(0);
    expect(await PlanFeature.count()).toBe(0);

    await planCatalogSeeder.up(queryInterface());
    const firstPlans = await planRows();
    const firstFeatures = await featureRows();
    const firstLimits = await limitRows();

    await Plan.update({ name: 'Changed', priceInCents: 1, isActive: false }, { where: { code: 'FREE' } });
    await Feature.update(
      { name: 'Changed', description: 'Changed', isActive: false },
      { where: { code: 'UNDO_ACTION' } }
    );
    await UsageLimit.update({ limitValue: 99, periodType: 'LIFETIME' }, { where: {} });

    await planCatalogSeeder.up(queryInterface());

    const plans = await planRows();
    const features = await featureRows();
    const limits = await limitRows();

    expect(plans.map((plan) => plan.id)).toEqual(firstPlans.map((plan) => plan.id));
    expect(features.map((feature) => feature.id)).toEqual(firstFeatures.map((feature) => feature.id));
    expect(limits.map((limit) => limit.id)).toEqual(firstLimits.map((limit) => limit.id));
    expect(plans.map((plan) => planFields(plan))).toEqual(PLAN_SEED);
    expect(features.map((feature) => featureFields(feature))).toEqual(
      [...FEATURE_SEED].sort((left, right) => left.code.localeCompare(right.code))
    );
    expect(limits.map((limit) => limitFields(limit))).toEqual(
      [...LIMIT_SEED].sort((left, right) =>
        `${left.planCode}:${left.metricKey}`.localeCompare(`${right.planCode}:${right.metricKey}`)
      )
    );
    expect(await Plan.count()).toBe(PLAN_SEED.length);
    expect(await Feature.count()).toBe(FEATURE_SEED.length);
    expect(await UsageLimit.count()).toBe(LIMIT_SEED.length);
    expect(await PlanFeature.count()).toBe(0);
    expect(
      await UsageLimit.count({
        where: { metricKey: { [Op.in]: MONTHLY_METRIC_KEYS } }
      })
    ).toBe(0);
    expect(await Subscription.count()).toBe(0);
    expect(await UsageRecord.count()).toBe(0);
    expect(await UserCreditBalance.count()).toBe(0);
  });

  it('removes only the seeded catalog rows and leaves unrelated catalog rows in place', async () => {
    await planCatalogSeeder.up(queryInterface());

    const otherPlan = await Plan.create({
      code: 'OTHER_PLAN',
      name: 'Other plan',
      billingInterval: 'NONE',
      priceInCents: 100,
      currency: 'INR',
      isActive: true,
      displayOrder: 9,
      ...timestamps()
    });
    await Feature.create({
      code: 'OTHER_FEATURE',
      name: 'Other feature',
      description: 'Not part of the plan catalog seeder',
      isActive: true,
      ...timestamps()
    });
    await UsageLimit.create({
      planId: otherPlan.id,
      metricKey: 'DAILY_LIKE_PASS',
      limitValue: 3,
      periodType: 'DAILY',
      ...timestamps()
    });
    await UsageLimit.create({
      planId: otherPlan.id,
      metricKey: 'MONTHLY_SUPER_LIKES',
      limitValue: 5,
      periodType: 'MONTHLY',
      ...timestamps()
    });

    await planCatalogSeeder.down(queryInterface());

    const remainingPlans = await Plan.findAll();
    const remainingFeatures = await Feature.findAll();
    const remainingLimits = await UsageLimit.findAll({ order: [['metricKey', 'ASC']] });

    expect(remainingPlans.map((plan) => plan.code)).toEqual(['OTHER_PLAN']);
    expect(remainingFeatures.map((feature) => feature.code)).toEqual(['OTHER_FEATURE']);
    expect(
      remainingLimits.map((limit) => ({
        planId: limit.planId,
        metricKey: limit.metricKey,
        limitValue: limit.limitValue,
        periodType: limit.periodType
      }))
    ).toEqual([
      {
        planId: otherPlan.id,
        metricKey: 'DAILY_LIKE_PASS',
        limitValue: 3,
        periodType: 'DAILY'
      },
      {
        planId: otherPlan.id,
        metricKey: 'MONTHLY_SUPER_LIKES',
        limitValue: 5,
        periodType: 'MONTHLY'
      }
    ]);
    expect(await Plan.count({ where: { code: { [Op.in]: SEEDED_PLAN_CODES } } })).toBe(0);
    expect(await Feature.count({ where: { code: { [Op.in]: SEEDED_FEATURE_CODES } } })).toBe(0);
    expect(await PlanFeature.count()).toBe(0);
    expect(await Subscription.count()).toBe(0);
    expect(await UsageRecord.count()).toBe(0);
    expect(await UserCreditBalance.count()).toBe(0);
  });
});
