import { Transaction } from 'sequelize';
import { InternalServerError, RateLimitError } from '../../utils/errors';
import {
  DAILY_LIKE_PASS_METRIC,
  DAILY_TEXT_MESSAGES_METRIC,
  findQualifyingPremiumPlan,
  type QualifyingPremiumPlan,
  incrementDailyLikePass,
  incrementDailyTextMessages
} from '../likes/likes.data-access';
import { findPlanByCode, findUsageLimit } from './entitlements.data-access';

const FREE_PLAN_CODE = 'FREE';

export type DailyQuotaMetric = typeof DAILY_LIKE_PASS_METRIC | typeof DAILY_TEXT_MESSAGES_METRIC;

function dailyLimitMessage(metricKey: DailyQuotaMetric, limit: number): string {
  if (metricKey === DAILY_LIKE_PASS_METRIC) {
    return `You have reached your daily limit of ${limit} likes/passes.`;
  }

  return `You have reached your daily limit of ${limit} text messages.`;
}

function unavailableCatalog(): InternalServerError {
  return new InternalServerError('Internal server error', [], 'INTERNAL_SERVER_ERROR', true);
}

function catalogLimit(limitValue: unknown, periodType: string): number {
  if (periodType !== 'DAILY' || limitValue === null || limitValue === undefined || limitValue === '') {
    throw unavailableCatalog();
  }

  const limit = typeof limitValue === 'number' ? limitValue : Number(limitValue);
  if (!Number.isInteger(limit) || limit < -1) {
    throw unavailableCatalog();
  }

  return limit;
}

async function resolveQuotaPlan(
  userId: string,
  transaction: Transaction
): Promise<{ plan: QualifyingPremiumPlan; premium: boolean }> {
  const premiumPlan = await findQualifyingPremiumPlan(userId, transaction);
  if (premiumPlan) {
    return { plan: premiumPlan, premium: true };
  }

  const freePlan = await findPlanByCode(FREE_PLAN_CODE, transaction);
  if (!freePlan) {
    throw unavailableCatalog();
  }

  return { plan: { id: freePlan.id, code: freePlan.code }, premium: false };
}

export async function consumeDailyQuota(
  userId: string,
  metricKey: DailyQuotaMetric,
  transaction: Transaction
): Promise<number | null> {
  const { plan, premium } = await resolveQuotaPlan(userId, transaction);
  const limitRow = await findUsageLimit(plan.id, metricKey, transaction);
  if (!limitRow) {
    throw unavailableCatalog();
  }

  const limit = catalogLimit(limitRow.limitValue, limitRow.periodType);
  if (limit === -1) {
    if (premium) {
      return null;
    }
    throw unavailableCatalog();
  }

  if (limit === 0) {
    throw new RateLimitError(dailyLimitMessage(metricKey, 0), [], 'DAILY_LIMIT_REACHED');
  }

  const usageCount =
    metricKey === DAILY_LIKE_PASS_METRIC
      ? await incrementDailyLikePass(userId, transaction, limit)
      : await incrementDailyTextMessages(userId, transaction, limit);

  if (usageCount === null) {
    throw new RateLimitError(dailyLimitMessage(metricKey, limit), [], 'DAILY_LIMIT_REACHED');
  }

  return limit - usageCount;
}
