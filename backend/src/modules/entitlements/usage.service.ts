import { Transaction } from 'sequelize';
import { RateLimitError } from '../../utils/errors';
import {
  DAILY_LIKE_PASS_METRIC,
  DAILY_TEXT_MESSAGES_METRIC,
  FREE_DAILY_LIKE_PASS_LIMIT,
  FREE_DAILY_TEXT_MESSAGES_LIMIT,
  hasActivePremium,
  incrementDailyLikePass,
  incrementDailyTextMessages
} from '../likes/likes.data-access';

const DAILY_LIKE_PASS_LIMIT_MESSAGE = 'You have reached your daily limit of 10 likes/passes.';
const DAILY_TEXT_LIMIT_MESSAGE = 'You have reached your daily limit of 20 text messages.';

export type DailyQuotaMetric = typeof DAILY_LIKE_PASS_METRIC | typeof DAILY_TEXT_MESSAGES_METRIC;

export async function consumeDailyQuota(
  userId: string,
  metricKey: DailyQuotaMetric,
  transaction: Transaction
): Promise<number | null> {
  if (await hasActivePremium(userId, transaction)) {
    return null;
  }

  const usageCount =
    metricKey === DAILY_LIKE_PASS_METRIC
      ? await incrementDailyLikePass(userId, transaction)
      : await incrementDailyTextMessages(userId, transaction);

  if (usageCount === null) {
    const message = metricKey === DAILY_LIKE_PASS_METRIC ? DAILY_LIKE_PASS_LIMIT_MESSAGE : DAILY_TEXT_LIMIT_MESSAGE;
    throw new RateLimitError(message, [], 'DAILY_LIMIT_REACHED');
  }

  const limit = metricKey === DAILY_LIKE_PASS_METRIC ? FREE_DAILY_LIKE_PASS_LIMIT : FREE_DAILY_TEXT_MESSAGES_LIMIT;
  return limit - usageCount;
}
