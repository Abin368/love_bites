import { Transaction } from 'sequelize';
import { InternalServerError, RateLimitError } from '../../src/utils/errors';

jest.mock('../../src/modules/likes/likes.data-access', () => ({
  DAILY_LIKE_PASS_METRIC: 'DAILY_LIKE_PASS',
  DAILY_TEXT_MESSAGES_METRIC: 'DAILY_TEXT_MESSAGES',
  findQualifyingPremiumPlan: jest.fn(),
  incrementDailyLikePass: jest.fn(),
  incrementDailyTextMessages: jest.fn()
}));

jest.mock('../../src/modules/entitlements/entitlements.data-access', () => ({
  findPlanByCode: jest.fn(),
  findUsageLimit: jest.fn()
}));

import { consumeDailyQuota } from '../../src/modules/entitlements/usage.service';
import { findPlanByCode, findUsageLimit } from '../../src/modules/entitlements/entitlements.data-access';
import {
  DAILY_LIKE_PASS_METRIC,
  DAILY_TEXT_MESSAGES_METRIC,
  findQualifyingPremiumPlan,
  incrementDailyLikePass,
  incrementDailyTextMessages
} from '../../src/modules/likes/likes.data-access';

const qualifying = findQualifyingPremiumPlan as jest.MockedFunction<typeof findQualifyingPremiumPlan>;
const findPlan = findPlanByCode as jest.MockedFunction<typeof findPlanByCode>;
const findLimit = findUsageLimit as jest.MockedFunction<typeof findUsageLimit>;
const incrementLikes = incrementDailyLikePass as jest.MockedFunction<typeof incrementDailyLikePass>;
const incrementText = incrementDailyTextMessages as jest.MockedFunction<typeof incrementDailyTextMessages>;
const transaction = { id: 'caller-transaction' } as Transaction;
const userId = 'user-1';
const freePlan = { id: 'free-plan', code: 'FREE' };
const monthlyPlan = { id: 'monthly-plan', code: 'PREMIUM_MONTHLY' };

function useFreePlan(): void {
  qualifying.mockResolvedValue(null);
  findPlan.mockResolvedValue(freePlan as Awaited<ReturnType<typeof findPlanByCode>>);
}

function useLimit(limitValue: number, periodType: 'DAILY' | 'MONTHLY' | 'LIFETIME' = 'DAILY'): void {
  findLimit.mockResolvedValue({
    limitValue,
    periodType
  } as Awaited<ReturnType<typeof findUsageLimit>>);
}

