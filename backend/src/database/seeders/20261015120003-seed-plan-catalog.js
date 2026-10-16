'use strict';

const { QueryTypes } = require('sequelize');

const PLANS = [
  {
    code: 'FREE',
    name: 'Free Tier',
    billingInterval: 'NONE',
    priceInCents: 0,
    currency: 'INR',
    displayOrder: 1
  },
  {
    code: 'PREMIUM_MONTHLY',
    name: 'Love Bite Premium (Monthly)',
    billingInterval: 'MONTH',
    priceInCents: 49900,
    currency: 'INR',
    displayOrder: 2
  },
  {
    code: 'PREMIUM_YEARLY',
    name: 'Love Bite Premium (Yearly)',
    billingInterval: 'YEAR',
    priceInCents: 399900,
    currency: 'INR',
    displayOrder: 3
  }
];

const FEATURES = [
  {
    code: 'UNLIMITED_SWIPES',
    name: 'Unlimited Swipes',
    description: 'Unlimited daily Likes and Passes'
  },
  {
    code: 'SEE_WHO_LIKED_YOU',
    name: 'See Who Liked You',
    description: 'Unlock admirer profiles in Who Liked You'
  },
  {
    code: 'ADVANCED_FILTERS',
    name: 'Advanced Filters',
    description: 'Filter by education, occupation, and lifestyle'
  },
  {
    code: 'UNDO_ACTION',
    name: 'Undo Last Action',
    description: 'Rewind accidental Left and Right swipes'
  },
  {
    code: 'CHAT_MEDIA',
    name: 'Rich Media Chat',
    description: 'Send images, audio notes, GIFs, and videos'
  },
  {
    code: 'AD_FREE',
    name: 'Ad-Free Experience',
    description: 'Zero third-party advertisements in app'
  },
  {
    code: 'PRIORITY_VISIBILITY',
    name: 'Priority Profile Visibility',
    description: 'Elevated ranking in regional discovery queues'
  },
  {
    code: 'MONTHLY_BOOST',
    name: 'Monthly Boost Credits',
    description: 'Monthly allocation of profile Boost sessions'
  },
  {
    code: 'MONTHLY_SUPER_LIKE',
    name: 'Monthly Super Likes',
    description: 'Monthly allocation of Super Likes'
  }
];

const USAGE_LIMITS = [
  { planCode: 'FREE', metricKey: 'DAILY_LIKE_PASS', limitValue: 10, periodType: 'DAILY' },
  { planCode: 'FREE', metricKey: 'DAILY_TEXT_MESSAGES', limitValue: 20, periodType: 'DAILY' },
  { planCode: 'PREMIUM_MONTHLY', metricKey: 'DAILY_LIKE_PASS', limitValue: -1, periodType: 'DAILY' },
  { planCode: 'PREMIUM_MONTHLY', metricKey: 'DAILY_TEXT_MESSAGES', limitValue: -1, periodType: 'DAILY' },
  { planCode: 'PREMIUM_YEARLY', metricKey: 'DAILY_LIKE_PASS', limitValue: -1, periodType: 'DAILY' },
  { planCode: 'PREMIUM_YEARLY', metricKey: 'DAILY_TEXT_MESSAGES', limitValue: -1, periodType: 'DAILY' }
];

const PLAN_CODES = PLANS.map((plan) => plan.code);
const FEATURE_CODES = FEATURES.map((feature) => feature.code);
const SEEDED_METRIC_KEYS = ['DAILY_LIKE_PASS', 'DAILY_TEXT_MESSAGES'];

function indexedReplacements(rows, fields) {
  return rows.reduce((values, row, index) => {
    for (const field of fields) {
      values[`${field}${index}`] = row[field];
    }
    return values;
  }, {});
}

function planInsertSql() {
  const rows = PLANS.map(
    (_plan, index) =>
      `(gen_random_uuid(), :code${index}, :name${index}, :billingInterval${index}, :priceInCents${index}, :currency${index}, TRUE, :displayOrder${index}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).join(',\n          ');

  return `
    INSERT INTO plans (
      id, code, name, billing_interval, price_in_cents, currency, is_active, display_order, created_at, updated_at
    )
    VALUES
      ${rows}
    ON CONFLICT (code) DO UPDATE
    SET
      name = EXCLUDED.name,
      billing_interval = EXCLUDED.billing_interval,
      price_in_cents = EXCLUDED.price_in_cents,
      currency = EXCLUDED.currency,
      is_active = EXCLUDED.is_active,
      display_order = EXCLUDED.display_order,
      updated_at = CURRENT_TIMESTAMP
  `;
}

function featureInsertSql() {
  const rows = FEATURES.map(
    (_feature, index) =>
      `(gen_random_uuid(), :code${index}, :name${index}, :description${index}, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).join(',\n          ');

  return `
    INSERT INTO features (
      id, code, name, description, is_active, created_at, updated_at
    )
    VALUES
      ${rows}
    ON CONFLICT (code) DO UPDATE
    SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      is_active = EXCLUDED.is_active,
      updated_at = CURRENT_TIMESTAMP
  `;
}

function usageLimitInsertSql() {
  const rows = USAGE_LIMITS.map(
    (_limit, index) =>
      `(:planCode${index}, :metricKey${index}, :limitValue${index}, :periodType${index})`
  ).join(',\n          ');

  return `
    INSERT INTO usage_limits (
      id, plan_id, metric_key, limit_value, period_type, created_at, updated_at
    )
    SELECT
      gen_random_uuid(),
      plans.id,
      seed.metric_key,
      seed.limit_value::integer,
      seed.period_type,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    FROM (
      VALUES
        ${rows}
    ) AS seed(plan_code, metric_key, limit_value, period_type)
    INNER JOIN plans ON plans.code = seed.plan_code
    ON CONFLICT (plan_id, metric_key) DO UPDATE
    SET
      limit_value = EXCLUDED.limit_value,
      period_type = EXCLUDED.period_type,
      updated_at = CURRENT_TIMESTAMP
    RETURNING metric_key
  `;
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(planInsertSql(), {
        replacements: indexedReplacements(PLANS, [
          'code',
          'name',
          'billingInterval',
          'priceInCents',
          'currency',
          'displayOrder'
        ]),
        transaction
      });

      await queryInterface.sequelize.query(featureInsertSql(), {
        replacements: indexedReplacements(FEATURES, ['code', 'name', 'description']),
        transaction
      });

      const limits = await queryInterface.sequelize.query(usageLimitInsertSql(), {
        replacements: indexedReplacements(USAGE_LIMITS, ['planCode', 'metricKey', 'limitValue', 'periodType']),
        transaction,
        type: QueryTypes.SELECT
      });

      if (limits.length !== USAGE_LIMITS.length) {
        throw new Error(
          `Plan catalog seeder resolved ${limits.length} usage limits; expected ${USAGE_LIMITS.length}. Plan ids are resolved by code after the plan upsert.`
        );
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `DELETE FROM usage_limits
         WHERE metric_key IN (:metricKeys)
           AND plan_id IN (SELECT id FROM plans WHERE code IN (:planCodes))`,
        {
          replacements: { metricKeys: SEEDED_METRIC_KEYS, planCodes: PLAN_CODES },
          transaction
        }
      );

      await queryInterface.sequelize.query(`DELETE FROM features WHERE code IN (:featureCodes)`, {
        replacements: { featureCodes: FEATURE_CODES },
        transaction
      });

      await queryInterface.sequelize.query(`DELETE FROM plans WHERE code IN (:planCodes)`, {
        replacements: { planCodes: PLAN_CODES },
        transaction
      });
    });
  }
};
