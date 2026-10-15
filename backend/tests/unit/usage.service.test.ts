import { Transaction } from 'sequelize';
import { RateLimitError } from '../../src/utils/errors';

jest.mock('../../src/modules/likes/likes.data-access', () => ({
  DAILY_LIKE_PASS_METRIC: 'DAILY_LIKE_PASS',
  DAILY_TEXT_MESSAGES_METRIC: 'DAILY_TEXT_MESSAGES',
  FREE_DAILY_LIKE_PASS_LIMIT: 10,
  FREE_DAILY_TEXT_MESSAGES_LIMIT: 20,
  hasActivePremium: jest.fn(),
  incrementDailyLikePass: jest.fn(),
  incrementDailyTextMessages: jest.fn()
}));

import { consumeDailyQuota } from '../../src/modules/entitlements/usage.service';
import {
  DAILY_LIKE_PASS_METRIC,
  DAILY_TEXT_MESSAGES_METRIC,
  hasActivePremium,
  incrementDailyLikePass,
  incrementDailyTextMessages
} from '../../src/modules/likes/likes.data-access';

const premium = hasActivePremium as jest.MockedFunction<typeof hasActivePremium>;
const incrementLikes = incrementDailyLikePass as jest.MockedFunction<typeof incrementDailyLikePass>;
const incrementText = incrementDailyTextMessages as jest.MockedFunction<typeof incrementDailyTextMessages>;
const transaction = { id: 'caller-transaction' } as Transaction;
const userId = 'user-1';

describe('consumeDailyQuota', () => {
  it('returns the remaining combined LIKE and PASS count for a free caller', async () => {
    premium.mockResolvedValue(false);
    incrementLikes.mockResolvedValue(3);

    await expect(consumeDailyQuota(userId, DAILY_LIKE_PASS_METRIC, transaction)).resolves.toBe(7);

    expect(premium).toHaveBeenCalledWith(userId, transaction);
    expect(incrementLikes).toHaveBeenCalledWith(userId, transaction);
    expect(incrementText).not.toHaveBeenCalled();
  });

  it('returns the remaining TEXT count for a free caller', async () => {
    premium.mockResolvedValue(false);
    incrementText.mockResolvedValue(5);

    await expect(consumeDailyQuota(userId, DAILY_TEXT_MESSAGES_METRIC, transaction)).resolves.toBe(15);

    expect(incrementText).toHaveBeenCalledWith(userId, transaction);
    expect(incrementLikes).not.toHaveBeenCalled();
  });

  it('returns null for a premium caller and does not increment usage', async () => {
    premium.mockResolvedValue(true);

    await expect(consumeDailyQuota(userId, DAILY_LIKE_PASS_METRIC, transaction)).resolves.toBeNull();
    await expect(consumeDailyQuota(userId, DAILY_TEXT_MESSAGES_METRIC, transaction)).resolves.toBeNull();

    expect(incrementLikes).not.toHaveBeenCalled();
    expect(incrementText).not.toHaveBeenCalled();
  });

  it('throws the existing LIKE and PASS limit error when the combined quota is exhausted', async () => {
    premium.mockResolvedValue(false);
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
    premium.mockResolvedValue(false);
    incrementText.mockResolvedValue(null);

    await expect(consumeDailyQuota(userId, DAILY_TEXT_MESSAGES_METRIC, transaction)).rejects.toMatchObject({
      statusCode: 429,
      errorCode: 'DAILY_LIMIT_REACHED',
      message: 'You have reached your daily limit of 20 text messages.'
    });
  });
});