describe('consumeDailyQuota', () => {
  it('returns the remaining combined LIKE and PASS count from the free catalog limit', async () => {
    useFreePlan();
    useLimit(10);
    incrementLikes.mockResolvedValue(3);

    await expect(consumeDailyQuota(userId, DAILY_LIKE_PASS_METRIC, transaction)).resolves.toBe(7);

    expect(qualifying).toHaveBeenCalledWith(userId, transaction);
    expect(findPlan).toHaveBeenCalledWith('FREE', transaction);
    expect(findLimit).toHaveBeenCalledWith(freePlan.id, DAILY_LIKE_PASS_METRIC, transaction);
    expect(incrementLikes).toHaveBeenCalledWith(userId, transaction, 10);
    expect(incrementText).not.toHaveBeenCalled();
  });

  it('returns the remaining TEXT count from the free catalog limit', async () => {
    useFreePlan();
    useLimit(20);
    incrementText.mockResolvedValue(5);

    await expect(consumeDailyQuota(userId, DAILY_TEXT_MESSAGES_METRIC, transaction)).resolves.toBe(15);

    expect(incrementText).toHaveBeenCalledWith(userId, transaction, 20);
    expect(incrementLikes).not.toHaveBeenCalled();
  });

  it('uses a positive catalog limit other than the historical constants', async () => {
    useFreePlan();
    useLimit(4);
    incrementLikes.mockResolvedValue(2);

    await expect(consumeDailyQuota(userId, DAILY_LIKE_PASS_METRIC, transaction)).resolves.toBe(2);

    expect(incrementLikes).toHaveBeenCalledWith(userId, transaction, 4);
  });

  it('returns null for a premium caller with a catalog limit of -1 and does not increment usage', async () => {
    qualifying.mockResolvedValue(monthlyPlan);
    useLimit(-1);

    await expect(consumeDailyQuota(userId, DAILY_LIKE_PASS_METRIC, transaction)).resolves.toBeNull();
    await expect(consumeDailyQuota(userId, DAILY_TEXT_MESSAGES_METRIC, transaction)).resolves.toBeNull();

    expect(findPlan).not.toHaveBeenCalled();
    expect(incrementLikes).not.toHaveBeenCalled();
    expect(incrementText).not.toHaveBeenCalled();
  });

  it('throws the existing LIKE and PASS limit error when the combined quota is exhausted', async () => {
    useFreePlan();
    useLimit(10);
    incrementLikes.mockResolvedValue(null);

    await expect(consumeDailyQuota(userId, DAILY_LIKE_PASS_METRIC, transaction)).rejects.toMatchObject({
      statusCode: 429,
      errorCode: 'DAILY_LIMIT_REACHED',
      message: 'You have reached your daily limit of 10 likes/passes.'
    });
    await expect(consumeDailyQuota(userId, DAILY_LIKE_PASS_METRIC, transaction)).rejects.toBeInstanceOf(RateLimitError);
    expect(incrementText).not.toHaveBeenCalled();
  });

  it('throws the existing TEXT limit error when the message quota is exhausted', async () => {
    useFreePlan();
    useLimit(20);
    incrementText.mockResolvedValue(null);

    await expect(consumeDailyQuota(userId, DAILY_TEXT_MESSAGES_METRIC, transaction)).rejects.toMatchObject({
      statusCode: 429,
      errorCode: 'DAILY_LIMIT_REACHED',
      message: 'You have reached your daily limit of 20 text messages.'
    });
  });

  it('rejects a zero limit before the usage upsert', async () => {
    useFreePlan();
    useLimit(0);

    await expect(consumeDailyQuota(userId, DAILY_LIKE_PASS_METRIC, transaction)).rejects.toMatchObject({
      statusCode: 429,
      errorCode: 'DAILY_LIMIT_REACHED',
      message: 'You have reached your daily limit of 0 likes/passes.'
    });
    await expect(consumeDailyQuota(userId, DAILY_TEXT_MESSAGES_METRIC, transaction)).rejects.toMatchObject({
      statusCode: 429,
      errorCode: 'DAILY_LIMIT_REACHED',
      message: 'You have reached your daily limit of 0 text messages.'
    });
    expect(incrementLikes).not.toHaveBeenCalled();
    expect(incrementText).not.toHaveBeenCalled();
  });

  it('fails closed when the free plan or the usage-limit row is missing', async () => {
    qualifying.mockResolvedValue(null);
    findPlan.mockResolvedValue(null);

    await expect(consumeDailyQuota(userId, DAILY_LIKE_PASS_METRIC, transaction)).rejects.toMatchObject({
      statusCode: 500,
      errorCode: 'INTERNAL_SERVER_ERROR',
      isOperational: true
    });
    await expect(consumeDailyQuota(userId, DAILY_LIKE_PASS_METRIC, transaction)).rejects.toBeInstanceOf(
      InternalServerError
    );

    useFreePlan();
    findLimit.mockResolvedValue(null);
    await expect(consumeDailyQuota(userId, DAILY_TEXT_MESSAGES_METRIC, transaction)).rejects.toMatchObject({
      statusCode: 500,
      errorCode: 'INTERNAL_SERVER_ERROR'
    });
    expect(incrementLikes).not.toHaveBeenCalled();
    expect(incrementText).not.toHaveBeenCalled();
  });

  it('fails closed for an unsupported period, a limit below -1, or free unlimited', async () => {
    useFreePlan();
    useLimit(10, 'MONTHLY');
    await expect(consumeDailyQuota(userId, DAILY_LIKE_PASS_METRIC, transaction)).rejects.toMatchObject({
      statusCode: 500,
      errorCode: 'INTERNAL_SERVER_ERROR',
      isOperational: true
    });

    useLimit(-2);
    await expect(consumeDailyQuota(userId, DAILY_LIKE_PASS_METRIC, transaction)).rejects.toMatchObject({
      statusCode: 500,
      errorCode: 'INTERNAL_SERVER_ERROR'
    });

    useLimit(-1);
    await expect(consumeDailyQuota(userId, DAILY_TEXT_MESSAGES_METRIC, transaction)).rejects.toMatchObject({
      statusCode: 500,
      errorCode: 'INTERNAL_SERVER_ERROR'
    });
    expect(incrementLikes).not.toHaveBeenCalled();
    expect(incrementText).not.toHaveBeenCalled();
  });
});
